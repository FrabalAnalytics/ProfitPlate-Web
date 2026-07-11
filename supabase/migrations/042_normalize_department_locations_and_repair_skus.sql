-- Some older/onboarded workspaces still have plain Kitchen/Bar rows typed as
-- stock-holding locations. That causes Procurement to see department balances
-- as PO receiving stores, and it prevents repair jobs from treating those rows
-- as department balances. Normalize those rows first, then rerun the origin
-- repair.

update public.locations
   set location_type = 'department'::public.location_type,
       routing_model = 'model_1_single_location'::public.routing_model,
       inventory_domain = case
         when lower(name) ~ '(bar|drink|beverage)' then 'beverage'
         else 'food'
       end
 where is_active = true
   and lower(name) ~ '(^|[^a-z])(kitchen|bar)([^a-z]|$)'
   and lower(name) !~ '(store|warehouse|main|central)';

update public.locations department_location
   set supplying_location_id = (
    select store.id
    from public.locations store
    where store.organization_id = department_location.organization_id
      and store.is_active = true
      and store.location_type::text in (
        'main_store',
        'central_warehouse',
        'branch_store'
      )
      and (
        store.inventory_domain = department_location.inventory_domain
        or store.inventory_domain = 'shared'
        or (
          department_location.inventory_domain = 'food'
          and lower(store.name) like '%food%'
        )
        or (
          department_location.inventory_domain = 'beverage'
          and (
            lower(store.name) like '%drink%'
            or lower(store.name) like '%bar%'
          )
        )
      )
    order by
      case
        when store.inventory_domain = department_location.inventory_domain then 0
        when department_location.inventory_domain = 'food'
             and lower(store.name) like '%food%' then 1
        when department_location.inventory_domain = 'beverage'
             and (
               lower(store.name) like '%drink%'
               or lower(store.name) like '%bar%'
             ) then 1
        when store.location_type::text = 'main_store' then 2
        else 3
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
   and lower(department_location.name) ~ '(^|[^a-z])(kitchen|bar)([^a-z]|$)';

create or replace function public.repair_dashboard_canonical_store_skus(
  target_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer := 0;
  changed_count integer := 0;
begin
  update public.inventory_items item
     set origin_inventory_item_id = item.id,
         is_active = true
    from public.locations location
   where location.id = item.location_id
     and location.location_type::text in (
       'main_store',
       'central_warehouse',
       'branch_store'
     )
     and (target_organization_id is null or item.organization_id = target_organization_id)
     and (
       item.origin_inventory_item_id is distinct from item.id
       or item.is_active is not true
     );

  get diagnostics changed_count = row_count;
  affected_count := affected_count + changed_count;

  return affected_count;
end;
$$;

grant execute on function public.repair_dashboard_canonical_store_skus(uuid)
  to authenticated;

select public.repair_dashboard_department_skus_to_store_origins(null::uuid);
select public.repair_dashboard_canonical_store_skus(null::uuid);

notify pgrst, 'reload schema';
