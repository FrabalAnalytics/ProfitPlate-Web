-- Requisition transfers should dispatch from source first, then update destination stock only after receiver acceptance.

drop function if exists public.acknowledge_dashboard_requisition_receipt(uuid);
drop function if exists public.confirm_dashboard_requisition_issue(uuid, jsonb);

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
    raise exception 'Only open requisitions can be dispatched.';
  end if;

  from_location_id := nullif(selected_request.payload->>'from_location_id', '')::uuid;
  to_location_id := nullif(selected_request.payload->>'to_location_id', '')::uuid;

  if to_location_id is null then
    raise exception 'Select the receiving destination location before dispatch.';
  end if;

  if jsonb_typeof(coalesce(selected_request.payload->'lines', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(selected_request.payload->'lines', '[]'::jsonb)) = 0 then
    raise exception 'Requisition has no lines to issue.';
  end if;

  for request_line in
    select * from jsonb_array_elements(selected_request.payload->'lines')
  loop
    destination_item := null::public.inventory_items;
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
          coalesce(source_item.on_hand_uom, source_item.base_uom, 'unit'),
          0,
          source_item.current_cost_per_base_uom,
          source_item.yield_pct,
          source_item.shrinkage_factor_pct,
          source_item.is_high_value,
          true
        )
        returning * into destination_item;
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
      );
    end if;

    confirmed_lines := confirmed_lines || jsonb_build_array(
      request_line ||
      jsonb_build_object(
        'requested_quantity', requested_qty,
        'issued_quantity', issued_qty,
        'destination_inventory_item_id', destination_item.id,
        'issued_at', to_jsonb(now())
      )
    );
  end loop;

  update public.approval_requests
     set status = 'accepted',
         approved_by = current_user_id,
         approved_at = now(),
         payload = selected_request.payload ||
           jsonb_build_object(
             'status', 'accepted',
             'lines', confirmed_lines,
             'issued_at', to_jsonb(now()),
             'awaiting_receipt', true
           )
   where id = selected_request.id
   returning * into updated_request;

  return updated_request;
end;
$$;

grant execute on function public.confirm_dashboard_requisition_issue(uuid, jsonb) to authenticated;

create function public.acknowledge_dashboard_requisition_receipt(
  target_request_id uuid
)
returns public.approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  selected_request public.approval_requests;
  destination_item public.inventory_items;
  request_line jsonb;
  received_lines jsonb := '[]'::jsonb;
  destination_item_id uuid;
  to_location_id uuid;
  issued_qty numeric(18, 6);
  updated_request public.approval_requests;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to receive a requisition.';
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
    raise exception 'Only inventory requisitions can be received here.';
  end if;

  perform public.require_dashboard_permission(selected_request.organization_id, 'operations');

  if selected_request.status <> 'accepted'
     or coalesce((selected_request.payload->>'awaiting_receipt')::boolean, false) is not true then
    raise exception 'Only dispatched requisitions can be received.';
  end if;

  to_location_id := nullif(selected_request.payload->>'to_location_id', '')::uuid;

  if jsonb_typeof(coalesce(selected_request.payload->'lines', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(selected_request.payload->'lines', '[]'::jsonb)) = 0 then
    raise exception 'Requisition has no lines to receive.';
  end if;

  for request_line in
    select * from jsonb_array_elements(selected_request.payload->'lines')
  loop
    destination_item_id := nullif(request_line->>'destination_inventory_item_id', '')::uuid;
    issued_qty := coalesce((request_line->>'issued_quantity')::numeric, 0);

    if issued_qty < 0 then
      raise exception 'Received quantity cannot be negative.';
    end if;

    if issued_qty > 0 then
      select *
        into destination_item
      from public.inventory_items ii
      where ii.id = destination_item_id
        and ii.organization_id = selected_request.organization_id
        and ii.is_active = true
      for update;

      if destination_item.id is null then
        raise exception 'The receiving SKU is missing. Dispatch must create a destination SKU before receipt.';
      end if;

      update public.inventory_items
         set on_hand_qty = coalesce(on_hand_qty, 0) + issued_qty,
             on_hand_uom = coalesce(on_hand_uom, destination_item.on_hand_uom, destination_item.base_uom, 'unit')
       where id = destination_item.id
         and organization_id = selected_request.organization_id;

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
        'requisition_receive',
        destination_item.id,
        coalesce(destination_item.location_id, to_location_id),
        issued_qty,
        destination_item.current_cost_per_base_uom,
        'approval_requests',
        selected_request.id,
        'central_transit',
        current_user_id
      );
    end if;

    received_lines := received_lines || jsonb_build_array(
      request_line ||
      jsonb_build_object(
        'received_quantity', issued_qty,
        'received_at', to_jsonb(now())
      )
    );
  end loop;

  update public.approval_requests
     set status = 'completed',
         payload = selected_request.payload ||
           jsonb_build_object(
             'status', 'completed',
             'lines', received_lines,
             'received_at', to_jsonb(now()),
             'received_by', current_user_id,
             'awaiting_receipt', false
           )
   where id = selected_request.id
   returning * into updated_request;

  return updated_request;
end;
$$;

grant execute on function public.acknowledge_dashboard_requisition_receipt(uuid) to authenticated;

notify pgrst, 'reload schema';
