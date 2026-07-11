-- Daily operation registers make "no activity" an auditable entry, not an absence of data.

create table if not exists public.operation_register_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operating_date date not null default current_date,
  register_key text not null,
  department text not null,
  status text not null default 'clear',
  activity_state text not null default 'no_activity',
  notes text,
  source_table text,
  source_record_id uuid,
  submitted_by uuid references auth.users(id) on delete set null default auth.uid(),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operation_register_entries_status_check check (
    status in ('completed', 'clear', 'exception')
  ),
  constraint operation_register_entries_activity_state_check check (
    activity_state in ('activity_recorded', 'no_activity', 'reviewed', 'exception')
  ),
  constraint operation_register_entries_unique_day_key unique (
    organization_id,
    operating_date,
    register_key
  )
);

drop trigger if exists set_operation_register_entries_updated_at
  on public.operation_register_entries;
create trigger set_operation_register_entries_updated_at
before update on public.operation_register_entries
for each row execute function public.set_updated_at();

create index if not exists idx_operation_register_entries_org_day
  on public.operation_register_entries(organization_id, operating_date desc);

alter table public.operation_register_entries enable row level security;

drop policy if exists "operation_register_entries_member_select"
  on public.operation_register_entries;
create policy "operation_register_entries_member_select"
on public.operation_register_entries
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "operation_register_entries_member_insert"
  on public.operation_register_entries;
create policy "operation_register_entries_member_insert"
on public.operation_register_entries
for insert
to authenticated
with check (public.user_can_record_operations(organization_id));

drop policy if exists "operation_register_entries_member_update"
  on public.operation_register_entries;
create policy "operation_register_entries_member_update"
on public.operation_register_entries
for update
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_record_operations(organization_id));

create or replace function public.upsert_dashboard_operation_register(
  target_organization_id uuid,
  register_key_value text,
  department_value text,
  operating_date_value date,
  status_value text,
  activity_state_value text,
  notes_value text default null
)
returns public.operation_register_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_entry public.operation_register_entries;
begin
  perform public.require_dashboard_permission(target_organization_id, 'operations');

  if register_key_value is null or length(trim(register_key_value)) = 0 then
    raise exception 'Choose a register before submitting.';
  end if;

  if department_value is null or length(trim(department_value)) = 0 then
    raise exception 'Department is required for compliance registers.';
  end if;

  if status_value not in ('completed', 'clear', 'exception') then
    raise exception 'Unsupported register status: %', status_value;
  end if;

  if activity_state_value not in ('activity_recorded', 'no_activity', 'reviewed', 'exception') then
    raise exception 'Unsupported register activity state: %', activity_state_value;
  end if;

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
    coalesce(operating_date_value, current_date),
    trim(register_key_value),
    trim(department_value),
    status_value,
    activity_state_value,
    nullif(trim(coalesce(notes_value, '')), ''),
    auth.uid(),
    now()
  )
  on conflict (organization_id, operating_date, register_key)
  do update set
    department = excluded.department,
    status = excluded.status,
    activity_state = excluded.activity_state,
    notes = excluded.notes,
    submitted_by = auth.uid(),
    submitted_at = now()
  returning * into saved_entry;

  return saved_entry;
end;
$$;

grant execute on function public.upsert_dashboard_operation_register(
  uuid,
  text,
  text,
  date,
  text,
  text,
  text
) to authenticated;
