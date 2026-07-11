-- Give every purchase order and completed receipt durable operational references.

alter table public.purchase_orders
  add column if not exists po_number text,
  add column if not exists grn_number text;

update public.purchase_orders
   set po_number = 'PO-'
     || to_char(coalesce(created_at, now()), 'YYYYMMDD')
     || '-'
     || upper(substr(replace(id::text, '-', ''), 1, 12))
 where po_number is null;

update public.purchase_orders
   set grn_number = 'GRN-'
     || to_char(coalesce(accepted_at, created_at, now()), 'YYYYMMDD')
     || '-'
     || upper(substr(replace(id::text, '-', ''), 1, 12))
 where status::text = 'completed'
   and grn_number is null;

alter table public.purchase_orders
  alter column po_number set not null;

create unique index if not exists idx_purchase_orders_po_number
  on public.purchase_orders(po_number);

create unique index if not exists idx_purchase_orders_grn_number
  on public.purchase_orders(grn_number)
  where grn_number is not null;

-- Defer route validation so an open PO can replace its old lines when its
-- receiving store changes within the same transaction.
drop trigger if exists validate_purchase_order_receiving_location
  on public.purchase_orders;
create constraint trigger validate_purchase_order_receiving_location
after insert or update
on public.purchase_orders
deferrable initially deferred
for each row execute function public.validate_purchase_order_stock_route();

create or replace function public.assign_purchase_order_references()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.po_number := coalesce(
      nullif(trim(new.po_number), ''),
      'PO-'
        || to_char(coalesce(new.created_at, now()), 'YYYYMMDD')
        || '-'
        || upper(substr(replace(new.id::text, '-', ''), 1, 12))
    );
  else
    new.po_number := old.po_number;
    new.grn_number := old.grn_number;
  end if;

  if new.status::text = 'completed' and new.grn_number is null then
    if tg_op = 'INSERT' then
      new.grn_number := 'GRN-'
        || to_char(coalesce(new.accepted_at, now()), 'YYYYMMDD')
        || '-'
        || upper(substr(replace(new.id::text, '-', ''), 1, 12));
    elsif old.status::text <> 'completed' then
      new.grn_number := 'GRN-'
        || to_char(coalesce(new.accepted_at, now()), 'YYYYMMDD')
        || '-'
        || upper(substr(replace(new.id::text, '-', ''), 1, 12));
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists assign_purchase_order_references
  on public.purchase_orders;
create trigger assign_purchase_order_references
before insert or update
on public.purchase_orders
for each row execute function public.assign_purchase_order_references();

notify pgrst, 'reload schema';
