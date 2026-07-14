-- Production output should reuse the manufactured SKU already tied to a
-- recipe. Some live workspaces have generated SUB-/FG- SKUs without the
-- recipe_id link, so production tries to create the same SKU again and the
-- duplicate master-data guardrail correctly blocks it. Repair those links.

update public.inventory_items item
   set recipe_id = recipe.id,
       name = coalesce(nullif(trim(item.name), ''), recipe.name),
       item_type = case
         when recipe.recipe_type::text in ('final_menu_item', 'final_dish')
           then 'final_product'::public.inventory_item_type
         else 'semi_finished'::public.inventory_item_type
       end,
       cost_type = 'manufactured'::public.inventory_cost_type,
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
         );

notify pgrst, 'reload schema';
