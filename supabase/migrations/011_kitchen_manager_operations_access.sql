-- Kitchen managers can raise requisitions, request transfers, and record kitchen waste.

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

notify pgrst, 'reload schema';
