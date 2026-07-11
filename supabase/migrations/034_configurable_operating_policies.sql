-- Make operating deadlines, close requirements, and POS cadence configurable.
-- This migration is additive and intentionally preserves migration 033 history.

create table if not exists public.operating_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  department text,
  schedule_name text not null default 'Operating schedule',
  timezone text not null default 'Africa/Lagos',
  day_of_week smallint not null,
  opens_at time,
  closes_at time,
  is_closed boolean not null default false,
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operating_schedules_day_check check (day_of_week between 0 and 6),
  constraint operating_schedules_window_check check (
    is_closed or (opens_at is not null and closes_at is not null)
  ),
  constraint operating_schedules_effective_check check (
    effective_to is null or effective_to >= effective_from
  )
);

create table if not exists public.operating_schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  schedule_id uuid not null references public.operating_schedules(id) on delete cascade,
  operating_date date not null,
  opens_at time,
  closes_at time,
  is_closed boolean not null default false,
  reason text not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint operating_schedule_overrides_window_check check (
    is_closed or (opens_at is not null and closes_at is not null)
  ),
  constraint operating_schedule_overrides_unique unique (
    schedule_id,
    operating_date
  )
);

create table if not exists public.operating_control_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  department text,
  control_key text not null,
  control_label text not null,
  source_kind text not null default 'register',
  blocks_operational_close boolean not null default true,
  allows_deferment boolean not null default false,
  allows_waiver boolean not null default false,
  due_anchor text not null default 'operating_close',
  due_offset_minutes integer not null default 0,
  grace_minutes integer not null default 0,
  pause_outside_schedule boolean not null default true,
  escalation_policy jsonb not null default '[]'::jsonb,
  priority integer not null default 100,
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operating_control_source_check check (
    source_kind in ('register', 'requisition_receipt', 'pos_reconciliation')
  ),
  constraint operating_control_anchor_check check (
    due_anchor in (
      'event_time',
      'department_open',
      'department_close',
      'operating_open',
      'operating_close',
      'scheduled_import'
    )
  ),
  constraint operating_control_timing_check check (
    due_offset_minutes between -10080 and 10080
    and grace_minutes between 0 and 10080
  ),
  constraint operating_control_effective_check check (
    effective_to is null or effective_to >= effective_from
  )
);

create table if not exists public.pos_import_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  cadence text not null default 'daily',
  expected_weekdays smallint[] not null default array[1, 2, 3, 4, 5, 6, 0]::smallint[],
  period_end_day smallint,
  due_time time not null default '10:00',
  due_offset_days integer not null default 1,
  timezone text not null default 'Africa/Lagos',
  blocks_operational_close boolean not null default false,
  requires_financial_reconciliation boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_import_policy_cadence_check check (
    cadence in ('continuous', 'daily', 'weekly', 'scheduled_days', 'manual')
  ),
  constraint pos_import_policy_period_day_check check (
    period_end_day is null or period_end_day between 0 and 6
  ),
  constraint pos_import_policy_due_offset_check check (
    due_offset_days between 0 and 31
  ),
  constraint pos_import_policy_effective_check check (
    effective_to is null or effective_to >= effective_from
  )
);

alter table if exists public.operation_register_entries
  add column if not exists control_outcome text,
  add column if not exists control_policy_id uuid
    references public.operating_control_policies(id) on delete set null,
  add column if not exists deferred_until timestamptz,
  add column if not exists decision_reason text,
  add column if not exists decided_by uuid references auth.users(id) on delete set null,
  add column if not exists decided_at timestamptz;

alter table if exists public.operation_register_entries
  drop constraint if exists operation_register_entries_control_outcome_check;

alter table if exists public.operation_register_entries
  add constraint operation_register_entries_control_outcome_check check (
    control_outcome is null
    or control_outcome in (
      'satisfied',
      'deferred',
      'exception',
      'waived',
      'not_applicable'
    )
  );

update public.operation_register_entries
set control_outcome = case
  when status in ('completed', 'clear') then 'satisfied'
  when status = 'exception' then 'exception'
  else control_outcome
end
where control_outcome is null;

create or replace function public.sync_operation_register_control_outcome()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- A fresh department submission supersedes an earlier deferment or waiver.
  -- Policy-decision RPCs do not change submitted_at, so their explicit outcome
  -- is preserved.
  if tg_op = 'INSERT'
    or new.submitted_at is distinct from old.submitted_at
  then
    new.control_outcome := case
      when new.status in ('completed', 'clear') then 'satisfied'
      when new.status = 'exception' then 'exception'
      else new.control_outcome
    end;
    new.control_policy_id := null;
    new.deferred_until := null;
    new.decision_reason := null;
    new.decided_by := null;
    new.decided_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_operation_register_control_outcome
  on public.operation_register_entries;
create trigger sync_operation_register_control_outcome
before insert or update on public.operation_register_entries
for each row execute function public.sync_operation_register_control_outcome();

alter table if exists public.operating_days
  add column if not exists reconciliation_status text not null default 'awaiting_data',
  add column if not exists reconciliation_note text,
  add column if not exists reconciled_by uuid references auth.users(id) on delete set null,
  add column if not exists reconciled_at timestamptz;

alter table if exists public.operating_days
  drop constraint if exists operating_days_reconciliation_status_check;

alter table if exists public.operating_days
  add constraint operating_days_reconciliation_status_check check (
    reconciliation_status in (
      'awaiting_data',
      'provisional',
      'reconciled',
      'exception',
      'not_required'
    )
  );

drop trigger if exists set_operating_schedules_updated_at
  on public.operating_schedules;
create trigger set_operating_schedules_updated_at
before update on public.operating_schedules
for each row execute function public.set_updated_at();

drop trigger if exists set_operating_control_policies_updated_at
  on public.operating_control_policies;
create trigger set_operating_control_policies_updated_at
before update on public.operating_control_policies
for each row execute function public.set_updated_at();

drop trigger if exists set_pos_import_policies_updated_at
  on public.pos_import_policies;
create trigger set_pos_import_policies_updated_at
before update on public.pos_import_policies
for each row execute function public.set_updated_at();

create index if not exists idx_operating_schedules_scope
  on public.operating_schedules(
    organization_id,
    location_id,
    department,
    day_of_week,
    effective_from
  );

create index if not exists idx_operating_control_policies_scope
  on public.operating_control_policies(
    organization_id,
    control_key,
    location_id,
    department,
    effective_from
  );

create index if not exists idx_pos_import_policies_scope
  on public.pos_import_policies(
    organization_id,
    location_id,
    effective_from
  );

alter table public.operating_schedules enable row level security;
alter table public.operating_schedule_overrides enable row level security;
alter table public.operating_control_policies enable row level security;
alter table public.pos_import_policies enable row level security;

drop policy if exists "operating_schedules_member_select"
  on public.operating_schedules;
create policy "operating_schedules_member_select"
on public.operating_schedules
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "operating_schedule_overrides_member_select"
  on public.operating_schedule_overrides;
create policy "operating_schedule_overrides_member_select"
on public.operating_schedule_overrides
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "operating_control_policies_member_select"
  on public.operating_control_policies;
create policy "operating_control_policies_member_select"
on public.operating_control_policies
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "pos_import_policies_member_select"
  on public.pos_import_policies;
create policy "pos_import_policies_member_select"
on public.pos_import_policies
for select
to authenticated
using (public.user_can_access_organization(organization_id));

-- Preserve the controls introduced in migration 033 as editable defaults.
insert into public.operating_control_policies (
  organization_id,
  department,
  control_key,
  control_label,
  source_kind,
  blocks_operational_close,
  allows_deferment,
  allows_waiver,
  priority,
  effective_from
)
select
  organization.id,
  seed.department,
  seed.control_key,
  seed.control_label,
  seed.source_kind,
  true,
  seed.allows_deferment,
  true,
  100,
  current_date
from public.organizations organization
cross join (
  values
    ('Operations', 'opening_readiness', 'Opening readiness', 'register', false),
    ('Finance', 'sales_register', 'Sales register', 'register', true),
    ('Procurement', 'procurement_register', 'Procurement register', 'register', false),
    ('Inventory', 'purchase_order_register', 'Open / pending PO review', 'register', true),
    ('Operations', 'requisition_register', 'Requisition register', 'register', true),
    ('Kitchen', 'production_register', 'Production register', 'register', false),
    ('Operations', 'waste_register', 'Waste register', 'register', false),
    ('Inventory', 'stock_count_register', 'Stock count register', 'register', true),
    ('Operations', 'requisition_receipt', 'Requisitions awaiting receipt', 'requisition_receipt', true)
) as seed(
  department,
  control_key,
  control_label,
  source_kind,
  allows_deferment
)
where not exists (
  select 1
  from public.operating_control_policies existing
  where existing.organization_id = organization.id
    and existing.location_id is null
    and existing.control_key = seed.control_key
    and existing.effective_to is null
);

insert into public.pos_import_policies (
  organization_id,
  cadence,
  expected_weekdays,
  period_end_day,
  due_time,
  due_offset_days,
  timezone,
  blocks_operational_close,
  requires_financial_reconciliation,
  effective_from
)
select
  organization.id,
  'daily',
  array[1, 2, 3, 4, 5, 6, 0]::smallint[],
  null,
  '10:00'::time,
  1,
  organization.operating_timezone,
  false,
  true,
  current_date
from public.organizations organization
where not exists (
  select 1
  from public.pos_import_policies existing
  where existing.organization_id = organization.id
    and existing.location_id is null
    and existing.effective_to is null
);

create or replace function public.is_dashboard_department_active(
  target_organization_id uuid,
  target_location_id uuid,
  target_department text,
  target_moment timestamptz default now()
)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  current_schedule public.operating_schedules;
  previous_schedule public.operating_schedules;
  current_override public.operating_schedule_overrides;
  previous_override public.operating_schedule_overrides;
  selected_timezone text;
  local_moment timestamp;
  local_date date;
  local_time time;
  local_day smallint;
  previous_date date;
  previous_day smallint;
begin
  if not public.user_can_access_organization(target_organization_id) then
    raise exception 'You do not have access to this workspace.';
  end if;

  select coalesce(
    (
      select schedule.timezone
      from public.operating_schedules schedule
      where schedule.organization_id = target_organization_id
        and schedule.is_active
        and (
          schedule.location_id is null
          or schedule.location_id = target_location_id
        )
        and (
          schedule.department is null
          or lower(schedule.department) =
            lower(coalesce(target_department, ''))
        )
      order by
        (schedule.location_id is not null)::integer desc,
        (schedule.department is not null)::integer desc,
        schedule.effective_from desc
      limit 1
    ),
    organization.operating_timezone,
    'Africa/Lagos'
  )
    into selected_timezone
  from public.organizations organization
  where organization.id = target_organization_id;

  local_moment := target_moment at time zone selected_timezone;
  local_date := local_moment::date;
  local_time := local_moment::time;
  local_day := extract(dow from local_date)::smallint;
  previous_date := local_date - 1;
  previous_day := extract(dow from previous_date)::smallint;

  select schedule.*
    into current_schedule
  from public.operating_schedules schedule
  where schedule.organization_id = target_organization_id
    and schedule.is_active
    and schedule.day_of_week = local_day
    and (schedule.location_id is null or schedule.location_id = target_location_id)
    and (
      schedule.department is null
      or lower(schedule.department) = lower(coalesce(target_department, ''))
    )
    and schedule.effective_from <= local_date
    and (schedule.effective_to is null or schedule.effective_to >= local_date)
  order by
    (schedule.location_id is not null)::integer desc,
    (schedule.department is not null)::integer desc,
    schedule.effective_from desc
  limit 1;

  select schedule.*
    into previous_schedule
  from public.operating_schedules schedule
  where schedule.organization_id = target_organization_id
    and schedule.is_active
    and schedule.day_of_week = previous_day
    and (schedule.location_id is null or schedule.location_id = target_location_id)
    and (
      schedule.department is null
      or lower(schedule.department) = lower(coalesce(target_department, ''))
    )
    and schedule.effective_from <= previous_date
    and (schedule.effective_to is null or schedule.effective_to >= previous_date)
  order by
    (schedule.location_id is not null)::integer desc,
    (schedule.department is not null)::integer desc,
    schedule.effective_from desc
  limit 1;

  if current_schedule.id is null and previous_schedule.id is null then
    -- No configured schedule means the timer is not restricted.
    return true;
  end if;

  if current_schedule.id is not null then
    select override.*
      into current_override
    from public.operating_schedule_overrides override
    where override.schedule_id = current_schedule.id
      and override.operating_date = local_date;

    if current_override.id is not null then
      if not current_override.is_closed then
        if current_override.opens_at <= current_override.closes_at
          and local_time >= current_override.opens_at
          and local_time < current_override.closes_at
        then
          return true;
        elsif current_override.opens_at > current_override.closes_at
          and local_time >= current_override.opens_at
        then
          return true;
        end if;
      end if;
    elsif not current_schedule.is_closed then
      if current_schedule.opens_at <= current_schedule.closes_at
        and local_time >= current_schedule.opens_at
        and local_time < current_schedule.closes_at
      then
        return true;
      elsif current_schedule.opens_at > current_schedule.closes_at
        and local_time >= current_schedule.opens_at
      then
        return true;
      end if;
    end if;
  end if;

  if previous_schedule.id is not null then
    select override.*
      into previous_override
    from public.operating_schedule_overrides override
    where override.schedule_id = previous_schedule.id
      and override.operating_date = previous_date;

    if previous_override.id is not null then
      return not previous_override.is_closed
        and previous_override.opens_at > previous_override.closes_at
        and local_time < previous_override.closes_at;
    end if;

    return not previous_schedule.is_closed
      and previous_schedule.opens_at > previous_schedule.closes_at
      and local_time < previous_schedule.closes_at;
  end if;

  return false;
end;
$$;

grant execute on function public.is_dashboard_department_active(
  uuid,
  uuid,
  text,
  timestamptz
) to authenticated;

create or replace function public.configure_dashboard_operating_schedule(
  target_organization_id uuid,
  target_location_id uuid,
  department_value text,
  schedule_name_value text,
  timezone_value text,
  day_of_week_value smallint,
  opens_at_value time,
  closes_at_value time,
  is_closed_value boolean default false
)
returns public.operating_schedules
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_schedule public.operating_schedules;
  clean_department text := nullif(trim(coalesce(department_value, '')), '');
begin
  perform public.require_dashboard_permission(target_organization_id, 'workspace');

  if day_of_week_value not between 0 and 6 then
    raise exception 'Day of week must be between 0 and 6.';
  end if;

  if target_location_id is not null and not exists (
    select 1
    from public.locations location
    where location.id = target_location_id
      and location.organization_id = target_organization_id
  ) then
    raise exception 'The selected location does not belong to this workspace.';
  end if;

  update public.operating_schedules
     set effective_to = current_date,
         is_active = false
   where organization_id = target_organization_id
     and location_id is not distinct from target_location_id
     and department is not distinct from clean_department
     and day_of_week = day_of_week_value
     and is_active
     and effective_to is null;

  insert into public.operating_schedules (
    organization_id,
    location_id,
    department,
    schedule_name,
    timezone,
    day_of_week,
    opens_at,
    closes_at,
    is_closed,
    effective_from
  ) values (
    target_organization_id,
    target_location_id,
    clean_department,
    coalesce(nullif(trim(schedule_name_value), ''), 'Operating schedule'),
    coalesce(nullif(trim(timezone_value), ''), 'Africa/Lagos'),
    day_of_week_value,
    case when coalesce(is_closed_value, false) then null else opens_at_value end,
    case when coalesce(is_closed_value, false) then null else closes_at_value end,
    coalesce(is_closed_value, false),
    current_date
  )
  returning * into saved_schedule;

  return saved_schedule;
end;
$$;

grant execute on function public.configure_dashboard_operating_schedule(
  uuid,
  uuid,
  text,
  text,
  text,
  smallint,
  time,
  time,
  boolean
) to authenticated;

create or replace function public.configure_dashboard_control_policy(
  target_organization_id uuid,
  target_location_id uuid,
  department_value text,
  control_key_value text,
  control_label_value text,
  source_kind_value text,
  blocks_operational_close_value boolean,
  allows_deferment_value boolean,
  allows_waiver_value boolean,
  due_anchor_value text,
  due_offset_minutes_value integer,
  grace_minutes_value integer,
  pause_outside_schedule_value boolean,
  escalation_policy_value jsonb
)
returns public.operating_control_policies
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_policy public.operating_control_policies;
  clean_department text := nullif(trim(coalesce(department_value, '')), '');
begin
  perform public.require_dashboard_permission(target_organization_id, 'workspace');

  if nullif(trim(coalesce(control_key_value, '')), '') is null then
    raise exception 'A control key is required.';
  end if;

  if target_location_id is not null and not exists (
    select 1
    from public.locations location
    where location.id = target_location_id
      and location.organization_id = target_organization_id
  ) then
    raise exception 'The selected location does not belong to this workspace.';
  end if;

  update public.operating_control_policies
     set effective_to = current_date,
         is_active = false
   where organization_id = target_organization_id
     and location_id is not distinct from target_location_id
     and department is not distinct from clean_department
     and control_key = trim(control_key_value)
     and is_active
     and effective_to is null;

  insert into public.operating_control_policies (
    organization_id,
    location_id,
    department,
    control_key,
    control_label,
    source_kind,
    blocks_operational_close,
    allows_deferment,
    allows_waiver,
    due_anchor,
    due_offset_minutes,
    grace_minutes,
    pause_outside_schedule,
    escalation_policy,
    effective_from
  ) values (
    target_organization_id,
    target_location_id,
    clean_department,
    trim(control_key_value),
    coalesce(nullif(trim(control_label_value), ''), trim(control_key_value)),
    coalesce(nullif(trim(source_kind_value), ''), 'register'),
    coalesce(blocks_operational_close_value, true),
    coalesce(allows_deferment_value, false),
    coalesce(allows_waiver_value, false),
    coalesce(nullif(trim(due_anchor_value), ''), 'operating_close'),
    coalesce(due_offset_minutes_value, 0),
    coalesce(grace_minutes_value, 0),
    coalesce(pause_outside_schedule_value, true),
    coalesce(escalation_policy_value, '[]'::jsonb),
    current_date
  )
  returning * into saved_policy;

  return saved_policy;
end;
$$;

grant execute on function public.configure_dashboard_control_policy(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  boolean,
  text,
  integer,
  integer,
  boolean,
  jsonb
) to authenticated;

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
  required_control record;
  register_entry public.operation_register_entries;
  effective_outcome text;
  blocker_list jsonb := '[]'::jsonb;
  unresolved_transfer_count integer := 0;
begin
  if not public.user_can_access_organization(target_organization_id) then
    raise exception 'You do not have access to this workspace.';
  end if;

  for required_control in
    select distinct on (policy.control_key)
      policy.*
    from public.operating_control_policies policy
    where policy.organization_id = target_organization_id
      and policy.location_id is null
      and policy.is_active
      and policy.blocks_operational_close
      and policy.effective_from <= target_operating_date
      and (
        policy.effective_to is null
        or policy.effective_to >= target_operating_date
      )
    order by
      policy.control_key,
      policy.priority desc,
      policy.effective_from desc
  loop
    if required_control.source_kind = 'register' then
      select *
        into register_entry
      from public.operation_register_entries entry
      where entry.organization_id = target_organization_id
        and entry.operating_date = target_operating_date
        and entry.register_key = required_control.control_key;

      if register_entry.id is null then
        blocker_list := blocker_list || jsonb_build_array(
          jsonb_build_object(
            'type', 'missing_register',
            'key', required_control.control_key,
            'label', required_control.control_label,
            'department', coalesce(required_control.department, 'Operations'),
            'message', required_control.control_label || ' has not been declared.'
          )
        );
      else
        effective_outcome := coalesce(
          register_entry.control_outcome,
          case
            when register_entry.status in ('completed', 'clear') then 'satisfied'
            when register_entry.status = 'exception' then 'exception'
            else 'exception'
          end
        );

        if effective_outcome = 'exception' then
          blocker_list := blocker_list || jsonb_build_array(
            jsonb_build_object(
              'type', 'register_exception',
              'key', required_control.control_key,
              'label', required_control.control_label,
              'department', coalesce(required_control.department, 'Operations'),
              'message', coalesce(
                register_entry.decision_reason,
                register_entry.notes,
                required_control.control_label || ' has an unresolved exception.'
              )
            )
          );
        elsif effective_outcome = 'deferred'
          and (
            not required_control.allows_deferment
            or register_entry.deferred_until is null
            or register_entry.deferred_until <= now()
          )
        then
          blocker_list := blocker_list || jsonb_build_array(
            jsonb_build_object(
              'type', 'expired_deferment',
              'key', required_control.control_key,
              'label', required_control.control_label,
              'department', coalesce(required_control.department, 'Operations'),
              'message', required_control.control_label
                || ' deferment is missing, expired, or not permitted.'
            )
          );
        elsif effective_outcome = 'waived'
          and not required_control.allows_waiver
        then
          blocker_list := blocker_list || jsonb_build_array(
            jsonb_build_object(
              'type', 'unauthorized_waiver',
              'key', required_control.control_key,
              'label', required_control.control_label,
              'department', coalesce(required_control.department, 'Operations'),
              'message', required_control.control_label || ' cannot be waived under the active policy.'
            )
          );
        end if;
      end if;

      register_entry := null::public.operation_register_entries;
      effective_outcome := null;
    elsif required_control.source_kind = 'requisition_receipt' then
      select count(*)
        into unresolved_transfer_count
      from public.approval_requests request
      where request.organization_id = target_organization_id
        and request.request_type = 'inventory_requisition'
        and request.status = 'accepted'
        and coalesce((request.payload->>'awaiting_receipt')::boolean, false)
        and coalesce(
          nullif(request.payload->>'issued_at', '')::timestamptz::date,
          request.created_at::date
        ) <= target_operating_date;

      if unresolved_transfer_count > 0 then
        blocker_list := blocker_list || jsonb_build_array(
          jsonb_build_object(
            'type', 'requisition_in_transit',
            'key', required_control.control_key,
            'label', required_control.control_label,
            'department', coalesce(required_control.department, 'Operations'),
            'count', unresolved_transfer_count,
            'message', unresolved_transfer_count::text
              || case
                when unresolved_transfer_count = 1
                  then ' requisition is'
                else ' requisitions are'
              end
              || ' still in transit and require receipt or an approved exception.'
          )
        );
      end if;
    end if;
  end loop;

  return blocker_list;
end;
$$;

grant execute on function public.get_dashboard_day_close_blockers(uuid, date)
  to authenticated;

create or replace function public.set_dashboard_control_outcome(
  target_organization_id uuid,
  target_operating_date date,
  target_register_key text,
  outcome_value text,
  deferred_until_value timestamptz default null,
  reason_value text default null
)
returns public.operation_register_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_policy public.operating_control_policies;
  saved_entry public.operation_register_entries;
  clean_reason text := nullif(trim(coalesce(reason_value, '')), '');
begin
  perform public.require_dashboard_permission(target_organization_id, 'approval');

  if outcome_value not in (
    'satisfied',
    'deferred',
    'exception',
    'waived',
    'not_applicable'
  ) then
    raise exception 'Unsupported control outcome: %', outcome_value;
  end if;

  select policy.*
    into selected_policy
  from public.operating_control_policies policy
  where policy.organization_id = target_organization_id
    and policy.location_id is null
    and policy.control_key = target_register_key
    and policy.source_kind = 'register'
    and policy.is_active
    and policy.effective_from <= target_operating_date
    and (
      policy.effective_to is null
      or policy.effective_to >= target_operating_date
    )
  order by policy.priority desc, policy.effective_from desc
  limit 1;

  if selected_policy.id is null then
    raise exception 'No active control policy exists for this register.';
  end if;

  if outcome_value = 'deferred' then
    if not selected_policy.allows_deferment then
      raise exception 'This control cannot be deferred under the active policy.';
    end if;

    if deferred_until_value is null or deferred_until_value <= now() then
      raise exception 'A future deferment deadline is required.';
    end if;
  end if;

  if outcome_value = 'waived' and not selected_policy.allows_waiver then
    raise exception 'This control cannot be waived under the active policy.';
  end if;

  if outcome_value in ('deferred', 'exception', 'waived', 'not_applicable')
    and clean_reason is null
  then
    raise exception 'A reason is required for this control outcome.';
  end if;

  update public.operation_register_entries
     set control_outcome = outcome_value,
         control_policy_id = selected_policy.id,
         deferred_until = case
           when outcome_value = 'deferred' then deferred_until_value
           else null
         end,
         decision_reason = clean_reason,
         decided_by = auth.uid(),
         decided_at = now(),
         status = case
           when outcome_value in ('satisfied', 'waived', 'not_applicable')
             then 'clear'
           when outcome_value = 'deferred' then 'clear'
           else 'exception'
         end,
         activity_state = case
           when outcome_value = 'exception' then 'exception'
           else 'reviewed'
         end
   where organization_id = target_organization_id
     and operating_date = target_operating_date
     and register_key = target_register_key
  returning * into saved_entry;

  if saved_entry.id is null then
    raise exception 'Submit the daily register before deciding its outcome.';
  end if;

  return saved_entry;
end;
$$;

grant execute on function public.set_dashboard_control_outcome(
  uuid,
  date,
  text,
  text,
  timestamptz,
  text
) to authenticated;

create or replace function public.configure_dashboard_pos_import_policy(
  target_organization_id uuid,
  target_location_id uuid,
  cadence_value text,
  expected_weekdays_value smallint[],
  period_end_day_value smallint,
  due_time_value time,
  due_offset_days_value integer,
  timezone_value text,
  blocks_operational_close_value boolean default false
)
returns public.pos_import_policies
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_policy public.pos_import_policies;
begin
  perform public.require_dashboard_permission(target_organization_id, 'workspace');

  if cadence_value not in (
    'continuous',
    'daily',
    'weekly',
    'scheduled_days',
    'manual'
  ) then
    raise exception 'Unsupported POS import cadence: %', cadence_value;
  end if;

  update public.pos_import_policies
     set effective_to = current_date,
         is_active = false
   where organization_id = target_organization_id
     and location_id is not distinct from target_location_id
     and is_active
     and effective_to is null;

  insert into public.pos_import_policies (
    organization_id,
    location_id,
    cadence,
    expected_weekdays,
    period_end_day,
    due_time,
    due_offset_days,
    timezone,
    blocks_operational_close,
    requires_financial_reconciliation,
    effective_from
  ) values (
    target_organization_id,
    target_location_id,
    cadence_value,
    coalesce(expected_weekdays_value, '{}'::smallint[]),
    period_end_day_value,
    coalesce(due_time_value, '10:00'::time),
    coalesce(due_offset_days_value, 1),
    coalesce(nullif(trim(timezone_value), ''), 'Africa/Lagos'),
    coalesce(blocks_operational_close_value, false),
    true,
    current_date
  )
  returning * into saved_policy;

  return saved_policy;
end;
$$;

grant execute on function public.configure_dashboard_pos_import_policy(
  uuid,
  uuid,
  text,
  smallint[],
  smallint,
  time,
  integer,
  text,
  boolean
) to authenticated;

create or replace function public.set_dashboard_day_reconciliation_status(
  target_organization_id uuid,
  target_operating_date date,
  reconciliation_status_value text,
  reconciliation_note_value text default null
)
returns public.operating_days
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_day public.operating_days;
  clean_note text := nullif(trim(coalesce(reconciliation_note_value, '')), '');
begin
  perform public.require_dashboard_permission(target_organization_id, 'costing');

  if reconciliation_status_value not in (
    'awaiting_data',
    'provisional',
    'reconciled',
    'exception',
    'not_required'
  ) then
    raise exception 'Unsupported reconciliation status: %',
      reconciliation_status_value;
  end if;

  if reconciliation_status_value in ('exception', 'not_required')
    and clean_note is null
  then
    raise exception 'A reason is required for this reconciliation status.';
  end if;

  insert into public.operating_days (
    organization_id,
    operating_date,
    status,
    reconciliation_status,
    reconciliation_note,
    reconciled_by,
    reconciled_at
  ) values (
    target_organization_id,
    target_operating_date,
    'open',
    reconciliation_status_value,
    clean_note,
    case
      when reconciliation_status_value = 'reconciled' then auth.uid()
      else null
    end,
    case
      when reconciliation_status_value = 'reconciled' then now()
      else null
    end
  )
  on conflict (organization_id, operating_date)
  do update set
    reconciliation_status = excluded.reconciliation_status,
    reconciliation_note = excluded.reconciliation_note,
    reconciled_by = excluded.reconciled_by,
    reconciled_at = excluded.reconciled_at
  returning * into saved_day;

  return saved_day;
end;
$$;

grant execute on function public.set_dashboard_day_reconciliation_status(
  uuid,
  date,
  text,
  text
) to authenticated;

notify pgrst, 'reload schema';
