-- Stronger repair for department balances that were accidentally treated as
-- the only SKU record. This restores/creates the canonical store SKU and links
-- Kitchen/Bar/department balances back to it.

create or replace function public.repair_dashboard_department_skus_to_store_origins(
  target_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  department_item public.inventory_items;
  department_location public.locations;
  preferred_store public.locations;
  origin_item public.inventory_items;
  identity_key text;
  item_text text;
  repaired_count integer := 0;
begin
  for department_item in
    select item.*
    from public.inventory_items item
    join public.locations location
      on location.id = item.location_id
    where (target_organization_id is null or item.organization_id = target_organization_id)
      and item.cost_type::text in ('purchased', 'manufactured')
      and location.location_type::text not in (
        'main_store',
        'central_warehouse',
        'branch_store'
      )
  loop
    preferred_store := null::public.locations;
    origin_item := null::public.inventory_items;
    identity_key := lower(
      coalesce(
        nullif(trim(department_item.sku), ''),
        nullif(trim(department_item.name), ''),
        department_item.id::text
      )
    );
    item_text := lower(
      concat_ws(
        ' ',
        department_item.name,
        department_item.sku,
        department_item.department
      )
    );

    select *
      into department_location
    from public.locations location
    where location.id = department_item.location_id
      and location.organization_id = department_item.organization_id;

    if department_location.supplying_location_id is not null then
      select *
        into preferred_store
      from public.locations location
      where location.id = department_location.supplying_location_id
        and location.organization_id = department_item.organization_id
        and location.is_active
        and location.location_type::text in (
          'main_store',
          'central_warehouse',
          'branch_store'
        );
    end if;

    if preferred_store.id is null then
      select *
        into preferred_store
      from public.locations location
      where location.organization_id = department_item.organization_id
        and location.is_active
        and location.location_type::text in (
          'main_store',
          'central_warehouse',
          'branch_store'
        )
        and (
          location.inventory_domain = department_location.inventory_domain
          or location.inventory_domain = 'shared'
          or (
            item_text !~ '(drink|bar|beverage)'
            and lower(location.name) like '%food%'
          )
          or (
            item_text ~ '(drink|bar|beverage)'
            and (
              lower(location.name) like '%drink%'
              or lower(location.name) like '%bar%'
            )
          )
        )
      order by
        case
          when location.inventory_domain = department_location.inventory_domain then 0
          when item_text !~ '(drink|bar|beverage)'
               and lower(location.name) like '%food%' then 1
          when item_text ~ '(drink|bar|beverage)'
               and (
                 lower(location.name) like '%drink%'
                 or lower(location.name) like '%bar%'
               ) then 1
          when location.location_type::text = 'main_store' then 2
          else 3
        end,
        location.created_at asc
      limit 1;
    end if;

    if preferred_store.id is null then
      select *
        into preferred_store
      from public.locations location
      where location.organization_id = department_item.organization_id
        and location.is_active
        and location.location_type::text in (
          'main_store',
          'central_warehouse',
          'branch_store'
        )
      order by
        case when location.location_type::text = 'main_store' then 0 else 1 end,
        location.created_at asc
      limit 1;
    end if;

    if preferred_store.id is null then
      continue;
    end if;

    if department_item.origin_inventory_item_id is not null then
      select origin.*
        into origin_item
      from public.inventory_items origin
      join public.locations origin_location
        on origin_location.id = origin.location_id
      where origin.id = department_item.origin_inventory_item_id
        and origin.organization_id = department_item.organization_id
        and origin_location.location_type::text in (
          'main_store',
          'central_warehouse',
          'branch_store'
        );
    end if;

    if origin_item.id is null then
      select origin.*
        into origin_item
      from public.inventory_items origin
      join public.locations origin_location
        on origin_location.id = origin.location_id
      where origin.organization_id = department_item.organization_id
        and origin.cost_type = department_item.cost_type
        and origin_location.location_type::text in (
          'main_store',
          'central_warehouse',
          'branch_store'
        )
        and (
          (department_item.recipe_id is not null and origin.recipe_id = department_item.recipe_id)
          or lower(
            coalesce(
              nullif(trim(origin.sku), ''),
              nullif(trim(origin.name), ''),
              origin.id::text
            )
          ) = identity_key
        )
      order by
        (origin.location_id = preferred_store.id)::integer desc,
        origin.is_active desc,
        origin.created_at asc
      limit 1;
    end if;

    if origin_item.id is null then
      insert into public.inventory_items (
        tenant_id,
        organization_id,
        location_id,
        recipe_id,
        name,
        sku,
        department,
        item_type,
        cost_type,
        base_uom,
        recipe_uom,
        on_hand_uom,
        on_hand_qty,
        current_cost_per_base_uom,
        yield_pct,
        shrinkage_factor_pct,
        is_high_value,
        is_active
      ) values (
        department_item.tenant_id,
        department_item.organization_id,
        preferred_store.id,
        department_item.recipe_id,
        department_item.name,
        department_item.sku,
        department_item.department,
        department_item.item_type,
        department_item.cost_type,
        department_item.base_uom,
        department_item.recipe_uom,
        coalesce(
          department_item.on_hand_uom,
          department_item.base_uom,
          department_item.recipe_uom,
          'unit'
        ),
        0,
        coalesce(department_item.current_cost_per_base_uom, 0),
        department_item.yield_pct,
        department_item.shrinkage_factor_pct,
        department_item.is_high_value,
        true
      )
      returning * into origin_item;
    end if;

    update public.inventory_items
       set origin_inventory_item_id = origin_item.id,
           is_active = true,
           current_cost_per_base_uom = coalesce(
             current_cost_per_base_uom,
             department_item.current_cost_per_base_uom,
             0
           ),
           on_hand_uom = coalesce(
             on_hand_uom,
             department_item.on_hand_uom,
             department_item.base_uom,
             department_item.recipe_uom,
             'unit'
           )
     where id = origin_item.id;

    update public.inventory_items
       set origin_inventory_item_id = origin_item.id,
           is_active = true
     where id = department_item.id
       and origin_inventory_item_id is distinct from origin_item.id;

    repaired_count := repaired_count + 1;
  end loop;

  return repaired_count;
end;
$$;

grant execute on function public.repair_dashboard_department_skus_to_store_origins(uuid)
  to authenticated;

select public.repair_dashboard_department_skus_to_store_origins(null);

notify pgrst, 'reload schema';
