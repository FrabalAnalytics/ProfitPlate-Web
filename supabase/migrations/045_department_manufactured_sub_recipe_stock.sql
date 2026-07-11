-- Sub-recipes are ingredients after production. Production output must land in
-- the producing department balance, while a store row remains as the canonical
-- origin for traceability and possible transfer-back flows.

create or replace function public.resolve_dashboard_sub_recipe_production_location(
  target_organization_id uuid,
  recipe_name_value text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_location_id uuid;
  item_text text := lower(coalesce(recipe_name_value, ''));
begin
  select location.id
    into resolved_location_id
  from public.locations location
  where location.organization_id = target_organization_id
    and location.is_active = true
    and lower(location.name) !~ '(store|warehouse|main|central)'
    and (
      location.location_type::text in (
        'department',
        'bar',
        'local_kitchen',
        'kitchen_line',
        'production_kitchen',
        'sales_outlet'
      )
      or lower(location.name) ~ '(kitchen|kicthen|kitchn|bar)'
    )
    and (
      (
        item_text ~ '(drink|bar|beverage|cocktail|juice)'
        and (
          location.inventory_domain = 'beverage'
          or lower(location.name) ~ '(bar|drink|beverage)'
        )
      )
      or (
        item_text !~ '(drink|bar|beverage|cocktail|juice)'
        and (
          location.inventory_domain in ('food', 'shared')
          or lower(location.name) ~ '(kitchen|kicthen|kitchn)'
        )
      )
    )
  order by
    case
      when item_text ~ '(drink|bar|beverage|cocktail|juice)'
           and lower(location.name) ~ '(bar|drink|beverage)' then 0
      when item_text !~ '(drink|bar|beverage|cocktail|juice)'
           and lower(location.name) ~ '(kitchen|kicthen|kitchn)' then 0
      when location.location_type::text = 'department' then 1
      else 2
    end,
    location.created_at asc
  limit 1;

  if resolved_location_id is null then
    select location.id
      into resolved_location_id
    from public.locations location
    where location.organization_id = target_organization_id
      and location.is_active = true
      and lower(location.name) !~ '(store|warehouse|main|central)'
      and (
        location.location_type::text in (
          'department',
          'bar',
          'local_kitchen',
          'kitchen_line',
          'production_kitchen',
          'sales_outlet'
        )
        or lower(location.name) ~ '(kitchen|kicthen|kitchn|bar)'
      )
    order by
      case
        when lower(location.name) ~ '(kitchen|kicthen|kitchn)' then 0
        when lower(location.name) ~ '(bar|drink|beverage)' then 1
        else 2
      end,
      location.created_at asc
    limit 1;
  end if;

  return resolved_location_id;
end;
$$;

grant execute on function public.resolve_dashboard_sub_recipe_production_location(uuid, text)
  to authenticated;

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
  if new.recipe_type::text = 'sub_recipe' then
    item_text := lower(concat_ws(' ', new.name, 'SUB-' || left(new.id::text, 8)));
    production_location_id :=
      public.resolve_dashboard_sub_recipe_production_location(
        new.organization_id,
        new.name
      );

    select location.id
      into main_store_location_id
    from public.locations location
    where location.organization_id = new.organization_id
      and location.is_active = true
      and location.location_type::text in (
        'main_store',
        'central_warehouse',
        'branch_store'
      )
      and (
        (
          item_text ~ '(drink|bar|beverage|cocktail|juice)'
          and (
            location.inventory_domain = 'beverage'
            or lower(location.name) like '%drink%'
            or lower(location.name) like '%bar%'
          )
        )
        or (
          item_text !~ '(drink|bar|beverage|cocktail|juice)'
          and (
            location.inventory_domain in ('food', 'shared')
            or lower(location.name) like '%food%'
          )
        )
      )
    order by
      case
        when item_text ~ '(drink|bar|beverage|cocktail|juice)'
             and location.inventory_domain = 'beverage' then 0
        when item_text !~ '(drink|bar|beverage|cocktail|juice)'
             and location.inventory_domain = 'food' then 0
        when location.location_type::text = 'main_store' then 1
        else 2
      end,
      location.created_at asc
    limit 1;

    if main_store_location_id is null then
      select location.id
        into main_store_location_id
      from public.locations location
      where location.organization_id = new.organization_id
        and location.is_active = true
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

    if main_store_location_id is not null then
      select item.id
        into origin_item_id
      from public.inventory_items item
      where item.organization_id = new.organization_id
        and item.recipe_id = new.id
        and item.cost_type::text = 'manufactured'
        and item.location_id = main_store_location_id
      order by item.created_at asc
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
          on_hand_qty,
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
          coalesce(new.output_uom, 'unit'),
          0,
          coalesce(new.resolved_unit_cost, 0),
          new.is_active
        )
        returning id into origin_item_id;
      end if;

      update public.inventory_items
         set name = new.name,
             tenant_id = coalesce(tenant_id, new.tenant_id, new.organization_id),
             current_cost_per_base_uom = coalesce(new.resolved_unit_cost, 0),
             on_hand_uom = coalesce(on_hand_uom, new.output_uom, 'unit'),
             origin_inventory_item_id = origin_item_id,
             is_active = new.is_active
       where id = origin_item_id;
    end if;

    if production_location_id is not null then
      select item.id
        into kitchen_item_id
      from public.inventory_items item
      where item.organization_id = new.organization_id
        and item.recipe_id = new.id
        and item.cost_type::text = 'manufactured'
        and item.location_id = production_location_id
      order by item.created_at asc
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
          on_hand_qty,
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
          coalesce(new.output_uom, 'unit'),
          0,
          coalesce(new.resolved_unit_cost, 0),
          origin_item_id,
          new.is_active
        )
        returning id into kitchen_item_id;
      end if;

      update public.inventory_items
         set name = new.name,
             tenant_id = coalesce(tenant_id, new.tenant_id, new.organization_id),
             location_id = production_location_id,
             current_cost_per_base_uom = coalesce(new.resolved_unit_cost, 0),
             on_hand_uom = coalesce(on_hand_uom, new.output_uom, 'unit'),
             origin_inventory_item_id = coalesce(origin_item_id, origin_inventory_item_id),
             is_active = new.is_active
       where id = kitchen_item_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_sub_recipe_inventory_item on public.recipes;
create trigger sync_sub_recipe_inventory_item
after insert or update of recipe_type, name, resolved_unit_cost, output_uom, is_active
on public.recipes
for each row execute function public.sync_sub_recipe_inventory_item();

create or replace function public.repair_dashboard_manufactured_sub_recipe_department_stock(
  target_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  recipe_row public.recipes;
  production_location_id uuid;
  origin_item_id uuid;
  department_item_id uuid;
  source_item record;
  moved_count integer := 0;
begin
  update public.recipes recipe
     set name = recipe.name
   where recipe.recipe_type::text = 'sub_recipe'
     and recipe.is_active
     and (target_organization_id is null or recipe.organization_id = target_organization_id);

  for recipe_row in
    select *
    from public.recipes recipe
    where recipe.recipe_type::text = 'sub_recipe'
      and recipe.is_active
      and (target_organization_id is null or recipe.organization_id = target_organization_id)
  loop
    production_location_id :=
      public.resolve_dashboard_sub_recipe_production_location(
        recipe_row.organization_id,
        recipe_row.name
      );

    if production_location_id is null then
      continue;
    end if;

    select item.id
      into department_item_id
    from public.inventory_items item
    where item.organization_id = recipe_row.organization_id
      and item.recipe_id = recipe_row.id
      and item.cost_type::text = 'manufactured'
      and item.location_id = production_location_id
    order by item.created_at asc
    limit 1;

    if department_item_id is null then
      continue;
    end if;

    select coalesce(item.origin_inventory_item_id, item.id)
      into origin_item_id
    from public.inventory_items item
    where item.id = department_item_id;

    for source_item in
      select item.*
      from public.inventory_items item
      where item.organization_id = recipe_row.organization_id
        and item.recipe_id = recipe_row.id
        and item.cost_type::text = 'manufactured'
        and item.id <> department_item_id
        and coalesce(item.on_hand_qty, 0) > 0
        and exists (
          select 1
          from public.transformation_events event
          where event.inventory_item_id = item.id
            and event.organization_id = item.organization_id
            and event.event_type::text = 'production_output_receipt'
        )
    loop
      update public.inventory_items
         set on_hand_qty = coalesce(on_hand_qty, 0) + coalesce(source_item.on_hand_qty, 0),
             current_cost_per_base_uom = coalesce(
               recipe_row.resolved_unit_cost,
               source_item.current_cost_per_base_uom,
               current_cost_per_base_uom,
               0
             ),
             on_hand_uom = coalesce(on_hand_uom, source_item.on_hand_uom, recipe_row.output_uom, 'unit'),
             origin_inventory_item_id = coalesce(origin_inventory_item_id, origin_item_id),
             is_active = true
       where id = department_item_id;

      update public.inventory_items
         set on_hand_qty = 0,
             origin_inventory_item_id = coalesce(origin_inventory_item_id, origin_item_id),
             is_active = true
       where id = source_item.id;

      -- transformation_events is append-only. Preserve the original production
      -- receipt event, then append a balanced production-output correction so
      -- movement history remains truthful without rewriting history. Some older
      -- databases still use transformation_event_type_enum without a generic
      -- stock_count_adjustment value, so keep this on an existing event type.
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
        source_item.organization_id,
        'production_output_receipt',
        source_item.id,
        source_item.location_id,
        -1 * coalesce(source_item.on_hand_qty, 0),
        coalesce(source_item.current_cost_per_base_uom, 0),
        'inventory_items',
        source_item.id,
        'kitchen_prep_line',
        auth.uid()
      ), (
        source_item.organization_id,
        'production_output_receipt',
        department_item_id,
        production_location_id,
        coalesce(source_item.on_hand_qty, 0),
        coalesce(source_item.current_cost_per_base_uom, 0),
        'inventory_items',
        source_item.id,
        'kitchen_prep_line',
        auth.uid()
      );

      moved_count := moved_count + 1;
    end loop;
  end loop;

  return moved_count;
end;
$$;

grant execute on function public.repair_dashboard_manufactured_sub_recipe_department_stock(uuid)
  to authenticated;

create or replace function public.create_dashboard_production_run(
  target_recipe_id uuid,
  target_output_quantity numeric,
  actual_output_quantity numeric default null,
  production_origin text default 'kitchen_prep_line',
  actual_component_usages jsonb default '[]'::jsonb
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
  production_location_id uuid;
  origin_item_id uuid;
  created_run public.production_runs;
  component_count integer;
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

  if selected_recipe.recipe_type::text <> 'sub_recipe' then
    raise exception 'Only sub-recipes can be produced into manufactured inventory from this dashboard.';
  end if;

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

  update public.recipes
     set name = name
   where id = selected_recipe.id
     and organization_id = current_organization_id;

  production_location_id :=
    public.resolve_dashboard_sub_recipe_production_location(
      current_organization_id,
      selected_recipe.name
    );

  if production_location_id is null then
    raise exception 'Create or activate a Kitchen/Bar department location before recording production.';
  end if;

  select item.id, coalesce(item.origin_inventory_item_id, item.id)
    into manufactured_item_id, origin_item_id
  from public.inventory_items item
  where item.organization_id = current_organization_id
    and item.recipe_id = selected_recipe.id
    and item.cost_type::text = 'manufactured'
    and item.location_id = production_location_id
    and item.is_active = true
  order by item.created_at asc
  limit 1;

  if manufactured_item_id is null then
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
      on_hand_qty,
      current_cost_per_base_uom,
      is_active
    ) values (
      coalesce(selected_recipe.tenant_id, current_organization_id),
      current_organization_id,
      production_location_id,
      selected_recipe.id,
      selected_recipe.name,
      'SUB-' || left(selected_recipe.id::text, 8),
      'semi_finished',
      'manufactured',
      coalesce(selected_recipe.output_uom, 'unit'),
      0,
      coalesce(selected_recipe.resolved_unit_cost, 0),
      true
    )
    returning id into manufactured_item_id;
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

grant execute on function public.create_dashboard_production_run(uuid, numeric, numeric, text, jsonb)
  to authenticated;

select public.repair_dashboard_manufactured_sub_recipe_department_stock(null::uuid);

notify pgrst, 'reload schema';
