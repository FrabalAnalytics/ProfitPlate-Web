-- Procurement owns vendor and SKU intake, but Finance owns the final master-data
-- approval. This keeps procurement operational without exposing or assigning
-- margin/yield-test responsibilities to the procurement role.

insert into public.operating_control_policies (
  organization_id,
  department,
  control_key,
  control_label,
  source_kind,
  blocks_operational_close,
  allows_deferment,
  allows_waiver,
  priority,
  effective_from
)
select
  organization.id,
  seed.department,
  seed.control_key,
  seed.control_label,
  'register',
  true,
  seed.allows_deferment,
  true,
  seed.priority,
  current_date
from public.organizations organization
cross join (
  values
    (
      'Procurement',
      'procurement_purchase_order_follow_up',
      'Purchase order follow-up reviewed',
      false,
      135
    ),
    (
      'Procurement',
      'procurement_vendor_sku_intake_check',
      'Vendor and SKU intake reviewed',
      false,
      125
    )
) as seed(
  department,
  control_key,
  control_label,
  allows_deferment,
  priority
)
where not exists (
  select 1
  from public.operating_control_policies existing
  where existing.organization_id = organization.id
    and existing.location_id is null
    and existing.control_key = seed.control_key
    and existing.effective_to is null
);

create or replace function public.register_approval_request_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.request_type = 'inventory_requisition' then
    perform public.mark_dashboard_operation_register_activity(
      new.organization_id,
      'requisition_register',
      'Operations',
      coalesce(new.created_at::date, current_date),
      'Inventory requisition activity was recorded.',
      'approval_requests',
      new.id
    );
  elsif new.request_type = 'stock_count_approval' then
    perform public.mark_dashboard_operation_register_activity(
      new.organization_id,
      'stock_count_register',
      'Inventory',
      coalesce(new.created_at::date, current_date),
      'Stock count activity was submitted for approval.',
      'approval_requests',
      new.id
    );
  elsif new.request_type in ('sku_creation_approval', 'vendor_creation_approval') then
    perform public.mark_dashboard_operation_register_activity(
      new.organization_id,
      'procurement_register',
      'Procurement',
      coalesce(new.created_at::date, current_date),
      'Procurement master-data intake activity was submitted for Finance approval.',
      'approval_requests',
      new.id
    );

    perform public.mark_dashboard_operation_register_activity(
      new.organization_id,
      'procurement_vendor_sku_intake_check',
      'Procurement',
      coalesce(new.created_at::date, current_date),
      'Vendor/SKU intake was submitted for Finance approval.',
      'approval_requests',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists register_approval_request_activity on public.approval_requests;
create trigger register_approval_request_activity
after insert on public.approval_requests
for each row execute function public.register_approval_request_activity();

create or replace function public.approve_dashboard_request(target_request_id uuid)
returns public.approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_user_role text;
  selected_request public.approval_requests;
  payload jsonb;
  approved_supplier_id uuid;
  approved_inventory_item_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to approve requests.';
  end if;

  select *
    into selected_request
  from public.approval_requests
  where id = target_request_id
  for update;

  if selected_request.id is null then
    raise exception 'Approval request not found.';
  end if;

  perform public.require_dashboard_permission(selected_request.organization_id, 'approval');

  if selected_request.status <> 'pending' then
    raise exception 'Only pending requests can be approved.';
  end if;

  select lower(coalesce(profile.role, ''))
    into current_user_role
  from public.profiles profile
  where profile.id = current_user_id
    and profile.organization_id = selected_request.organization_id;

  if selected_request.request_type in (
    'stock_count_approval',
    'sku_creation_approval',
    'vendor_creation_approval'
  )
     and current_user_role not in ('finance_manager', 'owner', 'admin') then
    raise exception 'This request requires Finance approval before balances or master data are posted.';
  end if;

  payload := coalesce(selected_request.payload, '{}'::jsonb);

  if selected_request.request_type = 'stock_count_approval' then
    perform public.apply_approved_dashboard_stock_count_lines(
      selected_request.organization_id,
      payload->'lines',
      selected_request.requested_by
    );
  elsif selected_request.request_type = 'vendor_creation_approval' then
    if nullif(trim(coalesce(payload->>'supplier_name', '')), '') is null then
      raise exception 'Vendor approval is missing a supplier name.';
    end if;

    insert into public.suppliers (
      organization_id,
      name,
      contact_name,
      phone,
      email,
      is_active
    ) values (
      selected_request.organization_id,
      trim(payload->>'supplier_name'),
      nullif(trim(coalesce(payload->>'contact_name', '')), ''),
      nullif(trim(coalesce(payload->>'phone', '')), ''),
      nullif(trim(coalesce(payload->>'email', '')), ''),
      true
    )
    returning id into approved_supplier_id;

    payload := payload || jsonb_build_object(
      'approved_supplier_id',
      approved_supplier_id
    );
  elsif selected_request.request_type = 'sku_creation_approval' then
    if nullif(trim(coalesce(payload->>'name', '')), '') is null
       or nullif(trim(coalesce(payload->>'base_uom', '')), '') is null then
      raise exception 'SKU approval requires item name and base UOM.';
    end if;

    insert into public.inventory_items (
      tenant_id,
      organization_id,
      location_id,
      name,
      sku,
      department,
      item_type,
      cost_type,
      base_uom,
      recipe_uom,
      on_hand_uom,
      on_hand_qty,
      current_cost_per_base_uom,
      yield_pct,
      shrinkage_factor_pct,
      is_high_value,
      is_active
    ) values (
      selected_request.organization_id,
      selected_request.organization_id,
      nullif(payload->>'location_id', '')::uuid,
      trim(payload->>'name'),
      nullif(trim(coalesce(payload->>'sku', '')), ''),
      nullif(trim(coalesce(payload->>'department', '')), ''),
      'raw_material',
      'purchased',
      trim(payload->>'base_uom'),
      trim(payload->>'base_uom'),
      trim(payload->>'base_uom'),
      0,
      greatest(coalesce(nullif(payload->>'current_cost_per_base_uom', '')::numeric, 0), 0),
      least(greatest(coalesce(nullif(payload->>'yield_pct', '')::numeric, 1), 0.0001), 1),
      least(greatest(coalesce(nullif(payload->>'shrinkage_factor_pct', '')::numeric, 0), 0), 0.99),
      coalesce(nullif(payload->>'is_high_value', '')::boolean, false),
      true
    )
    returning id into approved_inventory_item_id;

    payload := payload || jsonb_build_object(
      'approved_inventory_item_id',
      approved_inventory_item_id
    );
  end if;

  update public.approval_requests
     set status = 'accepted',
         payload = payload,
         approved_by = current_user_id,
         approved_at = now()
   where id = selected_request.id
   returning * into selected_request;

  return selected_request;
end;
$$;

grant execute on function public.approve_dashboard_request(uuid) to authenticated;

notify pgrst, 'reload schema';
