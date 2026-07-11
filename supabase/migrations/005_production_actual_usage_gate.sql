-- Require explicit actual raw material usage for production variance.

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_dashboard_production_run'
      and pg_get_function_identity_arguments(p.oid) =
        'target_recipe_id uuid, target_output_quantity numeric, actual_output_quantity numeric, production_origin text, actual_component_usages jsonb'
  ) and not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_dashboard_production_run_unchecked'
  ) then
    alter function public.create_dashboard_production_run(uuid, numeric, numeric, text, jsonb)
      rename to create_dashboard_production_run_unchecked;
  end if;
end $$;

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
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to record production.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before recording production.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  if target_output_quantity is null or target_output_quantity <= 0 then
    raise exception 'Actual output quantity must be greater than zero.';
  end if;

  select *
    into selected_recipe
  from public.recipes
  where id = target_recipe_id
    and organization_id = current_organization_id
    and is_active = true;

  if selected_recipe.id is null then
    raise exception 'Recipe not found for this workspace.';
  end if;

  if actual_component_usages is null
     or jsonb_typeof(actual_component_usages) <> 'array'
     or exists (
       select 1
       from public.recipe_components rc
       where rc.recipe_id = selected_recipe.id
         and rc.organization_id = current_organization_id
         and rc.component_inventory_item_id is not null
         and not exists (
           select 1
           from jsonb_array_elements(actual_component_usages) usage_item
           where nullif(usage_item->>'component_inventory_item_id', '')::uuid =
             rc.component_inventory_item_id
             and nullif(usage_item->>'actual_qty_used', '')::numeric >= 0
         )
     ) then
    raise exception 'Enter actual raw material quantity used for every production ingredient.';
  end if;

  return public.create_dashboard_production_run_unchecked(
    target_recipe_id,
    target_output_quantity,
    actual_output_quantity,
    production_origin,
    actual_component_usages
  );
end;
$$;

grant execute on function public.create_dashboard_production_run(uuid, numeric, numeric, text, jsonb) to authenticated;
revoke execute on function public.create_dashboard_production_run_unchecked(uuid, numeric, numeric, text, jsonb) from public;
revoke execute on function public.create_dashboard_production_run_unchecked(uuid, numeric, numeric, text, jsonb) from authenticated;

notify pgrst, 'reload schema';
