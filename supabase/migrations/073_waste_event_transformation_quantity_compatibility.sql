-- Waste recording must post an inventory movement on both schema variants:
-- older/live workspaces use transformation_events.quantity, while some newer
-- movement-ledger code can also read quantity_delta when present.

create or replace function public.create_dashboard_waste_event(
  target_inventory_item_id uuid,
  waste_quantity numeric,
  waste_reason_value text default 'spoilage',
  waste_stage_value text default 'prep',
  waste_notes_value text default null
)
returns public.waste_events
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  selected_item public.inventory_items;
  created_waste_event public.waste_events;
  has_legacy_item_id boolean;
  has_legacy_tenant_id boolean;
  movement_quantity_column text;
  normalized_reason text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to record waste.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before recording waste.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  if waste_quantity is null or waste_quantity <= 0 then
    raise exception 'Waste quantity must be greater than zero.';
  end if;

  select *
    into selected_item
  from public.inventory_items
  where id = target_inventory_item_id
    and organization_id = current_organization_id
    and is_active = true;

  if selected_item.id is null then
    raise exception 'Inventory item not found for this workspace.';
  end if;

  normalized_reason := public.normalize_waste_reason(waste_reason_value);

  if coalesce(selected_item.yield_pct, 1) < 1
     and normalized_reason in (
       'prep_waste',
       'prep',
       'trim_waste',
       'trimming',
       'over_trimming',
       'processing_loss',
       'yield_loss'
     ) then
    raise exception 'Prep Waste is blocked for % because its inherent yield is already %. Select Spoilage, Damaged, Expired, or another true waste reason.',
      coalesce(selected_item.name, selected_item.sku, 'this SKU'),
      round(coalesce(selected_item.yield_pct, 1) * 100, 2)::text || '%';
  end if;

  insert into public.waste_events (
    organization_id,
    inventory_item_id,
    quantity,
    unit_cost,
    waste_reason,
    waste_stage,
    notes,
    created_by
  ) values (
    current_organization_id,
    selected_item.id,
    waste_quantity,
    coalesce(selected_item.current_cost_per_base_uom, 0),
    coalesce(nullif(trim(waste_reason_value), ''), 'spoilage'),
    coalesce(nullif(trim(waste_stage_value), ''), 'prep'),
    nullif(trim(coalesce(waste_notes_value, '')), ''),
    current_user_id
  )
  returning * into created_waste_event;

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
       ''waste_event'',
       $3,
       %5$s
       $4,
       $5,
       ''waste_events'',
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
    current_organization_id,
    selected_item.location_id,
    selected_item.id,
    waste_quantity * -1,
    coalesce(selected_item.current_cost_per_base_uom, 0),
    created_waste_event.id,
    current_user_id;

  update public.inventory_items
     set on_hand_qty = greatest(coalesce(on_hand_qty, 0) - waste_quantity, 0)
   where id = selected_item.id
     and organization_id = current_organization_id;

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
    current_organization_id,
    selected_item.location_id,
    selected_item.id,
    'waste_variance',
    waste_quantity,
    coalesce(selected_item.current_cost_per_base_uom, 0),
    'waste_events',
    created_waste_event.id
  );

  return created_waste_event;
end;
$$;

grant execute on function public.create_dashboard_waste_event(uuid, numeric, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';
