-- Give stores and departments explicit stock domains and prevent receipts from crossing locations.

alter table public.locations
  add column if not exists inventory_domain text not null default 'shared',
  add column if not exists supplying_location_id uuid references public.locations(id) on delete set null;

alter table public.locations
  drop constraint if exists locations_inventory_domain_check;

alter table public.locations
  add constraint locations_inventory_domain_check check (
    inventory_domain in ('food', 'beverage', 'shared')
  );

create index if not exists idx_locations_supplying_location
  on public.locations(supplying_location_id);

update public.locations
   set inventory_domain = case
     when lower(name) ~ '(drink|beverage|bar)' then 'beverage'
     when lower(name) ~ '(food|kitchen)' then 'food'
     else inventory_domain
   end
 where is_active = true;

update public.locations department_location
   set supplying_location_id = (
    select store.id
    from public.locations store
    where store.organization_id = department_location.organization_id
      and store.is_active = true
      and store.location_type::text in ('main_store', 'central_warehouse', 'branch_store')
      and (
        store.inventory_domain = department_location.inventory_domain
        or store.inventory_domain = 'shared'
      )
    order by
      case
        when store.inventory_domain = department_location.inventory_domain then 0
        else 1
      end,
      store.created_at asc
    limit 1
  )
 where department_location.is_active = true
   and department_location.location_type::text in (
     'department',
     'bar',
     'local_kitchen',
     'kitchen_line',
     'production_kitchen',
     'sales_outlet'
   )
   and department_location.supplying_location_id is null;

create or replace function public.validate_purchase_order_stock_route()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_order public.purchase_orders;
  receiving_location public.locations;
  line_item public.inventory_items;
begin
  if tg_table_name = 'purchase_orders' then
    if new.receiving_location_id is null then
      return new;
    end if;

    select *
      into receiving_location
    from public.locations
    where id = new.receiving_location_id
      and organization_id = new.organization_id
      and is_active = true;

    if receiving_location.id is null then
      raise exception 'Select an active receiving location in this workspace.';
    end if;

    if receiving_location.location_type::text not in (
      'main_store',
      'central_warehouse',
      'branch_store'
    ) then
      raise exception 'Supplier receipts can only be assigned to a main store or warehouse, not a user department.';
    end if;

    if exists (
      select 1
      from public.purchase_order_lines pol
      join public.inventory_items ii on ii.id = pol.inventory_item_id
      where pol.purchase_order_id = new.id
        and ii.location_id is distinct from new.receiving_location_id
    ) then
      raise exception 'Every PO item must belong to the selected receiving store.';
    end if;

    return new;
  end if;

  select *
    into target_order
  from public.purchase_orders
  where id = new.purchase_order_id;

  if target_order.id is null then
    raise exception 'Purchase order not found.';
  end if;

  if target_order.receiving_location_id is null then
    raise exception 'Select a receiving store before adding PO items.';
  end if;

  select *
    into receiving_location
  from public.locations
  where id = target_order.receiving_location_id
    and organization_id = target_order.organization_id
    and is_active = true;

  if receiving_location.id is null
     or receiving_location.location_type::text not in (
       'main_store',
       'central_warehouse',
       'branch_store'
     ) then
    raise exception 'Supplier receipts can only be assigned to a main store or warehouse.';
  end if;

  select *
    into line_item
  from public.inventory_items
  where id = new.inventory_item_id
    and organization_id = target_order.organization_id
    and is_active = true;

  if line_item.id is null then
    raise exception 'PO item not found in this workspace.';
  end if;

  if line_item.cost_type <> 'purchased' then
    raise exception 'Only purchased SKUs can be included on a supplier purchase order.';
  end if;

  if line_item.location_id is distinct from target_order.receiving_location_id then
    raise exception 'The selected SKU belongs to a different location than the PO receiving store.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_purchase_order_receiving_location
  on public.purchase_orders;
create constraint trigger validate_purchase_order_receiving_location
after insert or update
on public.purchase_orders
deferrable initially deferred
for each row execute function public.validate_purchase_order_stock_route();

drop trigger if exists validate_purchase_order_line_stock_route
  on public.purchase_order_lines;
create trigger validate_purchase_order_line_stock_route
before insert or update of purchase_order_id, inventory_item_id
on public.purchase_order_lines
for each row execute function public.validate_purchase_order_stock_route();

notify pgrst, 'reload schema';
