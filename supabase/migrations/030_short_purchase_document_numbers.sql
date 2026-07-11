-- Use short organization-scoped document numbers for operational paperwork.

create table if not exists public.document_number_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_type text not null,
  next_value bigint not null default 1,
  primary key (organization_id, document_type),
  constraint document_number_counters_type_check check (
    document_type in ('purchase_order', 'goods_received_note')
  ),
  constraint document_number_counters_next_value_check check (next_value > 0)
);

alter table public.document_number_counters enable row level security;

-- Existing references must be renumbered before immutability is restored.
alter table public.purchase_orders
  disable trigger assign_purchase_order_references;

-- Renumbering and legacy-route repair are maintenance updates. Operational
-- route validation is restored immediately after these updates complete.
alter table public.purchase_orders
  disable trigger validate_purchase_order_receiving_location;

-- Remove the old globally unique indexes before assigning organization-scoped
-- numbers such as PO-000001 in more than one organization.
drop index if exists public.idx_purchase_orders_po_number;
drop index if exists public.idx_purchase_orders_grn_number;

-- Older POs may predate receiving-location enforcement. Where every PO line
-- clearly belongs to one store, treat that line location as authoritative.
with single_store_orders as (
  select
    pol.purchase_order_id,
    min(ii.location_id::text)::uuid as receiving_location_id
  from public.purchase_order_lines pol
  join public.inventory_items ii
    on ii.id = pol.inventory_item_id
  where ii.location_id is not null
  group by pol.purchase_order_id
  having count(distinct ii.location_id) = 1
)
update public.purchase_orders po
   set receiving_location_id = single_store_orders.receiving_location_id
  from single_store_orders
 where single_store_orders.purchase_order_id = po.id
   and po.receiving_location_id is distinct from single_store_orders.receiving_location_id;

with numbered_orders as (
  select
    id,
    'PO-' || lpad(
      row_number() over (
        partition by organization_id
        order by created_at asc, id asc
      )::text,
      6,
      '0'
    ) as short_number
  from public.purchase_orders
)
update public.purchase_orders po
   set po_number = numbered_orders.short_number
  from numbered_orders
 where numbered_orders.id = po.id
   and po.po_number ~ '^PO-[0-9]{8}-[A-F0-9]{12}$';

with numbered_receipts as (
  select
    id,
    'GRN-' || lpad(
      row_number() over (
        partition by organization_id
        order by accepted_at asc nulls last, created_at asc, id asc
      )::text,
      6,
      '0'
    ) as short_number
  from public.purchase_orders
  where grn_number is not null
)
update public.purchase_orders po
   set grn_number = numbered_receipts.short_number
  from numbered_receipts
 where numbered_receipts.id = po.id
   and po.grn_number ~ '^GRN-[0-9]{8}-[A-F0-9]{12}$';

alter table public.purchase_orders
  enable trigger assign_purchase_order_references;

alter table public.purchase_orders
  enable trigger validate_purchase_order_receiving_location;

create unique index if not exists idx_purchase_orders_org_po_number
  on public.purchase_orders(organization_id, po_number);

create unique index if not exists idx_purchase_orders_org_grn_number
  on public.purchase_orders(organization_id, grn_number)
  where grn_number is not null;

insert into public.document_number_counters (
  organization_id,
  document_type,
  next_value
)
select
  organization_id,
  'purchase_order',
  count(*) + 1
from public.purchase_orders
group by organization_id
on conflict (organization_id, document_type)
do update set next_value = greatest(
  public.document_number_counters.next_value,
  excluded.next_value
);

insert into public.document_number_counters (
  organization_id,
  document_type,
  next_value
)
select
  organization_id,
  'goods_received_note',
  count(*) filter (where grn_number is not null) + 1
from public.purchase_orders
group by organization_id
on conflict (organization_id, document_type)
do update set next_value = greatest(
  public.document_number_counters.next_value,
  excluded.next_value
);

create or replace function public.next_organization_document_number(
  target_organization_id uuid,
  target_document_type text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  allocated_value bigint;
  document_prefix text;
begin
  if target_document_type not in ('purchase_order', 'goods_received_note') then
    raise exception 'Unsupported document number type.';
  end if;

  insert into public.document_number_counters (
    organization_id,
    document_type,
    next_value
  ) values (
    target_organization_id,
    target_document_type,
    2
  )
  on conflict (organization_id, document_type)
  do update set next_value = public.document_number_counters.next_value + 1
  returning next_value - 1 into allocated_value;

  document_prefix := case
    when target_document_type = 'purchase_order' then 'PO'
    else 'GRN'
  end;

  return document_prefix || '-' || lpad(allocated_value::text, 6, '0');
end;
$$;

create or replace function public.assign_purchase_order_references()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.po_number := public.next_organization_document_number(
      new.organization_id,
      'purchase_order'
    );
  else
    new.po_number := old.po_number;
    new.grn_number := old.grn_number;
  end if;

  if new.status::text = 'completed' and new.grn_number is null then
    if tg_op = 'INSERT' then
      new.grn_number := public.next_organization_document_number(
        new.organization_id,
        'goods_received_note'
      );
    elsif old.status::text <> 'completed' then
      new.grn_number := public.next_organization_document_number(
        new.organization_id,
        'goods_received_note'
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.next_organization_document_number(uuid, text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
