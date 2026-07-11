-- Let operations teams own production sub-recipes while keeping final menu
-- pricing and final menu composition under costing/finance control.

create or replace function public.create_recipe_from_dashboard(
  recipe_name text,
  recipe_type_value text default 'sub_recipe',
  recipe_output_uom text default 'kg',
  recipe_standard_batch_output_qty numeric default 1,
  recipe_standard_yield_pct numeric default 1,
  recipe_selling_price numeric default 0
)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  normalized_recipe_type text;
  created_recipe public.recipes;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to create a recipe.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before adding recipes.';
  end if;

  if nullif(trim(recipe_name), '') is null then
    raise exception 'Recipe name is required.';
  end if;

  if recipe_standard_batch_output_qty is null or recipe_standard_batch_output_qty <= 0 then
    raise exception 'Standard batch output must be greater than zero.';
  end if;

  normalized_recipe_type := case
    when recipe_type_value in ('final_menu_item', 'final_dish')
      and exists (
        select 1
        from pg_attribute a
        join pg_type t on t.oid = a.atttypid
        join pg_enum e on e.enumtypid = t.oid
        where a.attrelid = 'public.recipes'::regclass
          and a.attname = 'recipe_type'
          and e.enumlabel = 'final_dish'
      ) then 'final_dish'
    when recipe_type_value in ('final_menu_item', 'final_dish') then 'final_menu_item'
    else 'sub_recipe'
  end;

  if normalized_recipe_type = 'sub_recipe' then
    perform public.require_dashboard_permission(current_organization_id, 'operations');
  else
    perform public.require_dashboard_permission(current_organization_id, 'costing');
  end if;

  execute format(
    'insert into public.recipes (
      tenant_id,
      organization_id,
      name,
      recipe_type,
      output_uom,
      standard_batch_output_qty,
      standard_yield_pct,
      selling_price,
      is_active
    ) values (
      $1,
      $1,
      $2,
      %L,
      $3,
      $4,
      $5,
      $6,
      true
    ) returning *',
    normalized_recipe_type
  )
  into created_recipe
  using
    current_organization_id,
    trim(recipe_name),
    coalesce(nullif(trim(recipe_output_uom), ''), 'kg'),
    recipe_standard_batch_output_qty,
    case
      when recipe_standard_yield_pct is not null and recipe_standard_yield_pct > 0
        then recipe_standard_yield_pct
      else 1
    end,
    case
      when normalized_recipe_type = 'sub_recipe' then 0
      else greatest(coalesce(recipe_selling_price, 0), 0)
    end;

  return created_recipe;
end;
$$;

grant execute on function public.create_recipe_from_dashboard(text, text, text, numeric, numeric, numeric)
  to authenticated;

create or replace function public.add_recipe_inventory_component(
  target_recipe_id uuid,
  target_inventory_item_id uuid,
  component_quantity numeric
)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  selected_recipe public.recipes;
  component_uom text;
  recalculated_cost numeric(18, 6);
  updated_recipe public.recipes;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to update a recipe.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before adding recipe components.';
  end if;

  if component_quantity is null or component_quantity <= 0 then
    raise exception 'Component quantity must be greater than zero.';
  end if;

  select *
    into selected_recipe
  from public.recipes r
  where r.id = target_recipe_id
    and r.organization_id = current_organization_id;

  if selected_recipe.id is null then
    raise exception 'Recipe not found for this workspace.';
  end if;

  if selected_recipe.recipe_type::text = 'sub_recipe' then
    perform public.require_dashboard_permission(current_organization_id, 'operations');
  else
    perform public.require_dashboard_permission(current_organization_id, 'costing');
  end if;

  select coalesce(ii.recipe_uom, ii.base_uom, ii.on_hand_uom, 'unit')
    into component_uom
  from public.inventory_items ii
  where ii.id = target_inventory_item_id
    and ii.organization_id = current_organization_id;

  if component_uom is null then
    raise exception 'Ingredient not found for this workspace.';
  end if;

  insert into public.recipe_components (
    organization_id,
    recipe_id,
    component_inventory_item_id,
    qty_in_recipe_uom,
    recipe_uom
  ) values (
    current_organization_id,
    target_recipe_id,
    target_inventory_item_id,
    component_quantity,
    component_uom
  );

  select coalesce(
      sum(rc.qty_in_recipe_uom * ii.current_cost_per_base_uom)
      / nullif(r.standard_batch_output_qty, 0),
      0
    )
    into recalculated_cost
  from public.recipe_components rc
  join public.inventory_items ii on ii.id = rc.component_inventory_item_id
  join public.recipes r on r.id = rc.recipe_id
  where rc.recipe_id = target_recipe_id
    and rc.organization_id = current_organization_id
  group by r.standard_batch_output_qty;

  perform set_config('profitplate.allow_cost_update', 'on', true);

  update public.recipes
     set resolved_unit_cost = recalculated_cost
   where id = target_recipe_id
     and organization_id = current_organization_id
   returning * into updated_recipe;

  insert into public.cost_recalculation_events (
    organization_id,
    recipe_id,
    old_cost,
    new_cost,
    reason
  ) values (
    current_organization_id,
    target_recipe_id,
    coalesce(selected_recipe.resolved_unit_cost, 0),
    recalculated_cost,
    'dashboard_recipe_component_update'
  );

  return updated_recipe;
end;
$$;

grant execute on function public.add_recipe_inventory_component(uuid, uuid, numeric)
  to authenticated;

create or replace function public.add_recipe_inventory_components(
  target_recipe_id text,
  component_lines jsonb
)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_profile_organization_id uuid;
  resolved_organization_id uuid;
  component_line jsonb;
  normalized_recipe_id uuid;
  target_inventory_item_id uuid;
  component_uom text;
  component_quantity numeric;
  old_recipe_cost numeric(18, 6);
  recalculated_cost numeric(18, 6);
  selected_recipe_type text;
  updated_recipe public.recipes;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to update a recipe.';
  end if;

  select p.organization_id
    into current_profile_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_profile_organization_id is null then
    raise exception 'Create a workspace before adding recipe components.';
  end if;

  if component_lines is null or jsonb_typeof(component_lines) <> 'array' then
    raise exception 'Ingredient lines must be an array.';
  end if;

  if jsonb_array_length(component_lines) = 0 then
    raise exception 'Add at least one ingredient line.';
  end if;

  normalized_recipe_id := substring(
    target_recipe_id
    from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
  )::uuid;

  select r.id, r.organization_id, r.resolved_unit_cost, r.recipe_type::text
    into normalized_recipe_id, resolved_organization_id, old_recipe_cost, selected_recipe_type
  from public.recipes r
  where r.id = normalized_recipe_id
    and public.user_can_access_organization(r.organization_id);

  if normalized_recipe_id is null then
    select r.id, r.organization_id, r.resolved_unit_cost, r.recipe_type::text
      into normalized_recipe_id, resolved_organization_id, old_recipe_cost, selected_recipe_type
    from public.inventory_items ii
    join public.recipes r on r.id = ii.recipe_id
    where ii.id = substring(
        target_recipe_id
        from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
      )::uuid
      and public.user_can_access_organization(r.organization_id)
    limit 1;
  end if;

  if normalized_recipe_id is null or resolved_organization_id is null then
    raise exception 'Recipe not found for this workspace.';
  end if;

  if selected_recipe_type = 'sub_recipe' then
    perform public.require_dashboard_permission(resolved_organization_id, 'operations');
  else
    perform public.require_dashboard_permission(resolved_organization_id, 'costing');
  end if;

  for component_line in
    select value from jsonb_array_elements(component_lines)
  loop
    target_inventory_item_id := substring(
      component_line->>'inventory_item_id'
      from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
    )::uuid;
    component_quantity := nullif(component_line->>'quantity', '')::numeric;

    if target_inventory_item_id is null
       or component_quantity is null
       or component_quantity <= 0 then
      raise exception 'Each ingredient line needs an ingredient and quantity greater than zero.';
    end if;

    select coalesce(ii.recipe_uom, ii.base_uom, ii.on_hand_uom, 'unit')
      into component_uom
    from public.inventory_items ii
    where ii.id = target_inventory_item_id
      and ii.organization_id = resolved_organization_id;

    if component_uom is null then
      raise exception 'Ingredient not found for this workspace.';
    end if;

    insert into public.recipe_components (
      organization_id,
      recipe_id,
      component_inventory_item_id,
      qty_in_recipe_uom,
      recipe_uom
    ) values (
      resolved_organization_id,
      normalized_recipe_id,
      target_inventory_item_id,
      component_quantity,
      component_uom
    );
  end loop;

  select coalesce(
      sum(rc.qty_in_recipe_uom * ii.current_cost_per_base_uom)
      / nullif(r.standard_batch_output_qty, 0),
      0
    )
    into recalculated_cost
  from public.recipe_components rc
  join public.inventory_items ii on ii.id = rc.component_inventory_item_id
  join public.recipes r on r.id = rc.recipe_id
  where rc.recipe_id = normalized_recipe_id
    and rc.organization_id = resolved_organization_id
  group by r.standard_batch_output_qty;

  perform set_config('profitplate.allow_cost_update', 'on', true);

  update public.recipes
     set resolved_unit_cost = coalesce(recalculated_cost, 0)
   where id = normalized_recipe_id
     and organization_id = resolved_organization_id
   returning * into updated_recipe;

  insert into public.cost_recalculation_events (
    organization_id,
    recipe_id,
    old_cost,
    new_cost,
    reason
  ) values (
    resolved_organization_id,
    normalized_recipe_id,
    coalesce(old_recipe_cost, 0),
    coalesce(recalculated_cost, 0),
    'dashboard_recipe_component_bulk_update'
  );

  return updated_recipe;
end;
$$;

grant execute on function public.add_recipe_inventory_components(text, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
