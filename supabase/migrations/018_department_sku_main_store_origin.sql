-- Department SKUs (Kitchen/Bar) must be location balances linked to a main-store origin SKU.

alter table public.inventory_items
  add column if not exists origin_inventory_item_id uuid references public.inventory_items(id) on delete set null;

create index if not exists idx_inventory_items_origin_inventory_item
  on public.inventory_items(origin_inventory_item_id);

do $$
declare
  department_item public.inventory_items;
  item_location public.locations;
  preferred_main_store public.locations;
  origin_item public.inventory_items;
  normalized_item_text text;
begin
  for department_item in
    select ii.*
    from public.inventory_items ii
    join public.locations l on l.id = ii.location_id
    where ii.origin_inventory_item_id is null
      and l.location_type <> 'main_store'
  loop
    select *
      into item_location
    from public.locations l
    where l.id = department_item.location_id;

    normalized_item_text := lower(
      concat_ws(
        ' ',
        department_item.name,
        department_item.sku,
        department_item.department,
        item_location.name
      )
    );

    select *
      into preferred_main_store
    from public.locations l
    where l.organization_id = department_item.organization_id
      and l.is_active = true
      and l.location_type = 'main_store'
      and (
        (
          normalized_item_text ~ '(drink|bar|beverage)'
          and lower(l.name) like '%drink%'
        )
        or (
          normalized_item_text !~ '(drink|bar|beverage)'
          and lower(l.name) like '%food%'
        )
      )
    order by
      case
        when normalized_item_text ~ '(drink|bar|beverage)'
             and lower(l.name) like '%drink%' then 0
        when normalized_item_text !~ '(drink|bar|beverage)'
             and lower(l.name) like '%food%' then 0
        else 1
      end,
      l.created_at asc
    limit 1;

    if preferred_main_store.id is null then
      select *
        into preferred_main_store
      from public.locations l
      where l.organization_id = department_item.organization_id
        and l.is_active = true
        and l.location_type = 'main_store'
      order by l.created_at asc
      limit 1;
    end if;

    if preferred_main_store.id is not null then
      select *
        into origin_item
      from public.inventory_items ii
      where ii.organization_id = department_item.organization_id
        and ii.location_id = preferred_main_store.id
        and ii.cost_type = department_item.cost_type
        and lower(coalesce(ii.sku, ii.name, '')) = lower(coalesce(department_item.sku, department_item.name, ''))
      for update;

      if origin_item.id is null then
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
          department_item.tenant_id,
          department_item.organization_id,
          preferred_main_store.id,
          department_item.recipe_id,
          department_item.name,
          department_item.sku,
          department_item.department,
          department_item.item_type,
          department_item.cost_type,
          department_item.base_uom,
          department_item.recipe_uom,
          coalesce(department_item.on_hand_uom, department_item.base_uom, 'unit'),
          0,
          department_item.current_cost_per_base_uom,
          department_item.yield_pct,
          department_item.shrinkage_factor_pct,
          department_item.is_high_value,
          true
        )
        returning * into origin_item;
      end if;

      update public.inventory_items
         set origin_inventory_item_id = origin_item.id,
             is_active = true
       where id = department_item.id;
    end if;
  end loop;

  update public.inventory_items ii
     set origin_inventory_item_id = ii.id
    from public.locations l
   where l.id = ii.location_id
     and l.location_type = 'main_store'
     and ii.origin_inventory_item_id is null;
end $$;

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
  origin_item public.inventory_items;
  request_line jsonb;
  issued_line jsonb;
  confirmed_lines jsonb := '[]'::jsonb;
  from_location public.locations;
  to_location public.locations;
  from_location_id uuid;
  to_location_id uuid;
  source_item_id uuid;
  requested_qty numeric(18, 6);
  issued_qty numeric(18, 6);
  next_origin_item_id uuid;
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

  perform public.require_dashboard_permission(selected_request.organization_id, 'approval');

  if selected_request.status <> 'pending' then
    raise exception 'Only pending requisition transfers can be confirmed.';
  end if;

  from_location_id := nullif(selected_request.payload->>'from_location_id', '')::uuid;
  to_location_id := nullif(selected_request.payload->>'to_location_id', '')::uuid;

  if to_location_id is null then
    raise exception 'Select the receiving destination location before confirming.';
  end if;

  select *
    into to_location
  from public.locations l
  where l.id = to_location_id
    and l.organization_id = selected_request.organization_id;

  if to_location.id is null then
    raise exception 'Receiving location is not active in this workspace.';
  end if;

  if jsonb_typeof(coalesce(selected_request.payload->'lines', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(selected_request.payload->'lines', '[]'::jsonb)) = 0 then
    raise exception 'Requisition has no lines to transfer.';
  end if;

  for request_line in
    select * from jsonb_array_elements(selected_request.payload->'lines')
  loop
    destination_item := null::public.inventory_items;
    origin_item := null::public.inventory_items;
    next_origin_item_id := null;
    source_item_id := nullif(request_line->>'inventory_item_id', '')::uuid;
    requested_qty := coalesce(nullif(request_line->>'quantity', '')::numeric, 0);

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
      into from_location
    from public.locations l
    where l.id = coalesce(from_location_id, source_item.location_id)
      and l.organization_id = selected_request.organization_id;

    select *
      into issued_line
    from jsonb_array_elements(coalesce(issued_lines, '[]'::jsonb)) item
    where nullif(item->>'inventory_item_id', '')::uuid = source_item.id
    limit 1;

    issued_qty := coalesce(nullif(issued_line->>'issued_quantity', '')::numeric, requested_qty);

    if issued_qty < 0 then
      raise exception 'Transfer quantity cannot be negative.';
    end if;

    if issued_qty > coalesce(source_item.on_hand_qty, 0) then
      raise exception 'Transfer quantity for % is higher than stock on hand.', coalesce(source_item.name, 'item');
    end if;

    if issued_qty > 0 then
      if source_item.origin_inventory_item_id is not null then
        select *
          into origin_item
        from public.inventory_items ii
        where ii.id = source_item.origin_inventory_item_id
          and ii.organization_id = selected_request.organization_id
        for update;
      end if;

      if to_location.location_type = 'main_store' then
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
            null
          )
          returning * into destination_item;

          update public.inventory_items
             set origin_inventory_item_id = destination_item.id
           where id = destination_item.id;
        end if;

        next_origin_item_id := destination_item.id;
      else
        next_origin_item_id := coalesce(origin_item.id, source_item.origin_inventory_item_id);

        if next_origin_item_id is null and from_location.location_type = 'main_store' then
          next_origin_item_id := source_item.id;
        end if;

        if next_origin_item_id is null then
          raise exception 'Department SKU % must be connected to a main-store origin before transfer.', coalesce(source_item.name, 'item');
        end if;

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
            next_origin_item_id
          )
          returning * into destination_item;
        end if;
      end if;

      update public.inventory_items
         set on_hand_qty = coalesce(on_hand_qty, 0) - issued_qty,
             is_active = true,
             origin_inventory_item_id = case
               when from_location.location_type = 'main_store' then coalesce(origin_inventory_item_id, source_item.id)
               else coalesce(origin_inventory_item_id, next_origin_item_id)
             end
       where id = source_item.id
         and organization_id = selected_request.organization_id;

      update public.inventory_items
         set on_hand_qty = coalesce(on_hand_qty, 0) + issued_qty,
             current_cost_per_base_uom = coalesce(source_item.current_cost_per_base_uom, current_cost_per_base_uom, 0),
             on_hand_uom = coalesce(on_hand_uom, source_item.on_hand_uom, source_item.base_uom, 'unit'),
             is_active = true,
             origin_inventory_item_id = case
               when to_location.location_type = 'main_store' then coalesce(origin_inventory_item_id, destination_item.id)
               else coalesce(origin_inventory_item_id, next_origin_item_id)
             end
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
        'transferred_quantity', issued_qty,
        'destination_inventory_item_id', destination_item.id,
        'origin_inventory_item_id', coalesce(next_origin_item_id, destination_item.origin_inventory_item_id),
        'issued_at', to_jsonb(now()),
        'received_quantity', issued_qty,
        'received_at', to_jsonb(now())
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
             'confirmed_at', to_jsonb(now()),
             'received_at', to_jsonb(now()),
             'received_by', current_user_id,
             'awaiting_receipt', false
           )
   where id = selected_request.id
   returning * into updated_request;

  return updated_request;
end;
$$;

grant execute on function public.confirm_dashboard_requisition_issue(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
