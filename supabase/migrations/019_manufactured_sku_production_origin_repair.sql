-- Manufactured sub-recipe SKUs originate from production, while purchased SKUs originate from main stores.

do $$
declare
  target_item public.inventory_items;
  target_location public.locations;
  item_text text;
begin
  for target_item in
    select ii.*
    from public.inventory_items ii
    where ii.origin_inventory_item_id is null
  loop
    target_location := null::public.locations;
    item_text := lower(concat_ws(' ', target_item.name, target_item.sku, target_item.department));

    if target_item.cost_type = 'manufactured' then
      select *
        into target_location
      from public.locations l
      where l.organization_id = target_item.organization_id
        and l.is_active = true
        and (
          l.location_type::text = 'production_kitchen'
          or lower(l.name) like '%kitchen%'
        )
      order by
        case when l.location_type::text = 'production_kitchen' then 0 else 1 end,
        l.created_at asc
      limit 1;

      update public.inventory_items
         set location_id = coalesce(location_id, target_location.id),
             origin_inventory_item_id = target_item.id,
             is_active = true
       where id = target_item.id;
    elsif target_item.cost_type = 'purchased' then
      select *
        into target_location
      from public.locations l
      where l.organization_id = target_item.organization_id
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
        where l.organization_id = target_item.organization_id
          and l.is_active = true
          and l.location_type = 'main_store'
        order by l.created_at asc
        limit 1;
      end if;

      update public.inventory_items
         set location_id = coalesce(location_id, target_location.id),
             origin_inventory_item_id = target_item.id,
             is_active = true
       where id = target_item.id;
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
  synced_item_id uuid;
begin
  if new.recipe_type = 'sub_recipe' then
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
      production_location_id,
      new.id,
      new.name,
      'SUB-' || left(new.id::text, 8),
      'semi_finished',
      'manufactured',
      coalesce(new.output_uom, 'kg'),
      coalesce(new.resolved_unit_cost, 0),
      new.is_active
    )
    on conflict do nothing;

    update public.inventory_items
       set name = new.name,
           tenant_id = coalesce(tenant_id, new.tenant_id, new.organization_id),
           organization_id = coalesce(organization_id, new.organization_id),
           location_id = coalesce(location_id, production_location_id),
           current_cost_per_base_uom = coalesce(new.resolved_unit_cost, 0),
           on_hand_uom = coalesce(on_hand_uom, new.output_uom, 'kg'),
           is_active = new.is_active
     where recipe_id = new.id
       and cost_type = 'manufactured'
     returning id into synced_item_id;

    update public.inventory_items
       set origin_inventory_item_id = coalesce(origin_inventory_item_id, id)
     where id = synced_item_id;
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
  item_text text;
begin
  if new.organization_id is null then
    return new;
  end if;

  if new.cost_type = 'manufactured' then
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

    new.origin_inventory_item_id := coalesce(new.origin_inventory_item_id, new.id);
  elsif new.cost_type = 'purchased' then
    item_text := lower(concat_ws(' ', new.name, new.sku, new.department));

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
