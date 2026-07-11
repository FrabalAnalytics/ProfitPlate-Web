-- Stock movement guardrails enforce the ProfitPlate operating model:
-- procurement receives into main stores, while sales and production consume or
-- create stock inside departments. UI filtering helps, but the database must
-- be the final control point.

create or replace function public.is_dashboard_main_store_location(
  target_organization_id uuid,
  target_location_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.locations location
    where location.id = target_location_id
      and location.organization_id = target_organization_id
      and location.location_type::text in (
        'main_store',
        'central_warehouse',
        'branch_store'
      )
  );
$$;

create or replace function public.is_dashboard_department_stock_location(
  target_organization_id uuid,
  target_location_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.locations location
    where location.id = target_location_id
      and location.organization_id = target_organization_id
      and location.is_active = true
      and lower(location.name) !~ '(store|warehouse|main|central)'
      and (
        location.location_type::text in (
          'department',
          'bar',
          'local_kitchen',
          'kitchen_line',
          'production_kitchen',
          'sales_outlet'
        )
        or lower(location.name) ~ '(kitchen|kicthen|kitchn|bar)'
      )
  );
$$;

grant execute on function public.is_dashboard_main_store_location(uuid, uuid)
  to authenticated;

grant execute on function public.is_dashboard_department_stock_location(uuid, uuid)
  to authenticated;

create or replace function public.enforce_purchase_order_store_receiving_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.receiving_location_id is null then
    return new;
  end if;

  if not public.is_dashboard_main_store_location(
    new.organization_id,
    new.receiving_location_id
  ) then
    raise exception 'Purchase orders must receive into a main store or warehouse. Issue stock to Kitchen/Bar through requisitions.';
  end if;

  if exists (
    select 1
    from public.purchase_order_lines line
    join public.inventory_items item
      on item.id = line.inventory_item_id
     and item.organization_id = new.organization_id
    where line.purchase_order_id = new.id
      and item.location_id <> new.receiving_location_id
  ) then
    raise exception 'Purchase order receiving location must match every line item store location.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_purchase_order_store_receiving_location
  on public.purchase_orders;
create trigger enforce_purchase_order_store_receiving_location
before insert or update of organization_id, receiving_location_id
on public.purchase_orders
for each row execute function public.enforce_purchase_order_store_receiving_location();

create or replace function public.enforce_purchase_order_line_store_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  order_organization_id uuid;
  order_receiving_location_id uuid;
  item_location_id uuid;
begin
  select purchase_order.organization_id,
         purchase_order.receiving_location_id
    into order_organization_id,
         order_receiving_location_id
  from public.purchase_orders purchase_order
  where purchase_order.id = new.purchase_order_id;

  if order_organization_id is null then
    raise exception 'Purchase order line must belong to an existing purchase order.';
  end if;

  select item.location_id
    into item_location_id
  from public.inventory_items item
  where item.id = new.inventory_item_id
    and item.organization_id = order_organization_id;

  if item_location_id is null then
    raise exception 'Purchase order item must belong to the same workspace as the purchase order.';
  end if;

  if order_receiving_location_id is not null
     and item_location_id <> order_receiving_location_id then
    raise exception 'Purchase order line item must belong to the selected receiving store.';
  end if;

  if not public.is_dashboard_main_store_location(
    order_organization_id,
    item_location_id
  ) then
    raise exception 'Purchase order line item must be a main-store stock item. Use requisitions to move stock into departments.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_purchase_order_line_store_item
  on public.purchase_order_lines;
create trigger enforce_purchase_order_line_store_item
before insert or update of purchase_order_id, inventory_item_id
on public.purchase_order_lines
for each row execute function public.enforce_purchase_order_line_store_item();

create or replace function public.enforce_operating_transformation_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is null or new.location_id is null then
    return new;
  end if;

  if new.event_type::text = 'sales_depletion'
     and public.is_dashboard_main_store_location(
       new.organization_id,
       new.location_id
     ) then
    raise exception 'Sales depletion must consume department stock, not main-store stock.';
  end if;

  if new.event_type::text = 'production_input_consumption'
     and public.is_dashboard_main_store_location(
       new.organization_id,
       new.location_id
     ) then
    raise exception 'Production must consume department ingredients. Issue stock from store to department before production.';
  end if;

  if new.event_type::text = 'production_output_receipt'
     and coalesce(new.source_table, '') = 'production_runs'
     and coalesce(new.quantity, 0) > 0
     and not public.is_dashboard_department_stock_location(
       new.organization_id,
       new.location_id
     ) then
    raise exception 'Production output must land in a department stock location.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_operating_transformation_location
  on public.transformation_events;
create trigger enforce_operating_transformation_location
before insert on public.transformation_events
for each row execute function public.enforce_operating_transformation_location();

notify pgrst, 'reload schema';
