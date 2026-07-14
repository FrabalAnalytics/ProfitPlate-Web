-- Production output must reuse an existing manufactured SKU at the output
-- location, even when older live data is missing the recipe_id link or carries
-- older enum labels. This keeps the duplicate master-data guardrail intact
-- while allowing production to post.

create or replace function public.create_dashboard_production_run(
  target_recipe_id uuid,
  target_output_quantity numeric,
  actual_output_quantity numeric default null,
  production_origin text default 'kitchen_prep_line',
  actual_component_usages jsonb default '[]'::jsonb,
  output_location_id_value uuid default null
)
returns public.production_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  selected_recipe public.recipes;
  selected_origin public.origin_attribution;
  normalized_actual_output numeric(18, 6);
  manufactured_item_id uuid;
  manufactured_item_type_value text;
  manufactured_sku text;
  production_location_id uuid;
  production_location public.locations;
  candidate_sales_outlet_count integer;
  origin_item_id uuid;
  created_run public.production_runs;
  component_count integer;
  is_final_menu_production boolean;
  inventory_item_type_name text;
  inventory_cost_type_name text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to record production.';
  end if;

  select profile.organization_id
    into current_organization_id
  from public.profiles profile
  where profile.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before recording production.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  if target_output_quantity is null or target_output_quantity <= 0 then
    raise exception 'Target output quantity must be greater than zero.';
  end if;

  normalized_actual_output := coalesce(actual_output_quantity, target_output_quantity);

  if normalized_actual_output <= 0 then
    raise exception 'Actual output quantity must be greater than zero.';
  end if;

  selected_origin := case production_origin
    when 'storage_defrosting' then 'storage_defrosting'::public.origin_attribution
    when 'central_transit' then 'central_transit'::public.origin_attribution
    when 'cold_room_storage' then 'cold_room_storage'::public.origin_attribution
    else 'kitchen_prep_line'::public.origin_attribution
  end;

  select *
    into selected_recipe
  from public.recipes recipe
  where recipe.id = target_recipe_id
    and recipe.organization_id = current_organization_id
    and recipe.is_active = true;

  if selected_recipe.id is null then
    raise exception 'Recipe not found for this workspace.';
  end if;

  if selected_recipe.recipe_type::text not in ('sub_recipe', 'final_menu_item', 'final_dish') then
    raise exception 'Only sub-recipes and final menu items can be produced into manufactured inventory from this dashboard.';
  end if;

  is_final_menu_production :=
    selected_recipe.recipe_type::text in ('final_menu_item', 'final_dish');
  manufactured_item_type_value := case
    when is_final_menu_production then 'final_product'
    else 'semi_finished'
  end;
  manufactured_sku := case
    when is_final_menu_production then 'FG-' || left(selected_recipe.id::text, 8)
    else 'SUB-' || left(selected_recipe.id::text, 8)
  end;

  select attribute_row.atttypid::regtype::text
    into inventory_item_type_name
  from pg_attribute attribute_row
  join pg_class table_row
    on table_row.oid = attribute_row.attrelid
  join pg_namespace namespace_row
    on namespace_row.oid = table_row.relnamespace
  where namespace_row.nspname = 'public'
    and table_row.relname = 'inventory_items'
    and attribute_row.attname = 'item_type'
    and not attribute_row.attisdropped;

  select attribute_row.atttypid::regtype::text
    into inventory_cost_type_name
  from pg_attribute attribute_row
  join pg_class table_row
    on table_row.oid = attribute_row.attrelid
  join pg_namespace namespace_row
    on namespace_row.oid = table_row.relnamespace
  where namespace_row.nspname = 'public'
    and table_row.relname = 'inventory_items'
    and attribute_row.attname = 'cost_type'
    and not attribute_row.attisdropped;

  select count(*)
    into component_count
  from public.recipe_components component
  where component.recipe_id = selected_recipe.id
    and component.organization_id = current_organization_id
    and component.component_inventory_item_id is not null;

  if component_count = 0 then
    raise exception 'Attach at least one ingredient before recording production.';
  end if;

  if actual_component_usages is null
     or jsonb_typeof(actual_component_usages) <> 'array'
     or exists (
       select 1
       from public.recipe_components component
       where component.recipe_id = selected_recipe.id
         and component.organization_id = current_organization_id
         and component.component_inventory_item_id is not null
         and not exists (
           select 1
           from jsonb_array_elements(actual_component_usages) usage_item
           where nullif(usage_item->>'component_inventory_item_id', '')::uuid =
             component.component_inventory_item_id
             and nullif(usage_item->>'actual_qty_used', '')::numeric >= 0
         )
     ) then
    raise exception 'Enter actual raw material quantity used for every production ingredient.';
  end if;

  if output_location_id_value is not null then
    select *
      into production_location
    from public.locations location
    where location.id = output_location_id_value
      and location.organization_id = current_organization_id
      and location.is_active = true;

    if production_location.id is null then
      raise exception 'Selected production output location is not active in this workspace.';
    end if;

    production_location_id := production_location.id;
  elsif is_final_menu_production then
    select location.*
      into production_location
    from public.inventory_items item
    join public.locations location
      on location.id = item.location_id
    where item.organization_id = current_organization_id
      and item.recipe_id = selected_recipe.id
      and item.item_type::text = 'final_product'
      and item.cost_type::text = 'manufactured'
      and item.is_active = true
      and location.is_active = true
      and location.location_type::text = 'sales_outlet'
    order by item.updated_at desc, item.created_at desc
    limit 1;

    production_location_id := production_location.id;

    if production_location_id is null then
      select count(*)
        into candidate_sales_outlet_count
      from public.locations location
      where location.organization_id = current_organization_id
        and location.is_active = true
        and location.location_type::text = 'sales_outlet';

      if candidate_sales_outlet_count = 1 then
        select *
          into production_location
        from public.locations location
        where location.organization_id = current_organization_id
          and location.is_active = true
          and location.location_type::text = 'sales_outlet'
        order by location.created_at asc
        limit 1;

        production_location_id := production_location.id;
      end if;
    end if;
  else
    production_location_id :=
      public.resolve_dashboard_sub_recipe_production_location(
        current_organization_id,
        selected_recipe.name
      );

    if production_location_id is not null then
      select *
        into production_location
      from public.locations location
      where location.id = production_location_id
        and location.organization_id = current_organization_id
        and location.is_active = true;
    end if;
  end if;

  if production_location_id is null then
    if is_final_menu_production then
      raise exception 'Select a sales outlet/front counter output location before recording final menu production.';
    end if;

    raise exception 'Create or activate a Kitchen/Bar department location before recording production.';
  end if;

  if not public.is_dashboard_department_stock_location(
    current_organization_id,
    production_location_id
  ) then
    raise exception 'Production output must land in a department, kitchen, bar, or sales outlet stock location.';
  end if;

  if is_final_menu_production
     and production_location.location_type::text <> 'sales_outlet' then
    raise exception 'Final menu production must be received into a sales outlet/front counter location.';
  end if;

  select item.id, coalesce(item.origin_inventory_item_id, item.id)
    into manufactured_item_id, origin_item_id
  from public.inventory_items item
  where item.organization_id = current_organization_id
    and item.location_id is not distinct from production_location_id
    and (
      item.recipe_id = selected_recipe.id
      or public.normalize_master_data_key(item.sku)
          = public.normalize_master_data_key(manufactured_sku)
    )
  order by
    case when item.is_active = true then 0 else 1 end,
    case when public.normalize_master_data_key(item.sku)
        = public.normalize_master_data_key(manufactured_sku) then 0 else 1 end,
    case when item.recipe_id = selected_recipe.id then 0 else 1 end,
    case when item.cost_type::text = 'manufactured' then 0 else 1 end,
    case when item.item_type::text = manufactured_item_type_value then 0 else 1 end,
    item.created_at asc
  limit 1;

  if manufactured_item_id is not null then
    execute format(
      'update public.inventory_items
          set recipe_id = $1,
              name = coalesce(nullif(trim(name), ''''), $2),
              sku = coalesce(nullif(trim(sku), ''''), $3),
              item_type = $4::%1$s,
              cost_type = $5::%2$s,
              on_hand_uom = coalesce(on_hand_uom, $6, ''unit''),
              current_cost_per_base_uom = coalesce(current_cost_per_base_uom, $7, 0),
              origin_inventory_item_id = coalesce(origin_inventory_item_id, id),
              is_active = true
        where id = $8',
      inventory_item_type_name,
      inventory_cost_type_name
    )
    using
      selected_recipe.id,
      selected_recipe.name,
      manufactured_sku,
      manufactured_item_type_value,
      'manufactured',
      selected_recipe.output_uom,
      selected_recipe.resolved_unit_cost,
      manufactured_item_id;
  end if;

  if manufactured_item_id is null then
    execute format(
      'insert into public.inventory_items (
         tenant_id,
         organization_id,
         location_id,
         recipe_id,
         name,
         sku,
         item_type,
         cost_type,
         on_hand_uom,
         on_hand_qty,
         current_cost_per_base_uom,
         is_active
       ) values (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7::%1$s,
         $8::%2$s,
         $9,
         0,
         $10,
         true
       )
       returning id',
      inventory_item_type_name,
      inventory_cost_type_name
    )
    into manufactured_item_id
    using
      coalesce(selected_recipe.tenant_id, current_organization_id),
      current_organization_id,
      production_location_id,
      selected_recipe.id,
      selected_recipe.name,
      manufactured_sku,
      manufactured_item_type_value,
      'manufactured',
      coalesce(selected_recipe.output_uom, 'unit'),
      coalesce(selected_recipe.resolved_unit_cost, 0);

    origin_item_id := manufactured_item_id;
  end if;

  insert into public.production_runs (
    organization_id,
    sub_recipe_id,
    target_output_qty,
    actual_output_qty,
    origin,
    status,
    created_by
  ) values (
    current_organization_id,
    selected_recipe.id,
    target_output_quantity,
    normalized_actual_output,
    selected_origin,
    'completed',
    current_user_id
  )
  returning * into created_run;

  insert into public.production_run_inputs (
    production_run_id,
    inventory_item_id,
    target_qty_required,
    actual_qty_used,
    unit_cost,
    origin
  )
  select
    created_run.id,
    component.component_inventory_item_id,
    (component.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
      * target_output_quantity,
    coalesce(
      actual_usage.actual_qty_used,
      (component.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
        * target_output_quantity
    ),
    coalesce(item.current_cost_per_base_uom, 0),
    selected_origin
  from public.recipe_components component
  join public.inventory_items item
    on item.id = component.component_inventory_item_id
  left join lateral (
    select nullif(usage_item->>'actual_qty_used', '')::numeric as actual_qty_used
    from jsonb_array_elements(coalesce(actual_component_usages, '[]'::jsonb)) usage_item
    where nullif(usage_item->>'component_inventory_item_id', '')::uuid =
      component.component_inventory_item_id
    limit 1
  ) actual_usage on true
  where component.recipe_id = selected_recipe.id
    and component.organization_id = current_organization_id
    and component.component_inventory_item_id is not null;

  insert into public.transformation_events (
    organization_id,
    event_type,
    inventory_item_id,
    location_id,
    quantity,
    unit_cost,
    source_table,
    source_id,
    origin,
    created_by
  )
  select
    current_organization_id,
    'production_input_consumption',
    component.component_inventory_item_id,
    item.location_id,
    -1 * coalesce(
      actual_usage.actual_qty_used,
      (component.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
        * target_output_quantity
    ),
    coalesce(item.current_cost_per_base_uom, 0),
    'production_runs',
    created_run.id,
    selected_origin,
    current_user_id
  from public.recipe_components component
  join public.inventory_items item
    on item.id = component.component_inventory_item_id
  left join lateral (
    select nullif(usage_item->>'actual_qty_used', '')::numeric as actual_qty_used
    from jsonb_array_elements(coalesce(actual_component_usages, '[]'::jsonb)) usage_item
    where nullif(usage_item->>'component_inventory_item_id', '')::uuid =
      component.component_inventory_item_id
    limit 1
  ) actual_usage on true
  where component.recipe_id = selected_recipe.id
    and component.organization_id = current_organization_id
    and component.component_inventory_item_id is not null;

  insert into public.variance_attributions (
    organization_id,
    inventory_item_id,
    variance_type,
    variance_qty,
    unit_cost,
    source_table,
    source_id
  )
  select
    current_organization_id,
    component.component_inventory_item_id,
    'waste_variance',
    coalesce(
      actual_usage.actual_qty_used,
      (component.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
        * target_output_quantity
    )
      - (
        (component.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
        * target_output_quantity
      ),
    coalesce(item.current_cost_per_base_uom, 0),
    'production_runs',
    created_run.id
  from public.recipe_components component
  join public.inventory_items item
    on item.id = component.component_inventory_item_id
  left join lateral (
    select nullif(usage_item->>'actual_qty_used', '')::numeric as actual_qty_used
    from jsonb_array_elements(coalesce(actual_component_usages, '[]'::jsonb)) usage_item
    where nullif(usage_item->>'component_inventory_item_id', '')::uuid =
      component.component_inventory_item_id
    limit 1
  ) actual_usage on true
  where component.recipe_id = selected_recipe.id
    and component.organization_id = current_organization_id
    and component.component_inventory_item_id is not null
    and coalesce(
      actual_usage.actual_qty_used,
      (component.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
        * target_output_quantity
    )
      <> (
        (component.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
        * target_output_quantity
      );

  insert into public.transformation_events (
    organization_id,
    event_type,
    inventory_item_id,
    location_id,
    quantity,
    unit_cost,
    source_table,
    source_id,
    origin,
    created_by
  ) values (
    current_organization_id,
    'production_output_receipt',
    manufactured_item_id,
    production_location_id,
    normalized_actual_output,
    coalesce(selected_recipe.resolved_unit_cost, 0),
    'production_runs',
    created_run.id,
    selected_origin,
    current_user_id
  );

  update public.inventory_items item
     set on_hand_qty = item.on_hand_qty - usage.actual_qty_used
    from (
      select
        component.component_inventory_item_id as inventory_item_id,
        sum(
          coalesce(
            actual_usage.actual_qty_used,
            (component.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
              * target_output_quantity
          )
        ) as actual_qty_used
      from public.recipe_components component
      left join lateral (
        select nullif(usage_item->>'actual_qty_used', '')::numeric as actual_qty_used
        from jsonb_array_elements(coalesce(actual_component_usages, '[]'::jsonb)) usage_item
        where nullif(usage_item->>'component_inventory_item_id', '')::uuid =
          component.component_inventory_item_id
        limit 1
      ) actual_usage on true
      where component.recipe_id = selected_recipe.id
        and component.organization_id = current_organization_id
        and component.component_inventory_item_id is not null
      group by component.component_inventory_item_id
    ) usage
   where item.id = usage.inventory_item_id;

  update public.inventory_items
     set on_hand_qty = coalesce(on_hand_qty, 0) + normalized_actual_output,
         current_cost_per_base_uom = coalesce(selected_recipe.resolved_unit_cost, 0),
         on_hand_uom = coalesce(on_hand_uom, selected_recipe.output_uom, 'unit'),
         origin_inventory_item_id = coalesce(origin_inventory_item_id, origin_item_id),
         is_active = true
   where id = manufactured_item_id;

  update public.inventory_items
     set current_cost_per_base_uom = coalesce(selected_recipe.resolved_unit_cost, 0),
         on_hand_uom = coalesce(on_hand_uom, selected_recipe.output_uom, 'unit'),
         is_active = true
   where organization_id = current_organization_id
     and recipe_id = selected_recipe.id
     and cost_type::text = 'manufactured';

  return created_run;
end;
$$;

grant execute on function public.create_dashboard_production_run(
  uuid,
  numeric,
  numeric,
  text,
  jsonb,
  uuid
) to authenticated;

notify pgrst, 'reload schema';
