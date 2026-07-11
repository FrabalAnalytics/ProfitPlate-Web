-- Manufactured sub-recipe SKUs can return to main stores, so they need main-store origin records too.

do $$
declare
  manufactured_item public.inventory_items;
  item_location public.locations;
  preferred_main_store public.locations;
  origin_item public.inventory_items;
  item_text text;
begin
  for manufactured_item in
    select ii.*
    from public.inventory_items ii
    left join public.locations l on l.id = ii.location_id
    where ii.cost_type = 'manufactured'
      and (
        ii.origin_inventory_item_id is null
        or ii.origin_inventory_item_id = ii.id
        or coalesce(l.location_type::text, '') <> 'main_store'
      )
  loop
    item_location := null::public.locations;
    preferred_main_store := null::public.locations;
    origin_item := null::public.inventory_items;
    item_text := lower(concat_ws(' ', manufactured_item.name, manufactured_item.sku, manufactured_item.department));

    select *
      into item_location
    from public.locations l
    where l.id = manufactured_item.location_id;

    if item_location.location_type = 'main_store' then
      update public.inventory_items
         set origin_inventory_item_id = manufactured_item.id,
             is_active = true
       where id = manufactured_item.id;
    else
      select *
        into preferred_main_store
      from public.locations l
      where l.organization_id = manufactured_item.organization_id
        and l.is_active = true
        and l.location_type = 'main_store'
        and (
          (
            item_text ~ '(drink|bar|beverage)'
            and lower(l.name) like '%drink%'
          )
          or (
            item_text !~ '(drink|bar|beverage)'
            and lower(l.name) like '%food%'
          )
        )
      order by
        case
          when item_text ~ '(drink|bar|beverage)'
               and lower(l.name) like '%drink%' then 0
          when item_text !~ '(drink|bar|beverage)'
               and lower(l.name) like '%food%' then 0
          else 1
        end,
        l.created_at asc
      limit 1;

      if preferred_main_store.id is null then
        select *
          into preferred_main_store
        from public.locations l
        where l.organization_id = manufactured_item.organization_id
          and l.is_active = true
          and l.location_type = 'main_store'
        order by l.created_at asc
        limit 1;
      end if;

      if preferred_main_store.id is not null then
        select *
          into origin_item
        from public.inventory_items ii
        where ii.organization_id = manufactured_item.organization_id
          and ii.location_id = preferred_main_store.id
          and ii.cost_type = 'manufactured'
          and (
            (ii.recipe_id is not null and ii.recipe_id = manufactured_item.recipe_id)
            or lower(coalesce(ii.sku, ii.name, '')) = lower(coalesce(manufactured_item.sku, manufactured_item.name, ''))
          )
        for update;

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
            manufactured_item.tenant_id,
            manufactured_item.organization_id,
            preferred_main_store.id,
            manufactured_item.recipe_id,
            manufactured_item.name,
            manufactured_item.sku,
            manufactured_item.department,
            manufactured_item.item_type,
            manufactured_item.cost_type,
            manufactured_item.base_uom,
            manufactured_item.recipe_uom,
            coalesce(manufactured_item.on_hand_uom, manufactured_item.base_uom, 'unit'),
            0,
            manufactured_item.current_cost_per_base_uom,
            manufactured_item.yield_pct,
            manufactured_item.shrinkage_factor_pct,
            manufactured_item.is_high_value,
            true
          )
          returning * into origin_item;
        end if;

        update public.inventory_items
           set origin_inventory_item_id = origin_item.id,
               is_active = true
         where id = manufactured_item.id;

        update public.inventory_items
           set origin_inventory_item_id = origin_item.id,
               is_active = true
         where id = origin_item.id;
      end if;
    end if;
  end loop;
end $$;

create or replace function public.sync_sub_recipe_inventory_item()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  production_location_id uuid;
  main_store_location_id uuid;
  kitchen_item_id uuid;
  origin_item_id uuid;
  item_text text;
begin
  if new.recipe_type = 'sub_recipe' then
    item_text := lower(concat_ws(' ', new.name, 'SUB-' || left(new.id::text, 8)));

    select l.id
      into production_location_id
    from public.locations l
    where l.organization_id = new.organization_id
      and l.is_active = true
      and (
        l.location_type::text = 'production_kitchen'
        or lower(l.name) like '%kitchen%'
      )
    order by
      case when l.location_type::text = 'production_kitchen' then 0 else 1 end,
      l.created_at asc
    limit 1;

    select l.id
      into main_store_location_id
    from public.locations l
    where l.organization_id = new.organization_id
      and l.is_active = true
      and l.location_type = 'main_store'
      and (
        (
          item_text ~ '(drink|bar|beverage)'
          and lower(l.name) like '%drink%'
        )
        or (
          item_text !~ '(drink|bar|beverage)'
          and lower(l.name) like '%food%'
        )
      )
    order by
      case
        when item_text ~ '(drink|bar|beverage)'
             and lower(l.name) like '%drink%' then 0
        when item_text !~ '(drink|bar|beverage)'
             and lower(l.name) like '%food%' then 0
        else 1
      end,
      l.created_at asc
    limit 1;

    if main_store_location_id is null then
      select l.id
        into main_store_location_id
      from public.locations l
      where l.organization_id = new.organization_id
        and l.is_active = true
        and l.location_type = 'main_store'
      order by l.created_at asc
      limit 1;
    end if;

    select ii.id
      into origin_item_id
    from public.inventory_items ii
    where ii.organization_id = new.organization_id
      and ii.recipe_id = new.id
      and ii.cost_type = 'manufactured'
      and ii.location_id = main_store_location_id
    order by ii.created_at asc
    limit 1;

    if origin_item_id is null then
      insert into public.inventory_items (
        tenant_id,
        organization_id,
        location_id,
        recipe_id,
        name,
        sku,
        item_type,
        cost_type,
        on_hand_uom,
        current_cost_per_base_uom,
        is_active
      ) values (
        coalesce(new.tenant_id, new.organization_id),
        new.organization_id,
        main_store_location_id,
        new.id,
        new.name,
        'SUB-' || left(new.id::text, 8),
        'semi_finished',
        'manufactured',
        coalesce(new.output_uom, 'kg'),
        coalesce(new.resolved_unit_cost, 0),
        new.is_active
      )
      returning id into origin_item_id;
    end if;

    update public.inventory_items
       set name = new.name,
           tenant_id = coalesce(tenant_id, new.tenant_id, new.organization_id),
           organization_id = coalesce(organization_id, new.organization_id),
           current_cost_per_base_uom = coalesce(new.resolved_unit_cost, 0),
           on_hand_uom = coalesce(on_hand_uom, new.output_uom, 'kg'),
           origin_inventory_item_id = origin_item_id,
           is_active = new.is_active
     where id = origin_item_id;

    select ii.id
      into kitchen_item_id
    from public.inventory_items ii
    where ii.organization_id = new.organization_id
      and ii.recipe_id = new.id
      and ii.cost_type = 'manufactured'
      and (
        ii.location_id = production_location_id
        or ii.location_id is null
      )
    order by
      case when ii.location_id = production_location_id then 0 else 1 end,
      ii.created_at asc
    limit 1;

    if kitchen_item_id is null then
      insert into public.inventory_items (
        tenant_id,
        organization_id,
        location_id,
        recipe_id,
        name,
        sku,
        item_type,
        cost_type,
        on_hand_uom,
        current_cost_per_base_uom,
        origin_inventory_item_id,
        is_active
      ) values (
        coalesce(new.tenant_id, new.organization_id),
        new.organization_id,
        production_location_id,
        new.id,
        new.name,
        'SUB-' || left(new.id::text, 8),
        'semi_finished',
        'manufactured',
        coalesce(new.output_uom, 'kg'),
        coalesce(new.resolved_unit_cost, 0),
        origin_item_id,
        new.is_active
      )
      returning id into kitchen_item_id;
    end if;

    update public.inventory_items
       set name = new.name,
           tenant_id = coalesce(tenant_id, new.tenant_id, new.organization_id),
           organization_id = coalesce(organization_id, new.organization_id),
           location_id = coalesce(location_id, production_location_id),
           current_cost_per_base_uom = coalesce(new.resolved_unit_cost, 0),
           on_hand_uom = coalesce(on_hand_uom, new.output_uom, 'kg'),
           origin_inventory_item_id = origin_item_id,
           is_active = new.is_active
     where id = kitchen_item_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_sub_recipe_inventory_item on public.recipes;
create trigger sync_sub_recipe_inventory_item
after insert or update of recipe_type, name, resolved_unit_cost, is_active on public.recipes
for each row execute function public.sync_sub_recipe_inventory_item();

create or replace function public.ensure_inventory_item_origin()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_location public.locations;
  origin_item public.inventory_items;
  item_text text;
begin
  if new.organization_id is null then
    return new;
  end if;

  item_text := lower(concat_ws(' ', new.name, new.sku, new.department));

  if new.cost_type = 'manufactured' then
    select *
      into target_location
    from public.locations l
    where l.id = new.location_id;

    if new.location_id is null then
      select *
        into target_location
      from public.locations l
      where l.organization_id = new.organization_id
        and l.is_active = true
        and (
          l.location_type::text = 'production_kitchen'
          or lower(l.name) like '%kitchen%'
        )
      order by
        case when l.location_type::text = 'production_kitchen' then 0 else 1 end,
        l.created_at asc
      limit 1;

      new.location_id := target_location.id;
    end if;

    if target_location.location_type = 'main_store' then
      new.origin_inventory_item_id := coalesce(new.origin_inventory_item_id, new.id);
    elsif new.origin_inventory_item_id is null then
      select *
        into origin_item
      from public.inventory_items ii
      join public.locations l on l.id = ii.location_id
      where ii.organization_id = new.organization_id
        and ii.cost_type = 'manufactured'
        and l.location_type = 'main_store'
        and (
          (new.recipe_id is not null and ii.recipe_id = new.recipe_id)
          or lower(coalesce(ii.sku, ii.name, '')) = lower(coalesce(new.sku, new.name, ''))
        )
      order by ii.created_at asc
      limit 1;

      new.origin_inventory_item_id := origin_item.id;
    end if;
  elsif new.cost_type = 'purchased' then
    if new.location_id is null then
      select *
        into target_location
      from public.locations l
      where l.organization_id = new.organization_id
        and l.is_active = true
        and l.location_type = 'main_store'
        and (
          (
            item_text ~ '(drink|bar|beverage)'
            and lower(l.name) like '%drink%'
          )
          or (
            item_text !~ '(drink|bar|beverage)'
            and lower(l.name) like '%food%'
          )
        )
      order by
        case
          when item_text ~ '(drink|bar|beverage)'
               and lower(l.name) like '%drink%' then 0
          when item_text !~ '(drink|bar|beverage)'
               and lower(l.name) like '%food%' then 0
          else 1
        end,
        l.created_at asc
      limit 1;

      if target_location.id is null then
        select *
          into target_location
        from public.locations l
        where l.organization_id = new.organization_id
          and l.is_active = true
          and l.location_type = 'main_store'
        order by l.created_at asc
        limit 1;
      end if;

      new.location_id := target_location.id;
    end if;

    select *
      into target_location
    from public.locations l
    where l.id = new.location_id;

    if target_location.location_type = 'main_store' then
      new.origin_inventory_item_id := coalesce(new.origin_inventory_item_id, new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_inventory_item_origin on public.inventory_items;
create trigger ensure_inventory_item_origin
before insert or update of organization_id, location_id, cost_type, origin_inventory_item_id
on public.inventory_items
for each row execute function public.ensure_inventory_item_origin();

notify pgrst, 'reload schema';
