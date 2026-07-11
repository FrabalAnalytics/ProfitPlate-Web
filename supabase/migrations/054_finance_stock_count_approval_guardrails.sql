-- Stock counts and stock adjustments are inventory proposals, not final stock
-- truth. Finance must approve the variance before balances and margin impact
-- are posted.

create or replace function public.approve_dashboard_request(target_request_id uuid)
returns public.approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_user_role text;
  selected_request public.approval_requests;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to approve requests.';
  end if;

  select *
    into selected_request
  from public.approval_requests
  where id = target_request_id;

  if selected_request.id is null then
    raise exception 'Approval request not found.';
  end if;

  perform public.require_dashboard_permission(selected_request.organization_id, 'approval');

  if selected_request.status <> 'pending' then
    raise exception 'Only pending requests can be approved.';
  end if;

  if selected_request.request_type = 'stock_count_approval' then
    select lower(coalesce(profile.role, ''))
      into current_user_role
    from public.profiles profile
    where profile.id = current_user_id
      and profile.organization_id = selected_request.organization_id;

    if current_user_role not in ('finance_manager', 'owner', 'admin') then
      raise exception 'Stock counts and stock adjustments require Finance approval before balances are posted.';
    end if;

    perform public.apply_approved_dashboard_stock_count_lines(
      selected_request.organization_id,
      selected_request.payload->'lines',
      selected_request.requested_by
    );
  end if;

  update public.approval_requests
     set status = 'accepted',
         approved_by = current_user_id,
         approved_at = now()
   where id = selected_request.id
   returning * into selected_request;

  return selected_request;
end;
$$;

grant execute on function public.approve_dashboard_request(uuid) to authenticated;

notify pgrst, 'reload schema';
