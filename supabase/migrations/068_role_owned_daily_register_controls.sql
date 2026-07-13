-- Daily checklist declarations must match role ownership. This keeps the UI
-- accountability model enforceable even if a user calls the RPC directly.

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
  current_user_id uuid := auth.uid();
  profile_role text;
  normalized_department text;
  saved_entry public.operation_register_entries;
begin
  perform public.require_dashboard_permission(target_organization_id, 'operations');

  if current_user_id is null then
    raise exception 'You must be signed in to update a daily register.';
  end if;

  select lower(replace(replace(p.role::text, ' ', '_'), '-', '_'))
    into profile_role
  from public.profiles p
  where p.id = current_user_id
    and p.organization_id = target_organization_id;

  if profile_role is null then
    raise exception 'Your profile is not assigned to this workspace.';
  end if;

  if profile_role in ('general_manager', 'gm', 'restaurant_manager') then
    profile_role := 'operations_manager';
  elsif profile_role = 'cost_controller' then
    profile_role := 'finance_manager';
  elsif profile_role = 'production_supervisor' then
    profile_role := 'kitchen_manager';
  elsif profile_role in ('inventory_clerk', 'receiving_officer') then
    profile_role := 'storekeeper';
  elsif profile_role in ('qa', 'quality_control') then
    profile_role := 'quality_assurance';
  elsif profile_role in ('bar_head', 'head_bartender') then
    profile_role := 'bar_manager';
  end if;

  if register_key_value is null or length(trim(register_key_value)) = 0 then
    raise exception 'Choose a register before submitting.';
  end if;

  if department_value is null or length(trim(department_value)) = 0 then
    raise exception 'Department is required for compliance registers.';
  end if;

  normalized_department := lower(trim(department_value));

  if profile_role not in ('owner', 'admin', 'manager', 'operations_manager') then
    if not (
      (profile_role = 'finance_manager' and normalized_department = 'finance')
      or (profile_role = 'procurement_manager' and normalized_department = 'procurement')
      or (profile_role = 'inventory_manager' and normalized_department in ('inventory', 'operations'))
      or (profile_role = 'storekeeper' and normalized_department = 'inventory')
      or (profile_role = 'kitchen_manager' and normalized_department in ('kitchen', 'operations'))
      or (profile_role = 'chef' and normalized_department = 'kitchen')
      or (profile_role = 'quality_assurance' and normalized_department in ('operations', 'inventory', 'kitchen'))
      or (profile_role = 'bar_manager' and normalized_department = 'bar')
      or (profile_role = 'bartender' and normalized_department = 'bar')
    ) then
      raise exception 'Your role cannot declare the % daily register.', trim(department_value);
    end if;
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
    current_user_id,
    now()
  )
  on conflict (organization_id, operating_date, register_key)
  do update set
    department = excluded.department,
    status = excluded.status,
    activity_state = excluded.activity_state,
    notes = excluded.notes,
    submitted_by = current_user_id,
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

notify pgrst, 'reload schema';
