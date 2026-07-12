-- Support hybrid sales depletion models per sale row:
-- 1. QSR / fast-food rows: if the sold recipe has a manufactured final_product
--    SKU in the selling sales_outlet, deplete that finished item 1-to-1.
-- 2. Standard rows: otherwise keep the existing recipe component explosion.
--
-- This prevents double depletion for QSR flows where production already
-- consumed raw materials and stocked finished goods at the counter.

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
  selling_location public.locations;
  finished_sale_item public.inventory_items;
  component_line record;
  resolved_item public.inventory_items;
  required_quantity numeric(18, 6);
  depleted_line_count integer := 0;
  has_legacy_item_id boolean;
begin
  if target_organization_id is null then
    raise exception 'A workspace is required before depleting sales stock.';
  end if;

  if sale_source_id is null then
    raise exception 'A menu sale source is required before depleting sales stock.';
  end if;

  if target_recipe_id is null then
    raise exception 'A menu item is required before depleting sales stock.';
  end if;

  if sold_quantity is null or sold_quantity <= 0 then
    raise exception 'Sold quantity must be greater than zero.';
  end if;

  select *
    into selected_recipe
  from public.recipes recipe
  where recipe.id = target_recipe_id
    and recipe.organization_id = target_organization_id
    and recipe.is_active;

  if selected_recipe.id is null then
    raise exception 'Menu item not found for this workspace.';
  end if;

  if selling_location_id_value is not null then
    select *
      into selling_location
    from public.locations location
    where location.id = selling_location_id_value
      and location.organization_id = target_organization_id
      and location.is_active;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transformation_events'
      and column_name = 'item_id'
  )
    into has_legacy_item_id;

  -- Branch A: QSR / Fast-food finished-goods depletion.
  -- This branch is evaluated for every sale row because the function is called
  -- once per imported/posted sale line. It only triggers when the sold recipe is
  -- represented by an active final_product SKU in the exact sales outlet that
  -- received the POS sale.
  if selling_location.id is not null
     and selling_location.location_type = 'sales_outlet'::public.location_type
  then
    select *
      into finished_sale_item
    from public.inventory_items item
    where item.organization_id = target_organization_id
      and item.location_id = selling_location.id
      and item.recipe_id = selected_recipe.id
      and item.item_type = 'final_product'::public.inventory_item_type
      and item.cost_type = 'manufactured'::public.inventory_cost_type
      and item.is_active
    order by
      item.updated_at desc,
      item.created_at desc
    limit 1;

    if finished_sale_item.id is not null then
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
          finished_sale_item.id,
          finished_sale_item.location_id,
          -1 * sold_quantity,
          coalesce(finished_sale_item.current_cost_per_base_uom, 0),
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
          finished_sale_item.id,
          finished_sale_item.location_id,
          -1 * sold_quantity,
          coalesce(finished_sale_item.current_cost_per_base_uom, 0),
          'menu_sales',
          sale_source_id,
          current_user_id
        );
      end if;

      update public.inventory_items
         set on_hand_qty = on_hand_qty - sold_quantity
       where id = finished_sale_item.id
         and organization_id = target_organization_id;

      -- Critical: return immediately so finished-goods sales do not also
      -- explode and deplete recipe ingredients.
      return 1;
    end if;
  end if;

  -- Branch B: Standard model recipe explosion. This preserves the existing
  -- behavior for dining/plated models and for any sale row without a matching
  -- finished final_product SKU in a sales_outlet.
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
    raise exception 'Attach at least one component before recording sales, or stock a linked final product in the sales outlet.';
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

notify pgrst, 'reload schema';
