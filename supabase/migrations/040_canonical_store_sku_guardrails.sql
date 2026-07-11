-- Make store SKUs canonical and department SKUs traceable balances.
-- Food/Drink main stores keep the SKU master. Kitchen/Bar/department rows are
-- balance rows that must point back to a canonical store SKU.

create or replace function public.ensure_inventory_item_origin()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_location public.locations;
  preferred_store public.locations;
  origin_item public.inventory_items;
  identity_key text;
  item_text text;
begin
  if new.organization_id is null then
    return new;
  end if;

  identity_key := lower(
    coalesce(nullif(trim(new.sku), ''), nullif(trim(new.name), ''), new.id::text)
  );
  item_text := lower(concat_ws(' ', new.name, new.sku, new.department));

  if new.location_id is not null then
    select *
      into target_location
    from public.locations location
    where location.id = new.location_id
      and location.organization_id = new.organization_id;
  end if;

  if target_location.id is null then
    select *
      into preferred_store
    from public.locations location
    where location.organization_id = new.organization_id
      and location.is_active
      and location.location_type::text in (
        'main_store',
        'central_warehouse',
        'branch_store'
      )
      and (
        (
          item_text ~ '(drink|bar|beverage)'
          and (
            location.inventory_domain = 'beverage'
            or lower(location.name) like '%drink%'
            or lower(location.name) like '%bar%'
          )
        )
        or (
          item_text !~ '(drink|bar|beverage)'
          and (
            location.inventory_domain in ('food', 'shared')
            or lower(location.name) like '%food%'
          )
        )
      )
    order by
      case
        when item_text ~ '(drink|bar|beverage)'
             and location.inventory_domain = 'beverage' then 0
        when item_text !~ '(drink|bar|beverage)'
             and location.inventory_domain = 'food' then 0
        when location.location_type::text = 'main_store' then 1
        else 2
      end,
      location.created_at asc
    limit 1;

    if preferred_store.id is null then
      select *
        into preferred_store
      from public.locations location
      where location.organization_id = new.organization_id
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

    new.location_id := preferred_store.id;
    target_location := preferred_store;
  end if;

  if target_location.location_type::text in (
    'main_store',
    'central_warehouse',
    'branch_store'
  ) then
    -- Store rows are canonical SKU records. A zero balance is still active
    -- master data and must remain visible to procurement/inventory.
    new.origin_inventory_item_id := new.id;
    new.is_active := true;
    return new;
  end if;

  if new.cost_type::text not in ('purchased', 'manufactured') then
    return new;
  end if;

  if target_location.supplying_location_id is not null then
    select *
      into preferred_store
    from public.locations location
    where location.id = target_location.supplying_location_id
      and location.organization_id = new.organization_id
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
    where location.organization_id = new.organization_id
      and location.is_active
      and location.location_type::text in (
        'main_store',
        'central_warehouse',
        'branch_store'
      )
      and (
        location.inventory_domain = target_location.inventory_domain
        or location.inventory_domain = 'shared'
      )
    order by
      case
        when location.inventory_domain = target_location.inventory_domain then 0
        when location.location_type::text = 'main_store' then 1
        else 2
      end,
      location.created_at asc
    limit 1;
  end if;

  if preferred_store.id is null then
    select *
      into preferred_store
    from public.locations location
    where location.organization_id = new.organization_id
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
    raise exception 'Create a main store before creating department stock balances.';
  end if;

  if new.origin_inventory_item_id is not null then
    select origin.*
      into origin_item
    from public.inventory_items origin
    join public.locations origin_location
      on origin_location.id = origin.location_id
    where origin.id = new.origin_inventory_item_id
      and origin.organization_id = new.organization_id
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
    where origin.organization_id = new.organization_id
      and origin.location_id = preferred_store.id
      and origin.cost_type = new.cost_type
      and (
        (new.recipe_id is not null and origin.recipe_id = new.recipe_id)
        or lower(
          coalesce(nullif(trim(origin.sku), ''), nullif(trim(origin.name), ''), origin.id::text)
        ) = identity_key
      )
    order by
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
      new.tenant_id,
      new.organization_id,
      preferred_store.id,
      new.recipe_id,
      new.name,
      new.sku,
      new.department,
      new.item_type,
      new.cost_type,
      new.base_uom,
      new.recipe_uom,
      coalesce(new.on_hand_uom, new.base_uom, new.recipe_uom, 'unit'),
      0,
      coalesce(new.current_cost_per_base_uom, 0),
      new.yield_pct,
      new.shrinkage_factor_pct,
      new.is_high_value,
      true
    )
    returning * into origin_item;
  end if;

  update public.inventory_items
     set is_active = true,
         origin_inventory_item_id = origin_item.id
   where id = origin_item.id;

  new.origin_inventory_item_id := origin_item.id;
  new.is_active := true;

  return new;
end;
$$;

drop trigger if exists ensure_inventory_item_origin on public.inventory_items;
create trigger ensure_inventory_item_origin
before insert or update of organization_id, location_id, cost_type, origin_inventory_item_id
on public.inventory_items
for each row execute function public.ensure_inventory_item_origin();

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

  update public.inventory_items item
     set origin_inventory_item_id = null,
         is_active = true
    from public.locations location
   where location.id = item.location_id
     and location.location_type::text not in (
       'main_store',
       'central_warehouse',
       'branch_store'
     )
     and item.cost_type::text in ('purchased', 'manufactured')
     and (target_organization_id is null or item.organization_id = target_organization_id);

  get diagnostics changed_count = row_count;
  affected_count := affected_count + changed_count;

  return affected_count;
end;
$$;

grant execute on function public.repair_dashboard_canonical_store_skus(uuid)
  to authenticated;

select public.repair_dashboard_canonical_store_skus(null);

notify pgrst, 'reload schema';
