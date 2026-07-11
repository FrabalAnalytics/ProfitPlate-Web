-- Periodic yield tests keep high-value SKU yield percentages current without making them daily checklist tasks.

create table if not exists public.yield_test_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  test_date date not null default current_date,
  starting_weight numeric(18, 6) not null,
  usable_weight numeric(18, 6) not null,
  trim_waste_weight numeric(18, 6) not null default 0,
  measured_yield_pct numeric(8, 4) not null,
  three_test_average_yield_pct numeric(8, 4),
  master_yield_updated boolean not null default false,
  notes text,
  submitted_by uuid references auth.users(id) on delete set null default auth.uid(),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint yield_test_entries_positive_weight_check check (starting_weight > 0),
  constraint yield_test_entries_usable_weight_check check (
    usable_weight >= 0 and usable_weight <= starting_weight
  ),
  constraint yield_test_entries_measured_yield_check check (
    measured_yield_pct > 0 and measured_yield_pct <= 1
  ),
  constraint yield_test_entries_three_test_average_check check (
    three_test_average_yield_pct is null
    or (three_test_average_yield_pct > 0 and three_test_average_yield_pct <= 1)
  )
);

create table if not exists public.yield_test_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  notification_type text not null,
  title text not null,
  detail text not null,
  recipients text[] not null default '{}'::text[],
  status text not null default 'open',
  triggered_at timestamptz not null default now(),
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint yield_test_notifications_type_check check (
    notification_type in ('overdue_yield_test', 'yield_master_updated')
  ),
  constraint yield_test_notifications_status_check check (
    status in ('open', 'acknowledged')
  )
);

drop trigger if exists set_yield_test_notifications_updated_at
  on public.yield_test_notifications;
create trigger set_yield_test_notifications_updated_at
before update on public.yield_test_notifications
for each row execute function public.set_updated_at();

create index if not exists idx_yield_test_entries_org_item_date
  on public.yield_test_entries(organization_id, inventory_item_id, test_date desc, submitted_at desc);

create index if not exists idx_yield_test_notifications_org_status
  on public.yield_test_notifications(organization_id, status, triggered_at desc);

create unique index if not exists idx_yield_test_notifications_open_overdue
  on public.yield_test_notifications(organization_id, inventory_item_id, notification_type)
  where notification_type = 'overdue_yield_test' and status = 'open';

alter table public.yield_test_entries enable row level security;
alter table public.yield_test_notifications enable row level security;

drop policy if exists "yield_test_entries_member_select"
  on public.yield_test_entries;
create policy "yield_test_entries_member_select"
on public.yield_test_entries
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "yield_test_entries_member_insert"
  on public.yield_test_entries;
create policy "yield_test_entries_member_insert"
on public.yield_test_entries
for insert
to authenticated
with check (public.user_can_record_operations(organization_id));

drop policy if exists "yield_test_notifications_member_select"
  on public.yield_test_notifications;
create policy "yield_test_notifications_member_select"
on public.yield_test_notifications
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "yield_test_notifications_member_insert"
  on public.yield_test_notifications;
create policy "yield_test_notifications_member_insert"
on public.yield_test_notifications
for insert
to authenticated
with check (public.user_can_record_operations(organization_id));

drop policy if exists "yield_test_notifications_member_update"
  on public.yield_test_notifications;
create policy "yield_test_notifications_member_update"
on public.yield_test_notifications
for update
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_record_operations(organization_id));

create or replace function public.refresh_dashboard_yield_test_overdue_notifications(
  target_organization_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  perform public.require_dashboard_permission(target_organization_id, 'operations');

  with overdue_items as (
    select
      ii.id,
      ii.name,
      ii.sku,
      max(yte.test_date) as last_test_date
    from public.inventory_items ii
    left join public.yield_test_entries yte
      on yte.inventory_item_id = ii.id
     and yte.organization_id = ii.organization_id
    where ii.organization_id = target_organization_id
      and ii.is_active = true
      and ii.is_high_value = true
      and ii.cost_type = 'purchased'
    group by ii.id, ii.name, ii.sku
    having max(yte.test_date) is null
        or max(yte.test_date) < current_date - 30
  ),
  inserted_notifications as (
    insert into public.yield_test_notifications (
      organization_id,
      inventory_item_id,
      notification_type,
      title,
      detail,
      recipients
    )
    select
      target_organization_id,
      overdue_items.id,
      'overdue_yield_test',
      'Yield test overdue',
      coalesce(overdue_items.name, overdue_items.sku, 'High-value SKU')
        || ' has not had a yield test in the past 30 days.',
      array['top_management', 'head_of_kitchen']
    from overdue_items
    on conflict do nothing
    returning id
  )
  select count(*) into inserted_count
  from inserted_notifications;

  return inserted_count;
end;
$$;

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
  latest_three_count integer := 0;
  latest_three_average numeric(8, 4);
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
    raise exception 'Yield tests are required only for high-value SKUs.';
  end if;

  if selected_item.cost_type <> 'purchased' then
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
    into latest_three_count, latest_three_average
  from (
    select yte.measured_yield_pct
    from public.yield_test_entries yte
    where yte.organization_id = current_organization_id
      and yte.inventory_item_id = selected_item.id
    order by yte.test_date desc, yte.submitted_at desc
    limit 3
  ) latest_tests;

  if latest_three_count = 3 then
    update public.inventory_items
       set yield_pct = latest_three_average
     where id = selected_item.id
       and organization_id = current_organization_id;

    update public.yield_test_entries
       set three_test_average_yield_pct = latest_three_average,
           master_yield_updated = true
     where id = saved_entry.id
     returning * into saved_entry;

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
        || round(latest_three_average * 100, 2)::text
        || '% after three independent yield tests.',
      array['management', 'head_of_kitchen', 'inventory_manager', 'kitchen_manager']
    );
  end if;

  return saved_entry;
end;
$$;

grant execute on function public.refresh_dashboard_yield_test_overdue_notifications(uuid)
  to authenticated;

grant execute on function public.submit_dashboard_yield_test(
  uuid,
  numeric,
  numeric,
  text,
  date
) to authenticated;
