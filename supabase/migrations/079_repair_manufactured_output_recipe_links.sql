-- Production output should reuse the manufactured SKU already tied to a
-- recipe. Some live workspaces have generated SUB-/FG- SKUs without the
-- recipe_id link, so production tries to create the same SKU again and the
-- duplicate master-data guardrail correctly blocks it. Repair those links.

do $$
declare
  inventory_item_type_name text;
  inventory_cost_type_name text;
begin
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

  execute format(
    $repair$
      update public.inventory_items item
         set recipe_id = recipe.id,
             name = coalesce(nullif(trim(item.name), ''), recipe.name),
             item_type = case
               when recipe.recipe_type::text in ('final_menu_item', 'final_dish')
                 then 'final_product'::%1$s
               else 'semi_finished'::%1$s
             end,
             cost_type = 'manufactured'::%2$s,
             on_hand_uom = coalesce(item.on_hand_uom, recipe.output_uom, 'unit'),
             current_cost_per_base_uom = coalesce(
               item.current_cost_per_base_uom,
               recipe.resolved_unit_cost,
               0
             )
        from public.recipes recipe
       where item.organization_id = recipe.organization_id
         and item.is_active = true
         and recipe.is_active = true
         and recipe.recipe_type::text in ('sub_recipe', 'final_menu_item', 'final_dish')
         and item.cost_type::text = 'manufactured'
         and item.recipe_id is distinct from recipe.id
         and public.normalize_master_data_key(item.sku)
             = public.normalize_master_data_key(
                 case
                   when recipe.recipe_type::text in ('final_menu_item', 'final_dish')
                     then 'FG-' || left(recipe.id::text, 8)
                   else 'SUB-' || left(recipe.id::text, 8)
                 end
               )
    $repair$,
    inventory_item_type_name,
    inventory_cost_type_name
  );
end $$;

notify pgrst, 'reload schema';
