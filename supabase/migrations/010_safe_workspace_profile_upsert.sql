-- Make workspace initialization safe for users who already have a profile row.

alter table if exists public.profiles
  drop constraint if exists profiles_role_allowed;

alter table if exists public.profiles
  add constraint profiles_role_allowed check (
    role in (
      'owner',
      'admin',
      'manager',
      'operations_manager',
      'procurement_manager',
      'finance_manager',
      'inventory_manager',
      'kitchen_manager',
      'chef',
      'viewer'
    )
  );

drop function if exists public.create_workspace(text, public.subscription_tier, text);

create function public.create_workspace(
  workspace_name text,
  workspace_subscription_tier public.subscription_tier default 'solo',
  workspace_local_currency text default 'NGN'
)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  created_organization_id uuid;
  created_organization public.organizations;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to create a workspace.';
  end if;

  if nullif(trim(workspace_name), '') is null then
    raise exception 'Workspace name is required.';
  end if;

  insert into public.organizations (
    owner_user_id,
    name,
    subscription_tier,
    local_currency
  ) values (
    current_user_id,
    trim(workspace_name),
    workspace_subscription_tier,
    upper(coalesce(nullif(trim(workspace_local_currency), ''), 'NGN'))
  )
  returning id into created_organization_id;

  insert into public.system_settings (
    organization_id,
    system_status
  ) values (
    created_organization_id,
    'implementation_mode'
  )
  on conflict (organization_id) do update set
    system_status = excluded.system_status;

  insert into public.profiles (
    id,
    organization_id,
    role
  ) values (
    current_user_id,
    created_organization_id,
    'owner'
  )
  on conflict (id) do update set
    organization_id = excluded.organization_id,
    role = coalesce(public.profiles.role, excluded.role),
    updated_at = now();

  select o.*
    into created_organization
  from public.organizations o
  where o.id = created_organization_id;

  return created_organization;
end;
$$;

grant execute on function public.create_workspace(text, public.subscription_tier, text) to authenticated;

insert into public.profiles (
  id,
  organization_id,
  full_name,
  role
)
select
  target_user.id,
  owner_profile.organization_id,
  coalesce(nullif(target_user.raw_user_meta_data->>'full_name', ''), 'Suzzy Q Gemini'),
  'kitchen_manager'
from auth.users target_user
cross join lateral (
  select profile.organization_id
  from public.profiles profile
  where profile.organization_id is not null
    and profile.role = 'owner'
  order by profile.created_at asc
  limit 1
) owner_profile
where lower(target_user.email) = lower('suzzyqgemini@gmail.com')
on conflict (id) do update
   set role = excluded.role,
       full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
       organization_id = coalesce(public.profiles.organization_id, excluded.organization_id),
       updated_at = now();

notify pgrst, 'reload schema';
