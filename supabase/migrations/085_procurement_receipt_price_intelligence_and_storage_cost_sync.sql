-- Supplier price changes should be visible in procurement intelligence and
-- should update the purchased SKU cost consistently across storage-location
-- copies. Stock quantity only changes in the receiving store; unit cost is
-- synchronized to matching active purchased SKUs so recipe costing and reports
-- do not depend on which store copy a recipe component references.

drop trigger if exists log_inventory_price_change on public.inventory_items;
create trigger log_inventory_price_change
after update of current_cost_per_base_uom on public.inventory_items
for each row execute function public.log_inventory_price_change();

create or replace function public.receive_dashboard_purchase_order_quantities(
  target_purchase_order_id uuid,
  received_lines jsonb,
  short_supply_reason_value text default null
)
returns public.purchase_order_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_organization_id uuid;
  profile_role text;
  selected_order public.purchase_orders;
  input_line jsonb;
  purchase_line public.purchase_order_lines;
  selected_item public.inventory_items;
  sibling_item public.inventory_items;
  receipt_record public.purchase_order_receipts;
  received_value numeric(18, 6);
  next_on_hand numeric(18, 6);
  previous_cost numeric(18, 6);
  next_cost numeric(18, 6);
  sibling_previous_cost numeric(18, 6);
  is_complete boolean;
  generated_grn text;
begin
  if current_user_id is null then
    raise exception 'You must be signed in to confirm a delivery.';
  end if;

  select p.organization_id, lower(replace(replace(p.role::text, ' ', '_'), '-', '_'))
    into current_organization_id, profile_role
  from public.profiles p
  where p.id = current_user_id;

  if profile_role not in (
    'owner',
    'admin',
    'operations_manager',
    'inventory_manager',
    'storekeeper'
  ) then
    raise exception 'Only Inventory, Store, Operations, Admin, or Owner users can confirm supplier deliveries.';
  end if;

  select *
    into selected_order
  from public.purchase_orders
  where id = target_purchase_order_id
    and organization_id = current_organization_id
  for update;

  if selected_order.id is null or selected_order.status::text = 'cancelled' then
    raise exception 'Open purchase order not found.';
  end if;

  if selected_order.created_by = current_user_id
     and profile_role not in ('inventory_manager', 'storekeeper') then
    raise exception 'The PO creator cannot confirm receipt. Inventory or Store receipt must be independent.';
  end if;

  if jsonb_typeof(coalesce(received_lines, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(received_lines, '[]'::jsonb)) = 0 then
    raise exception 'Enter at least one received quantity.';
  end if;

  for input_line in select * from jsonb_array_elements(received_lines)
  loop
    received_value := coalesce((input_line->>'received_qty')::numeric, 0);
    if received_value <= 0 then
      continue;
    end if;

    select *
      into purchase_line
    from public.purchase_order_lines
    where id = nullif(input_line->>'purchase_order_line_id', '')::uuid
      and purchase_order_id = selected_order.id
    for update;

    if purchase_line.id is null then
      raise exception 'A received line does not belong to this PO.';
    end if;

    if purchase_line.received_qty >= purchase_line.qty then
      raise exception 'This PO line has already been fully received.';
    end if;

    if purchase_line.received_qty + received_value > purchase_line.qty then
      raise exception 'Received quantity cannot exceed the outstanding PO quantity.';
    end if;

    select *
      into selected_item
    from public.inventory_items
    where id = purchase_line.inventory_item_id
      and organization_id = current_organization_id
      and location_id = selected_order.receiving_location_id
      and is_active = true
    for update;

    if selected_item.id is null then
      raise exception 'A PO item is not assigned to the receiving store.';
    end if;

    previous_cost := coalesce(selected_item.current_cost_per_base_uom, 0);
    next_on_hand := coalesce(selected_item.on_hand_qty, 0) + received_value;
    next_cost := case
      when coalesce(selected_item.on_hand_qty, 0) > 0 and next_on_hand > 0 then
        (
          coalesce(selected_item.on_hand_qty, 0) * previous_cost
          + received_value * purchase_line.landed_unit_cost
        ) / next_on_hand
      else purchase_line.landed_unit_cost
    end;

    update public.inventory_items
       set on_hand_qty = next_on_hand,
           current_cost_per_base_uom = next_cost,
           yield_pct = least(greatest(coalesce(yield_pct, 1), 0.0001), 1),
           on_hand_uom = coalesce(on_hand_uom, base_uom, recipe_uom, 'unit')
     where id = selected_item.id;

    if previous_cost is distinct from next_cost then
      perform public.cascade_recipe_costs_for_inventory_item(
        selected_item.id,
        'purchase_receipt_three_level_cost_cascade',
        'purchase_order_lines',
        purchase_line.id,
        previous_cost,
        next_cost
      );
    end if;

    for sibling_item in
      select sibling.*
      from public.inventory_items sibling
      where sibling.organization_id = current_organization_id
        and sibling.id is distinct from selected_item.id
        and sibling.is_active = true
        and sibling.cost_type::text = 'purchased'
        and (
          (
            selected_item.origin_inventory_item_id is not null
            and sibling.origin_inventory_item_id is not distinct from selected_item.origin_inventory_item_id
          )
          or (
            selected_item.origin_inventory_item_id is null
            and sibling.origin_inventory_item_id is not distinct from selected_item.id
          )
          or (
            nullif(trim(coalesce(selected_item.sku, '')), '') is not null
            and public.normalize_master_data_key(sibling.sku)
                = public.normalize_master_data_key(selected_item.sku)
          )
        )
      for update
    loop
      sibling_previous_cost := coalesce(sibling_item.current_cost_per_base_uom, 0);

      if sibling_previous_cost is distinct from next_cost then
        update public.inventory_items
           set current_cost_per_base_uom = next_cost,
               yield_pct = least(greatest(coalesce(yield_pct, 1), 0.0001), 1),
               on_hand_uom = coalesce(on_hand_uom, base_uom, recipe_uom, 'unit'),
               origin_inventory_item_id = coalesce(
                 origin_inventory_item_id,
                 selected_item.origin_inventory_item_id,
                 selected_item.id
               )
         where id = sibling_item.id
           and organization_id = current_organization_id;

        perform public.cascade_recipe_costs_for_inventory_item(
          sibling_item.id,
          'purchase_receipt_storage_cost_sync',
          'purchase_order_lines',
          purchase_line.id,
          sibling_previous_cost,
          next_cost
        );
      end if;
    end loop;

    update public.purchase_order_lines
       set received_qty = received_qty + received_value
     where id = purchase_line.id;
  end loop;

  if not exists (
    select 1
    from jsonb_array_elements(received_lines) line
    where coalesce((line->>'received_qty')::numeric, 0) > 0
  ) then
    raise exception 'At least one received quantity must be greater than zero.';
  end if;

  select not exists (
    select 1
    from public.purchase_order_lines pol
    where pol.purchase_order_id = selected_order.id
      and pol.received_qty < pol.qty
  ) into is_complete;

  if not is_complete and nullif(trim(coalesce(short_supply_reason_value, '')), '') is null then
    raise exception 'Enter a reason for the partial delivery.';
  end if;

  generated_grn := public.next_organization_document_number(
    current_organization_id,
    'goods_received_note'
  );

  insert into public.purchase_order_receipts (
    organization_id,
    purchase_order_id,
    grn_number,
    receipt_status,
    short_supply_reason,
    received_by
  ) values (
    current_organization_id,
    selected_order.id,
    generated_grn,
    case when is_complete then 'complete' else 'partial' end,
    nullif(trim(coalesce(short_supply_reason_value, '')), ''),
    current_user_id
  )
  returning * into receipt_record;

  insert into public.purchase_order_receipt_lines (
    receipt_id,
    purchase_order_line_id,
    inventory_item_id,
    received_qty,
    unit_cost
  )
  select
    receipt_record.id,
    pol.id,
    pol.inventory_item_id,
    (line->>'received_qty')::numeric,
    pol.landed_unit_cost
  from jsonb_array_elements(received_lines) line
  join public.purchase_order_lines pol
    on pol.id = nullif(line->>'purchase_order_line_id', '')::uuid
   and pol.purchase_order_id = selected_order.id
  where coalesce((line->>'received_qty')::numeric, 0) > 0;

  update public.purchase_orders
     set status = case
           when is_complete then 'completed'::public.transaction_status
           else 'accepted'::public.transaction_status
         end,
         receipt_status = case when is_complete then 'completed' else 'partially_received' end,
         short_supply_reason = case
           when is_complete then null
           else nullif(trim(coalesce(short_supply_reason_value, '')), '')
         end,
         accepted_by = current_user_id,
         accepted_at = now()
   where id = selected_order.id;

  if is_complete then
    select po.grn_number
      into generated_grn
    from public.purchase_orders po
    where po.id = selected_order.id;

    update public.purchase_order_receipts
       set grn_number = generated_grn
     where id = receipt_record.id
     returning * into receipt_record;
  end if;

  if is_complete then
    update public.purchase_order_alerts
       set status = 'resolved', resolved_at = now()
     where purchase_order_id = selected_order.id
       and status = 'open';
  else
    insert into public.purchase_order_alerts (
      organization_id, purchase_order_id, detail
    ) values (
      current_organization_id,
      selected_order.id,
      selected_order.po_number || ' was partially delivered: '
        || trim(short_supply_reason_value)
    )
    on conflict do nothing;
  end if;

  return receipt_record;
end;
$$;

grant execute on function public.receive_dashboard_purchase_order_quantities(uuid, jsonb, text)
  to authenticated;

notify pgrst, 'reload schema';
