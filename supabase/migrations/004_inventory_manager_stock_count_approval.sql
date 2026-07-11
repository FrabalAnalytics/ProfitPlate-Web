-- Inventory role upgrade and stock count approval gate.

update public.profiles
set role = 'inventory_manager'
where role = 'inventory_clerk';

alter table if exists public.profiles
  drop constraint if exists profiles_role_allowed;

alter table if exists public.profiles
  add constraint profiles_role_allowed check (
    role in (
      'owner',
      'admin',
      'manager',
      'operations_manager',
      'procurement_manager',
      'finance_manager',
      'inventory_manager',
      'chef',
      'viewer'
    )
  );

create or replace function public.user_can_record_operations(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.user_can_access_organization(target_organization_id)
    and public.user_has_any_role(
      array[
        'owner',
        'admin',
        'manager',
        'operations_manager',
        'procurement_manager',
        'inventory_manager',
        'chef'
      ]
    );
$$;

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
  created_line_count integer := 0;
begin
  if target_organization_id is null then
    raise exception 'A workspace is required before approving stock counts.';
  end if;

  if count_lines is null or jsonb_typeof(count_lines) <> 'array' or jsonb_array_length(count_lines) = 0 then
    raise exception 'Approved stock count has no count lines.';
  end if;

  select l.id
    into selected_location_id
  from public.locations l
  where l.organization_id = target_organization_id
    and l.is_active = true
  order by l.created_at asc
  limit 1;

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
      and is_active = true;

    if selected_item.id is null then
      raise exception 'Inventory item not found for this workspace.';
    end if;

    system_quantity := coalesce(selected_item.on_hand_qty, 0);
    variance_quantity := system_quantity - counted_quantity;

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

    update public.inventory_items
       set on_hand_qty = counted_quantity
     where id = selected_item.id
       and organization_id = target_organization_id;

    created_line_count := created_line_count + 1;
  end loop;

  return created_line_count;
end;
$$;

revoke execute on function public.apply_approved_dashboard_stock_count_lines(uuid, jsonb, uuid) from public;
revoke execute on function public.apply_approved_dashboard_stock_count_lines(uuid, jsonb, uuid) from authenticated;
revoke execute on function public.create_dashboard_stock_count(uuid, numeric) from public;
revoke execute on function public.create_dashboard_stock_count(uuid, numeric) from authenticated;
revoke execute on function public.create_dashboard_stock_count_lines(jsonb) from public;
revoke execute on function public.create_dashboard_stock_count_lines(jsonb) from authenticated;

create or replace function public.approve_dashboard_request(target_request_id uuid)
returns public.approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  selected_request public.approval_requests;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to approve requests.';
  end if;

  select *
    into selected_request
  from public.approval_requests
  where id = target_request_id;

  if selected_request.id is null then
    raise exception 'Approval request not found.';
  end if;

  perform public.require_dashboard_permission(selected_request.organization_id, 'approval');

  if selected_request.status <> 'pending' then
    raise exception 'Only pending requests can be approved.';
  end if;

  if selected_request.request_type = 'stock_count_approval' then
    perform public.apply_approved_dashboard_stock_count_lines(
      selected_request.organization_id,
      selected_request.payload->'lines',
      selected_request.requested_by
    );
  end if;

  update public.approval_requests
     set status = 'accepted',
         approved_by = current_user_id,
         approved_at = now()
   where id = selected_request.id
   returning * into selected_request;

  return selected_request;
end;
$$;

grant execute on function public.approve_dashboard_request(uuid) to authenticated;

notify pgrst, 'reload schema';
