-- Preserve ordered quantities while allowing partial supplier deliveries to hit stock.

alter table public.purchase_order_lines
  add column if not exists received_qty numeric(18, 6) not null default 0;

alter table public.purchase_orders
  add column if not exists receipt_status text not null default 'open',
  add column if not exists short_supply_reason text;

alter table public.purchase_orders
  drop constraint if exists purchase_orders_receipt_status_check;
alter table public.purchase_orders
  add constraint purchase_orders_receipt_status_check check (
    receipt_status in ('open', 'partially_received', 'completed', 'closed_short')
  );

create table if not exists public.purchase_order_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  grn_number text not null,
  receipt_status text not null,
  short_supply_reason text,
  received_by uuid references auth.users(id) on delete set null default auth.uid(),
  received_at timestamptz not null default now(),
  constraint purchase_order_receipts_status_check check (
    receipt_status in ('partial', 'complete')
  ),
  unique (organization_id, grn_number)
);

create table if not exists public.purchase_order_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.purchase_order_receipts(id) on delete cascade,
  purchase_order_line_id uuid not null references public.purchase_order_lines(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  received_qty numeric(18, 6) not null check (received_qty > 0),
  unit_cost numeric(18, 6) not null check (unit_cost >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_order_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  alert_type text not null default 'partial_delivery',
  detail text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint purchase_order_alerts_type_check check (
    alert_type = 'partial_delivery'
  ),
  constraint purchase_order_alerts_status_check check (
    status in ('open', 'resolved')
  )
);

create unique index if not exists idx_purchase_order_alerts_open_partial
  on public.purchase_order_alerts(organization_id, purchase_order_id, alert_type)
  where status = 'open';

alter table public.purchase_order_receipts enable row level security;
alter table public.purchase_order_receipt_lines enable row level security;
alter table public.purchase_order_alerts enable row level security;

update public.purchase_order_lines pol
   set received_qty = pol.qty
  from public.purchase_orders po
 where po.id = pol.purchase_order_id
   and po.status::text = 'completed'
   and pol.received_qty = 0;

alter table public.purchase_orders
  disable trigger validate_purchase_order_receiving_location;

update public.purchase_orders
   set receipt_status = 'completed'
 where status::text = 'completed'
   and receipt_status = 'open';

alter table public.purchase_orders
  enable trigger validate_purchase_order_receiving_location;

insert into public.purchase_order_receipts (
  organization_id,
  purchase_order_id,
  grn_number,
  receipt_status,
  received_by,
  received_at
)
select
  po.organization_id,
  po.id,
  po.grn_number,
  'complete',
  po.accepted_by,
  coalesce(po.accepted_at, po.created_at)
from public.purchase_orders po
where po.status::text = 'completed'
  and po.grn_number is not null
  and not exists (
    select 1
    from public.purchase_order_receipts por
    where por.purchase_order_id = po.id
      and por.grn_number = po.grn_number
  );

insert into public.purchase_order_receipt_lines (
  receipt_id,
  purchase_order_line_id,
  inventory_item_id,
  received_qty,
  unit_cost
)
select
  por.id,
  pol.id,
  pol.inventory_item_id,
  pol.qty,
  pol.landed_unit_cost
from public.purchase_order_receipts por
join public.purchase_orders po on po.id = por.purchase_order_id
join public.purchase_order_lines pol on pol.purchase_order_id = po.id
where por.receipt_status = 'complete'
  and not exists (
    select 1
    from public.purchase_order_receipt_lines porl
    where porl.receipt_id = por.id
      and porl.purchase_order_line_id = pol.id
  );

drop policy if exists "purchase_order_receipts_member_select"
  on public.purchase_order_receipts;
create policy "purchase_order_receipts_member_select"
on public.purchase_order_receipts for select to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "purchase_order_receipt_lines_member_select"
  on public.purchase_order_receipt_lines;
create policy "purchase_order_receipt_lines_member_select"
on public.purchase_order_receipt_lines for select to authenticated
using (
  exists (
    select 1
    from public.purchase_order_receipts por
    where por.id = receipt_id
      and public.user_can_access_organization(por.organization_id)
  )
);

drop policy if exists "purchase_order_alerts_member_select"
  on public.purchase_order_alerts;
create policy "purchase_order_alerts_member_select"
on public.purchase_order_alerts for select to authenticated
using (public.user_can_access_organization(organization_id));

create or replace function public.receive_dashboard_purchase_order_quantities(
  target_purchase_order_id uuid,
  received_lines jsonb,
  short_supply_reason_value text default null
)
returns public.purchase_order_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_organization_id uuid;
  profile_role text;
  selected_order public.purchase_orders;
  input_line jsonb;
  purchase_line public.purchase_order_lines;
  selected_item public.inventory_items;
  receipt_record public.purchase_order_receipts;
  received_value numeric(18, 6);
  next_on_hand numeric(18, 6);
  next_cost numeric(18, 6);
  affected_recipe record;
  recalculated_recipe_cost numeric(18, 6);
  is_complete boolean;
  generated_grn text;
begin
  if current_user_id is null then
    raise exception 'You must be signed in to confirm a delivery.';
  end if;

  select p.organization_id, lower(replace(replace(p.role::text, ' ', '_'), '-', '_'))
    into current_organization_id, profile_role
  from public.profiles p
  where p.id = current_user_id;

  if profile_role not in (
    'owner', 'admin', 'manager', 'general_manager', 'operations_manager',
    'inventory_manager', 'storekeeper'
  ) then
    raise exception 'Only Inventory or Store roles can confirm supplier deliveries.';
  end if;

  select *
    into selected_order
  from public.purchase_orders
  where id = target_purchase_order_id
    and organization_id = current_organization_id
  for update;

  if selected_order.id is null or selected_order.status::text = 'cancelled' then
    raise exception 'Open purchase order not found.';
  end if;

  if jsonb_typeof(coalesce(received_lines, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(received_lines, '[]'::jsonb)) = 0 then
    raise exception 'Enter at least one received quantity.';
  end if;

  for input_line in select * from jsonb_array_elements(received_lines)
  loop
    received_value := coalesce((input_line->>'received_qty')::numeric, 0);
    if received_value <= 0 then
      continue;
    end if;

    select *
      into purchase_line
    from public.purchase_order_lines
    where id = nullif(input_line->>'purchase_order_line_id', '')::uuid
      and purchase_order_id = selected_order.id
    for update;

    if purchase_line.id is null then
      raise exception 'A received line does not belong to this PO.';
    end if;

    if purchase_line.received_qty + received_value > purchase_line.qty then
      raise exception 'Received quantity cannot exceed the outstanding PO quantity.';
    end if;

    select *
      into selected_item
    from public.inventory_items
    where id = purchase_line.inventory_item_id
      and organization_id = current_organization_id
      and location_id = selected_order.receiving_location_id
      and is_active = true
    for update;

    if selected_item.id is null then
      raise exception 'A PO item is not assigned to the receiving store.';
    end if;

    next_on_hand := coalesce(selected_item.on_hand_qty, 0) + received_value;
    next_cost := case
      when coalesce(selected_item.on_hand_qty, 0) > 0 and next_on_hand > 0 then
        (
          coalesce(selected_item.on_hand_qty, 0)
            * coalesce(selected_item.current_cost_per_base_uom, 0)
          + received_value * purchase_line.landed_unit_cost
        ) / next_on_hand
      else purchase_line.landed_unit_cost
    end;

    update public.inventory_items
       set on_hand_qty = next_on_hand,
           current_cost_per_base_uom = next_cost,
           on_hand_uom = coalesce(on_hand_uom, base_uom, recipe_uom, 'unit')
     where id = selected_item.id;

    for affected_recipe in
      select distinct r.id, r.resolved_unit_cost
      from public.recipes r
      join public.recipe_components rc on rc.recipe_id = r.id
      where r.organization_id = current_organization_id
        and r.is_active = true
        and rc.component_inventory_item_id = selected_item.id
    loop
      select coalesce(
        sum(
          rc.qty_in_recipe_uom
          * coalesce(ii.current_cost_per_base_uom, cr.resolved_unit_cost, 0)
        ) / nullif(r.standard_batch_output_qty, 0),
        0
      )
      into recalculated_recipe_cost
      from public.recipe_components rc
      join public.recipes r on r.id = rc.recipe_id
      left join public.inventory_items ii on ii.id = rc.component_inventory_item_id
      left join public.recipes cr on cr.id = rc.component_recipe_id
      where rc.recipe_id = affected_recipe.id
        and rc.organization_id = current_organization_id
      group by r.standard_batch_output_qty;

      if coalesce(affected_recipe.resolved_unit_cost, 0)
         is distinct from coalesce(recalculated_recipe_cost, 0) then
        perform public.set_recipe_cost_from_engine(
          affected_recipe.id,
          coalesce(recalculated_recipe_cost, 0),
          'partial_purchase_receipt_cost_cascade'
        );
      end if;
    end loop;

    update public.purchase_order_lines
       set received_qty = received_qty + received_value
     where id = purchase_line.id;
  end loop;

  if not exists (
    select 1
    from jsonb_array_elements(received_lines) line
    where coalesce((line->>'received_qty')::numeric, 0) > 0
  ) then
    raise exception 'At least one received quantity must be greater than zero.';
  end if;

  select not exists (
    select 1
    from public.purchase_order_lines pol
    where pol.purchase_order_id = selected_order.id
      and pol.received_qty < pol.qty
  ) into is_complete;

  if not is_complete and nullif(trim(coalesce(short_supply_reason_value, '')), '') is null then
    raise exception 'Enter a reason for the partial delivery.';
  end if;

  generated_grn := public.next_organization_document_number(
    current_organization_id,
    'goods_received_note'
  );

  insert into public.purchase_order_receipts (
    organization_id,
    purchase_order_id,
    grn_number,
    receipt_status,
    short_supply_reason,
    received_by
  ) values (
    current_organization_id,
    selected_order.id,
    generated_grn,
    case when is_complete then 'complete' else 'partial' end,
    nullif(trim(coalesce(short_supply_reason_value, '')), ''),
    current_user_id
  )
  returning * into receipt_record;

  insert into public.purchase_order_receipt_lines (
    receipt_id,
    purchase_order_line_id,
    inventory_item_id,
    received_qty,
    unit_cost
  )
  select
    receipt_record.id,
    pol.id,
    pol.inventory_item_id,
    (line->>'received_qty')::numeric,
    pol.landed_unit_cost
  from jsonb_array_elements(received_lines) line
  join public.purchase_order_lines pol
    on pol.id = nullif(line->>'purchase_order_line_id', '')::uuid
   and pol.purchase_order_id = selected_order.id
  where coalesce((line->>'received_qty')::numeric, 0) > 0;

  update public.purchase_orders
     set status = case
           when is_complete then 'completed'::public.transaction_status
           else 'accepted'::public.transaction_status
         end,
         receipt_status = case when is_complete then 'completed' else 'partially_received' end,
         short_supply_reason = case
           when is_complete then null
           else nullif(trim(coalesce(short_supply_reason_value, '')), '')
         end,
         accepted_by = current_user_id,
         accepted_at = now()
   where id = selected_order.id;

  if is_complete then
    select po.grn_number
      into generated_grn
    from public.purchase_orders po
    where po.id = selected_order.id;

    update public.purchase_order_receipts
       set grn_number = generated_grn
     where id = receipt_record.id
     returning * into receipt_record;
  end if;

  if is_complete then
    update public.purchase_order_alerts
       set status = 'resolved', resolved_at = now()
     where purchase_order_id = selected_order.id
       and status = 'open';
  else
    insert into public.purchase_order_alerts (
      organization_id, purchase_order_id, detail
    ) values (
      current_organization_id,
      selected_order.id,
      selected_order.po_number || ' was partially delivered: '
        || trim(short_supply_reason_value)
    )
    on conflict do nothing;
  end if;

  return receipt_record;
end;
$$;

grant execute on function public.receive_dashboard_purchase_order_quantities(uuid, jsonb, text)
  to authenticated;

notify pgrst, 'reload schema';
