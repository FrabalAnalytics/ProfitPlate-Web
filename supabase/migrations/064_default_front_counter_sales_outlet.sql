-- QSR / fast-food production needs a predictable destination for finished
-- goods. Create one sales outlet/front counter during onboarding, and backfill
-- existing restaurant workspaces that do not have any active sales outlet yet.

-- The default Front Counter is platform infrastructure for QSR finished-goods
-- flow, not a customer-added operating branch. Keep normal subscription limits
-- intact, but allow exactly one active sales outlet/front counter to be created
-- for a workspace that does not already have one.
create or replace function public.enforce_location_subscription_limit()
returns trigger
language plpgsql
as $$
declare
  plan_limit integer;
  existing_count integer;
begin
  if new.organization_id is null then
    return new;
  end if;

  if coalesce(new.is_active, true)
     and new.location_type::text = 'sales_outlet'
     and lower(trim(coalesce(new.name, ''))) = 'front counter'
     and new.routing_model::text = 'model_1_single_location'
     and coalesce(new.inventory_domain, 'shared') = 'shared'
     and not exists (
       select 1
       from public.locations location
       where location.organization_id = new.organization_id
         and location.is_active = true
         and location.location_type = 'sales_outlet'::public.location_type
         and (tg_op = 'INSERT' or location.id <> new.id)
     ) then
    return new;
  end if;

  select sp.max_locations
    into plan_limit
  from public.organizations o
  join public.subscription_plans sp on sp.tier = o.subscription_tier
  where o.id = new.organization_id;

  select count(*)
    into existing_count
  from public.locations
  where organization_id = new.organization_id
    and is_active = true
    and (tg_op = 'INSERT' or id <> new.id);

  if plan_limit is not null and existing_count >= plan_limit then
    raise exception 'Location limit reached for current subscription tier. Upgrade to add more locations.';
  end if;

  return new;
end;
$$;

-- Some older databases still have a legacy compatibility trigger named around
-- sync_legacy_location_type(). That trigger casts modern public.location_type
-- values into an older location_type_enum, which cannot represent sales_outlet.
-- The current dashboard reads public.locations.location_type directly, so remove
-- only triggers that call that legacy sync function before creating Front Counter.
do $$
declare
  legacy_trigger record;
begin
  for legacy_trigger in
    select trigger_item.tgname
    from pg_trigger trigger_item
    join pg_proc proc_item on proc_item.oid = trigger_item.tgfoid
    join pg_class class_item on class_item.oid = trigger_item.tgrelid
    join pg_namespace namespace_item on namespace_item.oid = class_item.relnamespace
    where namespace_item.nspname = 'public'
      and class_item.relname = 'locations'
      and proc_item.proname = 'sync_legacy_location_type'
      and not trigger_item.tgisinternal
  loop
    execute format(
      'drop trigger if exists %I on public.locations',
      legacy_trigger.tgname
    );
  end loop;
end $$;

-- If the live database still has the old public.locations.type column, it may
-- be NOT NULL and backed by a legacy enum. Give it a safe legacy default so the
-- modern sales_outlet value can live in public.locations.location_type.
do $$
declare
  legacy_type_name text;
  legacy_default_value text;
begin
  select format('%I.%I', column_item.udt_schema, column_item.udt_name)
    into legacy_type_name
  from information_schema.columns column_item
  where column_item.table_schema = 'public'
    and column_item.table_name = 'locations'
    and column_item.column_name = 'type';

  if legacy_type_name is null then
    return;
  end if;

  select enum_item.enumlabel
    into legacy_default_value
  from pg_type type_item
  join pg_enum enum_item on enum_item.enumtypid = type_item.oid
  join pg_namespace namespace_item on namespace_item.oid = type_item.typnamespace
  where format('%I.%I', namespace_item.nspname, type_item.typname) = legacy_type_name
  order by case enum_item.enumlabel
    when 'main_store' then 0
    when 'store' then 1
    when 'central_warehouse' then 2
    else 3
  end, enum_item.enumsortorder
  limit 1;

  if legacy_default_value is null then
    return;
  end if;

  execute format(
    'alter table public.locations alter column type set default %L::%s',
    legacy_default_value,
    legacy_type_name
  );

  execute format(
    'update public.locations set type = %L::%s where type is null',
    legacy_default_value,
    legacy_type_name
  );
end $$;

create or replace function public.create_workspace(
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

  insert into public.locations (
    tenant_id,
    organization_id,
    name,
    location_type,
    routing_model,
    inventory_domain,
    is_active
  ) values (
    created_organization_id,
    created_organization_id,
    'Front Counter',
    'sales_outlet',
    'model_1_single_location',
    'shared',
    true
  );

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

grant execute on function public.create_workspace(text, public.subscription_tier, text)
  to authenticated;

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

  insert into public.locations (
    tenant_id,
    organization_id,
    name,
    location_type,
    routing_model,
    inventory_domain,
    is_active
  ) values (
    created_organization.id,
    created_organization.id,
    'Front Counter',
    'sales_outlet',
    'model_1_single_location',
    'shared',
    true
  );

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

insert into public.locations (
  tenant_id,
  organization_id,
  name,
  location_type,
  routing_model,
  inventory_domain,
  is_active
)
select
  organization.id,
  organization.id,
  'Front Counter',
  'sales_outlet',
  'model_1_single_location',
  'shared',
  true
from public.organizations organization
where not exists (
  select 1
  from public.locations location
  where location.organization_id = organization.id
    and location.is_active = true
    and location.location_type = 'sales_outlet'::public.location_type
);

notify pgrst, 'reload schema';
