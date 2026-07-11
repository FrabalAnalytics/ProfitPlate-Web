-- Ensure Inventory Manager can accept or reject requisition transfer decisions.

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

grant execute on function public.user_can_approve_operations(uuid) to authenticated;

notify pgrst, 'reload schema';
