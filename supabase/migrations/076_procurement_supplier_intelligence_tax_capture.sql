-- Procurement intelligence needs tax captured separately from landed cost.
-- Landed cost continues to drive inventory valuation and recipe costing, while
-- VAT/tax can be reported by Finance and management without polluting food cost.

alter table if exists public.purchase_order_lines
  add column if not exists tax_rate_pct numeric(7, 4) not null default 0,
  add column if not exists tax_amount numeric(18, 6) not null default 0,
  add column if not exists tax_inclusive boolean not null default false;

alter table if exists public.purchase_order_lines
  drop constraint if exists purchase_order_lines_tax_rate_pct_check;

alter table if exists public.purchase_order_lines
  add constraint purchase_order_lines_tax_rate_pct_check check (
    tax_rate_pct >= 0
    and tax_rate_pct <= 100
  );

alter table if exists public.purchase_order_lines
  drop constraint if exists purchase_order_lines_tax_amount_check;

alter table if exists public.purchase_order_lines
  add constraint purchase_order_lines_tax_amount_check check (tax_amount >= 0);

create or replace function public.update_dashboard_purchase_order(
  target_purchase_order_id uuid,
  target_supplier_id uuid,
  target_supplier_name text,
  target_receiving_location_id uuid,
  target_purchase_lines jsonb
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  profile_role text;
  normalized_role text;
  selected_order public.purchase_orders;
  line_item jsonb;
  expected_line_count integer;
  inserted_line_count integer := 0;
  updated_order public.purchase_orders;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to edit a purchase order.';
  end if;

  select p.organization_id, p.role::text
    into current_organization_id, profile_role
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before editing purchase orders.';
  end if;

  normalized_role := lower(
    replace(
      replace(
        trim(coalesce(profile_role, 'viewer')),
        ' ',
        '_'
      ),
      '-',
      '_'
    )
  );

  if normalized_role not in (
    'owner',
    'admin',
    'manager',
    'operations_manager',
    'procurement_manager'
  ) then
    raise exception 'Only procurement and operations leaders can edit open purchase orders. Current role: %', coalesce(profile_role, 'none');
  end if;

  select *
    into selected_order
  from public.purchase_orders
  where id = target_purchase_order_id
    and organization_id = current_organization_id
  for update;

  if selected_order.id is null then
    raise exception 'Purchase order not found for this workspace.';
  end if;

  if selected_order.status not in ('draft', 'pending', 'accepted') then
    raise exception 'Only open purchase orders can be edited before receipt.';
  end if;

  expected_line_count := jsonb_array_length(coalesce(target_purchase_lines, '[]'::jsonb));

  if jsonb_typeof(coalesce(target_purchase_lines, '[]'::jsonb)) <> 'array'
     or expected_line_count = 0 then
    raise exception 'Add at least one purchase order line.';
  end if;

  for line_item in
    select * from jsonb_array_elements(target_purchase_lines)
  loop
    if nullif(line_item->>'inventory_item_id', '') is null
       or coalesce((line_item->>'quantity')::numeric, 0) <= 0
       or coalesce((line_item->>'landed_unit_cost')::numeric, -1) < 0
       or coalesce(nullif(line_item->>'tax_rate_pct', '')::numeric, 0) < 0
       or coalesce(nullif(line_item->>'tax_rate_pct', '')::numeric, 0) > 100
       or coalesce(nullif(line_item->>'tax_amount', '')::numeric, 0) < 0 then
      raise exception 'Each purchase order line needs an item, quantity, expected unit cost, and valid tax value.';
    end if;

    if not exists (
      select 1
      from public.inventory_items ii
      where ii.id = nullif(line_item->>'inventory_item_id', '')::uuid
        and ii.organization_id = current_organization_id
        and ii.cost_type::text = 'purchased'
        and ii.is_active = true
    ) then
      raise exception 'One purchase order item is not an active purchased SKU in this workspace.';
    end if;
  end loop;

  update public.purchase_orders
     set supplier_id = target_supplier_id,
         supplier_name = nullif(target_supplier_name, ''),
         receiving_location_id = target_receiving_location_id
   where id = selected_order.id
     and organization_id = current_organization_id
   returning * into updated_order;

  delete from public.purchase_order_lines
   where purchase_order_id = selected_order.id;

  for line_item in
    select * from jsonb_array_elements(target_purchase_lines)
  loop
    insert into public.purchase_order_lines (
      purchase_order_id,
      inventory_item_id,
      qty,
      landed_unit_cost,
      tax_rate_pct,
      tax_amount,
      tax_inclusive
    ) values (
      selected_order.id,
      nullif(line_item->>'inventory_item_id', '')::uuid,
      (line_item->>'quantity')::numeric,
      (line_item->>'landed_unit_cost')::numeric,
      coalesce(nullif(line_item->>'tax_rate_pct', '')::numeric, 0),
      coalesce(nullif(line_item->>'tax_amount', '')::numeric, 0),
      coalesce(nullif(line_item->>'tax_inclusive', '')::boolean, false)
    );

    inserted_line_count := inserted_line_count + 1;
  end loop;

  if inserted_line_count <> expected_line_count then
    raise exception 'Purchase order edit did not save every line. Please retry.';
  end if;

  return updated_order;
end;
$$;

grant execute on function public.update_dashboard_purchase_order(uuid, uuid, text, uuid, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
