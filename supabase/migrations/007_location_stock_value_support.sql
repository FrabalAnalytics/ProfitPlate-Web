-- Lagos Grills stock-by-location support.

alter table if exists public.inventory_items
  add column if not exists department text,
  add column if not exists is_high_value boolean not null default false;

create index if not exists idx_inventory_items_org_location_active
on public.inventory_items(organization_id, location_id, is_active);

create index if not exists idx_inventory_items_org_high_value
on public.inventory_items(organization_id, is_high_value)
where is_active = true;

drop view if exists public.dashboard_location_stock_value;

create view public.dashboard_location_stock_value
with (security_invoker = true)
as
select
  ii.organization_id,
  ii.location_id,
  coalesce(l.name, 'Unassigned') as location_name,
  count(*) filter (where ii.is_active = true) as sku_count,
  count(*) filter (where ii.is_active = true and ii.is_high_value = true)
    as high_value_sku_count,
  coalesce(
    sum(
      greatest(coalesce(ii.on_hand_qty, 0), 0)
      * coalesce(ii.current_cost_per_base_uom, 0)
    ) filter (where ii.is_active = true),
    0
  ) as stock_value
from public.inventory_items ii
left join public.locations l
  on l.id = ii.location_id
group by ii.organization_id, ii.location_id, coalesce(l.name, 'Unassigned');

notify pgrst, 'reload schema';
