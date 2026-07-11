-- Consolidate overlapping restaurant roles while preserving their operational coverage.

alter table if exists public.profiles
  drop constraint if exists profiles_role_allowed;

update public.profiles
set role = case role::text
  when 'general_manager' then 'operations_manager'
  when 'cost_controller' then 'finance_manager'
  when 'production_supervisor' then 'kitchen_manager'
  when 'pos_supervisor' then 'finance_manager'
  else role::text
end
where role::text in (
  'general_manager',
  'cost_controller',
  'production_supervisor',
  'pos_supervisor'
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
      'storekeeper',
      'kitchen_manager',
      'chef',
      'quality_assurance',
      'bar_manager',
      'bartender',
      'auditor',
      'viewer'
    )
  );

create or replace function public.user_can_manage_costing(
  target_organization_id uuid
)
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
        'finance_manager',
        'procurement_manager'
      ]
    );
$$;

create or replace function public.user_can_record_operations(
  target_organization_id uuid
)
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
        'finance_manager',
        'inventory_manager',
        'storekeeper',
        'kitchen_manager',
        'chef',
        'quality_assurance',
        'bar_manager',
        'bartender'
      ]
    );
$$;

create or replace function public.user_can_approve_operations(
  target_organization_id uuid
)
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
        'finance_manager',
        'inventory_manager',
        'storekeeper',
        'kitchen_manager',
        'quality_assurance',
        'bar_manager',
        'auditor'
      ]
    );
$$;

notify pgrst, 'reload schema';
