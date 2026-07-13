-- Tighten yield-aware costing, dynamic yield updates, waste classification,
-- and purchase-price ripple reporting across raw SKUs, prep/sub-recipes, and
-- final menu items.

create table if not exists public.cost_cascade_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  trigger_source text not null,
  source_table text,
  source_id uuid,
  root_inventory_item_id uuid references public.inventory_items(id) on delete set null,
  previous_unit_cost numeric(18, 6) not null default 0,
  new_unit_cost numeric(18, 6) not null default 0,
  unit_cost_delta numeric(18, 6) generated always as (new_unit_cost - previous_unit_cost) stored,
  raw_material_impact numeric(18, 6) not null default 0,
  sub_recipe_impact numeric(18, 6) not null default 0,
  final_menu_impact numeric(18, 6) not null default 0,
  total_declared_impact numeric(18, 6) not null default 0,
  impacted_recipe_count integer not null default 0,
  impacted_inventory_item_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.cost_cascade_run_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.cost_cascade_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cascade_level integer not null check (cascade_level between 1 and 3),
  entity_type text not null check (entity_type in ('raw_material', 'sub_recipe', 'final_menu_item', 'linked_inventory_item')),
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  recipe_id uuid references public.recipes(id) on delete set null,
  previous_cost numeric(18, 6) not null default 0,
  new_cost numeric(18, 6) not null default 0,
  unit_delta numeric(18, 6) generated always as (new_cost - previous_cost) stored,
  on_hand_qty numeric(18, 6) not null default 0,
  declared_impact numeric(18, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_cost_cascade_runs_org_created
  on public.cost_cascade_runs(organization_id, created_at desc);

create index if not exists idx_cost_cascade_run_lines_run
  on public.cost_cascade_run_lines(run_id, cascade_level, entity_type);

alter table public.cost_cascade_runs enable row level security;
alter table public.cost_cascade_run_lines enable row level security;

drop policy if exists "cost_cascade_runs_member_select"
  on public.cost_cascade_runs;
create policy "cost_cascade_runs_member_select"
on public.cost_cascade_runs
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "cost_cascade_run_lines_member_select"
  on public.cost_cascade_run_lines;
create policy "cost_cascade_run_lines_member_select"
on public.cost_cascade_run_lines
for select
to authenticated
using (public.user_can_access_organization(organization_id));

create or replace function public.normalize_waste_reason(reason_value text)
returns text
language sql
immutable
as $$
  select lower(
    regexp_replace(
      trim(coalesce(reason_value, '')),
      '[^a-zA-Z0-9]+',
      '_',
      'g'
    )
  );
$$;

create or replace function public.calculate_recipe_unit_cost(
  target_recipe_id uuid
)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    sum(
      case
        when component.component_inventory_item_id is not null then
          (
            component.qty_in_recipe_uom
            / greatest(coalesce(item.yield_pct, 1), 0.0001)
          ) * coalesce(item.current_cost_per_base_uom, 0)
        else
          component.qty_in_recipe_uom
          * coalesce(component_recipe.resolved_unit_cost, 0)
      end
    )
    / nullif(
        recipe.standard_batch_output_qty
        * greatest(coalesce(recipe.standard_yield_pct, 1), 0.0001),
        0
      ),
    0
  )
  from public.recipes recipe
  left join public.recipe_components component
    on component.recipe_id = recipe.id
   and component.organization_id = recipe.organization_id
  left join public.inventory_items item
    on item.id = component.component_inventory_item_id
  left join public.recipes component_recipe
    on component_recipe.id = component.component_recipe_id
  where recipe.id = target_recipe_id
    and public.user_can_access_organization(recipe.organization_id)
  group by recipe.id, recipe.standard_batch_output_qty, recipe.standard_yield_pct;
$$;

create or replace function public.cascade_recipe_costs_for_inventory_item(
  target_inventory_item_id uuid,
  trigger_source_value text default 'cost_cascade',
  source_table_value text default null,
  source_id_value uuid default null,
  previous_unit_cost_value numeric default null,
  new_unit_cost_value numeric default null
)
returns public.cost_cascade_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_item public.inventory_items;
  cascade_run public.cost_cascade_runs;
  affected_recipe record;
  affected_linked_item record;
  recalculated_cost numeric(18, 6);
  current_level integer;
  raw_impact numeric(18, 6) := 0;
  sub_impact numeric(18, 6) := 0;
  final_impact numeric(18, 6) := 0;
  recipe_count integer := 0;
  linked_item_count integer := 0;
  previous_recipe_ids uuid[] := array[]::uuid[];
  current_recipe_ids uuid[] := array[]::uuid[];
  next_recipe_ids uuid[] := array[]::uuid[];
  normalized_trigger text := coalesce(nullif(trim(trigger_source_value), ''), 'cost_cascade');
begin
  select *
    into selected_item
  from public.inventory_items item
  where item.id = target_inventory_item_id
    and item.is_active = true;

  if selected_item.id is null then
    raise exception 'Inventory item not found for cost cascade.';
  end if;

  if not public.user_can_access_organization(selected_item.organization_id) then
    raise exception 'You do not have access to this workspace cost cascade.';
  end if;

  raw_impact :=
    (coalesce(new_unit_cost_value, selected_item.current_cost_per_base_uom, 0)
      - coalesce(previous_unit_cost_value, selected_item.current_cost_per_base_uom, 0))
    * coalesce(selected_item.on_hand_qty, 0);

  insert into public.cost_cascade_runs (
    organization_id,
    trigger_source,
    source_table,
    source_id,
    root_inventory_item_id,
    previous_unit_cost,
    new_unit_cost,
    raw_material_impact
  ) values (
    selected_item.organization_id,
    normalized_trigger,
    nullif(trim(coalesce(source_table_value, '')), ''),
    source_id_value,
    selected_item.id,
    coalesce(previous_unit_cost_value, selected_item.current_cost_per_base_uom, 0),
    coalesce(new_unit_cost_value, selected_item.current_cost_per_base_uom, 0),
    raw_impact
  )
  returning * into cascade_run;

  insert into public.cost_cascade_run_lines (
    run_id,
    organization_id,
    cascade_level,
    entity_type,
    inventory_item_id,
    previous_cost,
    new_cost,
    on_hand_qty,
    declared_impact
  ) values (
    cascade_run.id,
    selected_item.organization_id,
    1,
    'raw_material',
    selected_item.id,
    coalesce(previous_unit_cost_value, selected_item.current_cost_per_base_uom, 0),
    coalesce(new_unit_cost_value, selected_item.current_cost_per_base_uom, 0),
    coalesce(selected_item.on_hand_qty, 0),
    raw_impact
  );

  select coalesce(array_agg(distinct component.recipe_id), array[]::uuid[])
    into current_recipe_ids
  from public.recipe_components component
  join public.recipes recipe
    on recipe.id = component.recipe_id
  where component.organization_id = selected_item.organization_id
    and component.component_inventory_item_id = selected_item.id
    and recipe.is_active = true;

  for current_level in 2..3 loop
    next_recipe_ids := array[]::uuid[];

    for affected_recipe in
      select distinct recipe.id, recipe.recipe_type::text as recipe_type, recipe.resolved_unit_cost
      from public.recipes recipe
      where recipe.organization_id = selected_item.organization_id
        and recipe.id = any(current_recipe_ids)
        and recipe.is_active = true
      order by recipe.recipe_type::text desc, recipe.id
    loop
      recalculated_cost := public.calculate_recipe_unit_cost(affected_recipe.id);

      if coalesce(affected_recipe.resolved_unit_cost, 0)
         is distinct from coalesce(recalculated_cost, 0) then
        perform public.set_recipe_cost_from_engine(
          affected_recipe.id,
          coalesce(recalculated_cost, 0),
          normalized_trigger
        );

        insert into public.cost_cascade_run_lines (
          run_id,
          organization_id,
          cascade_level,
          entity_type,
          recipe_id,
          previous_cost,
          new_cost,
          declared_impact
        ) values (
          cascade_run.id,
          selected_item.organization_id,
          case
            when affected_recipe.recipe_type in ('final_menu_item', 'final_dish')
              then 3
            else 2
          end,
          case
            when affected_recipe.recipe_type in ('final_menu_item', 'final_dish')
              then 'final_menu_item'
            else 'sub_recipe'
          end,
          affected_recipe.id,
          coalesce(affected_recipe.resolved_unit_cost, 0),
          coalesce(recalculated_cost, 0),
          coalesce(recalculated_cost, 0) - coalesce(affected_recipe.resolved_unit_cost, 0)
        );

        recipe_count := recipe_count + 1;

        if affected_recipe.recipe_type in ('final_menu_item', 'final_dish') then
          final_impact := final_impact
            + (coalesce(recalculated_cost, 0) - coalesce(affected_recipe.resolved_unit_cost, 0));
        else
          sub_impact := sub_impact
            + (coalesce(recalculated_cost, 0) - coalesce(affected_recipe.resolved_unit_cost, 0));
        end if;

        for affected_linked_item in
          select item.id, item.current_cost_per_base_uom, item.on_hand_qty
          from public.inventory_items item
          where item.organization_id = selected_item.organization_id
            and item.recipe_id = affected_recipe.id
            and item.is_active = true
        loop
          if coalesce(affected_linked_item.current_cost_per_base_uom, 0)
             is distinct from coalesce(recalculated_cost, 0) then
            update public.inventory_items
               set current_cost_per_base_uom = coalesce(recalculated_cost, 0)
             where id = affected_linked_item.id;

            insert into public.cost_cascade_run_lines (
              run_id,
              organization_id,
              cascade_level,
              entity_type,
              inventory_item_id,
              recipe_id,
              previous_cost,
              new_cost,
              on_hand_qty,
              declared_impact
            ) values (
              cascade_run.id,
              selected_item.organization_id,
              case
                when affected_recipe.recipe_type in ('final_menu_item', 'final_dish')
                  then 3
                else 2
              end,
              'linked_inventory_item',
              affected_linked_item.id,
              affected_recipe.id,
              coalesce(affected_linked_item.current_cost_per_base_uom, 0),
              coalesce(recalculated_cost, 0),
              coalesce(affected_linked_item.on_hand_qty, 0),
              (coalesce(recalculated_cost, 0) - coalesce(affected_linked_item.current_cost_per_base_uom, 0))
                * coalesce(affected_linked_item.on_hand_qty, 0)
            );

            linked_item_count := linked_item_count + 1;
          end if;
        end loop;
      end if;
    end loop;

    previous_recipe_ids := previous_recipe_ids || current_recipe_ids;

    select coalesce(array_agg(distinct component.recipe_id), array[]::uuid[])
      into next_recipe_ids
    from public.recipe_components component
    join public.recipes recipe
      on recipe.id = component.recipe_id
    where component.organization_id = selected_item.organization_id
      and (
        component.component_recipe_id = any(current_recipe_ids)
        or component.component_inventory_item_id in (
          select linked_item.id
          from public.inventory_items linked_item
          where linked_item.organization_id = selected_item.organization_id
            and linked_item.recipe_id = any(current_recipe_ids)
            and linked_item.is_active = true
        )
      )
      and not (component.recipe_id = any(previous_recipe_ids))
      and recipe.is_active = true;

    current_recipe_ids := next_recipe_ids;
    exit when array_length(current_recipe_ids, 1) is null;
  end loop;

  update public.cost_cascade_runs
     set sub_recipe_impact = sub_impact,
         final_menu_impact = final_impact,
         total_declared_impact = raw_impact + sub_impact + final_impact,
         impacted_recipe_count = recipe_count,
         impacted_inventory_item_count = linked_item_count + 1,
         summary = jsonb_build_object(
           'level_1_raw_material_impact', raw_impact,
           'level_2_sub_recipe_unit_delta', sub_impact,
           'level_3_final_menu_unit_delta', final_impact,
           'total_declared_impact', raw_impact + sub_impact + final_impact,
           'impacted_recipe_count', recipe_count,
           'impacted_inventory_item_count', linked_item_count + 1
         )
   where id = cascade_run.id
   returning * into cascade_run;

  return cascade_run;
end;
$$;

grant execute on function public.calculate_recipe_unit_cost(uuid)
  to authenticated;

grant execute on function public.cascade_recipe_costs_for_inventory_item(
  uuid,
  text,
  text,
  uuid,
  numeric,
  numeric
) to authenticated;

create or replace function public.create_dashboard_waste_event(
  target_inventory_item_id uuid,
  waste_quantity numeric,
  waste_reason_value text default 'spoilage',
  waste_stage_value text default 'prep',
  waste_notes_value text default null
)
returns public.waste_events
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  selected_item public.inventory_items;
  created_waste_event public.waste_events;
  has_legacy_item_id boolean;
  has_legacy_tenant_id boolean;
  normalized_reason text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to record waste.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before recording waste.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  if waste_quantity is null or waste_quantity <= 0 then
    raise exception 'Waste quantity must be greater than zero.';
  end if;

  select *
    into selected_item
  from public.inventory_items
  where id = target_inventory_item_id
    and organization_id = current_organization_id
    and is_active = true;

  if selected_item.id is null then
    raise exception 'Inventory item not found for this workspace.';
  end if;

  normalized_reason := public.normalize_waste_reason(waste_reason_value);

  if coalesce(selected_item.yield_pct, 1) < 1
     and normalized_reason in (
       'prep_waste',
       'prep',
       'trim_waste',
       'trimming',
       'over_trimming',
       'processing_loss',
       'yield_loss'
     ) then
    raise exception 'Prep Waste is blocked for % because its inherent yield is already %. Select Spoilage, Damaged, Expired, or another true waste reason.',
      coalesce(selected_item.name, selected_item.sku, 'this SKU'),
      round(coalesce(selected_item.yield_pct, 1) * 100, 2)::text || '%';
  end if;

  insert into public.waste_events (
    organization_id,
    inventory_item_id,
    quantity,
    unit_cost,
    waste_reason,
    waste_stage,
    notes,
    created_by
  ) values (
    current_organization_id,
    selected_item.id,
    waste_quantity,
    coalesce(selected_item.current_cost_per_base_uom, 0),
    coalesce(nullif(trim(waste_reason_value), ''), 'spoilage'),
    coalesce(nullif(trim(waste_stage_value), ''), 'prep'),
    nullif(trim(coalesce(waste_notes_value, '')), ''),
    current_user_id
  )
  returning * into created_waste_event;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transformation_events'
      and column_name = 'item_id'
  )
    into has_legacy_item_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transformation_events'
      and column_name = 'tenant_id'
  )
    into has_legacy_tenant_id;

  if has_legacy_item_id and has_legacy_tenant_id then
    execute '
      insert into public.transformation_events (
        organization_id, tenant_id, location_id, event_type, inventory_item_id,
        item_id, quantity_delta, unit_cost, source_table, source_id, created_by
      ) values ($1, $1, $2, ''waste_event'', $3, $3, $4, $5, ''waste_events'', $6, $7)'
    using
      current_organization_id,
      selected_item.location_id,
      selected_item.id,
      waste_quantity * -1,
      coalesce(selected_item.current_cost_per_base_uom, 0),
      created_waste_event.id,
      current_user_id;
  else
    insert into public.transformation_events (
      organization_id,
      location_id,
      event_type,
      inventory_item_id,
      quantity_delta,
      unit_cost,
      source_table,
      source_id,
      created_by
    ) values (
      current_organization_id,
      selected_item.location_id,
      'waste_event',
      selected_item.id,
      waste_quantity * -1,
      coalesce(selected_item.current_cost_per_base_uom, 0),
      'waste_events',
      created_waste_event.id,
      current_user_id
    );
  end if;

  update public.inventory_items
     set on_hand_qty = greatest(coalesce(on_hand_qty, 0) - waste_quantity, 0)
   where id = selected_item.id
     and organization_id = current_organization_id;

  insert into public.variance_attributions (
    organization_id,
    location_id,
    inventory_item_id,
    variance_type,
    variance_qty,
    unit_cost,
    source_table,
    source_id
  ) values (
    current_organization_id,
    selected_item.location_id,
    selected_item.id,
    'waste_variance',
    waste_quantity,
    coalesce(selected_item.current_cost_per_base_uom, 0),
    'waste_events',
    created_waste_event.id
  );

  return created_waste_event;
end;
$$;

grant execute on function public.create_dashboard_waste_event(uuid, numeric, text, text, text)
  to authenticated;

create or replace function public.submit_dashboard_yield_test(
  target_inventory_item_id uuid,
  starting_weight_value numeric,
  usable_weight_value numeric,
  notes_value text default null,
  test_date_value date default current_date
)
returns public.yield_test_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  selected_item public.inventory_items;
  saved_entry public.yield_test_entries;
  latest_test_count integer := 0;
  latest_average numeric(8, 4);
  clean_starting_weight numeric(18, 6);
  clean_usable_weight numeric(18, 6);
  measured_yield numeric(8, 4);
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to record yield tests.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before recording yield tests.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  select *
    into selected_item
  from public.inventory_items
  where id = target_inventory_item_id
    and organization_id = current_organization_id
    and is_active = true;

  if selected_item.id is null then
    raise exception 'SKU not found for this workspace.';
  end if;

  if selected_item.is_high_value is not true then
    raise exception 'Yield tests are required only for high-value proteins and perishables.';
  end if;

  if selected_item.cost_type::text <> 'purchased' then
    raise exception 'Yield tests apply to purchased proteins and perishables.';
  end if;

  clean_starting_weight := coalesce(starting_weight_value, 0);
  clean_usable_weight := coalesce(usable_weight_value, 0);

  if clean_starting_weight <= 0 then
    raise exception 'Starting weight must be greater than zero.';
  end if;

  if clean_usable_weight <= 0 or clean_usable_weight > clean_starting_weight then
    raise exception 'Usable weight must be greater than zero and cannot exceed starting weight.';
  end if;

  measured_yield := round(clean_usable_weight / clean_starting_weight, 4);

  insert into public.yield_test_entries (
    organization_id,
    inventory_item_id,
    test_date,
    starting_weight,
    usable_weight,
    trim_waste_weight,
    measured_yield_pct,
    notes,
    submitted_by,
    submitted_at
  ) values (
    current_organization_id,
    selected_item.id,
    coalesce(test_date_value, current_date),
    clean_starting_weight,
    clean_usable_weight,
    clean_starting_weight - clean_usable_weight,
    measured_yield,
    nullif(trim(coalesce(notes_value, '')), ''),
    current_user_id,
    now()
  )
  returning * into saved_entry;

  select
    count(*),
    round(avg(measured_yield_pct), 4)
    into latest_test_count, latest_average
  from (
    select yte.measured_yield_pct
    from public.yield_test_entries yte
    where yte.organization_id = current_organization_id
      and yte.inventory_item_id = selected_item.id
    order by yte.test_date desc, yte.submitted_at desc
    limit 3
  ) latest_tests;

  update public.inventory_items
     set yield_pct = coalesce(latest_average, measured_yield)
   where id = selected_item.id
     and organization_id = current_organization_id;

  update public.yield_test_entries
     set three_test_average_yield_pct = latest_average,
         master_yield_updated = true
   where id = saved_entry.id
   returning * into saved_entry;

  perform public.cascade_recipe_costs_for_inventory_item(
    selected_item.id,
    'yield_test_rolling_average_cost_cascade',
    'yield_test_entries',
    saved_entry.id,
    selected_item.current_cost_per_base_uom,
    selected_item.current_cost_per_base_uom
  );

  update public.yield_test_notifications
     set status = 'acknowledged',
         acknowledged_by = current_user_id,
         acknowledged_at = now()
   where organization_id = current_organization_id
     and inventory_item_id = selected_item.id
     and notification_type = 'overdue_yield_test'
     and status = 'open';

  insert into public.yield_test_notifications (
    organization_id,
    inventory_item_id,
    notification_type,
    title,
    detail,
    recipients
  ) values (
    current_organization_id,
    selected_item.id,
    'yield_master_updated',
    'Master yield updated',
    coalesce(selected_item.name, selected_item.sku, 'High-value SKU')
      || ' master yield was updated to '
      || round(coalesce(latest_average, measured_yield) * 100, 2)::text
      || '% using the rolling average of the latest '
      || least(latest_test_count, 3)::text
      || ' yield test(s).',
    array['management', 'head_of_kitchen', 'inventory_manager', 'kitchen_manager']
  );

  return saved_entry;
end;
$$;

grant execute on function public.submit_dashboard_yield_test(
  uuid,
  numeric,
  numeric,
  text,
  date
) to authenticated;

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
  receipt_record public.purchase_order_receipts;
  received_value numeric(18, 6);
  next_on_hand numeric(18, 6);
  previous_cost numeric(18, 6);
  next_cost numeric(18, 6);
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

  if selected_order.created_by = current_user_id then
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
