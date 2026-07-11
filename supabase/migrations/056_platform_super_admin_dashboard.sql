-- Platform administration is separate from restaurant workspace roles.
-- A Super Admin can see the cross-restaurant estate without being inserted
-- into each restaurant's normal profile/role model.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'super_admin',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  constraint platform_admins_role_check check (
    role in (
      'super_admin',
      'support_admin',
      'implementation_manager',
      'platform_auditor'
    )
  )
);

alter table public.platform_admins enable row level security;

drop policy if exists "platform_admins_self_select" on public.platform_admins;
create policy "platform_admins_self_select"
on public.platform_admins
for select
to authenticated
using (user_id = auth.uid());

create or replace function public.current_user_is_platform_admin(
  allowed_roles text[] default array[
    'super_admin',
    'support_admin',
    'implementation_manager',
    'platform_auditor'
  ]
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.platform_admins admin
    where admin.user_id = auth.uid()
      and admin.is_active
      and admin.role = any(allowed_roles)
  );
$$;

grant execute on function public.current_user_is_platform_admin(text[])
  to authenticated;

create or replace function public.grant_platform_admin_by_email(
  target_email text,
  platform_role text default 'super_admin'
)
returns public.platform_admins
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_user_id uuid;
  saved_admin public.platform_admins;
begin
  if platform_role not in (
    'super_admin',
    'support_admin',
    'implementation_manager',
    'platform_auditor'
  ) then
    raise exception 'Unsupported platform role: %', platform_role;
  end if;

  select users.id
    into target_user_id
  from auth.users users
  where lower(users.email) = lower(trim(target_email))
  limit 1;

  if target_user_id is null then
    raise exception 'No auth user found for email %', target_email;
  end if;

  -- Bootstrap rule: if no active platform admin exists yet, the first grant is
  -- allowed for a signed-in user. After bootstrap, only active super admins can
  -- grant platform access.
  if exists (
    select 1
    from public.platform_admins existing
    where existing.is_active
  )
     and not public.current_user_is_platform_admin(array['super_admin']) then
    raise exception 'Only Super Admins can grant platform admin access.';
  end if;

  insert into public.platform_admins (
    user_id,
    role,
    is_active,
    created_by
  ) values (
    target_user_id,
    platform_role,
    true,
    auth.uid()
  )
  on conflict (user_id)
  do update set
    role = excluded.role,
    is_active = true
  returning * into saved_admin;

  return saved_admin;
end;
$$;

grant execute on function public.grant_platform_admin_by_email(text, text)
  to authenticated;

create or replace function public.get_platform_admin_workspace_summary()
returns table (
  organization_id uuid,
  organization_name text,
  subscription_tier text,
  system_status text,
  local_currency text,
  owner_user_id uuid,
  created_at timestamptz,
  profile_count integer,
  active_location_count integer,
  active_sku_count integer,
  pending_approval_count integer,
  open_operating_day_count integer,
  latest_operating_date date,
  latest_operating_status text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    organization.id as organization_id,
    organization.name as organization_name,
    organization.subscription_tier::text as subscription_tier,
    organization.system_status::text as system_status,
    organization.local_currency,
    organization.owner_user_id,
    organization.created_at,
    coalesce(profile_counts.profile_count, 0)::integer as profile_count,
    coalesce(location_counts.active_location_count, 0)::integer as active_location_count,
    coalesce(sku_counts.active_sku_count, 0)::integer as active_sku_count,
    coalesce(approval_counts.pending_approval_count, 0)::integer as pending_approval_count,
    coalesce(day_counts.open_operating_day_count, 0)::integer as open_operating_day_count,
    latest_day.operating_date as latest_operating_date,
    latest_day.status::text as latest_operating_status
  from public.organizations organization
  left join lateral (
    select count(*) as profile_count
    from public.profiles profile
    where profile.organization_id = organization.id
  ) profile_counts on true
  left join lateral (
    select count(*) as active_location_count
    from public.locations location
    where location.organization_id = organization.id
      and location.is_active
  ) location_counts on true
  left join lateral (
    select count(*) as active_sku_count
    from public.inventory_items item
    where item.organization_id = organization.id
      and item.is_active
  ) sku_counts on true
  left join lateral (
    select count(*) as pending_approval_count
    from public.approval_requests request
    where request.organization_id = organization.id
      and request.status = 'pending'
  ) approval_counts on true
  left join lateral (
    select count(*) as open_operating_day_count
    from public.operating_days day
    where day.organization_id = organization.id
      and day.status in ('open', 'closing_review')
  ) day_counts on true
  left join lateral (
    select day.operating_date, day.status
    from public.operating_days day
    where day.organization_id = organization.id
    order by day.operating_date desc
    limit 1
  ) latest_day on true
  where public.current_user_is_platform_admin()
  order by organization.created_at desc, organization.name asc;
$$;

grant execute on function public.get_platform_admin_workspace_summary()
  to authenticated;

notify pgrst, 'reload schema';
