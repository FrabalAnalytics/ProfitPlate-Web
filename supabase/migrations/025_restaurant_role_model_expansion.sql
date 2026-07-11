-- Expand main restaurant roles before introducing finer sub-role permissions.

alter table if exists public.profiles
  drop constraint if exists profiles_role_allowed;

alter table if exists public.profiles
  add constraint profiles_role_allowed check (
    role in (
      'owner',
      'admin',
      'manager',
      'general_manager',
      'operations_manager',
      'procurement_manager',
      'finance_manager',
      'cost_controller',
      'inventory_manager',
      'storekeeper',
      'kitchen_manager',
      'production_supervisor',
      'chef',
      'quality_assurance',
      'bar_manager',
      'bartender',
      'pos_supervisor',
      'auditor',
      'viewer'
    )
  );

create or replace function public.user_can_manage_costing(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.user_can_access_organization(target_organization_id)
    and public.user_has_any_role(
      array[
        'owner',
        'admin',
        'manager',
        'general_manager',
        'finance_manager',
        'cost_controller',
        'procurement_manager'
      ]
    );
$$;

create or replace function public.user_can_record_operations(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.user_can_access_organization(target_organization_id)
    and public.user_has_any_role(
      array[
        'owner',
        'admin',
        'manager',
        'general_manager',
        'operations_manager',
        'procurement_manager',
        'inventory_manager',
        'storekeeper',
        'kitchen_manager',
        'production_supervisor',
        'chef',
        'quality_assurance',
        'bar_manager',
        'bartender',
        'pos_supervisor'
      ]
    );
$$;

create or replace function public.user_can_approve_operations(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.user_can_access_organization(target_organization_id)
    and public.user_has_any_role(
      array[
        'owner',
        'admin',
        'manager',
        'general_manager',
        'operations_manager',
        'procurement_manager',
        'finance_manager',
        'cost_controller',
        'inventory_manager',
        'storekeeper',
        'kitchen_manager',
        'quality_assurance',
        'bar_manager',
        'auditor'
      ]
    );
$$;

create or replace function public.receive_dashboard_purchase_order(
  target_purchase_order_id uuid
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  profile_role text;
  normalized_role text;
  selected_order public.purchase_orders;
  purchase_line public.purchase_order_lines;
  selected_item public.inventory_items;
  affected_recipe record;
  next_on_hand_qty numeric(18, 6);
  next_unit_cost numeric(18, 6);
  recalculated_recipe_cost numeric(18, 6);
  updated_order public.purchase_orders;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to receive a purchase order.';
  end if;

  select p.organization_id, p.role::text
    into current_organization_id, profile_role
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before receiving purchase orders.';
  end if;

  normalized_role := lower(
    replace(
      replace(
        trim(coalesce(profile_role, 'viewer')),
        ' ',
        '_'
      ),
      '-',
      '_'
    )
  );

  if normalized_role = 'inventory_clerk' then
    normalized_role := 'storekeeper';
  end if;

  if normalized_role not in (
    'owner',
    'admin',
    'manager',
    'general_manager',
    'operations_manager',
    'inventory_manager',
    'storekeeper'
  ) then
    raise exception 'Only inventory managers, storekeepers, and operations leaders can confirm purchase receipt. Current role: %', coalesce(profile_role, 'none');
  end if;

  select *
    into selected_order
  from public.purchase_orders
  where id = target_purchase_order_id
    and organization_id = current_organization_id
  for update;

  if selected_order.id is null then
    raise exception 'Purchase order not found for this workspace.';
  end if;

  if selected_order.status = 'completed' then
    raise exception 'This purchase order has already been received.';
  end if;

  if selected_order.status not in ('draft', 'pending', 'accepted') then
    raise exception 'Only open purchase orders can be received.';
  end if;

  if not exists (
    select 1
    from public.purchase_order_lines pol
    where pol.purchase_order_id = selected_order.id
  ) then
    raise exception 'Purchase order has no lines to receive.';
  end if;

  for purchase_line in
    select *
    from public.purchase_order_lines pol
    where pol.purchase_order_id = selected_order.id
    order by pol.created_at asc, pol.id asc
  loop
    select *
      into selected_item
    from public.inventory_items
    where id = purchase_line.inventory_item_id
      and organization_id = current_organization_id
      and is_active = true
    for update;

    if selected_item.id is null then
      raise exception 'A purchase order item no longer exists in this workspace.';
    end if;

    next_on_hand_qty := coalesce(selected_item.on_hand_qty, 0) + purchase_line.qty;

    next_unit_cost := case
      when coalesce(selected_item.on_hand_qty, 0) > 0 and next_on_hand_qty > 0 then
        (
          (coalesce(selected_item.on_hand_qty, 0) * coalesce(selected_item.current_cost_per_base_uom, 0))
          + (purchase_line.qty * purchase_line.landed_unit_cost)
        ) / next_on_hand_qty
      else purchase_line.landed_unit_cost
    end;

    update public.inventory_items
       set on_hand_qty = next_on_hand_qty,
           current_cost_per_base_uom = next_unit_cost,
           on_hand_uom = coalesce(on_hand_uom, base_uom, recipe_uom, 'unit')
     where id = selected_item.id
       and organization_id = current_organization_id;

    for affected_recipe in
      select distinct r.id, r.resolved_unit_cost
      from public.recipes r
      join public.recipe_components rc on rc.recipe_id = r.id
      where r.organization_id = current_organization_id
        and r.is_active = true
        and rc.component_inventory_item_id = selected_item.id
    loop
      select coalesce(
          sum(
            rc.qty_in_recipe_uom *
            coalesce(ii.current_cost_per_base_uom, cr.resolved_unit_cost, 0)
          ) / nullif(r.standard_batch_output_qty, 0),
          0
        )
        into recalculated_recipe_cost
      from public.recipe_components rc
      join public.recipes r on r.id = rc.recipe_id
      left join public.inventory_items ii on ii.id = rc.component_inventory_item_id
      left join public.recipes cr on cr.id = rc.component_recipe_id
      where rc.recipe_id = affected_recipe.id
        and rc.organization_id = current_organization_id
      group by r.standard_batch_output_qty;

      if coalesce(affected_recipe.resolved_unit_cost, 0) is distinct from coalesce(recalculated_recipe_cost, 0) then
        perform set_config('profitplate.allow_cost_update', 'on', true);

        update public.recipes
           set resolved_unit_cost = coalesce(recalculated_recipe_cost, 0)
         where id = affected_recipe.id
           and organization_id = current_organization_id;

        insert into public.cost_recalculation_events (
          organization_id,
          inventory_item_id,
          recipe_id,
          old_cost,
          new_cost,
          reason
        ) values (
          current_organization_id,
          selected_item.id,
          affected_recipe.id,
          coalesce(affected_recipe.resolved_unit_cost, 0),
          coalesce(recalculated_recipe_cost, 0),
          'purchase_receipt_margin_recovery'
        );
      end if;
    end loop;
  end loop;

  update public.purchase_orders
     set status = 'completed',
         accepted_by = current_user_id,
         accepted_at = now()
   where id = selected_order.id
     and organization_id = current_organization_id
   returning * into updated_order;

  return updated_order;
end;
$$;

grant execute on function public.user_can_manage_costing(uuid) to authenticated;
grant execute on function public.user_can_record_operations(uuid) to authenticated;
grant execute on function public.user_can_approve_operations(uuid) to authenticated;
grant execute on function public.receive_dashboard_purchase_order(uuid) to authenticated;

notify pgrst, 'reload schema';
