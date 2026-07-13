-- Read-only stock movement ledger for SKU drill-downs. The source table stays
-- append-only; this RPC only exposes movement rows the signed-in user can see.

drop function if exists public.get_dashboard_stock_movement_ledger(uuid, date, date, uuid);

create function public.get_dashboard_stock_movement_ledger(
  target_organization_id uuid,
  start_date_value date default null,
  end_date_value date default null,
  target_inventory_item_id uuid default null
)
returns table (
  movement_id uuid,
  inventory_item_id uuid,
  item_name text,
  sku text,
  location_id uuid,
  location_name text,
  event_type text,
  movement_qty numeric,
  unit_cost numeric,
  movement_value numeric,
  source_table text,
  source_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  qty_expression text := 'te.quantity';
begin
  if not public.user_can_access_organization(target_organization_id) then
    raise exception 'You do not have access to this workspace stock ledger.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transformation_events'
      and column_name = 'quantity_delta'
  ) then
    qty_expression := 'coalesce(te.quantity_delta, te.quantity, 0)';
  end if;

  return query execute format(
    $sql$
      select
        te.id as movement_id,
        te.inventory_item_id,
        coalesce(ii.name, 'Inventory item') as item_name,
        ii.sku,
        te.location_id,
        coalesce(loc.name, 'Unassigned') as location_name,
        te.event_type::text as event_type,
        %1$s as movement_qty,
        coalesce(te.unit_cost, 0) as unit_cost,
        (%1$s) * coalesce(te.unit_cost, 0) as movement_value,
        te.source_table,
        te.source_id,
        te.created_at
      from public.transformation_events te
      left join public.inventory_items ii
        on ii.id = te.inventory_item_id
      left join public.locations loc
        on loc.id = te.location_id
      where te.organization_id = $1
        and ($2 is null or te.created_at::date >= $2)
        and ($3 is null or te.created_at::date <= $3)
        and ($4 is null or te.inventory_item_id = $4)
      order by te.created_at desc
      limit 1000
    $sql$,
    qty_expression
  )
  using target_organization_id, start_date_value, end_date_value, target_inventory_item_id;
end;
$$;

grant execute on function public.get_dashboard_stock_movement_ledger(uuid, date, date, uuid)
  to authenticated;

notify pgrst, 'reload schema';
