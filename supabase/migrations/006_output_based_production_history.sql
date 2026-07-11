-- Report production variance as expected output from actual material usage.

drop function if exists public.get_dashboard_production_history();

create function public.get_dashboard_production_history()
returns table (
  production_run_id uuid,
  created_at timestamptz,
  recipe_name text,
  target_output_qty numeric,
  actual_output_qty numeric,
  output_uom text,
  ingredient_name text,
  target_qty_required numeric,
  actual_qty_used numeric,
  waste_variance_qty numeric,
  expected_output_from_actual_qty numeric,
  output_variance_qty numeric,
  unit_cost numeric,
  naira_loss numeric,
  origin text
)
language sql
security definer
set search_path = public
as $$
  select
    pr.id as production_run_id,
    pr.created_at,
    r.name as recipe_name,
    pr.target_output_qty,
    pr.actual_output_qty,
    r.output_uom,
    coalesce(ii.name, 'Ingredient') as ingredient_name,
    pri.target_qty_required,
    pri.actual_qty_used,
    pri.waste_variance_qty,
    case
      when coalesce(rc.qty_in_recipe_uom, 0) > 0
       and coalesce(r.standard_batch_output_qty, 0) > 0
      then pri.actual_qty_used / (rc.qty_in_recipe_uom / r.standard_batch_output_qty)
      else coalesce(pr.actual_output_qty, pr.target_output_qty)
    end as expected_output_from_actual_qty,
    (
      case
        when coalesce(rc.qty_in_recipe_uom, 0) > 0
         and coalesce(r.standard_batch_output_qty, 0) > 0
        then pri.actual_qty_used / (rc.qty_in_recipe_uom / r.standard_batch_output_qty)
        else coalesce(pr.actual_output_qty, pr.target_output_qty)
      end
    ) - coalesce(pr.actual_output_qty, pr.target_output_qty) as output_variance_qty,
    pri.unit_cost,
    pri.naira_loss,
    pri.origin::text as origin
  from public.production_runs pr
  join public.recipes r
    on r.id = pr.sub_recipe_id
  join public.production_run_inputs pri
    on pri.production_run_id = pr.id
  left join public.inventory_items ii
    on ii.id = pri.inventory_item_id
  left join public.recipe_components rc
    on rc.recipe_id = pr.sub_recipe_id
   and rc.component_inventory_item_id = pri.inventory_item_id
  join public.profiles p
    on p.organization_id = pr.organization_id
  where p.id = auth.uid()
  order by pr.created_at desc;
$$;

grant execute on function public.get_dashboard_production_history() to authenticated;

notify pgrst, 'reload schema';
