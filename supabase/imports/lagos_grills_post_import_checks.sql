-- Lagos Grills post-import verification.
-- Paste this into Supabase after the fresh import succeeds.

with target_org as (
  select id
  from public.organizations
  where name = 'Lagos Grills'
  order by created_at desc
  limit 1
)
select
  'organization' as check_name,
  o.name as detail,
  o.subscription_tier::text as status,
  o.local_currency as value
from public.organizations o
join target_org t on t.id = o.id;

with target_org as (
  select id
  from public.organizations
  where name = 'Lagos Grills'
  order by created_at desc
  limit 1
)
select
  'record_counts' as check_name,
  (select count(*) from public.locations l where l.organization_id = t.id) as locations,
  (select count(*) from public.suppliers s where s.organization_id = t.id) as suppliers,
  (select count(*) from public.inventory_items i where i.organization_id = t.id) as inventory_rows,
  (select count(*) from public.recipes r where r.organization_id = t.id) as recipes,
  (select count(*) from public.recipe_components rc where rc.organization_id = t.id) as recipe_components
from target_org t;

with target_org as (
  select id
  from public.organizations
  where name = 'Lagos Grills'
  order by created_at desc
  limit 1
)
select
  l.name as location,
  count(i.id) as stock_rows,
  count(i.id) filter (where i.is_high_value = true) as high_value_rows,
  round(
    coalesce(sum(coalesce(i.on_hand_qty, 0) * coalesce(i.current_cost_per_base_uom, 0)), 0),
    2
  ) as stock_value
from public.locations l
join target_org t on t.id = l.organization_id
left join public.inventory_items i
  on i.location_id = l.id
 and i.organization_id = t.id
group by l.name
order by l.name;

with target_org as (
  select id
  from public.organizations
  where name = 'Lagos Grills'
  order by created_at desc
  limit 1
)
select
  r.recipe_type::text as recipe_type,
  count(*) as recipe_count
from public.recipes r
join target_org t on t.id = r.organization_id
group by r.recipe_type::text
order by r.recipe_type::text;

with target_org as (
  select id
  from public.organizations
  where name = 'Lagos Grills'
  order by created_at desc
  limit 1
)
select
  l.name as location,
  i.name,
  i.on_hand_qty,
  i.on_hand_uom,
  i.current_cost_per_base_uom,
  round(coalesce(i.on_hand_qty, 0) * coalesce(i.current_cost_per_base_uom, 0), 2) as stock_value
from public.inventory_items i
join target_org t on t.id = i.organization_id
left join public.locations l on l.id = i.location_id
where i.name in ('Lemon Juice', 'Lime')
order by i.name, l.name;

with target_org as (
  select id
  from public.organizations
  where name = 'Lagos Grills'
  order by created_at desc
  limit 1
)
select
  l.name as location,
  i.name,
  i.on_hand_qty,
  i.on_hand_uom,
  i.current_cost_per_base_uom
from public.inventory_items i
join target_org t on t.id = i.organization_id
left join public.locations l on l.id = i.location_id
where i.is_high_value = true
order by l.name, i.name;
