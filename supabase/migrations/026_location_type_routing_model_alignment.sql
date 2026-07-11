-- Align location and routing enums with the dashboard location setup options.

do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'location_type'
  ) then
    alter type public.location_type add value if not exists 'branch_store';
    alter type public.location_type add value if not exists 'production_kitchen';
    alter type public.location_type add value if not exists 'sales_outlet';
  end if;

  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'routing_model'
  ) then
    alter type public.routing_model add value if not exists 'model_2_central_kitchen';
    alter type public.routing_model add value if not exists 'model_3_commissary';
  end if;
end $$;

notify pgrst, 'reload schema';
