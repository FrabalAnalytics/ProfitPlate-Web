-- ProfitPlate Engine Core
-- Foundational schema for margin intelligence, transformation events, and
-- enforced operational guardrails.

create extension if not exists pgcrypto;

do $$
begin
  create type public.subscription_tier as enum ('solo', 'multi_unit', 'enterprise_grid');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.system_status as enum ('implementation_mode', 'live_operations');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.location_type as enum (
    'main_store',
    'central_warehouse',
    'local_kitchen',
    'kitchen_line',
    'bar',
    'department'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.routing_model as enum ('model_1_single_location', 'model_2_central_warehouse');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.inventory_item_type as enum ('raw_material', 'semi_finished', 'final_product');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.inventory_cost_type as enum ('purchased', 'manufactured');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.recipe_type as enum ('sub_recipe', 'final_menu_item');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.transaction_status as enum (
    'draft',
    'pending',
    'accepted',
    'completed',
    'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.transformation_event_type as enum (
    'po_receipt',
    'requisition_issue',
    'requisition_receive',
    'transfer_issue',
    'transfer_receive',
    'production_input_consumption',
    'production_output_receipt',
    'waste_event',
    'stock_count_adjustment',
    'cost_recalculation',
    'sales_depletion'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.variance_type as enum (
    'yield_variance',
    'waste_variance',
    'price_variance',
    'portioning_variance',
    'transfer_variance',
    'unrecorded_depletion'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.origin_attribution as enum (
    'kitchen_prep_line',
    'storage_defrosting',
    'central_transit',
    'cold_room_storage'
  );
exception when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.subscription_plans (
  tier public.subscription_tier primary key,
  name text not null,
  max_locations integer not null,
  allows_inter_store_transfers boolean not null default false,
  allows_model_2 boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.subscription_plans (
  tier,
  name,
  max_locations,
  allows_inter_store_transfers,
  allows_model_2
) values
  ('solo', 'Solo Operator', 1, false, false),
  ('multi_unit', 'Multi-Unit Group', 10, true, false),
  ('enterprise_grid', 'Enterprise Grid', 1000, true, true)
on conflict (tier) do update set
  name = excluded.name,
  max_locations = excluded.max_locations,
  allows_inter_store_transfers = excluded.allows_inter_store_transfers,
  allows_model_2 = excluded.allows_model_2;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  name text not null,
  subscription_tier public.subscription_tier not null default 'solo',
  system_status public.system_status not null default 'implementation_mode',
  routing_model public.routing_model not null default 'model_1_single_location',
  local_currency text not null default 'NGN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.organizations
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null default auth.uid();

drop trigger if exists set_organizations_updated_at on public.organizations;
create trigger set_organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  full_name text,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
      'chef',
      'viewer'
    )
  ) not valid;

alter table if exists public.profiles
  validate constraint profiles_role_allowed;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_type text not null,
  status public.transaction_status not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  requested_by uuid references auth.users(id) on delete set null default auth.uid(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  rejected_by uuid references auth.users(id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_requests_status_check check (
    status in ('pending', 'accepted', 'completed', 'cancelled')
  )
);

drop trigger if exists set_approval_requests_updated_at on public.approval_requests;
create trigger set_approval_requests_updated_at
before update on public.approval_requests
for each row execute function public.set_updated_at();

create table if not exists public.system_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  system_status public.system_status not null default 'implementation_mode',
  activated_at timestamptz,
  activated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_system_settings_updated_at on public.system_settings;
create trigger set_system_settings_updated_at
before update on public.system_settings
for each row execute function public.set_updated_at();

create table if not exists public.unit_conversions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  from_uom text not null,
  to_uom text not null,
  factor numeric(18, 8) not null check (factor > 0),
  is_standard boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, from_uom, to_uom)
);

-- Existing-table expansion. These ALTER statements preserve dashboard-created
-- tables while adding the columns required by the engine.
alter table if exists public.locations
  add column if not exists tenant_id uuid,
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists location_type public.location_type not null default 'main_store',
  add column if not exists routing_model public.routing_model not null default 'model_1_single_location',
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  location_type public.location_type not null default 'main_store',
  routing_model public.routing_model not null default 'model_1_single_location',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_locations_updated_at on public.locations;
create trigger set_locations_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

alter table if exists public.inventory_items
  add column if not exists tenant_id uuid,
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists recipe_id uuid,
  add column if not exists name text,
  add column if not exists sku text,
  add column if not exists department text,
  add column if not exists item_type public.inventory_item_type not null default 'raw_material',
  add column if not exists cost_type public.inventory_cost_type not null default 'purchased',
  add column if not exists base_uom text,
  add column if not exists purchase_pack_uom text,
  add column if not exists recipe_uom text,
  add column if not exists units_per_pack numeric(18, 6),
  add column if not exists current_cost_per_base_uom numeric(18, 6) not null default 0,
  add column if not exists yield_pct numeric(8, 4) not null default 1 check (yield_pct > 0 and yield_pct <= 1),
  add column if not exists shrinkage_factor_pct numeric(8, 4) not null default 0 check (shrinkage_factor_pct >= 0 and shrinkage_factor_pct < 1),
  add column if not exists on_hand_qty numeric(18, 6) not null default 0,
  add column if not exists on_hand_uom text,
  add column if not exists is_high_value boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  organization_id uuid references public.organizations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  recipe_id uuid,
  name text,
  sku text,
  department text,
  item_type public.inventory_item_type not null default 'raw_material',
  cost_type public.inventory_cost_type not null default 'purchased',
  base_uom text,
  purchase_pack_uom text,
  recipe_uom text,
  units_per_pack numeric(18, 6),
  current_cost_per_base_uom numeric(18, 6) not null default 0,
  yield_pct numeric(8, 4) not null default 1 check (yield_pct > 0 and yield_pct <= 1),
  shrinkage_factor_pct numeric(8, 4) not null default 0 check (shrinkage_factor_pct >= 0 and shrinkage_factor_pct < 1),
  on_hand_qty numeric(18, 6) not null default 0,
  on_hand_uom text,
  is_high_value boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_inventory_items_updated_at on public.inventory_items;
create trigger set_inventory_items_updated_at
before update on public.inventory_items
for each row execute function public.set_updated_at();

alter table if exists public.recipes
  add column if not exists tenant_id uuid,
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists output_uom text,
  add column if not exists standard_batch_output_qty numeric(18, 6) not null default 1 check (standard_batch_output_qty > 0),
  add column if not exists standard_yield_pct numeric(8, 4) not null default 1 check (standard_yield_pct > 0 and standard_yield_pct <= 1),
  add column if not exists selling_price numeric(18, 6) not null default 0 check (selling_price >= 0),
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  recipe_type public.recipe_type not null,
  output_uom text,
  standard_batch_output_qty numeric(18, 6) not null default 1 check (standard_batch_output_qty > 0),
  standard_yield_pct numeric(8, 4) not null default 1 check (standard_yield_pct > 0 and standard_yield_pct <= 1),
  resolved_unit_cost numeric(18, 6) not null default 0,
  selling_price numeric(18, 6) not null default 0 check (selling_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_recipes_updated_at on public.recipes;
create trigger set_recipes_updated_at
before update on public.recipes
for each row execute function public.set_updated_at();

create table if not exists public.recipe_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  component_inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  component_recipe_id uuid references public.recipes(id) on delete restrict,
  qty_in_recipe_uom numeric(18, 6) not null check (qty_in_recipe_uom > 0),
  recipe_uom text not null,
  created_at timestamptz not null default now(),
  constraint exactly_one_component_source check (
    (component_inventory_item_id is not null)::integer +
    (component_recipe_id is not null)::integer = 1
  )
);

alter table if exists public.requisitions
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists accepted_by uuid references auth.users(id) on delete set null,
  add column if not exists accepted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.requisitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  from_location_id uuid references public.locations(id) on delete restrict,
  to_location_id uuid references public.locations(id) on delete restrict,
  status public.transaction_status not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_requisitions_updated_at on public.requisitions;
create trigger set_requisitions_updated_at
before update on public.requisitions
for each row execute function public.set_updated_at();

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  supplier_name text,
  receiving_location_id uuid references public.locations(id) on delete restrict,
  status public.transaction_status not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_purchase_orders_updated_at on public.purchase_orders;
create trigger set_purchase_orders_updated_at
before update on public.purchase_orders
for each row execute function public.set_updated_at();

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  qty numeric(18, 6) not null check (qty > 0),
  landed_unit_cost numeric(18, 6) not null check (landed_unit_cost >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  from_location_id uuid references public.locations(id) on delete restrict,
  to_location_id uuid references public.locations(id) on delete restrict,
  status public.transaction_status not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_transfers_updated_at on public.transfers;
create trigger set_transfers_updated_at
before update on public.transfers
for each row execute function public.set_updated_at();

create table if not exists public.transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  qty numeric(18, 6) not null check (qty > 0),
  unit_cost numeric(18, 6) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.production_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete restrict,
  sub_recipe_id uuid not null references public.recipes(id) on delete restrict,
  target_output_qty numeric(18, 6) not null check (target_output_qty > 0),
  actual_output_qty numeric(18, 6),
  origin public.origin_attribution not null,
  status public.transaction_status not null default 'completed',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.production_run_inputs (
  id uuid primary key default gen_random_uuid(),
  production_run_id uuid not null references public.production_runs(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  target_qty_required numeric(18, 6) not null check (target_qty_required >= 0),
  actual_qty_used numeric(18, 6) not null check (actual_qty_used >= 0),
  waste_variance_qty numeric(18, 6) generated always as (actual_qty_used - target_qty_required) stored,
  unit_cost numeric(18, 6) not null default 0,
  naira_loss numeric(18, 6) generated always as ((actual_qty_used - target_qty_required) * unit_cost) stored,
  origin public.origin_attribution not null,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  status public.transaction_status not null default 'draft',
  frozen_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_stock_counts_updated_at on public.stock_counts;
create trigger set_stock_counts_updated_at
before update on public.stock_counts
for each row execute function public.set_updated_at();

create table if not exists public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  stock_count_id uuid not null references public.stock_counts(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  counted_qty numeric(18, 6) not null check (counted_qty >= 0),
  system_qty numeric(18, 6),
  variance_qty numeric(18, 6) generated always as (coalesce(system_qty, 0) - counted_qty) stored,
  unit_cost numeric(18, 6) not null default 0,
  created_at timestamptz not null default now()
);

alter table if exists public.transformation_events
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  add column if not exists location_id uuid references public.locations(id) on delete restrict,
  add column if not exists quantity numeric(18, 6) not null default 0,
  add column if not exists unit_cost numeric(18, 6) not null default 0,
  add column if not exists total_cost numeric(18, 6) generated always as (quantity * unit_cost) stored,
  add column if not exists source_table text,
  add column if not exists source_id uuid,
  add column if not exists variance_type public.variance_type,
  add column if not exists origin public.origin_attribution,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create table if not exists public.transformation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  event_type public.transformation_event_type not null,
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  location_id uuid references public.locations(id) on delete restrict,
  quantity numeric(18, 6) not null default 0,
  unit_cost numeric(18, 6) not null default 0,
  total_cost numeric(18, 6) generated always as (quantity * unit_cost) stored,
  source_table text,
  source_id uuid,
  variance_type public.variance_type,
  origin public.origin_attribution,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.variance_attributions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete restrict,
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  variance_type public.variance_type not null,
  variance_qty numeric(18, 6) not null default 0,
  unit_cost numeric(18, 6) not null default 0,
  hard_currency_impact numeric(18, 6) generated always as (variance_qty * unit_cost) stored,
  source_table text,
  source_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.waste_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  quantity numeric(18, 6) not null check (quantity > 0),
  unit_cost numeric(18, 6) not null default 0,
  waste_reason text not null default 'spoilage',
  waste_stage text not null default 'prep',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.cost_recalculation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  recipe_id uuid references public.recipes(id) on delete set null,
  old_cost numeric(18, 6) not null default 0,
  new_cost numeric(18, 6) not null default 0,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_items_org on public.inventory_items(organization_id);
create index if not exists idx_inventory_items_location on public.inventory_items(location_id);
create index if not exists idx_recipes_org on public.recipes(organization_id);
create index if not exists idx_recipe_components_recipe on public.recipe_components(recipe_id);
create index if not exists idx_recipe_components_component_recipe on public.recipe_components(component_recipe_id);
create index if not exists idx_transformation_events_org_location on public.transformation_events(organization_id, location_id);
create index if not exists idx_transformation_events_item on public.transformation_events(inventory_item_id);
create index if not exists idx_variance_attributions_org_location on public.variance_attributions(organization_id, location_id);
create index if not exists idx_waste_events_org_created on public.waste_events(organization_id, created_at desc);
create index if not exists idx_waste_events_item on public.waste_events(inventory_item_id);
create index if not exists idx_approval_requests_org_status
  on public.approval_requests(organization_id, status, created_at desc);

create or replace function public.user_can_access_organization(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = target_organization_id
      and o.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.organization_id = target_organization_id
  );
$$;

create or replace function public.current_profile_role()
returns text
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.role
      from public.profiles p
      where p.id = auth.uid()
      limit 1
    ),
    'viewer'
  );
$$;

create or replace function public.user_has_any_role(allowed_roles text[])
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.current_profile_role() = any(allowed_roles);
$$;

create or replace function public.user_can_manage_workspace(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.user_can_access_organization(target_organization_id)
    and public.user_has_any_role(array['owner', 'admin']);
$$;

create or replace function public.user_can_manage_costing(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.user_can_access_organization(target_organization_id)
    and public.user_has_any_role(
      array['owner', 'admin', 'manager', 'finance_manager', 'procurement_manager']
    );
$$;

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
        'chef'
      ]
    );
$$;

create or replace function public.user_can_approve_operations(target_organization_id uuid)
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
        'finance_manager'
      ]
    );
$$;

create or replace function public.require_dashboard_permission(
  target_organization_id uuid,
  permission_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_organization_id is null then
    raise exception 'Create a workspace before continuing.';
  end if;

  if permission_name = 'workspace' then
    if not public.user_can_manage_workspace(target_organization_id) then
      raise exception 'Only owners and admins can manage workspace settings and roles.';
    end if;
  elsif permission_name = 'costing' then
    if not public.user_can_manage_costing(target_organization_id) then
      raise exception 'Only owners, admins, and managers can change costing, recipes, or menu pricing.';
    end if;
  elsif permission_name = 'operations' then
    if not public.user_can_record_operations(target_organization_id) then
      raise exception 'Your role can view this workspace but cannot record operational activity.';
    end if;
  elsif permission_name = 'approval' then
    if not public.user_can_approve_operations(target_organization_id) then
      raise exception 'Only owners, admins, and managers can approve operational requests.';
    end if;
  else
    raise exception 'Unknown dashboard permission: %', permission_name;
  end if;
end;
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.system_settings enable row level security;
alter table public.unit_conversions enable row level security;
alter table public.locations enable row level security;
alter table public.inventory_items enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_components enable row level security;
alter table public.requisitions enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.transfers enable row level security;
alter table public.transfer_lines enable row level security;
alter table public.production_runs enable row level security;
alter table public.production_run_inputs enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
alter table public.transformation_events enable row level security;
alter table public.variance_attributions enable row level security;
alter table public.waste_events enable row level security;
alter table public.cost_recalculation_events enable row level security;
alter table public.approval_requests enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.user_can_manage_workspace(organization_id)
);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid() and role = public.current_profile_role());

drop policy if exists "profiles_update_by_workspace_admin" on public.profiles;
create policy "profiles_update_by_workspace_admin"
on public.profiles
for update
to authenticated
using (public.user_can_manage_workspace(organization_id))
with check (public.user_can_manage_workspace(organization_id));

drop policy if exists "organizations_insert_owned" on public.organizations;
create policy "organizations_insert_owned"
on public.organizations
for insert
to authenticated
with check (coalesce(owner_user_id, auth.uid()) = auth.uid());

drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member"
on public.organizations
for select
to authenticated
using (public.user_can_access_organization(id));

drop policy if exists "organizations_update_member" on public.organizations;
create policy "organizations_update_member"
on public.organizations
for update
to authenticated
using (public.user_can_manage_workspace(id))
with check (public.user_can_manage_workspace(id));

drop policy if exists "system_settings_member_all" on public.system_settings;
create policy "system_settings_member_all"
on public.system_settings
for all
to authenticated
using (public.user_can_manage_workspace(organization_id))
with check (public.user_can_manage_workspace(organization_id));

drop policy if exists "unit_conversions_member_all" on public.unit_conversions;
create policy "unit_conversions_member_all"
on public.unit_conversions
for all
to authenticated
using (public.user_can_manage_costing(organization_id))
with check (public.user_can_manage_costing(organization_id));

drop policy if exists "locations_member_all" on public.locations;
create policy "locations_member_all"
on public.locations
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_manage_workspace(organization_id));

drop policy if exists "inventory_items_member_all" on public.inventory_items;
create policy "inventory_items_member_all"
on public.inventory_items
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (
  public.user_can_manage_costing(organization_id)
  or public.user_can_record_operations(organization_id)
);

drop policy if exists "recipes_member_all" on public.recipes;
create policy "recipes_member_all"
on public.recipes
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_manage_costing(organization_id));

drop policy if exists "recipe_components_member_all" on public.recipe_components;
create policy "recipe_components_member_all"
on public.recipe_components
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_manage_costing(organization_id));

drop policy if exists "requisitions_member_all" on public.requisitions;
create policy "requisitions_member_all"
on public.requisitions
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_record_operations(organization_id));

drop policy if exists "purchase_orders_member_all" on public.purchase_orders;
create policy "purchase_orders_member_all"
on public.purchase_orders
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_record_operations(organization_id));

drop policy if exists "purchase_order_lines_member_all" on public.purchase_order_lines;
create policy "purchase_order_lines_member_all"
on public.purchase_order_lines
for all
to authenticated
using (
  exists (
    select 1
    from public.purchase_orders po
    where po.id = purchase_order_id
      and public.user_can_access_organization(po.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.purchase_orders po
    where po.id = purchase_order_id
      and public.user_can_record_operations(po.organization_id)
  )
);

drop policy if exists "transfers_member_all" on public.transfers;
create policy "transfers_member_all"
on public.transfers
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_record_operations(organization_id));

drop policy if exists "transfer_lines_member_all" on public.transfer_lines;
create policy "transfer_lines_member_all"
on public.transfer_lines
for all
to authenticated
using (
  exists (
    select 1
    from public.transfers t
    where t.id = transfer_id
      and public.user_can_access_organization(t.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.transfers t
    where t.id = transfer_id
      and public.user_can_record_operations(t.organization_id)
  )
);

drop policy if exists "production_runs_member_all" on public.production_runs;
create policy "production_runs_member_all"
on public.production_runs
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_record_operations(organization_id));

drop policy if exists "production_run_inputs_member_all" on public.production_run_inputs;
create policy "production_run_inputs_member_all"
on public.production_run_inputs
for all
to authenticated
using (
  exists (
    select 1
    from public.production_runs pr
    where pr.id = production_run_id
      and public.user_can_access_organization(pr.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.production_runs pr
    where pr.id = production_run_id
      and public.user_can_record_operations(pr.organization_id)
  )
);

drop policy if exists "stock_counts_member_all" on public.stock_counts;
create policy "stock_counts_member_all"
on public.stock_counts
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_record_operations(organization_id));

drop policy if exists "stock_count_lines_member_all" on public.stock_count_lines;
create policy "stock_count_lines_member_all"
on public.stock_count_lines
for all
to authenticated
using (
  exists (
    select 1
    from public.stock_counts sc
    where sc.id = stock_count_id
      and public.user_can_access_organization(sc.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.stock_counts sc
    where sc.id = stock_count_id
      and public.user_can_record_operations(sc.organization_id)
  )
);

drop policy if exists "transformation_events_member_insert_select" on public.transformation_events;
create policy "transformation_events_member_insert_select"
on public.transformation_events
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_record_operations(organization_id));

drop policy if exists "variance_attributions_member_all" on public.variance_attributions;
create policy "variance_attributions_member_all"
on public.variance_attributions
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_record_operations(organization_id));

drop policy if exists "waste_events_member_all" on public.waste_events;
create policy "waste_events_member_all"
on public.waste_events
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_record_operations(organization_id));

drop policy if exists "cost_recalculation_events_member_select" on public.cost_recalculation_events;
create policy "cost_recalculation_events_member_select"
on public.cost_recalculation_events
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "cost_recalculation_events_member_insert" on public.cost_recalculation_events;
create policy "cost_recalculation_events_member_insert"
on public.cost_recalculation_events
for insert
to authenticated
with check (public.user_can_manage_costing(organization_id));

drop policy if exists "approval_requests_member_select" on public.approval_requests;
create policy "approval_requests_member_select"
on public.approval_requests
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "approval_requests_member_insert" on public.approval_requests;
create policy "approval_requests_member_insert"
on public.approval_requests
for insert
to authenticated
with check (
  public.user_can_record_operations(organization_id)
  and requested_by = auth.uid()
);

drop policy if exists "approval_requests_approver_update" on public.approval_requests;
create policy "approval_requests_approver_update"
on public.approval_requests
for update
to authenticated
using (public.user_can_approve_operations(organization_id))
with check (public.user_can_approve_operations(organization_id));

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
    role = coalesce(public.profiles.role, excluded.role);

  select o.*
    into created_organization
  from public.organizations o
  where o.id = created_organization_id;

  return created_organization;
end;
$$;

grant execute on function public.create_workspace(text, public.subscription_tier, text) to authenticated;

drop function if exists public.submit_dashboard_approval_request(text, jsonb);

create function public.submit_dashboard_approval_request(
  request_type_value text,
  request_payload jsonb default '{}'::jsonb
)
returns public.approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  created_request public.approval_requests;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to request approval.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  if nullif(trim(request_type_value), '') is null then
    raise exception 'Approval request type is required.';
  end if;

  insert into public.approval_requests (
    organization_id,
    request_type,
    payload,
    requested_by
  ) values (
    current_organization_id,
    trim(request_type_value),
    coalesce(request_payload, '{}'::jsonb),
    current_user_id
  )
  returning * into created_request;

  return created_request;
end;
$$;

grant execute on function public.submit_dashboard_approval_request(text, jsonb) to authenticated;

drop function if exists public.approve_dashboard_request(uuid);

create function public.approve_dashboard_request(target_request_id uuid)
returns public.approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
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

drop function if exists public.reject_dashboard_request(uuid, text);

create function public.reject_dashboard_request(
  target_request_id uuid,
  rejection_reason_value text default null
)
returns public.approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  selected_request public.approval_requests;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to reject requests.';
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
    raise exception 'Only pending requests can be rejected.';
  end if;

  update public.approval_requests
     set status = 'cancelled',
         rejected_by = current_user_id,
         rejected_at = now(),
         rejection_reason = nullif(trim(coalesce(rejection_reason_value, '')), '')
   where id = selected_request.id
   returning * into selected_request;

  return selected_request;
end;
$$;

grant execute on function public.reject_dashboard_request(uuid, text) to authenticated;

drop function if exists public.create_recipe_from_dashboard(text, text, text, numeric);
drop function if exists public.create_recipe_from_dashboard(text, text, text, numeric, numeric);
drop function if exists public.create_recipe_from_dashboard(text, text, text, numeric, numeric, numeric);

create function public.create_recipe_from_dashboard(
  recipe_name text,
  recipe_type_value text default 'sub_recipe',
  recipe_output_uom text default 'kg',
  recipe_standard_batch_output_qty numeric default 1,
  recipe_standard_yield_pct numeric default 1,
  recipe_selling_price numeric default 0
)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  normalized_recipe_type text;
  created_recipe public.recipes;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to create a recipe.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before adding recipes.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'costing');

  if nullif(trim(recipe_name), '') is null then
    raise exception 'Recipe name is required.';
  end if;

  if recipe_standard_batch_output_qty is null or recipe_standard_batch_output_qty <= 0 then
    raise exception 'Standard batch output must be greater than zero.';
  end if;

  normalized_recipe_type := case
    when recipe_type_value in ('final_menu_item', 'final_dish')
      and exists (
        select 1
        from pg_attribute a
        join pg_type t on t.oid = a.atttypid
        join pg_enum e on e.enumtypid = t.oid
        where a.attrelid = 'public.recipes'::regclass
          and a.attname = 'recipe_type'
          and e.enumlabel = 'final_dish'
      ) then 'final_dish'
    when recipe_type_value in ('final_menu_item', 'final_dish') then 'final_menu_item'
    else 'sub_recipe'
  end;

  execute format(
    'insert into public.recipes (
      tenant_id,
      organization_id,
      name,
      recipe_type,
      output_uom,
      standard_batch_output_qty,
      standard_yield_pct,
      selling_price,
      is_active
    ) values (
      $1,
      $1,
      $2,
      %L,
      $3,
      $4,
      $5,
      $6,
      true
    ) returning *',
    normalized_recipe_type
  )
  into created_recipe
  using
    current_organization_id,
    trim(recipe_name),
    coalesce(nullif(trim(recipe_output_uom), ''), 'kg'),
    recipe_standard_batch_output_qty,
    coalesce(recipe_standard_yield_pct, 1),
    greatest(coalesce(recipe_selling_price, 0), 0);

  return created_recipe;
end;
$$;

grant execute on function public.create_recipe_from_dashboard(text, text, text, numeric, numeric, numeric) to authenticated;

drop function if exists public.update_dashboard_recipe_selling_price(uuid, numeric);

create function public.update_dashboard_recipe_selling_price(
  target_recipe_id uuid,
  next_selling_price numeric
)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  updated_recipe public.recipes;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to update menu pricing.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before updating menu pricing.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'costing');

  update public.recipes
     set selling_price = greatest(coalesce(next_selling_price, 0), 0)
   where id = target_recipe_id
     and organization_id = current_organization_id
     and recipe_type::text in ('final_menu_item', 'final_dish')
   returning * into updated_recipe;

  if updated_recipe.id is null then
    raise exception 'Final menu item not found for this workspace.';
  end if;

  return updated_recipe;
end;
$$;

grant execute on function public.update_dashboard_recipe_selling_price(uuid, numeric) to authenticated;

drop function if exists public.add_recipe_inventory_component(uuid, uuid, numeric);

create function public.add_recipe_inventory_component(
  target_recipe_id uuid,
  target_inventory_item_id uuid,
  component_quantity numeric
)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  component_uom text;
  recalculated_cost numeric(18, 6);
  updated_recipe public.recipes;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to update a recipe.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before adding recipe components.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'costing');

  perform public.require_dashboard_permission(current_organization_id, 'costing');

  if component_quantity is null or component_quantity <= 0 then
    raise exception 'Component quantity must be greater than zero.';
  end if;

  if not exists (
    select 1
    from public.recipes r
    where r.id = target_recipe_id
      and r.organization_id = current_organization_id
  ) then
    raise exception 'Recipe not found for this workspace.';
  end if;

  select coalesce(ii.recipe_uom, ii.base_uom, ii.on_hand_uom, 'unit')
    into component_uom
  from public.inventory_items ii
  where ii.id = target_inventory_item_id
    and ii.organization_id = current_organization_id;

  if component_uom is null then
    raise exception 'Ingredient not found for this workspace.';
  end if;

  insert into public.recipe_components (
    organization_id,
    recipe_id,
    component_inventory_item_id,
    qty_in_recipe_uom,
    recipe_uom
  ) values (
    current_organization_id,
    target_recipe_id,
    target_inventory_item_id,
    component_quantity,
    component_uom
  );

  select coalesce(
      sum(rc.qty_in_recipe_uom * ii.current_cost_per_base_uom)
      / nullif(r.standard_batch_output_qty, 0),
      0
    )
    into recalculated_cost
  from public.recipe_components rc
  join public.inventory_items ii on ii.id = rc.component_inventory_item_id
  join public.recipes r on r.id = rc.recipe_id
  where rc.recipe_id = target_recipe_id
    and rc.organization_id = current_organization_id
  group by r.standard_batch_output_qty;

  perform set_config('profitplate.allow_cost_update', 'on', true);

  update public.recipes
     set resolved_unit_cost = recalculated_cost
   where id = target_recipe_id
     and organization_id = current_organization_id
   returning * into updated_recipe;

  insert into public.cost_recalculation_events (
    organization_id,
    recipe_id,
    old_cost,
    new_cost,
    reason
  ) values (
    current_organization_id,
    target_recipe_id,
    0,
    recalculated_cost,
    'dashboard_recipe_component_update'
  );

  return updated_recipe;
end;
$$;

grant execute on function public.add_recipe_inventory_component(uuid, uuid, numeric) to authenticated;

drop function if exists public.add_recipe_inventory_components(uuid, jsonb);
drop function if exists public.add_recipe_inventory_components(text, jsonb);

create function public.add_recipe_inventory_components(
  target_recipe_id text,
  component_lines jsonb
)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_profile_organization_id uuid;
  resolved_organization_id uuid;
  component_line jsonb;
  normalized_recipe_id uuid;
  target_inventory_item_id uuid;
  component_uom text;
  component_quantity numeric;
  old_recipe_cost numeric(18, 6);
  recalculated_cost numeric(18, 6);
  updated_recipe public.recipes;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to update a recipe.';
  end if;

  select p.organization_id
    into current_profile_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_profile_organization_id is null then
    raise exception 'Create a workspace before adding recipe components.';
  end if;

  if component_lines is null or jsonb_typeof(component_lines) <> 'array' then
    raise exception 'Ingredient lines must be an array.';
  end if;

  if jsonb_array_length(component_lines) = 0 then
    raise exception 'Add at least one ingredient line.';
  end if;

  normalized_recipe_id := substring(
    target_recipe_id
    from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
  )::uuid;

  select r.id, r.organization_id, r.resolved_unit_cost
    into normalized_recipe_id, resolved_organization_id, old_recipe_cost
  from public.recipes r
  where r.id = normalized_recipe_id
    and public.user_can_access_organization(r.organization_id);

  if normalized_recipe_id is null then
    select r.id, r.organization_id, r.resolved_unit_cost
      into normalized_recipe_id, resolved_organization_id, old_recipe_cost
    from public.inventory_items ii
    join public.recipes r on r.id = ii.recipe_id
    where ii.id = substring(
        target_recipe_id
        from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
      )::uuid
      and public.user_can_access_organization(r.organization_id)
    limit 1;
  end if;

  if normalized_recipe_id is null or resolved_organization_id is null then
    raise exception 'Recipe not found for this workspace.';
  end if;

  for component_line in
    select value from jsonb_array_elements(component_lines)
  loop
    target_inventory_item_id := substring(
      component_line->>'inventory_item_id'
      from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
    )::uuid;
    component_quantity := nullif(component_line->>'quantity', '')::numeric;

    if target_inventory_item_id is null
       or component_quantity is null
       or component_quantity <= 0 then
      raise exception 'Each ingredient line needs an ingredient and quantity greater than zero.';
    end if;

    select coalesce(ii.recipe_uom, ii.base_uom, ii.on_hand_uom, 'unit')
      into component_uom
    from public.inventory_items ii
    where ii.id = target_inventory_item_id
      and ii.organization_id = resolved_organization_id;

    if component_uom is null then
      raise exception 'Ingredient not found for this workspace.';
    end if;

    insert into public.recipe_components (
      organization_id,
      recipe_id,
      component_inventory_item_id,
      qty_in_recipe_uom,
      recipe_uom
    ) values (
      resolved_organization_id,
      normalized_recipe_id,
      target_inventory_item_id,
      component_quantity,
      component_uom
    );
  end loop;

  select coalesce(
      sum(rc.qty_in_recipe_uom * ii.current_cost_per_base_uom)
      / nullif(r.standard_batch_output_qty, 0),
      0
    )
    into recalculated_cost
  from public.recipe_components rc
  join public.inventory_items ii on ii.id = rc.component_inventory_item_id
  join public.recipes r on r.id = rc.recipe_id
  where rc.recipe_id = normalized_recipe_id
    and rc.organization_id = resolved_organization_id
  group by r.standard_batch_output_qty;

  perform set_config('profitplate.allow_cost_update', 'on', true);

  update public.recipes
     set resolved_unit_cost = coalesce(recalculated_cost, 0)
   where id = normalized_recipe_id
     and organization_id = resolved_organization_id
   returning * into updated_recipe;

  insert into public.cost_recalculation_events (
    organization_id,
    recipe_id,
    old_cost,
    new_cost,
    reason
  ) values (
    resolved_organization_id,
    normalized_recipe_id,
    coalesce(old_recipe_cost, 0),
    coalesce(recalculated_cost, 0),
    'dashboard_recipe_component_bulk_update'
  );

  return updated_recipe;
end;
$$;

grant execute on function public.add_recipe_inventory_components(text, jsonb) to authenticated;

drop function if exists public.get_dashboard_recipes();

create function public.get_dashboard_recipes()
returns setof public.recipes
language sql
security definer
set search_path = public
as $$
  select r.*
  from public.recipes r
  join public.profiles p on p.organization_id = r.organization_id
  where p.id = auth.uid()
  order by r.created_at desc;
$$;

grant execute on function public.get_dashboard_recipes() to authenticated;

drop function if exists public.get_dashboard_recipe_details();

create function public.get_dashboard_recipe_details()
returns table (
  id uuid,
  tenant_id uuid,
  organization_id uuid,
  name text,
  recipe_type text,
  output_uom text,
  standard_batch_output_qty numeric,
  standard_yield_pct numeric,
  resolved_unit_cost numeric,
  selling_price numeric,
  is_active boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    r.id,
    r.tenant_id,
    r.organization_id,
    r.name,
    r.recipe_type::text as recipe_type,
    r.output_uom,
    r.standard_batch_output_qty,
    r.standard_yield_pct,
    r.resolved_unit_cost,
    r.selling_price,
    r.is_active,
    r.created_at
  from public.recipes r
  join public.profiles p
    on p.organization_id = r.organization_id
  where p.id = auth.uid()
  order by r.created_at desc;
$$;

grant execute on function public.get_dashboard_recipe_details() to authenticated;

drop function if exists public.get_dashboard_recipe_components();

create function public.get_dashboard_recipe_components()
returns setof public.recipe_components
language sql
security definer
set search_path = public
as $$
  select rc.*
  from public.recipe_components rc
  join public.profiles p on p.organization_id = rc.organization_id
  where p.id = auth.uid()
  order by rc.created_at asc;
$$;

grant execute on function public.get_dashboard_recipe_components() to authenticated;

drop function if exists public.get_dashboard_recipe_component_details();

create function public.get_dashboard_recipe_component_details()
returns table (
  id uuid,
  organization_id uuid,
  recipe_id uuid,
  component_inventory_item_id uuid,
  component_recipe_id uuid,
  qty_in_recipe_uom numeric,
  recipe_uom text,
  ingredient_name text,
  ingredient_unit_cost numeric,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    rc.id,
    rc.organization_id,
    rc.recipe_id,
    rc.component_inventory_item_id,
    rc.component_recipe_id,
    rc.qty_in_recipe_uom,
    rc.recipe_uom,
    ii.name as ingredient_name,
    ii.current_cost_per_base_uom as ingredient_unit_cost,
    rc.created_at
  from public.recipe_components rc
  left join public.inventory_items ii
    on ii.id = rc.component_inventory_item_id
  join public.profiles p
    on p.organization_id = rc.organization_id
  where p.id = auth.uid()
  order by rc.created_at asc;
$$;

grant execute on function public.get_dashboard_recipe_component_details() to authenticated;

drop function if exists public.create_dashboard_purchase_receipt(uuid, numeric, numeric, text);

create function public.create_dashboard_purchase_receipt(
  target_inventory_item_id uuid,
  receipt_quantity numeric,
  receipt_landed_unit_cost numeric,
  supplier_name_value text default null
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  selected_item public.inventory_items;
  created_purchase_order_id uuid;
  next_on_hand_qty numeric(18, 6);
  next_unit_cost numeric(18, 6);
  updated_item public.inventory_items;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to receive stock.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before receiving stock.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  if receipt_quantity is null or receipt_quantity <= 0 then
    raise exception 'Receipt quantity must be greater than zero.';
  end if;

  if receipt_landed_unit_cost is null or receipt_landed_unit_cost < 0 then
    raise exception 'Landed unit cost cannot be negative.';
  end if;

  select *
    into selected_item
  from public.inventory_items
  where id = target_inventory_item_id
    and organization_id = current_organization_id
    and cost_type = 'purchased'
    and is_active = true;

  if selected_item.id is null then
    raise exception 'Ingredient not found for this workspace.';
  end if;

  next_on_hand_qty := coalesce(selected_item.on_hand_qty, 0) + receipt_quantity;

  next_unit_cost := case
    when coalesce(selected_item.on_hand_qty, 0) > 0 and next_on_hand_qty > 0 then
      (
        (coalesce(selected_item.on_hand_qty, 0) * coalesce(selected_item.current_cost_per_base_uom, 0))
        + (receipt_quantity * receipt_landed_unit_cost)
      ) / next_on_hand_qty
    else receipt_landed_unit_cost
  end;

  insert into public.purchase_orders (
    organization_id,
    supplier_name,
    status,
    created_by,
    accepted_by,
    accepted_at
  ) values (
    current_organization_id,
    nullif(trim(coalesce(supplier_name_value, '')), ''),
    'completed',
    current_user_id,
    current_user_id,
    now()
  )
  returning id into created_purchase_order_id;

  insert into public.purchase_order_lines (
    purchase_order_id,
    inventory_item_id,
    qty,
    landed_unit_cost
  ) values (
    created_purchase_order_id,
    selected_item.id,
    receipt_quantity,
    receipt_landed_unit_cost
  );

  update public.inventory_items
     set on_hand_qty = next_on_hand_qty,
         current_cost_per_base_uom = next_unit_cost,
         on_hand_uom = coalesce(on_hand_uom, base_uom, recipe_uom, 'unit')
   where id = selected_item.id
     and organization_id = current_organization_id
   returning * into updated_item;

  return updated_item;
end;
$$;

grant execute on function public.create_dashboard_purchase_receipt(uuid, numeric, numeric, text) to authenticated;

drop function if exists public.create_dashboard_purchase_receipt_lines(jsonb, text);

create function public.create_dashboard_purchase_receipt_lines(
  receipt_lines jsonb,
  supplier_name_value text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  created_purchase_order_id uuid;
  receipt_line jsonb;
  target_inventory_item_id uuid;
  receipt_quantity numeric(18, 6);
  receipt_landed_unit_cost numeric(18, 6);
  selected_item public.inventory_items;
  next_on_hand_qty numeric(18, 6);
  next_unit_cost numeric(18, 6);
  created_line_count integer := 0;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to receive stock.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before receiving stock.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  if receipt_lines is null or jsonb_typeof(receipt_lines) <> 'array' or jsonb_array_length(receipt_lines) = 0 then
    raise exception 'Add at least one receipt line.';
  end if;

  insert into public.purchase_orders (
    organization_id,
    supplier_name,
    status,
    created_by,
    accepted_by,
    accepted_at
  ) values (
    current_organization_id,
    nullif(trim(coalesce(supplier_name_value, '')), ''),
    'completed',
    current_user_id,
    current_user_id,
    now()
  )
  returning id into created_purchase_order_id;

  for receipt_line in
    select value from jsonb_array_elements(receipt_lines)
  loop
    target_inventory_item_id := nullif(receipt_line->>'inventory_item_id', '')::uuid;
    receipt_quantity := nullif(receipt_line->>'quantity', '')::numeric;
    receipt_landed_unit_cost := nullif(receipt_line->>'landed_unit_cost', '')::numeric;

    if target_inventory_item_id is null
       or receipt_quantity is null
       or receipt_quantity <= 0
       or receipt_landed_unit_cost is null
       or receipt_landed_unit_cost < 0 then
      raise exception 'Every receipt line needs an ingredient, quantity, and landed unit cost.';
    end if;

    select *
      into selected_item
    from public.inventory_items
    where id = target_inventory_item_id
      and organization_id = current_organization_id
      and cost_type = 'purchased'
      and is_active = true;

    if selected_item.id is null then
      raise exception 'Ingredient not found for this workspace.';
    end if;

    next_on_hand_qty := coalesce(selected_item.on_hand_qty, 0) + receipt_quantity;

    next_unit_cost := case
      when coalesce(selected_item.on_hand_qty, 0) > 0 and next_on_hand_qty > 0 then
        (
          (coalesce(selected_item.on_hand_qty, 0) * coalesce(selected_item.current_cost_per_base_uom, 0))
          + (receipt_quantity * receipt_landed_unit_cost)
        ) / next_on_hand_qty
      else receipt_landed_unit_cost
    end;

    insert into public.purchase_order_lines (
      purchase_order_id,
      inventory_item_id,
      qty,
      landed_unit_cost
    ) values (
      created_purchase_order_id,
      selected_item.id,
      receipt_quantity,
      receipt_landed_unit_cost
    );

    update public.inventory_items
       set on_hand_qty = next_on_hand_qty,
           current_cost_per_base_uom = next_unit_cost,
           on_hand_uom = coalesce(on_hand_uom, base_uom, recipe_uom, 'unit')
     where id = selected_item.id
       and organization_id = current_organization_id;

    created_line_count := created_line_count + 1;
  end loop;

  return created_line_count;
end;
$$;

grant execute on function public.create_dashboard_purchase_receipt_lines(jsonb, text) to authenticated;

drop function if exists public.create_dashboard_stock_count(uuid, numeric);

create function public.create_dashboard_stock_count(
  target_inventory_item_id uuid,
  counted_quantity numeric
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  selected_item public.inventory_items;
  selected_location_id uuid;
  created_stock_count_id uuid;
  system_quantity numeric(18, 6);
  variance_quantity numeric(18, 6);
  updated_item public.inventory_items;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to record a stock count.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before recording stock counts.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  if counted_quantity is null or counted_quantity < 0 then
    raise exception 'Counted quantity cannot be negative.';
  end if;

  select *
    into selected_item
  from public.inventory_items
  where id = target_inventory_item_id
    and organization_id = current_organization_id
    and is_active = true;

  if selected_item.id is null then
    raise exception 'Inventory item not found for this workspace.';
  end if;

  select l.id
    into selected_location_id
  from public.locations l
  where l.organization_id = current_organization_id
    and l.is_active = true
  order by l.created_at asc
  limit 1;

  if selected_location_id is null then
    insert into public.locations (
      tenant_id,
      organization_id,
      name,
      location_type,
      routing_model,
      is_active
    ) values (
      current_organization_id,
      current_organization_id,
      'Main Store',
      'main_store',
      'model_1_single_location',
      true
    )
    returning id into selected_location_id;
  end if;

  system_quantity := coalesce(selected_item.on_hand_qty, 0);
  variance_quantity := system_quantity - counted_quantity;

  insert into public.stock_counts (
    organization_id,
    location_id,
    status,
    frozen_at,
    created_by
  ) values (
    current_organization_id,
    selected_location_id,
    'completed',
    now(),
    current_user_id
  )
  returning id into created_stock_count_id;

  insert into public.stock_count_lines (
    stock_count_id,
    inventory_item_id,
    counted_qty,
    system_qty,
    unit_cost
  ) values (
    created_stock_count_id,
    selected_item.id,
    counted_quantity,
    system_quantity,
    coalesce(selected_item.current_cost_per_base_uom, 0)
  );

  if variance_quantity <> 0 then
    insert into public.variance_attributions (
      organization_id,
      location_id,
      inventory_item_id,
      variance_type,
      variance_qty,
      unit_cost,
      source_table,
      source_id
    ) values (
      current_organization_id,
      selected_location_id,
      selected_item.id,
      'unrecorded_depletion',
      variance_quantity,
      coalesce(selected_item.current_cost_per_base_uom, 0),
      'stock_counts',
      created_stock_count_id
    );
  end if;

  update public.inventory_items
     set on_hand_qty = counted_quantity
   where id = selected_item.id
     and organization_id = current_organization_id
   returning * into updated_item;

  return updated_item;
end;
$$;

grant execute on function public.create_dashboard_stock_count(uuid, numeric) to authenticated;

drop function if exists public.create_dashboard_stock_count_lines(jsonb);

create function public.create_dashboard_stock_count_lines(
  count_lines jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  selected_location_id uuid;
  created_stock_count_id uuid;
  count_line jsonb;
  target_inventory_item_id uuid;
  counted_quantity numeric(18, 6);
  selected_item public.inventory_items;
  system_quantity numeric(18, 6);
  variance_quantity numeric(18, 6);
  created_line_count integer := 0;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to record a stock count.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before recording stock counts.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  if count_lines is null or jsonb_typeof(count_lines) <> 'array' or jsonb_array_length(count_lines) = 0 then
    raise exception 'Add at least one stock count line.';
  end if;

  select l.id
    into selected_location_id
  from public.locations l
  where l.organization_id = current_organization_id
    and l.is_active = true
  order by l.created_at asc
  limit 1;

  if selected_location_id is null then
    insert into public.locations (
      tenant_id,
      organization_id,
      name,
      location_type,
      routing_model,
      is_active
    ) values (
      current_organization_id,
      current_organization_id,
      'Main Store',
      'main_store',
      'model_1_single_location',
      true
    )
    returning id into selected_location_id;
  end if;

  insert into public.stock_counts (
    organization_id,
    location_id,
    status,
    frozen_at,
    created_by
  ) values (
    current_organization_id,
    selected_location_id,
    'completed',
    now(),
    current_user_id
  )
  returning id into created_stock_count_id;

  for count_line in
    select value from jsonb_array_elements(count_lines)
  loop
    target_inventory_item_id := nullif(count_line->>'inventory_item_id', '')::uuid;
    counted_quantity := nullif(count_line->>'counted_quantity', '')::numeric;

    if target_inventory_item_id is null
       or counted_quantity is null
       or counted_quantity < 0 then
      raise exception 'Every stock count line needs an item and non-negative counted quantity.';
    end if;

    select *
      into selected_item
    from public.inventory_items
    where id = target_inventory_item_id
      and organization_id = current_organization_id
      and is_active = true;

    if selected_item.id is null then
      raise exception 'Inventory item not found for this workspace.';
    end if;

    system_quantity := coalesce(selected_item.on_hand_qty, 0);
    variance_quantity := system_quantity - counted_quantity;

    insert into public.stock_count_lines (
      stock_count_id,
      inventory_item_id,
      counted_qty,
      system_qty,
      unit_cost
    ) values (
      created_stock_count_id,
      selected_item.id,
      counted_quantity,
      system_quantity,
      coalesce(selected_item.current_cost_per_base_uom, 0)
    );

    if variance_quantity <> 0 then
      insert into public.variance_attributions (
        organization_id,
        location_id,
        inventory_item_id,
        variance_type,
        variance_qty,
        unit_cost,
        source_table,
        source_id
      ) values (
        current_organization_id,
        selected_location_id,
        selected_item.id,
        'unrecorded_depletion',
        variance_quantity,
        coalesce(selected_item.current_cost_per_base_uom, 0),
        'stock_counts',
        created_stock_count_id
      );
    end if;

    update public.inventory_items
       set on_hand_qty = counted_quantity
     where id = selected_item.id
       and organization_id = current_organization_id;

    created_line_count := created_line_count + 1;
  end loop;

  return created_line_count;
end;
$$;

grant execute on function public.create_dashboard_stock_count_lines(jsonb) to authenticated;

drop function if exists public.create_dashboard_waste_event(uuid, numeric, text, text, text);

create function public.create_dashboard_waste_event(
  target_inventory_item_id uuid,
  waste_quantity numeric,
  waste_reason_value text default 'spoilage',
  waste_stage_value text default 'prep',
  waste_notes_value text default null
)
returns public.waste_events
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  selected_item public.inventory_items;
  created_waste_event public.waste_events;
  has_legacy_item_id boolean;
  has_legacy_tenant_id boolean;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to record waste.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before recording waste.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  if waste_quantity is null or waste_quantity <= 0 then
    raise exception 'Waste quantity must be greater than zero.';
  end if;

  select *
    into selected_item
  from public.inventory_items
  where id = target_inventory_item_id
    and organization_id = current_organization_id
    and is_active = true;

  if selected_item.id is null then
    raise exception 'Inventory item not found for this workspace.';
  end if;

  insert into public.waste_events (
    organization_id,
    inventory_item_id,
    quantity,
    unit_cost,
    waste_reason,
    waste_stage,
    notes,
    created_by
  ) values (
    current_organization_id,
    selected_item.id,
    waste_quantity,
    coalesce(selected_item.current_cost_per_base_uom, 0),
    coalesce(nullif(trim(waste_reason_value), ''), 'spoilage'),
    coalesce(nullif(trim(waste_stage_value), ''), 'prep'),
    nullif(trim(coalesce(waste_notes_value, '')), ''),
    current_user_id
  )
  returning * into created_waste_event;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transformation_events'
      and column_name = 'item_id'
  )
    into has_legacy_item_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transformation_events'
      and column_name = 'tenant_id'
  )
    into has_legacy_tenant_id;

  if has_legacy_item_id and has_legacy_tenant_id then
    execute '
      insert into public.transformation_events (
        tenant_id,
        organization_id,
        event_type,
        inventory_item_id,
        item_id,
        quantity,
        unit_cost,
        source_table,
        source_id,
        variance_type,
        created_by
      ) values (
        $1,
        $1,
        ''waste_event'',
        $2,
        $2,
        $3,
        $4,
        ''waste_events'',
        $5,
        ''waste_variance'',
        $6
      )'
    using
      current_organization_id,
      selected_item.id,
      -1 * waste_quantity,
      coalesce(selected_item.current_cost_per_base_uom, 0),
      created_waste_event.id,
      current_user_id;
  elsif has_legacy_item_id then
    execute '
      insert into public.transformation_events (
        organization_id,
        event_type,
        inventory_item_id,
        item_id,
        quantity,
        unit_cost,
        source_table,
        source_id,
        variance_type,
        created_by
      ) values (
        $1,
        ''waste_event'',
        $2,
        $2,
        $3,
        $4,
        ''waste_events'',
        $5,
        ''waste_variance'',
        $6
      )'
    using
      current_organization_id,
      selected_item.id,
      -1 * waste_quantity,
      coalesce(selected_item.current_cost_per_base_uom, 0),
      created_waste_event.id,
      current_user_id;
  else
    insert into public.transformation_events (
      organization_id,
      event_type,
      inventory_item_id,
      quantity,
      unit_cost,
      source_table,
      source_id,
      variance_type,
      created_by
    ) values (
      current_organization_id,
      'waste_event',
      selected_item.id,
      -1 * waste_quantity,
      coalesce(selected_item.current_cost_per_base_uom, 0),
      'waste_events',
      created_waste_event.id,
      'waste_variance',
      current_user_id
    );
  end if;

  insert into public.variance_attributions (
    organization_id,
    inventory_item_id,
    variance_type,
    variance_qty,
    unit_cost,
    source_table,
    source_id
  ) values (
    current_organization_id,
    selected_item.id,
    'waste_variance',
    waste_quantity,
    coalesce(selected_item.current_cost_per_base_uom, 0),
    'waste_events',
    created_waste_event.id
  );

  update public.inventory_items
     set on_hand_qty = on_hand_qty - waste_quantity
   where id = selected_item.id
     and organization_id = current_organization_id;

  return created_waste_event;
end;
$$;

grant execute on function public.create_dashboard_waste_event(uuid, numeric, text, text, text) to authenticated;

drop function if exists public.get_dashboard_waste_history();

create function public.get_dashboard_waste_history()
returns table (
  waste_event_id uuid,
  created_at timestamptz,
  ingredient_name text,
  quantity numeric,
  uom text,
  unit_cost numeric,
  waste_cost numeric,
  waste_reason text,
  waste_stage text,
  notes text
)
language sql
security definer
set search_path = public
as $$
  select
    we.id as waste_event_id,
    we.created_at,
    coalesce(ii.name, 'Ingredient') as ingredient_name,
    we.quantity,
    coalesce(ii.on_hand_uom, ii.base_uom, 'unit') as uom,
    we.unit_cost,
    we.quantity * we.unit_cost as waste_cost,
    we.waste_reason,
    we.waste_stage,
    we.notes
  from public.waste_events we
  left join public.inventory_items ii on ii.id = we.inventory_item_id
  join public.profiles p on p.organization_id = we.organization_id
  where p.id = auth.uid()
  order by we.created_at desc;
$$;

grant execute on function public.get_dashboard_waste_history() to authenticated;

drop function if exists public.get_dashboard_stock_variance_history();

create function public.get_dashboard_stock_variance_history()
returns table (
  stock_count_id uuid,
  created_at timestamptz,
  ingredient_name text,
  system_qty numeric,
  counted_qty numeric,
  variance_qty numeric,
  unit_cost numeric,
  hard_currency_impact numeric,
  uom text
)
language sql
security definer
set search_path = public
as $$
  select
    sc.id as stock_count_id,
    sc.created_at,
    coalesce(ii.name, 'Inventory item') as ingredient_name,
    scl.system_qty,
    scl.counted_qty,
    coalesce(scl.system_qty, 0) - scl.counted_qty as variance_qty,
    scl.unit_cost,
    (coalesce(scl.system_qty, 0) - scl.counted_qty) * scl.unit_cost
      as hard_currency_impact,
    coalesce(ii.on_hand_uom, ii.base_uom, ii.recipe_uom, 'unit') as uom
  from public.stock_counts sc
  join public.stock_count_lines scl
    on scl.stock_count_id = sc.id
  left join public.inventory_items ii
    on ii.id = scl.inventory_item_id
  join public.profiles p
    on p.organization_id = sc.organization_id
  where p.id = auth.uid()
  order by sc.created_at desc;
$$;

grant execute on function public.get_dashboard_stock_variance_history() to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'transformation_event_type'
  ) then
    alter type public.transformation_event_type add value if not exists 'sales_depletion';
  end if;

  if exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'transformation_event_type_enum'
  ) then
    alter type public.transformation_event_type_enum add value if not exists 'sales_depletion';
  end if;
exception when duplicate_object then null;
end $$;

create table if not exists public.menu_sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid default auth.uid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete restrict,
  sold_quantity numeric(18, 6) not null check (sold_quantity > 0),
  selling_unit_price numeric(18, 6) not null default 0,
  total_revenue numeric(18, 6) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table if exists public.menu_sales
  add column if not exists tenant_id uuid default auth.uid(),
  add column if not exists selling_unit_price numeric(18, 6) not null default 0,
  add column if not exists total_revenue numeric(18, 6) not null default 0;

create index if not exists idx_menu_sales_org_created
  on public.menu_sales(organization_id, created_at desc);

alter table public.menu_sales enable row level security;

drop policy if exists "menu_sales_member_all" on public.menu_sales;
create policy "menu_sales_member_all"
on public.menu_sales
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_record_operations(organization_id));

drop function if exists public.create_dashboard_menu_sale(uuid, numeric);

create function public.create_dashboard_menu_sale(
  target_recipe_id uuid,
  sold_quantity numeric
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  selected_recipe public.recipes;
  sale_source_id uuid;
  component_line record;
  required_quantity numeric(18, 6);
  depleted_line_count integer := 0;
  has_legacy_item_id boolean;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to record menu sales.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before recording menu sales.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  if sold_quantity is null or sold_quantity <= 0 then
    raise exception 'Sold quantity must be greater than zero.';
  end if;

  select *
    into selected_recipe
  from public.recipes
  where id = target_recipe_id
    and organization_id = current_organization_id
    and is_active = true;

  if selected_recipe.id is null then
    raise exception 'Menu item not found for this workspace.';
  end if;

  if selected_recipe.recipe_type::text not in ('final_menu_item', 'final_dish') then
    raise exception 'Only final menu items can be recorded as sales.';
  end if;

  insert into public.menu_sales (
    tenant_id,
    organization_id,
    recipe_id,
    sold_quantity,
    selling_unit_price,
    total_revenue,
    created_by
  ) values (
    current_user_id,
    current_organization_id,
    selected_recipe.id,
    sold_quantity,
    coalesce(selected_recipe.selling_price, 0),
    sold_quantity * coalesce(selected_recipe.selling_price, 0),
    current_user_id
  )
  returning id into sale_source_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transformation_events'
      and column_name = 'item_id'
  )
    into has_legacy_item_id;

  for component_line in
    select
      rc.component_inventory_item_id,
      rc.qty_in_recipe_uom,
      ii.current_cost_per_base_uom
    from public.recipe_components rc
    join public.inventory_items ii
      on ii.id = rc.component_inventory_item_id
    where rc.recipe_id = selected_recipe.id
      and rc.organization_id = current_organization_id
      and rc.component_inventory_item_id is not null
  loop
    required_quantity :=
      (component_line.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
      * sold_quantity;

    if has_legacy_item_id then
      execute '
        insert into public.transformation_events (
          organization_id,
          event_type,
          inventory_item_id,
          item_id,
          quantity,
          unit_cost,
          source_table,
          source_id,
          created_by
        ) values (
          $1,
          ''sales_depletion'',
          $2,
          $2,
          $3,
          $4,
          ''menu_sales'',
          $5,
          $6
        )'
      using
        current_organization_id,
        component_line.component_inventory_item_id,
        -1 * required_quantity,
        coalesce(component_line.current_cost_per_base_uom, 0),
        sale_source_id,
        current_user_id;
    else
      insert into public.transformation_events (
        organization_id,
        event_type,
        inventory_item_id,
        quantity,
        unit_cost,
        source_table,
        source_id,
        created_by
      ) values (
        current_organization_id,
        'sales_depletion',
        component_line.component_inventory_item_id,
        -1 * required_quantity,
        coalesce(component_line.current_cost_per_base_uom, 0),
        'menu_sales',
        sale_source_id,
        current_user_id
      );
    end if;

    update public.inventory_items
       set on_hand_qty = on_hand_qty - required_quantity
     where id = component_line.component_inventory_item_id
       and organization_id = current_organization_id;

    depleted_line_count := depleted_line_count + 1;
  end loop;

  if depleted_line_count = 0 then
    raise exception 'Attach at least one component before recording sales.';
  end if;

  return depleted_line_count;
end;
$$;

grant execute on function public.create_dashboard_menu_sale(uuid, numeric) to authenticated;

drop function if exists public.get_dashboard_menu_sales_history();

create function public.get_dashboard_menu_sales_history()
returns table (
  menu_sale_id uuid,
  created_at timestamptz,
  recipe_name text,
  sold_quantity numeric,
  output_uom text,
  component_name text,
  depleted_qty numeric,
  unit_cost numeric,
  cost_impact numeric,
  selling_unit_price numeric,
  total_revenue numeric,
  gross_profit numeric,
  gross_margin_pct numeric,
  component_uom text
)
language sql
security definer
set search_path = public
as $$
  with sale_lines as (
    select
      ms.id as menu_sale_id,
      ms.created_at,
      r.name as recipe_name,
      ms.sold_quantity,
      r.output_uom,
      coalesce(ii.name, 'Component') as component_name,
      abs(te.quantity) as depleted_qty,
      te.unit_cost,
      abs(te.quantity * te.unit_cost) as cost_impact,
      sum(abs(te.quantity * te.unit_cost)) over (partition by ms.id) as total_food_cost,
      ms.selling_unit_price,
      ms.total_revenue,
      coalesce(ii.on_hand_uom, ii.recipe_uom, ii.base_uom) as component_uom
    from public.menu_sales ms
    join public.recipes r on r.id = ms.recipe_id
    join public.transformation_events te
      on te.source_table = 'menu_sales'
     and te.source_id = ms.id
    left join public.inventory_items ii
      on ii.id = te.inventory_item_id
    join public.profiles p on p.organization_id = ms.organization_id
    where p.id = auth.uid()
  )
  select
    menu_sale_id,
    created_at,
    recipe_name,
    sold_quantity,
    output_uom,
    component_name,
    depleted_qty,
    unit_cost,
    cost_impact,
    selling_unit_price,
    total_revenue,
    total_revenue - total_food_cost as gross_profit,
    case
      when total_revenue > 0 then
        ((total_revenue - total_food_cost) / total_revenue) * 100
      else null
    end as gross_margin_pct,
    component_uom
  from sale_lines
  order by created_at desc, component_name asc;
$$;

grant execute on function public.get_dashboard_menu_sales_history() to authenticated;

drop function if exists public.deactivate_duplicate_purchased_inventory_skus();

create function public.deactivate_duplicate_purchased_inventory_skus()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  deactivated_count integer;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to clean duplicate inventory items.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before cleaning duplicate inventory items.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'costing');

  with ranked_purchased_duplicates as (
    select
      id,
      row_number() over (
        partition by lower(trim(sku))
        order by created_at desc, id desc
      ) as duplicate_rank
    from public.inventory_items
    where organization_id = current_organization_id
      and cost_type = 'purchased'
      and is_active = true
      and nullif(trim(sku), '') is not null
  ),
  ranked_manufactured_duplicates as (
    select
      id,
      row_number() over (
        partition by lower(trim(name))
        order by created_at desc, id desc
      ) as duplicate_rank
    from public.inventory_items
    where organization_id = current_organization_id
      and cost_type = 'manufactured'
      and is_active = true
      and nullif(trim(name), '') is not null
  ),
  ranked_recipe_duplicates as (
    select
      id,
      row_number() over (
        partition by lower(trim(name)), recipe_type
        order by created_at desc, id desc
      ) as duplicate_rank
    from public.recipes
    where organization_id = current_organization_id
      and is_active = true
      and nullif(trim(name), '') is not null
  ),
  deactivated_inventory as (
    update public.inventory_items ii
       set is_active = false
      from (
        select id, duplicate_rank from ranked_purchased_duplicates
        union all
        select id, duplicate_rank from ranked_manufactured_duplicates
      ) rd
     where ii.id = rd.id
       and rd.duplicate_rank > 1
    returning ii.id
  ),
  deactivated_recipes as (
    update public.recipes r
       set is_active = false
      from ranked_recipe_duplicates rd
     where r.id = rd.id
       and rd.duplicate_rank > 1
    returning r.id
  )
  select count(*) into deactivated_count
  from (
    select id from deactivated_inventory
    union all
    select id from deactivated_recipes
  ) deactivated;

  return coalesce(deactivated_count, 0);
end;
$$;

grant execute on function public.deactivate_duplicate_purchased_inventory_skus() to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'transformation_event_type'
  ) then
    alter type public.transformation_event_type add value if not exists 'production_input_consumption';
    alter type public.transformation_event_type add value if not exists 'production_output_receipt';
  end if;

  if exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'transformation_event_type_enum'
  ) then
    alter type public.transformation_event_type_enum add value if not exists 'production_input_consumption';
    alter type public.transformation_event_type_enum add value if not exists 'production_output_receipt';
  end if;
exception when duplicate_object then null;
end $$;

drop function if exists public.create_dashboard_production_run(uuid, numeric, numeric, text);
drop function if exists public.create_dashboard_production_run(uuid, numeric, numeric, text, jsonb);

create function public.create_dashboard_production_run(
  target_recipe_id uuid,
  target_output_quantity numeric,
  actual_output_quantity numeric default null,
  production_origin text default 'kitchen_prep_line',
  actual_component_usages jsonb default '[]'::jsonb
)
returns public.production_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  selected_recipe public.recipes;
  selected_origin public.origin_attribution;
  normalized_actual_output numeric(18, 6);
  manufactured_item_id uuid;
  created_run public.production_runs;
  component_count integer;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to record production.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before recording production.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  if target_output_quantity is null or target_output_quantity <= 0 then
    raise exception 'Actual output quantity must be greater than zero.';
  end if;

  normalized_actual_output := coalesce(actual_output_quantity, target_output_quantity);

  if normalized_actual_output <= 0 then
    raise exception 'Actual output quantity must be greater than zero.';
  end if;

  selected_origin := case production_origin
    when 'storage_defrosting' then 'storage_defrosting'::public.origin_attribution
    when 'central_transit' then 'central_transit'::public.origin_attribution
    when 'cold_room_storage' then 'cold_room_storage'::public.origin_attribution
    else 'kitchen_prep_line'::public.origin_attribution
  end;

  select *
    into selected_recipe
  from public.recipes
  where id = target_recipe_id
    and organization_id = current_organization_id
    and is_active = true;

  if selected_recipe.id is null then
    raise exception 'Recipe not found for this workspace.';
  end if;

  if selected_recipe.recipe_type <> 'sub_recipe' then
    raise exception 'Only sub-recipes can be produced into manufactured inventory from this dashboard.';
  end if;

  select count(*)
    into component_count
  from public.recipe_components rc
  where rc.recipe_id = selected_recipe.id
    and rc.organization_id = current_organization_id
    and rc.component_inventory_item_id is not null;

  if component_count = 0 then
    raise exception 'Attach at least one ingredient before recording production.';
  end if;

  if actual_component_usages is null
     or jsonb_typeof(actual_component_usages) <> 'array'
     or exists (
       select 1
       from public.recipe_components rc
       where rc.recipe_id = selected_recipe.id
         and rc.organization_id = current_organization_id
         and rc.component_inventory_item_id is not null
         and not exists (
           select 1
           from jsonb_array_elements(actual_component_usages) usage_item
           where nullif(usage_item->>'component_inventory_item_id', '')::uuid =
             rc.component_inventory_item_id
             and nullif(usage_item->>'actual_qty_used', '')::numeric >= 0
         )
     ) then
    raise exception 'Enter actual raw material quantity used for every production ingredient.';
  end if;

  select ii.id
    into manufactured_item_id
  from public.inventory_items ii
  where ii.organization_id = current_organization_id
    and ii.recipe_id = selected_recipe.id
    and ii.cost_type = 'manufactured'
    and ii.is_active = true
  order by ii.created_at desc
  limit 1;

  if manufactured_item_id is null then
    insert into public.inventory_items (
      tenant_id,
      organization_id,
      recipe_id,
      name,
      sku,
      item_type,
      cost_type,
      on_hand_uom,
      current_cost_per_base_uom,
      is_active
    ) values (
      coalesce(selected_recipe.tenant_id, current_organization_id),
      current_organization_id,
      selected_recipe.id,
      selected_recipe.name,
      'SUB-' || left(selected_recipe.id::text, 8),
      'semi_finished',
      'manufactured',
      coalesce(selected_recipe.output_uom, 'kg'),
      coalesce(selected_recipe.resolved_unit_cost, 0),
      true
    )
    returning id into manufactured_item_id;
  end if;

  insert into public.production_runs (
    organization_id,
    sub_recipe_id,
    target_output_qty,
    actual_output_qty,
    origin,
    status,
    created_by
  ) values (
    current_organization_id,
    selected_recipe.id,
    target_output_quantity,
    normalized_actual_output,
    selected_origin,
    'completed',
    current_user_id
  )
  returning * into created_run;

  insert into public.production_run_inputs (
    production_run_id,
    inventory_item_id,
    target_qty_required,
    actual_qty_used,
    unit_cost,
    origin
  )
  select
    created_run.id,
    rc.component_inventory_item_id,
    (rc.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
      * target_output_quantity,
    coalesce(
      actual_usage.actual_qty_used,
      (rc.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
        * target_output_quantity
    ),
    coalesce(ii.current_cost_per_base_uom, 0),
    selected_origin
  from public.recipe_components rc
  join public.inventory_items ii on ii.id = rc.component_inventory_item_id
  left join lateral (
    select nullif(usage_item->>'actual_qty_used', '')::numeric as actual_qty_used
    from jsonb_array_elements(coalesce(actual_component_usages, '[]'::jsonb)) usage_item
    where nullif(usage_item->>'component_inventory_item_id', '')::uuid = rc.component_inventory_item_id
    limit 1
  ) actual_usage on true
  where rc.recipe_id = selected_recipe.id
    and rc.organization_id = current_organization_id
    and rc.component_inventory_item_id is not null;

  insert into public.transformation_events (
    organization_id,
    event_type,
    inventory_item_id,
    quantity,
    unit_cost,
    source_table,
    source_id,
    origin,
    created_by
  )
  select
    current_organization_id,
    'production_input_consumption',
    rc.component_inventory_item_id,
    -1 * coalesce(
      actual_usage.actual_qty_used,
      (rc.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
        * target_output_quantity
    ),
    coalesce(ii.current_cost_per_base_uom, 0),
    'production_runs',
    created_run.id,
    selected_origin,
    current_user_id
  from public.recipe_components rc
  join public.inventory_items ii on ii.id = rc.component_inventory_item_id
  left join lateral (
    select nullif(usage_item->>'actual_qty_used', '')::numeric as actual_qty_used
    from jsonb_array_elements(coalesce(actual_component_usages, '[]'::jsonb)) usage_item
    where nullif(usage_item->>'component_inventory_item_id', '')::uuid = rc.component_inventory_item_id
    limit 1
  ) actual_usage on true
  where rc.recipe_id = selected_recipe.id
    and rc.organization_id = current_organization_id
    and rc.component_inventory_item_id is not null;

  insert into public.variance_attributions (
    organization_id,
    inventory_item_id,
    variance_type,
    variance_qty,
    unit_cost,
    source_table,
    source_id
  )
  select
    current_organization_id,
    rc.component_inventory_item_id,
    'waste_variance',
    coalesce(
      actual_usage.actual_qty_used,
      (rc.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
        * target_output_quantity
    )
      - (
        (rc.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
        * target_output_quantity
      ),
    coalesce(ii.current_cost_per_base_uom, 0),
    'production_runs',
    created_run.id
  from public.recipe_components rc
  join public.inventory_items ii on ii.id = rc.component_inventory_item_id
  left join lateral (
    select nullif(usage_item->>'actual_qty_used', '')::numeric as actual_qty_used
    from jsonb_array_elements(coalesce(actual_component_usages, '[]'::jsonb)) usage_item
    where nullif(usage_item->>'component_inventory_item_id', '')::uuid = rc.component_inventory_item_id
    limit 1
  ) actual_usage on true
  where rc.recipe_id = selected_recipe.id
    and rc.organization_id = current_organization_id
    and rc.component_inventory_item_id is not null
    and coalesce(
      actual_usage.actual_qty_used,
      (rc.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
        * target_output_quantity
    )
      <> (
        (rc.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
        * target_output_quantity
      );

  insert into public.transformation_events (
    organization_id,
    event_type,
    inventory_item_id,
    quantity,
    unit_cost,
    source_table,
    source_id,
    origin,
    created_by
  ) values (
    current_organization_id,
    'production_output_receipt',
    manufactured_item_id,
    normalized_actual_output,
    coalesce(selected_recipe.resolved_unit_cost, 0),
    'production_runs',
    created_run.id,
    selected_origin,
    current_user_id
  );

  update public.inventory_items ii
     set on_hand_qty = ii.on_hand_qty - usage.actual_qty_used
    from (
      select
        rc.component_inventory_item_id as inventory_item_id,
        sum(
          coalesce(
            actual_usage.actual_qty_used,
            (rc.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
              * target_output_quantity
          )
        ) as actual_qty_used
      from public.recipe_components rc
      left join lateral (
        select nullif(usage_item->>'actual_qty_used', '')::numeric as actual_qty_used
        from jsonb_array_elements(coalesce(actual_component_usages, '[]'::jsonb)) usage_item
        where nullif(usage_item->>'component_inventory_item_id', '')::uuid = rc.component_inventory_item_id
        limit 1
      ) actual_usage on true
      where rc.recipe_id = selected_recipe.id
        and rc.organization_id = current_organization_id
        and rc.component_inventory_item_id is not null
      group by rc.component_inventory_item_id
    ) usage
   where ii.id = usage.inventory_item_id;

  update public.inventory_items
     set on_hand_qty = on_hand_qty + normalized_actual_output,
         current_cost_per_base_uom = coalesce(selected_recipe.resolved_unit_cost, 0),
         on_hand_uom = coalesce(on_hand_uom, selected_recipe.output_uom, 'kg')
   where id = manufactured_item_id;

  return created_run;
end;
$$;

grant execute on function public.create_dashboard_production_run(uuid, numeric, numeric, text, jsonb) to authenticated;

drop function if exists public.get_dashboard_production_history();

create function public.get_dashboard_production_history()
returns table (
  production_run_id uuid,
  created_at timestamptz,
  recipe_name text,
  target_output_qty numeric,
  actual_output_qty numeric,
  output_uom text,
  ingredient_name text,
  target_qty_required numeric,
  actual_qty_used numeric,
  waste_variance_qty numeric,
  expected_output_from_actual_qty numeric,
  output_variance_qty numeric,
  unit_cost numeric,
  naira_loss numeric,
  origin text
)
language sql
security definer
set search_path = public
as $$
  select
    pr.id as production_run_id,
    pr.created_at,
    r.name as recipe_name,
    pr.target_output_qty,
    pr.actual_output_qty,
    r.output_uom,
    coalesce(ii.name, 'Ingredient') as ingredient_name,
    pri.target_qty_required,
    pri.actual_qty_used,
    pri.waste_variance_qty,
    case
      when coalesce(rc.qty_in_recipe_uom, 0) > 0
       and coalesce(r.standard_batch_output_qty, 0) > 0
      then pri.actual_qty_used / (rc.qty_in_recipe_uom / r.standard_batch_output_qty)
      else coalesce(pr.actual_output_qty, pr.target_output_qty)
    end as expected_output_from_actual_qty,
    (
      case
        when coalesce(rc.qty_in_recipe_uom, 0) > 0
         and coalesce(r.standard_batch_output_qty, 0) > 0
        then pri.actual_qty_used / (rc.qty_in_recipe_uom / r.standard_batch_output_qty)
        else coalesce(pr.actual_output_qty, pr.target_output_qty)
      end
    ) - coalesce(pr.actual_output_qty, pr.target_output_qty) as output_variance_qty,
    pri.unit_cost,
    pri.naira_loss,
    pri.origin::text as origin
  from public.production_runs pr
  join public.recipes r
    on r.id = pr.sub_recipe_id
  join public.production_run_inputs pri
    on pri.production_run_id = pr.id
  left join public.inventory_items ii
    on ii.id = pri.inventory_item_id
  left join public.recipe_components rc
    on rc.recipe_id = pr.sub_recipe_id
   and rc.component_inventory_item_id = pri.inventory_item_id
  join public.profiles p
    on p.organization_id = pr.organization_id
  where p.id = auth.uid()
  order by pr.created_at desc, ii.name asc;
$$;

grant execute on function public.get_dashboard_production_history() to authenticated;

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

drop trigger if exists enforce_location_subscription_limit on public.locations;
create trigger enforce_location_subscription_limit
before insert or update of organization_id, is_active on public.locations
for each row execute function public.enforce_location_subscription_limit();

create or replace function public.enforce_model_2_subscription()
returns trigger
language plpgsql
as $$
declare
  allowed boolean;
begin
  if new.organization_id is null then
    return new;
  end if;

  if new.routing_model = 'model_2_central_warehouse' then
    select sp.allows_model_2
      into allowed
    from public.organizations o
    join public.subscription_plans sp on sp.tier = o.subscription_tier
    where o.id = new.organization_id;

    if coalesce(allowed, false) = false then
      raise exception 'Central Commissary and Central Warehouse distribution models require our Enterprise Grid plan.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_model_2_subscription on public.locations;
create trigger enforce_model_2_subscription
before insert or update of routing_model on public.locations
for each row execute function public.enforce_model_2_subscription();

create or replace function public.enforce_transfer_subscription()
returns trigger
language plpgsql
as $$
declare
  allowed boolean;
begin
  if new.organization_id is null then
    return new;
  end if;

  select sp.allows_inter_store_transfers
    into allowed
  from public.organizations o
  join public.subscription_plans sp on sp.tier = o.subscription_tier
  where o.id = new.organization_id;

  if coalesce(allowed, false) = false then
    raise exception 'Upgrade to Multi-Unit Group to transfer stock across locations.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_transfer_subscription on public.transfers;
create trigger enforce_transfer_subscription
before insert or update on public.transfers
for each row execute function public.enforce_transfer_subscription();

create or replace function public.prevent_transformation_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'transformation_events is append-only and cannot be updated or deleted.';
end;
$$;

drop trigger if exists prevent_transformation_event_update on public.transformation_events;
create trigger prevent_transformation_event_update
before update on public.transformation_events
for each row execute function public.prevent_transformation_event_mutation();

drop trigger if exists prevent_transformation_event_delete on public.transformation_events;
create trigger prevent_transformation_event_delete
before delete on public.transformation_events
for each row execute function public.prevent_transformation_event_mutation();

create or replace function public.prevent_recipe_component_cycle()
returns trigger
language plpgsql
as $$
declare
  found_cycle text;
begin
  if new.component_recipe_id is null then
    return new;
  end if;

  if new.component_recipe_id = new.recipe_id then
    raise exception 'Circular recipe reference rejected: recipe cannot contain itself.';
  end if;

  with recursive lineage(recipe_id, path) as (
    select new.component_recipe_id, array[new.recipe_id, new.component_recipe_id]
    union all
    select rc.component_recipe_id, lineage.path || rc.component_recipe_id
    from public.recipe_components rc
    join lineage on rc.recipe_id = lineage.recipe_id
    where rc.component_recipe_id is not null
      and not rc.component_recipe_id = any(lineage.path)
  )
  select array_to_string(path, ' -> ')
    into found_cycle
  from lineage
  where recipe_id = new.recipe_id
  limit 1;

  if found_cycle is not null then
    raise exception 'Circular recipe reference rejected: %', found_cycle;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_recipe_component_cycle on public.recipe_components;
create trigger prevent_recipe_component_cycle
before insert or update on public.recipe_components
for each row execute function public.prevent_recipe_component_cycle();

create or replace function public.sync_sub_recipe_inventory_item()
returns trigger
language plpgsql
as $$
begin
  if new.recipe_type = 'sub_recipe' then
    insert into public.inventory_items (
      tenant_id,
      organization_id,
      recipe_id,
      name,
      sku,
      item_type,
      cost_type,
      on_hand_uom,
      current_cost_per_base_uom,
      is_active
    ) values (
      coalesce(new.tenant_id, new.organization_id),
      new.organization_id,
      new.id,
      new.name,
      'SUB-' || left(new.id::text, 8),
      'semi_finished',
      'manufactured',
      coalesce(new.output_uom, 'kg'),
      coalesce(new.resolved_unit_cost, 0),
      new.is_active
    )
    on conflict do nothing;

    update public.inventory_items
       set name = new.name,
           tenant_id = coalesce(tenant_id, new.tenant_id, new.organization_id),
           organization_id = coalesce(organization_id, new.organization_id),
           current_cost_per_base_uom = coalesce(new.resolved_unit_cost, 0),
           on_hand_uom = coalesce(on_hand_uom, new.output_uom, 'kg'),
           is_active = new.is_active
     where recipe_id = new.id
       and cost_type = 'manufactured';
  end if;

  return new;
end;
$$;

drop trigger if exists sync_sub_recipe_inventory_item on public.recipes;
create trigger sync_sub_recipe_inventory_item
after insert or update of recipe_type, name, resolved_unit_cost, is_active on public.recipes
for each row execute function public.sync_sub_recipe_inventory_item();

create or replace function public.block_sub_recipe_delete_with_stock()
returns trigger
language plpgsql
as $$
declare
  stock_qty numeric(18, 6);
begin
  if old.recipe_type <> 'sub_recipe' then
    return old;
  end if;

  select coalesce(sum(on_hand_qty), 0)
    into stock_qty
  from public.inventory_items
  where recipe_id = old.id
    and cost_type = 'manufactured';

  if stock_qty > 0 then
    raise exception 'Cannot delete sub-recipe while manufactured inventory has on-hand quantity.';
  end if;

  return old;
end;
$$;

drop trigger if exists block_sub_recipe_delete_with_stock on public.recipes;
create trigger block_sub_recipe_delete_with_stock
before delete on public.recipes
for each row execute function public.block_sub_recipe_delete_with_stock();

create or replace function public.prevent_manual_recipe_cost_update()
returns trigger
language plpgsql
as $$
begin
  if old.resolved_unit_cost is distinct from new.resolved_unit_cost
     and coalesce(current_setting('profitplate.allow_cost_update', true), 'off') <> 'on' then
    raise exception 'Recipe costs cannot be manually entered. Use the standard cost cascade engine.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_manual_recipe_cost_update on public.recipes;
create trigger prevent_manual_recipe_cost_update
before update of resolved_unit_cost on public.recipes
for each row execute function public.prevent_manual_recipe_cost_update();

create or replace function public.log_inventory_price_change()
returns trigger
language plpgsql
as $$
begin
  if old.current_cost_per_base_uom is distinct from new.current_cost_per_base_uom then
    insert into public.cost_recalculation_events (
      organization_id,
      inventory_item_id,
      old_cost,
      new_cost,
      reason
    ) values (
      new.organization_id,
      new.id,
      old.current_cost_per_base_uom,
      new.current_cost_per_base_uom,
      'ingredient_price_change'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists log_inventory_price_change on public.inventory_items;
create trigger log_inventory_price_change
after update of current_cost_per_base_uom on public.inventory_items
for each row execute function public.log_inventory_price_change();

create or replace function public.set_recipe_cost_from_engine(
  target_recipe_id uuid,
  new_cost numeric,
  reason text default 'standard_cost_cascade'
)
returns void
language plpgsql
as $$
declare
  old_cost numeric(18, 6);
  org_id uuid;
begin
  select resolved_unit_cost, organization_id
    into old_cost, org_id
  from public.recipes
  where id = target_recipe_id;

  perform set_config('profitplate.allow_cost_update', 'on', true);

  update public.recipes
     set resolved_unit_cost = new_cost
   where id = target_recipe_id;

  insert into public.cost_recalculation_events (
    organization_id,
    recipe_id,
    old_cost,
    new_cost,
    reason
  ) values (
    org_id,
    target_recipe_id,
    coalesce(old_cost, 0),
    new_cost,
    reason
  );
end;
$$;
