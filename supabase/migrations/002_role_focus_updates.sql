-- ProfitPlate role focus update
-- Adds focused manager roles after the core engine migration has already run.

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
      'chef',
      'viewer'
    )
  );

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
