-- Tighten requisition transfers:
-- 1. Store confirmation records the issued quantities and dispatches the task,
--    but does not adjust physical balances.
-- 2. Receiver acknowledgement is the atomic stock-movement point.
-- 3. Receiver rejection is explicit and auditable.

create or replace function public.confirm_dashboard_requisition_issue(
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
    raise exception 'You must be signed in to confirm a requisition transfer.';
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

  perform public.require_dashboard_permission(
    selected_request.organization_id,
    'approval'
  );

  if selected_request.status <> 'pending' then
    raise exception 'Only pending requisition transfers can be confirmed.';
  end if;

  from_location_id := nullif(selected_request.payload->>'from_location_id', '')::uuid;
  to_location_id := nullif(selected_request.payload->>'to_location_id', '')::uuid;

  if to_location_id is null then
    raise exception 'Select the receiving destination location before confirming.';
  end if;

  if not exists (
    select 1
    from public.locations location
    where location.id = to_location_id
      and location.organization_id = selected_request.organization_id
      and location.is_active = true
  ) then
    raise exception 'Receiving location is not active in this workspace.';
  end if;

  if jsonb_typeof(coalesce(selected_request.payload->'lines', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(selected_request.payload->'lines', '[]'::jsonb)) = 0 then
    raise exception 'Requisition has no lines to transfer.';
  end if;

  for request_line in
    select * from jsonb_array_elements(selected_request.payload->'lines')
  loop
    issued_line := null;
    source_item_id := nullif(request_line->>'inventory_item_id', '')::uuid;
    requested_qty := coalesce(nullif(request_line->>'quantity', '')::numeric, 0);

    select *
      into source_item
    from public.inventory_items item
    where item.id = source_item_id
      and item.organization_id = selected_request.organization_id
      and item.is_active = true
    for update;

    if source_item.id is null then
      raise exception 'A requested item is no longer active in this workspace.';
    end if;

    if from_location_id is not null
       and source_item.location_id <> from_location_id then
      raise exception 'A requested item does not belong to the selected issuing location.';
    end if;

    select issued.value
      into issued_line
    from jsonb_array_elements(coalesce(issued_lines, '[]'::jsonb)) as issued(value)
    where nullif(issued.value->>'inventory_item_id', '')::uuid = source_item.id
    limit 1;

    issued_qty := coalesce(
      nullif(issued_line->>'issued_quantity', '')::numeric,
      requested_qty
    );

    if issued_qty < 0 then
      raise exception 'Transfer quantity cannot be negative.';
    end if;

    if issued_qty > coalesce(source_item.on_hand_qty, 0) then
      raise exception 'Transfer quantity for % is higher than stock on hand.',
        coalesce(source_item.name, 'item');
    end if;

    confirmed_lines := confirmed_lines || jsonb_build_array(
      request_line ||
      jsonb_build_object(
        'requested_quantity', requested_qty,
        'issued_quantity', issued_qty,
        'transferred_quantity', issued_qty,
        'source_inventory_item_id', source_item.id,
        'source_location_id', source_item.location_id,
        'source_unit_cost', coalesce(source_item.current_cost_per_base_uom, 0),
        'origin_inventory_item_id', coalesce(
          source_item.origin_inventory_item_id,
          case
            when public.is_dashboard_main_store_location(
              selected_request.organization_id,
              source_item.location_id
            )
              then source_item.id
            else null
          end
        ),
        'issued_at', to_jsonb(now()),
        'issued_by', current_user_id
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
             'issued_by', current_user_id,
             'awaiting_receipt', true,
             'stock_movement_deferred', true
           )
   where id = selected_request.id
   returning * into updated_request;

  return updated_request;
end;
$$;

grant execute on function public.confirm_dashboard_requisition_issue(uuid, jsonb)
  to authenticated;

create or replace function public.acknowledge_dashboard_requisition_receipt(
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
  request_line jsonb;
  received_lines jsonb := '[]'::jsonb;
  source_item public.inventory_items;
  destination_item public.inventory_items;
  destination_item_id uuid;
  source_item_id uuid;
  to_location_id uuid;
  issued_qty numeric(18, 6);
  movement_is_deferred boolean;
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

  perform public.require_dashboard_permission(
    selected_request.organization_id,
    'operations'
  );

  if selected_request.status <> 'accepted'
     or coalesce((selected_request.payload->>'awaiting_receipt')::boolean, false) is not true then
    raise exception 'Only dispatched requisitions can be received.';
  end if;

  if selected_request.approved_by = current_user_id
     or nullif(selected_request.payload->>'issued_by', '')::uuid = current_user_id then
    raise exception 'The issuing user cannot acknowledge receipt. Receiving department acknowledgement must be independent.';
  end if;

  to_location_id := nullif(selected_request.payload->>'to_location_id', '')::uuid;
  movement_is_deferred := coalesce(
    (selected_request.payload->>'stock_movement_deferred')::boolean,
    false
  );

  if to_location_id is null then
    raise exception 'Receiving location is missing from this requisition.';
  end if;

  for request_line in
    select * from jsonb_array_elements(coalesce(selected_request.payload->'lines', '[]'::jsonb))
  loop
    source_item := null::public.inventory_items;
    destination_item := null::public.inventory_items;
    source_item_id := coalesce(
      nullif(request_line->>'source_inventory_item_id', '')::uuid,
      nullif(request_line->>'inventory_item_id', '')::uuid
    );
    destination_item_id := nullif(request_line->>'destination_inventory_item_id', '')::uuid;
    issued_qty := coalesce(nullif(request_line->>'issued_quantity', '')::numeric, 0);

    if issued_qty < 0 then
      raise exception 'Received quantity cannot be negative.';
    end if;

    if issued_qty > 0 then
      select *
        into source_item
      from public.inventory_items item
      where item.id = source_item_id
        and item.organization_id = selected_request.organization_id
        and item.is_active = true
      for update;

      if source_item.id is null then
        raise exception 'The source SKU for this transfer no longer exists.';
      end if;

      if movement_is_deferred
         and issued_qty > coalesce(source_item.on_hand_qty, 0) then
        raise exception 'Transfer quantity for % is now higher than stock on hand. Reject receipt or ask Store to re-issue.',
          coalesce(source_item.name, 'item');
      end if;

      if destination_item_id is not null then
        select *
          into destination_item
        from public.inventory_items item
        where item.id = destination_item_id
          and item.organization_id = selected_request.organization_id
          and item.location_id = to_location_id
          and item.is_active = true
        for update;
      end if;

      if destination_item.id is null then
        select *
          into destination_item
        from public.inventory_items item
        where item.organization_id = selected_request.organization_id
          and item.location_id = to_location_id
          and item.cost_type = source_item.cost_type
          and lower(coalesce(item.sku, item.name, '')) =
            lower(coalesce(source_item.sku, source_item.name, ''))
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
            is_active,
            origin_inventory_item_id
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
            true,
            coalesce(
              nullif(request_line->>'origin_inventory_item_id', '')::uuid,
              source_item.origin_inventory_item_id,
              source_item.id
            )
          )
          returning * into destination_item;
        end if;
      end if;

      if movement_is_deferred then
        update public.inventory_items
           set on_hand_qty = coalesce(on_hand_qty, 0) - issued_qty,
               is_active = true,
               origin_inventory_item_id = coalesce(origin_inventory_item_id, source_item.id)
         where id = source_item.id
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
          'requisition_issue',
          source_item.id,
          source_item.location_id,
          -issued_qty,
          coalesce(source_item.current_cost_per_base_uom, 0),
          'approval_requests',
          selected_request.id,
          'central_transit',
          current_user_id
        );
      end if;

      update public.inventory_items
         set on_hand_qty = coalesce(on_hand_qty, 0) + issued_qty,
             current_cost_per_base_uom = coalesce(
               source_item.current_cost_per_base_uom,
               current_cost_per_base_uom,
               0
             ),
             on_hand_uom = coalesce(
               on_hand_uom,
               source_item.on_hand_uom,
               source_item.base_uom,
               'unit'
             ),
             origin_inventory_item_id = coalesce(
               origin_inventory_item_id,
               destination_item.origin_inventory_item_id,
               nullif(request_line->>'origin_inventory_item_id', '')::uuid,
               source_item.origin_inventory_item_id,
               source_item.id
             ),
             is_active = true
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
        to_location_id,
        issued_qty,
        coalesce(source_item.current_cost_per_base_uom, destination_item.current_cost_per_base_uom, 0),
        'approval_requests',
        selected_request.id,
        'central_transit',
        current_user_id
      );
    end if;

    received_lines := received_lines || jsonb_build_array(
      request_line ||
      jsonb_build_object(
        'destination_inventory_item_id', destination_item.id,
        'received_quantity', issued_qty,
        'received_at', to_jsonb(now()),
        'received_by', current_user_id
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

grant execute on function public.acknowledge_dashboard_requisition_receipt(uuid)
  to authenticated;

create or replace function public.reject_dashboard_requisition_receipt(
  target_request_id uuid,
  rejection_reason_value text default null
)
returns public.approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  selected_request public.approval_requests;
  request_line jsonb;
  source_item public.inventory_items;
  source_item_id uuid;
  issued_qty numeric(18, 6);
  movement_is_deferred boolean;
  clean_reason text := nullif(trim(coalesce(rejection_reason_value, '')), '');
  updated_request public.approval_requests;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to reject a requisition receipt.';
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
    raise exception 'Only inventory requisitions can be rejected here.';
  end if;

  perform public.require_dashboard_permission(
    selected_request.organization_id,
    'operations'
  );

  if selected_request.status <> 'accepted'
     or coalesce((selected_request.payload->>'awaiting_receipt')::boolean, false) is not true then
    raise exception 'Only dispatched requisitions awaiting receipt can be rejected.';
  end if;

  if selected_request.approved_by = current_user_id
     or nullif(selected_request.payload->>'issued_by', '')::uuid = current_user_id then
    raise exception 'The issuing user cannot reject receipt. Receiving department rejection must be independent.';
  end if;

  movement_is_deferred := coalesce(
    (selected_request.payload->>'stock_movement_deferred')::boolean,
    false
  );

  -- Legacy in-transit requests may already have depleted the source store.
  -- Restore them when receiver rejects. New deferred requests have no stock
  -- movement to reverse.
  if not movement_is_deferred then
    for request_line in
      select * from jsonb_array_elements(coalesce(selected_request.payload->'lines', '[]'::jsonb))
    loop
      source_item_id := coalesce(
        nullif(request_line->>'source_inventory_item_id', '')::uuid,
        nullif(request_line->>'inventory_item_id', '')::uuid
      );
      issued_qty := coalesce(nullif(request_line->>'issued_quantity', '')::numeric, 0);

      if issued_qty > 0 and source_item_id is not null then
        select *
          into source_item
        from public.inventory_items item
        where item.id = source_item_id
          and item.organization_id = selected_request.organization_id
        for update;

        if source_item.id is not null then
          update public.inventory_items
             set on_hand_qty = coalesce(on_hand_qty, 0) + issued_qty,
                 is_active = true
           where id = source_item.id
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
            'requisition_issue',
            source_item.id,
            source_item.location_id,
            issued_qty,
            coalesce(source_item.current_cost_per_base_uom, 0),
            'approval_requests',
            selected_request.id,
            'central_transit',
            current_user_id
          );
        end if;
      end if;
    end loop;
  end if;

  update public.approval_requests
     set status = 'cancelled',
         rejected_by = current_user_id,
         rejected_at = now(),
         rejection_reason = coalesce(clean_reason, 'Receipt rejected by receiving department.'),
         payload = selected_request.payload ||
           jsonb_build_object(
             'status', 'receipt_rejected',
             'receipt_rejected_at', to_jsonb(now()),
             'receipt_rejected_by', current_user_id,
             'receipt_rejection_reason', coalesce(clean_reason, 'Receipt rejected by receiving department.'),
             'awaiting_receipt', false
           )
   where id = selected_request.id
   returning * into updated_request;

  return updated_request;
end;
$$;

grant execute on function public.reject_dashboard_requisition_receipt(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
