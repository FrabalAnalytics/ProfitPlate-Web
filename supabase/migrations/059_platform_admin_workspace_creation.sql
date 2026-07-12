-- Super Admins and Implementation Managers can create restaurant entity shells
-- from the platform dashboard without turning the platform admin account into
-- the restaurant owner. If an owner email already exists in Auth, attach that
-- user as the restaurant owner/profile; otherwise leave ownership unassigned
-- for onboarding follow-up.

create or replace function public.create_platform_admin_workspace(
  workspace_name text,
  subscription_tier_value text default 'solo',
  local_currency_value text default 'NGN',
  owner_email_value text default null
)
returns public.organizations
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_owner_user_id uuid;
  created_organization public.organizations;
  normalized_currency text;
begin
  if not public.current_user_is_platform_admin(
    array['super_admin', 'implementation_manager']
  ) then
    raise exception 'Only Super Admins and Implementation Managers can create restaurant workspaces.';
  end if;

  if nullif(trim(coalesce(workspace_name, '')), '') is null then
    raise exception 'Restaurant name is required.';
  end if;

  if subscription_tier_value not in ('solo', 'multi_unit', 'enterprise_grid') then
    raise exception 'Unsupported subscription tier: %', subscription_tier_value;
  end if;

  normalized_currency := nullif(upper(trim(coalesce(local_currency_value, ''))), '');

  if normalized_currency is null then
    normalized_currency := 'NGN';
  end if;

  if length(normalized_currency) <> 3 then
    raise exception 'Currency must be a 3-letter code such as NGN, USD, or GBP.';
  end if;

  if nullif(trim(coalesce(owner_email_value, '')), '') is not null then
    select users.id
      into target_owner_user_id
    from auth.users users
    where lower(users.email) = lower(trim(owner_email_value))
    limit 1;

    if target_owner_user_id is null then
      raise exception 'No auth user found for owner email %. Create the user first or leave owner email blank.', owner_email_value;
    end if;
  end if;

  insert into public.organizations (
    owner_user_id,
    name,
    subscription_tier,
    system_status,
    local_currency
  ) values (
    target_owner_user_id,
    trim(workspace_name),
    subscription_tier_value::public.subscription_tier,
    'implementation_mode',
    normalized_currency
  )
  returning * into created_organization;

  insert into public.system_settings (
    organization_id,
    system_status
  ) values (
    created_organization.id,
    'implementation_mode'
  )
  on conflict (organization_id) do update set
    system_status = excluded.system_status,
    updated_at = now();

  if target_owner_user_id is not null then
    insert into public.profiles (
      id,
      organization_id,
      role
    ) values (
      target_owner_user_id,
      created_organization.id,
      'owner'
    )
    on conflict (id) do update set
      organization_id = excluded.organization_id,
      role = 'owner',
      updated_at = now();
  end if;

  return created_organization;
end;
$$;

grant execute on function public.create_platform_admin_workspace(text, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';
