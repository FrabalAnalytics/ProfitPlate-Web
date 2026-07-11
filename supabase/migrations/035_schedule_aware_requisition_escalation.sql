-- Track requisitions in transit using receiving-department active time.

alter table if exists public.organizations
  add column if not exists enforce_requisition_separation boolean not null default true;

create table if not exists public.requisition_escalation_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  policy_id uuid references public.operating_control_policies(id) on delete set null,
  from_location_id uuid references public.locations(id) on delete set null,
  to_location_id uuid references public.locations(id) on delete set null,
  receiving_department text not null default 'Operations',
  dispatched_by uuid references auth.users(id) on delete set null,
  dispatched_at timestamptz not null,
  status text not null default 'awaiting_receipt',
  active_elapsed_minutes integer not null default 0,
  current_level integer not null default 0,
  current_owner_role text not null default 'receiver',
  next_escalation_active_minute integer,
  value_at_risk numeric(18, 6) not null default 0,
  last_evaluated_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint requisition_escalation_request_unique unique (request_id),
  constraint requisition_escalation_status_check check (
    status in (
      'awaiting_receipt',
      'received',
      'partially_received',
      'rejected',
      'not_received',
      'resolved'
    )
  ),
  constraint requisition_escalation_minutes_check check (
    active_elapsed_minutes >= 0 and current_level >= 0
  )
);

create table if not exists public.requisition_escalation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  escalation_state_id uuid not null
    references public.requisition_escalation_states(id) on delete cascade,
  event_type text not null,
  escalation_level integer not null default 0,
  recipient_role text,
  active_elapsed_minutes integer not null default 0,
  message text not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint requisition_escalation_event_type_check check (
    event_type in ('dispatched', 'reminder', 'escalated', 'received', 'exception')
  ),
  constraint requisition_escalation_event_unique unique (
    request_id,
    event_type,
    escalation_level
  )
);

drop trigger if exists set_requisition_escalation_states_updated_at
  on public.requisition_escalation_states;
create trigger set_requisition_escalation_states_updated_at
before update on public.requisition_escalation_states
for each row execute function public.set_updated_at();

create index if not exists idx_requisition_escalation_open
  on public.requisition_escalation_states(
    organization_id,
    status,
    dispatched_at
  );

alter table public.requisition_escalation_states enable row level security;
alter table public.requisition_escalation_events enable row level security;

drop policy if exists "requisition_escalation_states_member_select"
  on public.requisition_escalation_states;
create policy "requisition_escalation_states_member_select"
on public.requisition_escalation_states
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "requisition_escalation_events_member_select"
  on public.requisition_escalation_events;
create policy "requisition_escalation_events_member_select"
on public.requisition_escalation_events
for select
to authenticated
using (public.user_can_access_organization(organization_id));

create or replace function public.initialize_dashboard_requisition_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_policy public.operating_control_policies;
  saved_state public.requisition_escalation_states;
  destination_location_id uuid;
  source_location_id uuid;
  dispatch_time timestamptz;
  department_name text;
  exposure numeric(18, 6) := 0;
begin
  if new.request_type <> 'inventory_requisition' then
    return new;
  end if;

  if new.status = 'accepted'
    and coalesce((new.payload->>'awaiting_receipt')::boolean, false)
    and (
      old.status is distinct from new.status
      or coalesce((old.payload->>'awaiting_receipt')::boolean, false) is false
      or not exists (
        select 1
        from public.requisition_escalation_states existing
        where existing.request_id = new.id
      )
    )
  then
    destination_location_id := nullif(new.payload->>'to_location_id', '')::uuid;
    source_location_id := nullif(new.payload->>'from_location_id', '')::uuid;
    dispatch_time := coalesce(
      nullif(new.payload->>'issued_at', '')::timestamptz,
      new.approved_at,
      now()
    );
    department_name := coalesce(
      nullif(trim(new.payload->>'requested_to'), ''),
      (
        select location.name
        from public.locations location
        where location.id = destination_location_id
      ),
      'Operations'
    );

    select policy.*
      into selected_policy
    from public.operating_control_policies policy
    where policy.organization_id = new.organization_id
      and policy.control_key = 'requisition_receipt'
      and policy.source_kind = 'requisition_receipt'
      and policy.is_active
      and (
        policy.location_id is null
        or policy.location_id = destination_location_id
      )
      and (
        policy.department is null
        or lower(policy.department) = lower(department_name)
      )
      and policy.effective_from <= dispatch_time::date
      and (
        policy.effective_to is null
        or policy.effective_to >= dispatch_time::date
      )
    order by
      (policy.location_id is not null)::integer desc,
      (policy.department is not null)::integer desc,
      policy.priority desc
    limit 1;

    select coalesce(sum(
      coalesce((line->>'issued_quantity')::numeric, 0)
      * coalesce(item.current_cost_per_base_uom, 0)
    ), 0)
      into exposure
    from jsonb_array_elements(coalesce(new.payload->'lines', '[]'::jsonb)) line
    left join public.inventory_items item
      on item.id = nullif(line->>'destination_inventory_item_id', '')::uuid;

    insert into public.requisition_escalation_states (
      organization_id,
      request_id,
      policy_id,
      from_location_id,
      to_location_id,
      receiving_department,
      dispatched_by,
      dispatched_at,
      current_owner_role,
      next_escalation_active_minute,
      value_at_risk,
      last_evaluated_at
    ) values (
      new.organization_id,
      new.id,
      selected_policy.id,
      source_location_id,
      destination_location_id,
      department_name,
      new.approved_by,
      dispatch_time,
      'receiver',
      30,
      exposure,
      dispatch_time
    )
    on conflict (request_id)
    do update set
      policy_id = excluded.policy_id,
      from_location_id = excluded.from_location_id,
      to_location_id = excluded.to_location_id,
      receiving_department = excluded.receiving_department,
      dispatched_by = excluded.dispatched_by,
      dispatched_at = excluded.dispatched_at,
      status = 'awaiting_receipt',
      value_at_risk = excluded.value_at_risk,
      last_evaluated_at = excluded.last_evaluated_at
    returning * into saved_state;

    insert into public.requisition_escalation_events (
      organization_id,
      request_id,
      escalation_state_id,
      event_type,
      escalation_level,
      recipient_role,
      message
    ) values (
      new.organization_id,
      new.id,
      saved_state.id,
      'dispatched',
      0,
      'receiver',
      'Stock dispatched. The receiving department must acknowledge receipt.'
    )
    on conflict do nothing;
  elsif new.status = 'completed' and old.status = 'accepted' then
    update public.requisition_escalation_states
       set status = 'received',
           resolved_by = auth.uid(),
           resolved_at = now(),
           resolution_note = 'Receiving department acknowledged the transfer.'
     where request_id = new.id
    returning * into saved_state;

    if saved_state.id is not null then
      insert into public.requisition_escalation_events (
        organization_id,
        request_id,
        escalation_state_id,
        event_type,
        escalation_level,
        recipient_role,
        active_elapsed_minutes,
        message
      ) values (
        new.organization_id,
        new.id,
        saved_state.id,
        'received',
        saved_state.current_level,
        saved_state.current_owner_role,
        saved_state.active_elapsed_minutes,
        'Transfer receipt acknowledged and escalation closed.'
      )
      on conflict do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists initialize_dashboard_requisition_escalation
  on public.approval_requests;
create trigger initialize_dashboard_requisition_escalation
after update on public.approval_requests
for each row execute function public.initialize_dashboard_requisition_escalation();

create or replace function public.enforce_dashboard_requisition_separation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  enforce_separation boolean;
begin
  if new.request_type = 'inventory_requisition'
    and old.status = 'accepted'
    and new.status = 'completed'
  then
    select organization.enforce_requisition_separation
      into enforce_separation
    from public.organizations organization
    where organization.id = new.organization_id;

    if coalesce(enforce_separation, true)
      and old.approved_by = auth.uid()
    then
      raise exception 'The person who dispatched this transfer cannot acknowledge its receipt.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_dashboard_requisition_separation
  on public.approval_requests;
create trigger enforce_dashboard_requisition_separation
before update on public.approval_requests
for each row execute function public.enforce_dashboard_requisition_separation();

create or replace function public.refresh_dashboard_requisition_escalations(
  target_organization_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  escalation record;
  policy_steps jsonb;
  step record;
  minutes_to_add integer;
  next_level integer;
  next_owner text;
  next_threshold integer;
  updated_count integer := 0;
begin
  if not public.user_can_access_organization(target_organization_id) then
    raise exception 'You do not have access to this workspace.';
  end if;

  for escalation in
    select
      state.*,
      policy.pause_outside_schedule,
      policy.escalation_policy
    from public.requisition_escalation_states state
    left join public.operating_control_policies policy
      on policy.id = state.policy_id
    where state.organization_id = target_organization_id
      and state.status = 'awaiting_receipt'
  loop
    select count(*)
      into minutes_to_add
    from generate_series(
      escalation.last_evaluated_at + interval '1 minute',
      now(),
      interval '1 minute'
    ) tick
    where coalesce(escalation.pause_outside_schedule, true) is false
      or public.is_dashboard_department_active(
        target_organization_id,
        escalation.to_location_id,
        escalation.receiving_department,
        tick
      );

    policy_steps := case
      when jsonb_typeof(escalation.escalation_policy) = 'array'
        and jsonb_array_length(escalation.escalation_policy) > 0
      then escalation.escalation_policy
      else '[
        {"level": 1, "after_minutes": 30, "role": "department_manager"},
        {"level": 2, "after_minutes": 60, "role": "operations_manager"},
        {"level": 3, "after_minutes": 120, "role": "owner"}
      ]'::jsonb
    end;

    next_level := escalation.current_level;
    next_owner := escalation.current_owner_role;
    next_threshold := null;

    for step in
      select
        coalesce((value->>'level')::integer, ordinality::integer) as level,
        coalesce((value->>'after_minutes')::integer, 0) as after_minutes,
        coalesce(nullif(value->>'role', ''), 'operations_manager') as role
      from jsonb_array_elements(policy_steps) with ordinality
      order by after_minutes
    loop
      if escalation.active_elapsed_minutes + minutes_to_add >= step.after_minutes then
        if step.level > next_level then
          next_level := step.level;
          next_owner := step.role;

          insert into public.requisition_escalation_events (
            organization_id,
            request_id,
            escalation_state_id,
            event_type,
            escalation_level,
            recipient_role,
            active_elapsed_minutes,
            message
          ) values (
            target_organization_id,
            escalation.request_id,
            escalation.id,
            'escalated',
            step.level,
            step.role,
            escalation.active_elapsed_minutes + minutes_to_add,
            'Receipt acknowledgement escalated to ' || replace(step.role, '_', ' ') || '.'
          )
          on conflict do nothing;
        end if;
      elsif next_threshold is null then
        next_threshold := step.after_minutes;
      end if;
    end loop;

    update public.requisition_escalation_states
       set active_elapsed_minutes =
             active_elapsed_minutes + greatest(coalesce(minutes_to_add, 0), 0),
           current_level = next_level,
           current_owner_role = next_owner,
           next_escalation_active_minute = next_threshold,
           last_evaluated_at = case
             when now() - escalation.last_evaluated_at >= interval '1 minute'
               then date_trunc('minute', now())
             else escalation.last_evaluated_at
           end
     where id = escalation.id;

    updated_count := updated_count + 1;
  end loop;

  return updated_count;
end;
$$;

grant execute on function public.refresh_dashboard_requisition_escalations(uuid)
  to authenticated;

-- Backfill transfers already awaiting receipt when this migration is applied.
update public.approval_requests
set payload = payload || jsonb_build_object(
  'escalation_initialized_at',
  to_jsonb(now())
)
where request_type = 'inventory_requisition'
  and status = 'accepted'
  and coalesce((payload->>'awaiting_receipt')::boolean, false);

notify pgrst, 'reload schema';
