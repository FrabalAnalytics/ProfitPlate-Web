-- Establish an authoritative, auditable operating-day close control.
-- Existing operation registers remain the source checklist; this layer governs
-- when their operating date may be closed, locked, or reopened.

alter table if exists public.organizations
  add column if not exists operating_timezone text not null default 'Africa/Lagos',
  add column if not exists business_day_cutoff_time time not null default '04:00',
  add column if not exists expected_close_time time not null default '23:59',
  add column if not exists close_grace_minutes integer not null default 60;

alter table if exists public.organizations
  drop constraint if exists organizations_close_grace_minutes_check;

alter table if exists public.organizations
  add constraint organizations_close_grace_minutes_check
  check (close_grace_minutes between 0 and 720);

create table if not exists public.operating_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operating_date date not null,
  status text not null default 'open',
  blockers jsonb not null default '[]'::jsonb,
  close_note text,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  locked_by uuid references auth.users(id) on delete set null,
  locked_at timestamptz,
  reopened_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operating_days_status_check
    check (status in ('open', 'closing_review', 'closed', 'locked')),
  constraint operating_days_org_date_unique
    unique (organization_id, operating_date)
);

create table if not exists public.operating_day_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operating_day_id uuid not null references public.operating_days(id) on delete cascade,
  operating_date date not null,
  event_type text not null,
  previous_status text,
  next_status text not null,
  reason text,
  blockers jsonb not null default '[]'::jsonb,
  performed_by uuid references auth.users(id) on delete set null default auth.uid(),
  performed_at timestamptz not null default now(),
  constraint operating_day_audit_event_type_check
    check (event_type in ('reviewed', 'closed', 'locked', 'reopened'))
);

drop trigger if exists set_operating_days_updated_at on public.operating_days;
create trigger set_operating_days_updated_at
before update on public.operating_days
for each row execute function public.set_updated_at();

create index if not exists idx_operating_days_org_date
  on public.operating_days(organization_id, operating_date desc);

create index if not exists idx_operating_day_audit_org_date
  on public.operating_day_audit_events(organization_id, operating_date desc, performed_at desc);

alter table public.operating_days enable row level security;
alter table public.operating_day_audit_events enable row level security;

drop policy if exists "operating_days_member_select" on public.operating_days;
create policy "operating_days_member_select"
on public.operating_days
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "operating_day_audit_member_select"
  on public.operating_day_audit_events;
create policy "operating_day_audit_member_select"
on public.operating_day_audit_events
for select
to authenticated
using (public.user_can_access_organization(organization_id));

create or replace function public.get_dashboard_day_close_blockers(
  target_organization_id uuid,
  target_operating_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  required_register record;
  register_entry public.operation_register_entries;
  blocker_list jsonb := '[]'::jsonb;
  unresolved_transfer_count integer := 0;
begin
  if not public.user_can_access_organization(target_organization_id) then
    raise exception 'You do not have access to this workspace.';
  end if;

  for required_register in
    select *
    from (
      values
        ('opening_readiness', 'Opening readiness', 'Operations'),
        ('sales_register', 'Sales register', 'Finance'),
        ('procurement_register', 'Procurement register', 'Procurement'),
        ('purchase_order_register', 'Open / pending PO review', 'Inventory'),
        ('requisition_register', 'Requisition register', 'Operations'),
        ('production_register', 'Production register', 'Kitchen'),
        ('waste_register', 'Waste register', 'Operations'),
        ('stock_count_register', 'Stock count register', 'Inventory')
    ) as required(register_key, label, department)
  loop
    select *
      into register_entry
    from public.operation_register_entries ore
    where ore.organization_id = target_organization_id
      and ore.operating_date = target_operating_date
      and ore.register_key = required_register.register_key;

    if register_entry.id is null then
      blocker_list := blocker_list || jsonb_build_array(
        jsonb_build_object(
          'type', 'missing_register',
          'key', required_register.register_key,
          'label', required_register.label,
          'department', required_register.department,
          'message', required_register.label || ' has not been declared.'
        )
      );
    elsif register_entry.status = 'exception' then
      blocker_list := blocker_list || jsonb_build_array(
        jsonb_build_object(
          'type', 'register_exception',
          'key', required_register.register_key,
          'label', required_register.label,
          'department', required_register.department,
          'message', coalesce(register_entry.notes, required_register.label || ' has an unresolved exception.')
        )
      );
    end if;

    register_entry := null::public.operation_register_entries;
  end loop;

  select count(*)
    into unresolved_transfer_count
  from public.approval_requests ar
  where ar.organization_id = target_organization_id
    and ar.request_type = 'inventory_requisition'
    and ar.status = 'accepted'
    and coalesce((ar.payload->>'awaiting_receipt')::boolean, false) is true
    and coalesce(
      nullif(ar.payload->>'issued_at', '')::timestamptz::date,
      ar.created_at::date
    ) <= target_operating_date;

  if unresolved_transfer_count > 0 then
    blocker_list := blocker_list || jsonb_build_array(
      jsonb_build_object(
        'type', 'requisition_in_transit',
        'key', 'requisition_receipt',
        'label', 'Requisitions awaiting receipt',
        'department', 'Operations',
        'count', unresolved_transfer_count,
        'message', unresolved_transfer_count::text
          || case when unresolved_transfer_count = 1 then ' requisition is' else ' requisitions are' end
          || ' still in transit and must be received or escalated.'
      )
    );
  end if;

  return blocker_list;
end;
$$;

grant execute on function public.get_dashboard_day_close_blockers(uuid, date)
  to authenticated;

create or replace function public.review_dashboard_operating_day(
  target_organization_id uuid,
  target_operating_date date
)
returns public.operating_days
language plpgsql
security definer
set search_path = public
as $$
declare
  blocker_list jsonb;
  saved_day public.operating_days;
  previous_status text;
begin
  perform public.require_dashboard_permission(target_organization_id, 'operations');
  blocker_list := public.get_dashboard_day_close_blockers(
    target_organization_id,
    coalesce(target_operating_date, current_date)
  );

  select status into previous_status
  from public.operating_days
  where organization_id = target_organization_id
    and operating_date = coalesce(target_operating_date, current_date);

  insert into public.operating_days (
    organization_id,
    operating_date,
    status,
    blockers
  ) values (
    target_organization_id,
    coalesce(target_operating_date, current_date),
    'closing_review',
    blocker_list
  )
  on conflict (organization_id, operating_date)
  do update set
    status = case
      when public.operating_days.status in ('closed', 'locked')
        then public.operating_days.status
      else 'closing_review'
    end,
    blockers = excluded.blockers
  returning * into saved_day;

  insert into public.operating_day_audit_events (
    organization_id,
    operating_day_id,
    operating_date,
    event_type,
    previous_status,
    next_status,
    blockers
  ) values (
    target_organization_id,
    saved_day.id,
    saved_day.operating_date,
    'reviewed',
    coalesce(previous_status, 'open'),
    saved_day.status,
    blocker_list
  );

  return saved_day;
end;
$$;

grant execute on function public.review_dashboard_operating_day(uuid, date)
  to authenticated;

create or replace function public.close_dashboard_operating_day(
  target_organization_id uuid,
  target_operating_date date,
  close_note_value text default null
)
returns public.operating_days
language plpgsql
security definer
set search_path = public
as $$
declare
  blocker_list jsonb;
  saved_day public.operating_days;
  current_user_id uuid := auth.uid();
  previous_status text;
begin
  perform public.require_dashboard_permission(target_organization_id, 'approval');
  blocker_list := public.get_dashboard_day_close_blockers(
    target_organization_id,
    coalesce(target_operating_date, current_date)
  );

  if jsonb_array_length(blocker_list) > 0 then
    raise exception 'Day close blocked: % control item(s) require action.',
      jsonb_array_length(blocker_list);
  end if;

  select status into previous_status
  from public.operating_days
  where organization_id = target_organization_id
    and operating_date = coalesce(target_operating_date, current_date);

  if previous_status = 'locked' then
    raise exception 'This operating day is locked and cannot be closed again.';
  end if;

  insert into public.operating_days (
    organization_id,
    operating_date,
    status,
    blockers,
    close_note,
    closed_by,
    closed_at
  ) values (
    target_organization_id,
    coalesce(target_operating_date, current_date),
    'closed',
    '[]'::jsonb,
    nullif(trim(coalesce(close_note_value, '')), ''),
    current_user_id,
    now()
  )
  on conflict (organization_id, operating_date)
  do update set
    status = 'closed',
    blockers = '[]'::jsonb,
    close_note = excluded.close_note,
    closed_by = current_user_id,
    closed_at = now()
  returning * into saved_day;

  insert into public.operation_register_entries (
    organization_id,
    operating_date,
    register_key,
    department,
    status,
    activity_state,
    notes,
    submitted_by,
    submitted_at
  ) values (
    target_organization_id,
    saved_day.operating_date,
    'closing_readiness',
    'Operations',
    'completed',
    'reviewed',
    coalesce(nullif(trim(coalesce(close_note_value, '')), ''), 'Operating day closed after all blocking controls passed.'),
    current_user_id,
    now()
  )
  on conflict (organization_id, operating_date, register_key)
  do update set
    status = 'completed',
    activity_state = 'reviewed',
    notes = excluded.notes,
    submitted_by = current_user_id,
    submitted_at = now();

  insert into public.operating_day_audit_events (
    organization_id,
    operating_day_id,
    operating_date,
    event_type,
    previous_status,
    next_status,
    reason
  ) values (
    target_organization_id,
    saved_day.id,
    saved_day.operating_date,
    'closed',
    coalesce(previous_status, 'open'),
    'closed',
    saved_day.close_note
  );

  return saved_day;
end;
$$;

grant execute on function public.close_dashboard_operating_day(uuid, date, text)
  to authenticated;

create or replace function public.reopen_dashboard_operating_day(
  target_organization_id uuid,
  target_operating_date date,
  reopen_reason_value text
)
returns public.operating_days
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_day public.operating_days;
  previous_status text;
  clean_reason text := nullif(trim(coalesce(reopen_reason_value, '')), '');
begin
  perform public.require_dashboard_permission(target_organization_id, 'approval');

  if clean_reason is null then
    raise exception 'A reason is required to reopen an operating day.';
  end if;

  select status
    into previous_status
  from public.operating_days
  where organization_id = target_organization_id
    and operating_date = coalesce(target_operating_date, current_date)
  for update;

  if previous_status is null then
    raise exception 'This operating day has not been closed.';
  end if;

  if previous_status = 'locked' then
    raise exception 'A locked operating day cannot be reopened.';
  end if;

  if previous_status <> 'closed' then
    raise exception 'Only a closed operating day can be reopened.';
  end if;

  update public.operating_days
     set status = 'open',
         blockers = public.get_dashboard_day_close_blockers(
           target_organization_id,
           coalesce(target_operating_date, current_date)
         ),
         reopened_by = auth.uid(),
         reopened_at = now(),
         reopen_reason = clean_reason
   where organization_id = target_organization_id
     and operating_date = coalesce(target_operating_date, current_date)
  returning * into saved_day;

  update public.operation_register_entries
     set status = 'exception',
         activity_state = 'exception',
         notes = 'Day reopened: ' || clean_reason,
         submitted_by = auth.uid(),
         submitted_at = now()
   where organization_id = target_organization_id
     and operating_date = saved_day.operating_date
     and register_key = 'closing_readiness';

  insert into public.operating_day_audit_events (
    organization_id,
    operating_day_id,
    operating_date,
    event_type,
    previous_status,
    next_status,
    reason,
    blockers
  ) values (
    target_organization_id,
    saved_day.id,
    saved_day.operating_date,
    'reopened',
    previous_status,
    'open',
    clean_reason,
    saved_day.blockers
  );

  return saved_day;
end;
$$;

grant execute on function public.reopen_dashboard_operating_day(uuid, date, text)
  to authenticated;

notify pgrst, 'reload schema';
