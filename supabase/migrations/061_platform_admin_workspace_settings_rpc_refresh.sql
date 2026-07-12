-- Re-publish the platform workspace settings RPC so PostgREST/Supabase has a
-- fresh schema-cache entry for the Admin "Save changes" action.

create or replace function public.update_platform_admin_workspace_settings(
  target_organization_id uuid,
  system_status_value text default null,
  subscription_tier_value text default null,
  local_currency_value text default null
)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_organization public.organizations;
  normalized_currency text;
begin
  if not public.current_user_is_platform_admin(
    array['super_admin', 'implementation_manager']
  ) then
    raise exception 'Only Super Admins and Implementation Managers can update workspace settings.';
  end if;

  if target_organization_id is null then
    raise exception 'Select a restaurant workspace to manage.';
  end if;

  if system_status_value is not null
     and system_status_value not in ('implementation_mode', 'live_operations') then
    raise exception 'Unsupported system status: %', system_status_value;
  end if;

  if subscription_tier_value is not null
     and subscription_tier_value not in ('solo', 'multi_unit', 'enterprise_grid') then
    raise exception 'Unsupported subscription tier: %', subscription_tier_value;
  end if;

  normalized_currency := nullif(upper(trim(coalesce(local_currency_value, ''))), '');

  if normalized_currency is not null and length(normalized_currency) <> 3 then
    raise exception 'Currency must be a 3-letter code such as NGN, USD, or GBP.';
  end if;

  update public.organizations organization
     set system_status = coalesce(
           system_status_value::public.system_status,
           organization.system_status
         ),
         subscription_tier = coalesce(
           subscription_tier_value::public.subscription_tier,
           organization.subscription_tier
         ),
         local_currency = coalesce(
           normalized_currency,
           organization.local_currency
         )
   where organization.id = target_organization_id
   returning * into updated_organization;

  if updated_organization.id is null then
    raise exception 'Restaurant workspace not found.';
  end if;

  return updated_organization;
end;
$$;

grant execute on function public.update_platform_admin_workspace_settings(
  uuid,
  text,
  text,
  text
) to authenticated;

notify pgrst, 'reload schema';
