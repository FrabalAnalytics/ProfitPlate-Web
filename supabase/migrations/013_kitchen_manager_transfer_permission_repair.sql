-- Repair live permissions for Kitchen Manager requisitions and transfers.

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

update public.profiles p
   set role = 'kitchen_manager',
       updated_at = now()
  from auth.users u
 where u.id = p.id
   and lower(u.email) = lower('suzzyqgemini@gmail.com')
   and p.role is distinct from 'kitchen_manager';

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
        'finance_manager',
        'inventory_manager',
        'kitchen_manager'
      ]
    );
$$;

grant execute on function public.user_can_record_operations(uuid) to authenticated;
grant execute on function public.user_can_approve_operations(uuid) to authenticated;

notify pgrst, 'reload schema';
