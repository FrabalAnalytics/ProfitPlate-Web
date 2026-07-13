-- Protect master data from accidental duplicates. These trigger checks block
-- new duplicate suppliers, location SKUs/items, and recipes even when records
-- are created outside the dashboard UI.

create or replace function public.normalize_master_data_key(value text)
returns text
language sql
immutable
as $$
  select lower(
    regexp_replace(
      trim(coalesce(value, '')),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.prevent_duplicate_supplier_master_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active is true
     and exists (
       select 1
       from public.suppliers supplier
       where supplier.organization_id = new.organization_id
         and supplier.id is distinct from new.id
         and supplier.is_active = true
         and public.normalize_master_data_key(supplier.name)
             = public.normalize_master_data_key(new.name)
     ) then
    raise exception 'Duplicate supplier blocked: % already exists in this workspace. Update the existing supplier instead.', trim(new.name);
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_duplicate_supplier_master_data
  on public.suppliers;
create trigger prevent_duplicate_supplier_master_data
before insert or update of organization_id, name, is_active
on public.suppliers
for each row
execute function public.prevent_duplicate_supplier_master_data();

create or replace function public.prevent_duplicate_inventory_master_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_sku text := public.normalize_master_data_key(new.sku);
  clean_name text := public.normalize_master_data_key(new.name);
begin
  if new.is_active is not true then
    return new;
  end if;

  if clean_sku <> ''
     and exists (
       select 1
       from public.inventory_items item
       where item.organization_id = new.organization_id
         and item.id is distinct from new.id
         and item.is_active = true
         and item.location_id is not distinct from new.location_id
         and public.normalize_master_data_key(item.sku) = clean_sku
     ) then
    raise exception 'Duplicate SKU blocked: % already exists in this location. Update the existing SKU instead.', trim(new.sku);
  end if;

  if clean_name <> ''
     and exists (
       select 1
       from public.inventory_items item
       where item.organization_id = new.organization_id
         and item.id is distinct from new.id
         and item.is_active = true
         and item.location_id is not distinct from new.location_id
         and public.normalize_master_data_key(item.name) = clean_name
         and coalesce(item.cost_type::text, '') = coalesce(new.cost_type::text, '')
     ) then
    raise exception 'Duplicate inventory item blocked: % already exists in this location. Update the existing item instead.', trim(new.name);
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_duplicate_inventory_master_data
  on public.inventory_items;
create trigger prevent_duplicate_inventory_master_data
before insert or update of organization_id, location_id, name, sku, cost_type, is_active
on public.inventory_items
for each row
execute function public.prevent_duplicate_inventory_master_data();

create or replace function public.prevent_duplicate_recipe_master_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active is true
     and exists (
       select 1
       from public.recipes recipe
       where recipe.organization_id = new.organization_id
         and recipe.id is distinct from new.id
         and recipe.is_active = true
         and recipe.recipe_type::text = new.recipe_type::text
         and public.normalize_master_data_key(recipe.name)
             = public.normalize_master_data_key(new.name)
     ) then
    raise exception 'Duplicate recipe blocked: % already exists as a % recipe. Update the existing recipe instead.', trim(new.name), new.recipe_type::text;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_duplicate_recipe_master_data
  on public.recipes;
create trigger prevent_duplicate_recipe_master_data
before insert or update of organization_id, name, recipe_type, is_active
on public.recipes
for each row
execute function public.prevent_duplicate_recipe_master_data();

do $$
begin
  if not exists (
    select 1
    from (
      select organization_id, public.normalize_master_data_key(name) as name_key
      from public.suppliers
      where is_active = true
      group by organization_id, public.normalize_master_data_key(name)
      having count(*) > 1
    ) duplicates
  ) then
    create unique index if not exists idx_suppliers_unique_active_name
      on public.suppliers(organization_id, public.normalize_master_data_key(name))
      where is_active = true;
  end if;

  if not exists (
    select 1
    from (
      select
        organization_id,
        coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid) as location_key,
        public.normalize_master_data_key(sku) as sku_key
      from public.inventory_items
      where is_active = true
        and nullif(trim(coalesce(sku, '')), '') is not null
      group by organization_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), public.normalize_master_data_key(sku)
      having count(*) > 1
    ) duplicates
  ) then
    create unique index if not exists idx_inventory_items_unique_active_location_sku
      on public.inventory_items(
        organization_id,
        coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
        public.normalize_master_data_key(sku)
      )
      where is_active = true
        and nullif(trim(coalesce(sku, '')), '') is not null;
  end if;

  if not exists (
    select 1
    from (
      select
        organization_id,
        coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid) as location_key,
        cost_type::text as cost_type_key,
        public.normalize_master_data_key(name) as name_key
      from public.inventory_items
      where is_active = true
        and nullif(trim(coalesce(name, '')), '') is not null
      group by organization_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), cost_type::text, public.normalize_master_data_key(name)
      having count(*) > 1
    ) duplicates
  ) then
    create unique index if not exists idx_inventory_items_unique_active_location_name_cost
      on public.inventory_items(
        organization_id,
        coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
        cost_type,
        public.normalize_master_data_key(name)
      )
      where is_active = true
        and nullif(trim(coalesce(name, '')), '') is not null;
  end if;

  if not exists (
    select 1
    from (
      select organization_id, recipe_type::text as recipe_type_key, public.normalize_master_data_key(name) as name_key
      from public.recipes
      where is_active = true
      group by organization_id, recipe_type::text, public.normalize_master_data_key(name)
      having count(*) > 1
    ) duplicates
  ) then
    create unique index if not exists idx_recipes_unique_active_name_type
      on public.recipes(organization_id, recipe_type, public.normalize_master_data_key(name))
      where is_active = true;
  end if;
end $$;

notify pgrst, 'reload schema';
