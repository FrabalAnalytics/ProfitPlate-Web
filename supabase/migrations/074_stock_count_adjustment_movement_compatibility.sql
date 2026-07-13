-- Finance-approved stock counts and adjustments should post both the approved
-- balance and a movement event. Use the live transformation_events quantity
-- column, because some workspaces have quantity while newer ledger code can
-- also consume quantity_delta.

create or replace function public.apply_approved_dashboard_stock_count_lines(
  target_organization_id uuid,
  count_lines jsonb,
  requested_by_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_location_id uuid;
  created_stock_count_id uuid;
  count_line jsonb;
  target_inventory_item_id uuid;
  counted_quantity numeric(18, 6);
  selected_item public.inventory_items;
  system_quantity numeric(18, 6);
  variance_quantity numeric(18, 6);
  movement_quantity numeric(18, 6);
  created_line_count integer := 0;
  has_legacy_item_id boolean;
  has_legacy_tenant_id boolean;
  movement_quantity_column text;
begin
  if target_organization_id is null then
    raise exception 'A workspace is required before approving stock counts.';
  end if;

  if count_lines is null
     or jsonb_typeof(count_lines) <> 'array'
     or jsonb_array_length(count_lines) = 0 then
    raise exception 'Approved stock count has no count lines.';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transformation_events'
      and column_name = 'item_id'
  )
    into has_legacy_item_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transformation_events'
      and column_name = 'tenant_id'
  )
    into has_legacy_tenant_id;

  select case
           when exists (
             select 1
             from information_schema.columns
             where table_schema = 'public'
               and table_name = 'transformation_events'
               and column_name = 'quantity_delta'
           )
             then 'quantity_delta'
           else 'quantity'
         end
    into movement_quantity_column;

  for count_line in
    select value from jsonb_array_elements(count_lines)
  loop
    target_inventory_item_id := nullif(count_line->>'inventory_item_id', '')::uuid;

    if target_inventory_item_id is null then
      raise exception 'Every approved stock count line needs an item.';
    end if;

    select *
      into selected_item
    from public.inventory_items
    where id = target_inventory_item_id
      and organization_id = target_organization_id
      and is_active = true;

    if selected_item.id is null then
      raise exception 'Inventory item not found for this workspace.';
    end if;

    if selected_location_id is null then
      selected_location_id := selected_item.location_id;
    elsif selected_location_id is distinct from selected_item.location_id then
      raise exception 'Approved stock count lines must belong to one storage location.';
    end if;
  end loop;

  if selected_location_id is null then
    select location.id
      into selected_location_id
    from public.locations location
    where location.organization_id = target_organization_id
      and location.is_active = true
    order by location.created_at asc
    limit 1;
  end if;

  if selected_location_id is null then
    insert into public.locations (
      tenant_id,
      organization_id,
      name,
      location_type,
      routing_model,
      is_active
    ) values (
      target_organization_id,
      target_organization_id,
      'Main Store',
      'main_store',
      'model_1_single_location',
      true
    )
    returning id into selected_location_id;
  end if;

  insert into public.stock_counts (
    organization_id,
    location_id,
    status,
    frozen_at,
    created_by
  ) values (
    target_organization_id,
    selected_location_id,
    'completed',
    now(),
    requested_by_user_id
  )
  returning id into created_stock_count_id;

  for count_line in
    select value from jsonb_array_elements(count_lines)
  loop
    target_inventory_item_id := nullif(count_line->>'inventory_item_id', '')::uuid;
    counted_quantity := nullif(count_line->>'counted_quantity', '')::numeric;

    if target_inventory_item_id is null
       or counted_quantity is null
       or counted_quantity < 0 then
      raise exception 'Every approved stock count line needs an item and non-negative counted quantity.';
    end if;

    select *
      into selected_item
    from public.inventory_items
    where id = target_inventory_item_id
      and organization_id = target_organization_id
      and is_active = true
    for update;

    if selected_item.id is null then
      raise exception 'Inventory item not found for this workspace.';
    end if;

    system_quantity := coalesce(selected_item.on_hand_qty, 0);
    variance_quantity := system_quantity - counted_quantity;
    movement_quantity := counted_quantity - system_quantity;

    insert into public.stock_count_lines (
      stock_count_id,
      inventory_item_id,
      counted_qty,
      system_qty,
      unit_cost
    ) values (
      created_stock_count_id,
      selected_item.id,
      counted_quantity,
      system_quantity,
      coalesce(selected_item.current_cost_per_base_uom, 0)
    );

    if variance_quantity <> 0 then
      insert into public.variance_attributions (
        organization_id,
        location_id,
        inventory_item_id,
        variance_type,
        variance_qty,
        unit_cost,
        source_table,
        source_id
      ) values (
        target_organization_id,
        selected_location_id,
        selected_item.id,
        'unrecorded_depletion',
        variance_quantity,
        coalesce(selected_item.current_cost_per_base_uom, 0),
        'stock_counts',
        created_stock_count_id
      );
    end if;

    if movement_quantity <> 0 then
      execute format(
        'insert into public.transformation_events (
           organization_id,
           %1$s
           location_id,
           event_type,
           inventory_item_id,
           %2$s
           %3$I,
           unit_cost,
           source_table,
           source_id,
           created_by
         ) values (
           $1,
           %4$s
           $2,
           ''stock_count_adjustment'',
           $3,
           %5$s
           $4,
           $5,
           ''stock_counts'',
           $6,
           $7
         )',
        case when has_legacy_tenant_id then 'tenant_id,' else '' end,
        case when has_legacy_item_id then 'item_id,' else '' end,
        movement_quantity_column,
        case when has_legacy_tenant_id then '$1,' else '' end,
        case when has_legacy_item_id then '$3,' else '' end
      )
      using
        target_organization_id,
        selected_item.location_id,
        selected_item.id,
        movement_quantity,
        coalesce(selected_item.current_cost_per_base_uom, 0),
        created_stock_count_id,
        requested_by_user_id;
    end if;

    update public.inventory_items
       set on_hand_qty = counted_quantity
     where id = selected_item.id
       and organization_id = target_organization_id;

    created_line_count := created_line_count + 1;
  end loop;

  return created_line_count;
end;
$$;

revoke execute on function public.apply_approved_dashboard_stock_count_lines(
  uuid,
  jsonb,
  uuid
) from public;

revoke execute on function public.apply_approved_dashboard_stock_count_lines(
  uuid,
  jsonb,
  uuid
) from authenticated;

notify pgrst, 'reload schema';
