-- Restore the receiving-side RPC for two-step requisitions. Store issue moves
-- stock out of the source location and marks the request awaiting receipt;
-- this acknowledgement is the only point where the destination department
-- balance is increased.

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

  to_location_id := nullif(selected_request.payload->>'to_location_id', '')::uuid;

  if to_location_id is null then
    raise exception 'Receiving location is missing from this requisition.';
  end if;

  if jsonb_typeof(coalesce(selected_request.payload->'lines', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(selected_request.payload->'lines', '[]'::jsonb)) = 0 then
    raise exception 'Requisition has no lines to receive.';
  end if;

  for request_line in
    select * from jsonb_array_elements(selected_request.payload->'lines')
  loop
    source_item := null::public.inventory_items;
    destination_item := null::public.inventory_items;
    source_item_id := nullif(request_line->>'inventory_item_id', '')::uuid;
    destination_item_id := nullif(request_line->>'destination_inventory_item_id', '')::uuid;
    issued_qty := coalesce(nullif(request_line->>'issued_quantity', '')::numeric, 0);

    if issued_qty < 0 then
      raise exception 'Received quantity cannot be negative.';
    end if;

    if issued_qty > 0 then
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
          into source_item
        from public.inventory_items item
        where item.id = source_item_id
          and item.organization_id = selected_request.organization_id
          and item.is_active = true
        for update;

        if source_item.id is null then
          raise exception 'The source SKU for this transfer no longer exists.';
        end if;

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
            coalesce(source_item.origin_inventory_item_id, source_item.id)
          )
          returning * into destination_item;
        end if;
      end if;

      update public.inventory_items
         set on_hand_qty = coalesce(on_hand_qty, 0) + issued_qty,
             current_cost_per_base_uom = coalesce(
               destination_item.current_cost_per_base_uom,
               current_cost_per_base_uom,
               0
             ),
             on_hand_uom = coalesce(
               on_hand_uom,
               destination_item.on_hand_uom,
               destination_item.base_uom,
               'unit'
             ),
             origin_inventory_item_id = coalesce(
               origin_inventory_item_id,
               destination_item.origin_inventory_item_id,
               nullif(request_line->>'origin_inventory_item_id', '')::uuid
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
        coalesce(destination_item.current_cost_per_base_uom, 0),
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

notify pgrst, 'reload schema';
