-- Add kitchen manager role and assign the kitchen lead account when present.

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

create or replace function public.user_can_record_operations(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.user_can_access_organization(target_organization_id)
    and public.user_has_any_role(
      array[
        'owner',
        'admin',
        'manager',
        'operations_manager',
        'procurement_manager',
        'inventory_manager',
        'kitchen_manager',
        'chef'
      ]
    );
$$;

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
