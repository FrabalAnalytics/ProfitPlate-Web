-- Purchase orders should update stock only after inventory/operations confirms receipt.

drop function if exists public.receive_dashboard_purchase_order(uuid);
drop function if exists public.update_dashboard_purchase_order(uuid, uuid, text, uuid, jsonb);
drop function if exists public.update_dashboard_requisition_request(uuid, jsonb);
drop function if exists public.confirm_dashboard_requisition_issue(uuid, jsonb);

do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'transformation_event_type'
  ) then
    execute 'alter type public.transformation_event_type add value if not exists ''requisition_issue''';
    execute 'alter type public.transformation_event_type add value if not exists ''requisition_receive''';
  end if;

  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'transformation_event_type_enum'
  ) then
    execute 'alter type public.transformation_event_type_enum add value if not exists ''requisition_issue''';
    execute 'alter type public.transformation_event_type_enum add value if not exists ''requisition_receive''';
  end if;
end $$;

create function public.update_dashboard_requisition_request(
  target_request_id uuid,
  request_payload jsonb
)
returns public.approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  selected_request public.approval_requests;
  updated_request public.approval_requests;
  line_item jsonb;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to edit a requisition.';
  end if;

  select *
    into selected_request
  from public.approval_requests
  where id = target_request_id
  for update;

  if selected_request.id is null then
    raise exception 'Requisition not found.';
  end if;

  if selected_request.request_type <> 'inventory_requisition' then
    raise exception 'Only inventory requisitions can be edited here.';
  end if;

  perform public.require_dashboard_permission(selected_request.organization_id, 'operations');

  if selected_request.status <> 'pending' then
    raise exception 'Only open requisitions can be edited before store confirmation.';
  end if;

  if jsonb_typeof(coalesce(request_payload->'lines', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(request_payload->'lines', '[]'::jsonb)) = 0 then
    raise exception 'Add at least one requisition line.';
  end if;

  for line_item in
    select * from jsonb_array_elements(request_payload->'lines')
  loop
    if nullif(line_item->>'inventory_item_id', '') is null
       or coalesce((line_item->>'quantity')::numeric, 0) <= 0 then
      raise exception 'Each requisition line needs an item and requested quantity.';
    end if;

    if not exists (
      select 1
      from public.inventory_items ii
      where ii.id = nullif(line_item->>'inventory_item_id', '')::uuid
        and ii.organization_id = selected_request.organization_id
        and ii.is_active = true
    ) then
      raise exception 'One requisition item is not active in this workspace.';
    end if;
  end loop;

  update public.approval_requests
     set payload = coalesce(request_payload, '{}'::jsonb) ||
         jsonb_build_object(
           'status', 'pending',
           'updated_at', to_jsonb(now())
         )
   where id = selected_request.id
   returning * into updated_request;

  return updated_request;
end;
$$;

grant execute on function public.update_dashboard_requisition_request(uuid, jsonb) to authenticated;

create function public.confirm_dashboard_requisition_issue(
  target_request_id uuid,
  issued_lines jsonb
)
returns public.approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  selected_request public.approval_requests;
  source_item public.inventory_items;
  destination_item public.inventory_items;
  request_line jsonb;
  issued_line jsonb;
  confirmed_lines jsonb := '[]'::jsonb;
  from_location_id uuid;
  to_location_id uuid;
  source_item_id uuid;
  requested_qty numeric(18, 6);
  issued_qty numeric(18, 6);
  updated_request public.approval_requests;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to confirm a requisition.';
  end if;

  select *
    into selected_request
  from public.approval_requests
  where id = target_request_id
  for update;

  if selected_request.id is null then
    raise exception 'Requisition not found.';
  end if;

  if selected_request.request_type <> 'inventory_requisition' then
    raise exception 'Only inventory requisitions can be confirmed here.';
  end if;

  perform public.require_dashboard_permission(selected_request.organization_id, 'approval');

  if selected_request.status <> 'pending' then
    raise exception 'Only open requisitions can be confirmed.';
  end if;

  from_location_id := nullif(selected_request.payload->>'from_location_id', '')::uuid;
  to_location_id := nullif(selected_request.payload->>'to_location_id', '')::uuid;

  if to_location_id is null then
    raise exception 'Select the requesting destination location before confirming.';
  end if;

  if jsonb_typeof(coalesce(selected_request.payload->'lines', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(selected_request.payload->'lines', '[]'::jsonb)) = 0 then
    raise exception 'Requisition has no lines to issue.';
  end if;

  for request_line in
    select * from jsonb_array_elements(selected_request.payload->'lines')
  loop
    source_item_id := nullif(request_line->>'inventory_item_id', '')::uuid;
    requested_qty := coalesce((request_line->>'quantity')::numeric, 0);

    select *
      into source_item
    from public.inventory_items ii
    where ii.id = source_item_id
      and ii.organization_id = selected_request.organization_id
      and ii.is_active = true
    for update;

    if source_item.id is null then
      raise exception 'A requested item is no longer active in this workspace.';
    end if;

    if from_location_id is null then
      from_location_id := source_item.location_id;
    end if;

    select *
      into issued_line
    from jsonb_array_elements(coalesce(issued_lines, '[]'::jsonb)) item
    where nullif(item->>'inventory_item_id', '')::uuid = source_item.id
    limit 1;

    issued_qty := coalesce((issued_line->>'issued_quantity')::numeric, requested_qty);

    if issued_qty < 0 then
      raise exception 'Issued quantity cannot be negative.';
    end if;

    if issued_qty > coalesce(source_item.on_hand_qty, 0) then
      raise exception 'Issued quantity for % is higher than stock on hand.', coalesce(source_item.name, 'item');
    end if;

    if issued_qty > 0 then
      update public.inventory_items
         set on_hand_qty = coalesce(on_hand_qty, 0) - issued_qty
       where id = source_item.id
         and organization_id = selected_request.organization_id;

      select *
        into destination_item
      from public.inventory_items ii
      where ii.organization_id = selected_request.organization_id
        and ii.location_id = to_location_id
        and ii.cost_type = source_item.cost_type
        and lower(coalesce(ii.sku, ii.name, '')) = lower(coalesce(source_item.sku, source_item.name, ''))
      for update;

      if destination_item.id is null then
        insert into public.inventory_items (
          tenant_id,
          organization_id,
          location_id,
          recipe_id,
          name,
          sku,
          department,
          item_type,
          cost_type,
          base_uom,
          recipe_uom,
          on_hand_uom,
          on_hand_qty,
          current_cost_per_base_uom,
          yield_pct,
          shrinkage_factor_pct,
          is_high_value,
          is_active
        ) values (
          source_item.tenant_id,
          selected_request.organization_id,
          to_location_id,
          source_item.recipe_id,
          source_item.name,
          source_item.sku,
          source_item.department,
          source_item.item_type,
          source_item.cost_type,
          source_item.base_uom,
          source_item.recipe_uom,
          source_item.on_hand_uom,
          issued_qty,
          source_item.current_cost_per_base_uom,
          source_item.yield_pct,
          source_item.shrinkage_factor_pct,
          source_item.is_high_value,
          true
        )
        returning * into destination_item;
      else
        update public.inventory_items
           set on_hand_qty = coalesce(on_hand_qty, 0) + issued_qty,
               current_cost_per_base_uom = source_item.current_cost_per_base_uom,
               on_hand_uom = coalesce(on_hand_uom, source_item.on_hand_uom, source_item.base_uom, 'unit')
         where id = destination_item.id
           and organization_id = selected_request.organization_id;
      end if;

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
        selected_request.organization_id,
        'requisition_issue',
        source_item.id,
        coalesce(source_item.location_id, from_location_id),
        -issued_qty,
        source_item.current_cost_per_base_uom,
        'approval_requests',
        selected_request.id,
        'central_transit',
        current_user_id
      ), (
        selected_request.organization_id,
        'requisition_receive',
        destination_item.id,
        to_location_id,
        issued_qty,
        source_item.current_cost_per_base_uom,
        'approval_requests',
        selected_request.id,
        'central_transit',
        current_user_id
      );
    end if;

    confirmed_lines := confirmed_lines || jsonb_build_array(
      request_line ||
      jsonb_build_object(
        'requested_quantity', requested_qty,
        'issued_quantity', issued_qty,
        'issued_at', to_jsonb(now())
      )
    );
  end loop;

  update public.approval_requests
     set status = 'completed',
         approved_by = current_user_id,
         approved_at = now(),
         payload = selected_request.payload ||
           jsonb_build_object(
             'status', 'completed',
             'lines', confirmed_lines,
             'confirmed_at', to_jsonb(now())
           )
   where id = selected_request.id
   returning * into updated_request;

  return updated_request;
end;
$$;

grant execute on function public.confirm_dashboard_requisition_issue(uuid, jsonb) to authenticated;

create function public.update_dashboard_purchase_order(
  target_purchase_order_id uuid,
  target_supplier_id uuid,
  target_supplier_name text,
  target_receiving_location_id uuid,
  target_purchase_lines jsonb
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
  line_item jsonb;
  expected_line_count integer;
  inserted_line_count integer := 0;
  updated_order public.purchase_orders;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to edit a purchase order.';
  end if;

  select p.organization_id, p.role::text
    into current_organization_id, profile_role
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before editing purchase orders.';
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

  if normalized_role not in (
    'owner',
    'admin',
    'manager',
    'operations_manager',
    'procurement_manager'
  ) then
    raise exception 'Only procurement and operations leaders can edit open purchase orders. Current role: %', coalesce(profile_role, 'none');
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

  if selected_order.status not in ('draft', 'pending', 'accepted') then
    raise exception 'Only open purchase orders can be edited before receipt.';
  end if;

  expected_line_count := jsonb_array_length(coalesce(target_purchase_lines, '[]'::jsonb));

  if jsonb_typeof(coalesce(target_purchase_lines, '[]'::jsonb)) <> 'array'
     or expected_line_count = 0 then
    raise exception 'Add at least one purchase order line.';
  end if;

  for line_item in
    select * from jsonb_array_elements(target_purchase_lines)
  loop
    if nullif(line_item->>'inventory_item_id', '') is null
       or coalesce((line_item->>'quantity')::numeric, 0) <= 0
       or coalesce((line_item->>'landed_unit_cost')::numeric, -1) < 0 then
      raise exception 'Each purchase order line needs an item, quantity, and expected unit cost.';
    end if;

    if not exists (
      select 1
      from public.inventory_items ii
      where ii.id = nullif(line_item->>'inventory_item_id', '')::uuid
        and ii.organization_id = current_organization_id
        and ii.cost_type::text = 'purchased'
        and ii.is_active = true
    ) then
      raise exception 'One purchase order item is not an active purchased SKU in this workspace.';
    end if;
  end loop;

  update public.purchase_orders
     set supplier_id = target_supplier_id,
         supplier_name = nullif(target_supplier_name, ''),
         receiving_location_id = target_receiving_location_id
   where id = selected_order.id
     and organization_id = current_organization_id
   returning * into updated_order;

  delete from public.purchase_order_lines
   where purchase_order_id = selected_order.id;

  for line_item in
    select * from jsonb_array_elements(target_purchase_lines)
  loop
    insert into public.purchase_order_lines (
      purchase_order_id,
      inventory_item_id,
      qty,
      landed_unit_cost
    ) values (
      selected_order.id,
      nullif(line_item->>'inventory_item_id', '')::uuid,
      (line_item->>'quantity')::numeric,
      (line_item->>'landed_unit_cost')::numeric
    );

    inserted_line_count := inserted_line_count + 1;
  end loop;

  if inserted_line_count <> expected_line_count then
    raise exception 'Purchase order edit did not save every line. Please retry.';
  end if;

  return updated_order;
end;
$$;

grant execute on function public.update_dashboard_purchase_order(uuid, uuid, text, uuid, jsonb) to authenticated;

create function public.receive_dashboard_purchase_order(
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
    normalized_role := 'inventory_manager';
  end if;

  if normalized_role not in (
    'owner',
    'admin',
    'manager',
    'operations_manager',
    'inventory_manager'
  ) then
    raise exception 'Only inventory managers and operations leaders can confirm purchase receipt. Current role: %', coalesce(profile_role, 'none');
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

grant execute on function public.receive_dashboard_purchase_order(uuid) to authenticated;

notify pgrst, 'reload schema';
