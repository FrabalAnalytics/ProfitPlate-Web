-- Give platform admins a direct, auditable way to repair QSR readiness for
-- existing restaurant workspaces. Migration 064 creates/backfills the default
-- Front Counter; this migration exposes that same setup as an admin action and
-- adds readiness counts to the platform estate summary.

create or replace function public.ensure_platform_admin_front_counter(
  target_organization_id uuid
)
returns public.locations
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_location public.locations;
begin
  if not public.current_user_is_platform_admin(
    array['super_admin', 'implementation_manager']
  ) then
    raise exception 'Only Super Admins and Implementation Managers can ensure the Front Counter.';
  end if;

  if target_organization_id is null then
    raise exception 'Select a restaurant workspace first.';
  end if;

  if not exists (
    select 1
    from public.organizations organization
    where organization.id = target_organization_id
  ) then
    raise exception 'Restaurant workspace not found.';
  end if;

  select location.*
    into selected_location
  from public.locations location
  where location.organization_id = target_organization_id
    and location.is_active = true
    and location.location_type = 'sales_outlet'::public.location_type
  order by
    case when lower(trim(location.name)) = 'front counter' then 0 else 1 end,
    location.created_at asc
  limit 1;

  if selected_location.id is not null then
    return selected_location;
  end if;

  insert into public.locations (
    tenant_id,
    organization_id,
    name,
    location_type,
    routing_model,
    inventory_domain,
    is_active
  ) values (
    target_organization_id,
    target_organization_id,
    'Front Counter',
    'sales_outlet',
    'model_1_single_location',
    'shared',
    true
  )
  returning * into selected_location;

  return selected_location;
end;
$$;

grant execute on function public.ensure_platform_admin_front_counter(uuid)
  to authenticated;

drop function if exists public.get_platform_admin_workspace_summary();

create function public.get_platform_admin_workspace_summary()
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
  active_sales_outlet_count integer,
  active_sku_count integer,
  manufactured_final_product_count integer,
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
    coalesce(sales_outlet_counts.active_sales_outlet_count, 0)::integer as active_sales_outlet_count,
    coalesce(sku_counts.active_sku_count, 0)::integer as active_sku_count,
    coalesce(final_product_counts.manufactured_final_product_count, 0)::integer as manufactured_final_product_count,
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
    select count(*) as active_sales_outlet_count
    from public.locations location
    where location.organization_id = organization.id
      and location.is_active
      and location.location_type = 'sales_outlet'::public.location_type
  ) sales_outlet_counts on true
  left join lateral (
    select count(*) as active_sku_count
    from public.inventory_items item
    where item.organization_id = organization.id
      and item.is_active
  ) sku_counts on true
  left join lateral (
    select count(*) as manufactured_final_product_count
    from public.inventory_items item
    where item.organization_id = organization.id
      and item.is_active
      and item.item_type = 'final_product'::public.inventory_item_type
      and item.cost_type = 'manufactured'::public.inventory_cost_type
  ) final_product_counts on true
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
