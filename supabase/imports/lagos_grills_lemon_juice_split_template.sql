-- Lagos Grills Lemon Juice opening stock split.
-- Replace the two numbers below before running.
-- The total from the workbook was 1000 ML.

begin;

with target_org as (
  select id
  from public.organizations
  where name = 'Lagos Grills'
  order by created_at desc
  limit 1
),
split_values as (
  select
    0::numeric as food_main_store_ml,
    0::numeric as drink_main_store_ml
),
updated_food as (
  update public.inventory_items i
     set on_hand_qty = s.food_main_store_ml,
         on_hand_uom = 'ML',
         updated_at = now()
  from target_org t
  join public.locations l
    on l.organization_id = t.id
   and l.name = 'Food Main Store'
  cross join split_values s
  where i.organization_id = t.id
    and i.location_id = l.id
    and i.name = 'Lemon Juice'
  returning i.id
),
updated_drink as (
  update public.inventory_items i
     set on_hand_qty = s.drink_main_store_ml,
         on_hand_uom = 'ML',
         updated_at = now()
  from target_org t
  join public.locations l
    on l.organization_id = t.id
   and l.name = 'Drink Main Store'
  cross join split_values s
  where i.organization_id = t.id
    and i.location_id = l.id
    and i.name = 'Lemon Juice'
  returning i.id
)
select
  (select count(*) from updated_food) as food_rows_updated,
  (select count(*) from updated_drink) as drink_rows_updated,
  (select food_main_store_ml + drink_main_store_ml from split_values) as total_ml_after_split;

commit;
