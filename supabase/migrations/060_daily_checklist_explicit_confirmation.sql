-- Activity rows are evidence, not a human checklist decision.
-- A waste event, PO, production run, etc. should show that activity exists,
-- but day close should still require a user to confirm, declare zero activity,
-- defer/waive where policy allows, or flag an exception.

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
            when register_entry.status = 'exception'
              or register_entry.activity_state = 'exception'
              then 'exception'
            when register_entry.activity_state in ('reviewed', 'no_activity')
              and register_entry.status in ('completed', 'clear')
              then 'satisfied'
            else 'needs_review'
          end
        );

        if effective_outcome = 'needs_review' then
          blocker_list := blocker_list || jsonb_build_array(
            jsonb_build_object(
              'type', 'register_needs_review',
              'key', required_control.control_key,
              'label', required_control.control_label,
              'department', coalesce(required_control.department, 'Operations'),
              'message', required_control.control_label
                || ' has activity evidence but has not been explicitly confirmed.'
            )
          );
        elsif effective_outcome = 'exception' then
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
              'message', required_control.control_label
                || ' cannot be waived under the active policy.'
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

notify pgrst, 'reload schema';
