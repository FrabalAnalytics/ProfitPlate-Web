-- Route sales depletion to the correct user department/location.
-- POS revenue may arrive at a selling location, but stock should be depleted
-- from the configured department stock for each recipe component.

create table if not exists public.sales_depletion_routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipe_id uuid references public.recipes(id) on delete cascade,
  component_inventory_item_id uuid references public.inventory_items(id) on delete cascade,
  selling_location_id uuid references public.locations(id) on delete cascade,
  depletion_location_id uuid references public.locations(id) on delete cascade,
  depletion_inventory_item_id uuid references public.inventory_items(id) on delete cascade,
  route_strategy text not null default 'same_origin_in_selling_location',
  priority integer not null default 100,
  is_active boolean not null default true,
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_depletion_routes_strategy_check check (
    route_strategy in (
      'exact_inventory_item',
      'same_origin_in_selling_location',
      'same_origin_in_depletion_location',
      'same_sku_in_selling_location',
      'same_sku_in_depletion_location',
      'component_default'
    )
  ),
  constraint sales_depletion_routes_target_check check (
    depletion_inventory_item_id is not null
    or depletion_location_id is not null
    or route_strategy in (
      'same_origin_in_selling_location',
      'same_sku_in_selling_location',
      'component_default'
    )
  )
);

drop trigger if exists set_sales_depletion_routes_updated_at
  on public.sales_depletion_routes;
create trigger set_sales_depletion_routes_updated_at
before update on public.sales_depletion_routes
for each row execute function public.set_updated_at();

create index if not exists idx_sales_depletion_routes_scope
  on public.sales_depletion_routes(
    organization_id,
    recipe_id,
    component_inventory_item_id,
    selling_location_id,
    priority desc
  );

alter table public.sales_depletion_routes enable row level security;

drop policy if exists "sales_depletion_routes_member_select"
  on public.sales_depletion_routes;
create policy "sales_depletion_routes_member_select"
on public.sales_depletion_routes
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "sales_depletion_routes_member_write"
  on public.sales_depletion_routes;
create policy "sales_depletion_routes_member_write"
on public.sales_depletion_routes
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_record_operations(organization_id));

create or replace function public.resolve_dashboard_sales_depletion_item(
  target_organization_id uuid,
  target_recipe_id uuid,
  target_component_inventory_item_id uuid,
  selling_location_id_value uuid default null
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  source_item public.inventory_items;
  selected_route public.sales_depletion_routes;
  resolved_item public.inventory_items;
  source_origin_id uuid;
begin
  select *
    into source_item
  from public.inventory_items item
  where item.id = target_component_inventory_item_id
    and item.organization_id = target_organization_id;

  if source_item.id is null then
    raise exception 'Recipe component stock item was not found.';
  end if;

  source_origin_id := coalesce(source_item.origin_inventory_item_id, source_item.id);

  select route.*
    into selected_route
  from public.sales_depletion_routes route
  where route.organization_id = target_organization_id
    and route.is_active
    and (route.recipe_id is null or route.recipe_id = target_recipe_id)
    and (
      route.component_inventory_item_id is null
      or route.component_inventory_item_id = target_component_inventory_item_id
      or route.component_inventory_item_id = source_origin_id
    )
    and (
      route.selling_location_id is null
      or route.selling_location_id = selling_location_id_value
    )
  order by
    (route.recipe_id is not null)::integer desc,
    (route.component_inventory_item_id is not null)::integer desc,
    (route.selling_location_id is not null)::integer desc,
    route.priority desc,
    route.created_at desc
  limit 1;

  if selected_route.depletion_inventory_item_id is not null then
    select *
      into resolved_item
    from public.inventory_items item
    where item.id = selected_route.depletion_inventory_item_id
      and item.organization_id = target_organization_id
      and item.is_active;
  elsif selected_route.id is not null
    and selected_route.depletion_location_id is not null
  then
    select *
      into resolved_item
    from public.inventory_items item
    where item.organization_id = target_organization_id
      and item.location_id = selected_route.depletion_location_id
      and item.is_active
      and (
        coalesce(item.origin_inventory_item_id, item.id) = source_origin_id
        or item.id = source_origin_id
        or (
          nullif(trim(coalesce(item.sku, '')), '') is not null
          and lower(trim(item.sku)) = lower(trim(coalesce(source_item.sku, '')))
        )
      )
    order by
      (coalesce(item.origin_inventory_item_id, item.id) = source_origin_id)::integer desc,
      item.updated_at desc
    limit 1;
  elsif selling_location_id_value is not null then
    select *
      into resolved_item
    from public.inventory_items item
    where item.organization_id = target_organization_id
      and item.location_id = selling_location_id_value
      and item.is_active
      and (
        coalesce(item.origin_inventory_item_id, item.id) = source_origin_id
        or item.id = source_origin_id
        or (
          nullif(trim(coalesce(item.sku, '')), '') is not null
          and lower(trim(item.sku)) = lower(trim(coalesce(source_item.sku, '')))
        )
      )
    order by
      (coalesce(item.origin_inventory_item_id, item.id) = source_origin_id)::integer desc,
      item.updated_at desc
    limit 1;
  end if;

  if resolved_item.id is null then
    resolved_item := source_item;
  end if;

  return resolved_item;
end;
$$;

grant execute on function public.resolve_dashboard_sales_depletion_item(
  uuid,
  uuid,
  uuid,
  uuid
) to authenticated;

create or replace function public.deplete_dashboard_menu_sale_stock(
  target_organization_id uuid,
  sale_source_id uuid,
  target_recipe_id uuid,
  sold_quantity numeric,
  selling_location_id_value uuid default null,
  current_user_id uuid default auth.uid()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_recipe public.recipes;
  component_line record;
  resolved_item public.inventory_items;
  required_quantity numeric(18, 6);
  depleted_line_count integer := 0;
  has_legacy_item_id boolean;
begin
  select *
    into selected_recipe
  from public.recipes recipe
  where recipe.id = target_recipe_id
    and recipe.organization_id = target_organization_id
    and recipe.is_active;

  if selected_recipe.id is null then
    raise exception 'Menu item not found for this workspace.';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transformation_events'
      and column_name = 'item_id'
  )
    into has_legacy_item_id;

  for component_line in
    select
      rc.component_inventory_item_id,
      rc.qty_in_recipe_uom
    from public.recipe_components rc
    where rc.recipe_id = selected_recipe.id
      and rc.organization_id = target_organization_id
      and rc.component_inventory_item_id is not null
  loop
    resolved_item := public.resolve_dashboard_sales_depletion_item(
      target_organization_id,
      selected_recipe.id,
      component_line.component_inventory_item_id,
      selling_location_id_value
    );

    required_quantity :=
      (component_line.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
      * sold_quantity;

    if resolved_item.id is null then
      raise exception 'No depletion stock item could be resolved for this sale.';
    end if;

    if has_legacy_item_id then
      execute '
        insert into public.transformation_events (
          organization_id,
          event_type,
          inventory_item_id,
          item_id,
          location_id,
          quantity,
          unit_cost,
          source_table,
          source_id,
          created_by
        ) values (
          $1,
          ''sales_depletion'',
          $2,
          $2,
          $3,
          $4,
          $5,
          ''menu_sales'',
          $6,
          $7
        )'
      using
        target_organization_id,
        resolved_item.id,
        resolved_item.location_id,
        -1 * required_quantity,
        coalesce(resolved_item.current_cost_per_base_uom, 0),
        sale_source_id,
        current_user_id;
    else
      insert into public.transformation_events (
        organization_id,
        event_type,
        inventory_item_id,
        location_id,
        quantity,
        unit_cost,
        source_table,
        source_id,
        created_by
      ) values (
        target_organization_id,
        'sales_depletion',
        resolved_item.id,
        resolved_item.location_id,
        -1 * required_quantity,
        coalesce(resolved_item.current_cost_per_base_uom, 0),
        'menu_sales',
        sale_source_id,
        current_user_id
      );
    end if;

    update public.inventory_items
       set on_hand_qty = on_hand_qty - required_quantity
     where id = resolved_item.id
       and organization_id = target_organization_id;

    depleted_line_count := depleted_line_count + 1;
  end loop;

  if depleted_line_count = 0 then
    raise exception 'Attach at least one component before recording sales.';
  end if;

  return depleted_line_count;
end;
$$;

grant execute on function public.deplete_dashboard_menu_sale_stock(
  uuid,
  uuid,
  uuid,
  numeric,
  uuid,
  uuid
) to authenticated;

drop function if exists public.create_dashboard_menu_sale(uuid, numeric);
drop function if exists public.create_dashboard_menu_sale(uuid, numeric, uuid);

create function public.create_dashboard_menu_sale(
  target_recipe_id uuid,
  sold_quantity numeric,
  location_id_value uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  selected_recipe public.recipes;
  sale_source_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to record menu sales.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before recording menu sales.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  if sold_quantity is null or sold_quantity <= 0 then
    raise exception 'Sold quantity must be greater than zero.';
  end if;

  select *
    into selected_recipe
  from public.recipes
  where id = target_recipe_id
    and organization_id = current_organization_id
    and is_active = true;

  if selected_recipe.id is null then
    raise exception 'Menu item not found for this workspace.';
  end if;

  if selected_recipe.recipe_type::text not in ('final_menu_item', 'final_dish') then
    raise exception 'Only final menu items can be recorded as sales.';
  end if;

  if location_id_value is not null and not exists (
    select 1
    from public.locations location
    where location.id = location_id_value
      and location.organization_id = current_organization_id
  ) then
    raise exception 'The selected location does not belong to this workspace.';
  end if;

  insert into public.menu_sales (
    tenant_id,
    organization_id,
    recipe_id,
    sold_quantity,
    selling_unit_price,
    total_revenue,
    operating_date,
    location_id,
    created_by
  ) values (
    current_user_id,
    current_organization_id,
    selected_recipe.id,
    sold_quantity,
    coalesce(selected_recipe.selling_price, 0),
    sold_quantity * coalesce(selected_recipe.selling_price, 0),
    (now() at time zone (
      select coalesce(organization.operating_timezone, 'Africa/Lagos')
      from public.organizations organization
      where organization.id = current_organization_id
    ))::date,
    location_id_value,
    current_user_id
  )
  returning id into sale_source_id;

  return public.deplete_dashboard_menu_sale_stock(
    current_organization_id,
    sale_source_id,
    selected_recipe.id,
    sold_quantity,
    location_id_value,
    current_user_id
  );
end;
$$;

grant execute on function public.create_dashboard_menu_sale(uuid, numeric, uuid)
  to authenticated;

drop function if exists public.create_dashboard_menu_sale_with_revenue(
  uuid,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  uuid,
  text,
  text,
  date,
  uuid,
  date,
  timestamptz,
  text,
  text
);

create function public.create_dashboard_menu_sale_with_revenue(
  target_recipe_id uuid,
  sold_quantity numeric,
  gross_sales_value numeric default null,
  discount_amount_value numeric default 0,
  promo_amount_value numeric default 0,
  void_amount_value numeric default 0,
  pos_import_batch_id_value uuid default null,
  pos_source_label_value text default null,
  pos_source_code_value text default null,
  operating_date_value date default null,
  location_id_value uuid default null,
  pos_business_date_value date default null,
  pos_transaction_timestamp_value timestamptz default null,
  pos_source_transaction_id_value text default null,
  pos_source_check_id_value text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  selected_recipe public.recipes;
  sale_source_id uuid;
  clean_gross_sales numeric(18, 6);
  clean_discount_amount numeric(18, 6);
  clean_promo_amount numeric(18, 6);
  clean_void_amount numeric(18, 6);
  clean_net_sales numeric(18, 6);
  clean_selling_unit_price numeric(18, 6);
  resolved_operating_date date;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to record menu sales.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before recording menu sales.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  if sold_quantity is null or sold_quantity <= 0 then
    raise exception 'Sold quantity must be greater than zero.';
  end if;

  select *
    into selected_recipe
  from public.recipes
  where id = target_recipe_id
    and organization_id = current_organization_id
    and is_active = true;

  if selected_recipe.id is null then
    raise exception 'Menu item not found for this workspace.';
  end if;

  if selected_recipe.recipe_type::text not in ('final_menu_item', 'final_dish') then
    raise exception 'Only final menu items can be recorded as sales.';
  end if;

  if pos_import_batch_id_value is not null and not exists (
    select 1
    from public.pos_sales_import_batches b
    where b.id = pos_import_batch_id_value
      and b.organization_id = current_organization_id
  ) then
    raise exception 'POS import batch not found for this workspace.';
  end if;

  if location_id_value is not null and not exists (
    select 1
    from public.locations location
    where location.id = location_id_value
      and location.organization_id = current_organization_id
  ) then
    raise exception 'The selected location does not belong to this workspace.';
  end if;

  resolved_operating_date := coalesce(
    operating_date_value,
    pos_business_date_value,
    (coalesce(pos_transaction_timestamp_value, now()) at time zone (
      select coalesce(organization.operating_timezone, 'Africa/Lagos')
      from public.organizations organization
      where organization.id = current_organization_id
    ))::date
  );

  clean_gross_sales :=
    case
      when gross_sales_value is null then sold_quantity * coalesce(selected_recipe.selling_price, 0)
      else greatest(gross_sales_value, 0)
    end;
  clean_discount_amount := greatest(coalesce(discount_amount_value, 0), 0);
  clean_promo_amount := greatest(coalesce(promo_amount_value, 0), 0);
  clean_void_amount := greatest(coalesce(void_amount_value, 0), 0);
  clean_net_sales := greatest(
    clean_gross_sales - clean_discount_amount - clean_promo_amount - clean_void_amount,
    0
  );
  clean_selling_unit_price := clean_net_sales / nullif(sold_quantity, 0);

  insert into public.menu_sales (
    tenant_id,
    organization_id,
    recipe_id,
    sold_quantity,
    selling_unit_price,
    total_revenue,
    gross_sales,
    discount_amount,
    promo_amount,
    void_amount,
    net_sales,
    operating_date,
    location_id,
    pos_business_date,
    pos_transaction_timestamp,
    pos_import_batch_id,
    pos_source_label,
    pos_source_code,
    pos_source_transaction_id,
    pos_source_check_id,
    created_by
  ) values (
    current_user_id,
    current_organization_id,
    selected_recipe.id,
    sold_quantity,
    clean_selling_unit_price,
    clean_net_sales,
    clean_gross_sales,
    clean_discount_amount,
    clean_promo_amount,
    clean_void_amount,
    clean_net_sales,
    resolved_operating_date,
    location_id_value,
    coalesce(pos_business_date_value, resolved_operating_date),
    pos_transaction_timestamp_value,
    pos_import_batch_id_value,
    nullif(trim(coalesce(pos_source_label_value, '')), ''),
    nullif(trim(coalesce(pos_source_code_value, '')), ''),
    nullif(trim(coalesce(pos_source_transaction_id_value, '')), ''),
    nullif(trim(coalesce(pos_source_check_id_value, '')), ''),
    current_user_id
  )
  returning id into sale_source_id;

  return public.deplete_dashboard_menu_sale_stock(
    current_organization_id,
    sale_source_id,
    selected_recipe.id,
    sold_quantity,
    location_id_value,
    current_user_id
  );
end;
$$;

grant execute on function public.create_dashboard_menu_sale_with_revenue(
  uuid,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  uuid,
  text,
  text,
  date,
  uuid,
  date,
  timestamptz,
  text,
  text
) to authenticated;

notify pgrst, 'reload schema';
