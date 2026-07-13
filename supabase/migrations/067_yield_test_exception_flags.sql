-- Flag every yield test that performs below the current master yield and
-- include cascade impact detail in the master-yield update notification.

alter table if exists public.yield_test_entries
  add column if not exists master_yield_pct_at_test numeric(8, 4),
  add column if not exists yield_delta_pct numeric(8, 4),
  add column if not exists is_below_master boolean not null default false;

alter table if exists public.yield_test_entries
  drop constraint if exists yield_test_entries_master_yield_at_test_check;

alter table if exists public.yield_test_entries
  add constraint yield_test_entries_master_yield_at_test_check check (
    master_yield_pct_at_test is null
    or (master_yield_pct_at_test > 0 and master_yield_pct_at_test <= 1)
  );

create index if not exists idx_yield_test_entries_org_below_master
  on public.yield_test_entries(organization_id, is_below_master, test_date desc, submitted_at desc)
  where is_below_master = true;

alter table if exists public.yield_test_notifications
  drop constraint if exists yield_test_notifications_type_check;

alter table if exists public.yield_test_notifications
  add constraint yield_test_notifications_type_check check (
    notification_type in (
      'overdue_yield_test',
      'yield_master_updated',
      'yield_below_master'
    )
  );

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
  cascade_run public.cost_cascade_runs;
  latest_test_count integer := 0;
  latest_average numeric(8, 4);
  clean_starting_weight numeric(18, 6);
  clean_usable_weight numeric(18, 6);
  measured_yield numeric(8, 4);
  master_yield_at_test numeric(8, 4);
  yield_delta numeric(8, 4);
  below_master boolean := false;
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
  master_yield_at_test := least(greatest(coalesce(selected_item.yield_pct, 1), 0.0001), 1);
  yield_delta := measured_yield - master_yield_at_test;
  below_master := measured_yield < master_yield_at_test;

  insert into public.yield_test_entries (
    organization_id,
    inventory_item_id,
    test_date,
    starting_weight,
    usable_weight,
    trim_waste_weight,
    measured_yield_pct,
    master_yield_pct_at_test,
    yield_delta_pct,
    is_below_master,
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
    master_yield_at_test,
    yield_delta,
    below_master,
    nullif(trim(coalesce(notes_value, '')), ''),
    current_user_id,
    now()
  )
  returning * into saved_entry;

  if below_master then
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
      'yield_below_master',
      'Yield below master',
      coalesce(selected_item.name, selected_item.sku, 'High-value SKU')
        || ' tested at '
        || round(measured_yield * 100, 2)::text
        || '%, below the current master yield of '
        || round(master_yield_at_test * 100, 2)::text
        || '% by '
        || round(abs(yield_delta) * 100, 2)::text
        || ' percentage point(s).',
      array['management', 'head_of_kitchen', 'inventory_manager', 'kitchen_manager']
    );
  end if;

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

  select *
    into cascade_run
  from public.cascade_recipe_costs_for_inventory_item(
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
      || ' master yield moved from '
      || round(master_yield_at_test * 100, 2)::text
      || '% to '
      || round(coalesce(latest_average, measured_yield) * 100, 2)::text
      || '% using the rolling average of the latest '
      || least(latest_test_count, 3)::text
      || ' yield test(s). Impact: '
      || coalesce(cascade_run.impacted_recipe_count, 0)::text
      || ' recipe(s), '
      || coalesce(cascade_run.impacted_inventory_item_count, 0)::text
      || ' inventory SKU(s), declared impact '
      || round(coalesce(cascade_run.total_declared_impact, 0), 2)::text
      || '.',
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

notify pgrst, 'reload schema';
