-- Some live workspaces use the older transformation_event_type_enum type and
-- did not receive the stock_count_adjustment label. Finance-approved stock
-- adjustments need this enum value before the movement event can be posted.

do $$
begin
  if exists (
    select 1
    from pg_type type_row
    join pg_namespace namespace_row
      on namespace_row.oid = type_row.typnamespace
    where namespace_row.nspname = 'public'
      and type_row.typname = 'transformation_event_type'
  ) then
    alter type public.transformation_event_type
      add value if not exists 'stock_count_adjustment';
  end if;

  if exists (
    select 1
    from pg_type type_row
    join pg_namespace namespace_row
      on namespace_row.oid = type_row.typnamespace
    where namespace_row.nspname = 'public'
      and type_row.typname = 'transformation_event_type_enum'
  ) then
    alter type public.transformation_event_type_enum
      add value if not exists 'stock_count_adjustment';
  end if;
end $$;

notify pgrst, 'reload schema';
