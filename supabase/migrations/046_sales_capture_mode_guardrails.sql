-- Sales capture mode is an operating-control setting. A workspace should not
-- allow POS imports and manual sales to both post depletion for the same
-- operating period unless explicitly placed in test mode.

alter table if exists public.system_settings
  add column if not exists sales_capture_mode text not null default 'pos_import';

alter table if exists public.system_settings
  drop constraint if exists system_settings_sales_capture_mode_check;

alter table if exists public.system_settings
  add constraint system_settings_sales_capture_mode_check
  check (sales_capture_mode in ('pos_import', 'manual_sales', 'test_mode'));

update public.system_settings
   set sales_capture_mode = coalesce(nullif(sales_capture_mode, ''), 'pos_import');

create or replace function public.get_dashboard_sales_capture_mode(
  target_organization_id uuid
)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select settings.sales_capture_mode
      from public.system_settings settings
      where settings.organization_id = target_organization_id
      limit 1
    ),
    'pos_import'
  );
$$;

grant execute on function public.get_dashboard_sales_capture_mode(uuid)
  to authenticated;

create or replace function public.configure_dashboard_sales_capture_mode(
  target_organization_id uuid,
  sales_capture_mode_value text
)
returns public.system_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_mode text;
  saved_settings public.system_settings;
begin
  perform public.require_dashboard_permission(target_organization_id, 'workspace');

  normalized_mode := lower(trim(coalesce(sales_capture_mode_value, '')));

  if normalized_mode not in ('pos_import', 'manual_sales', 'test_mode') then
    raise exception 'Unsupported sales capture mode: %. Choose pos_import, manual_sales, or test_mode.',
      sales_capture_mode_value;
  end if;

  insert into public.system_settings (
    organization_id,
    sales_capture_mode
  ) values (
    target_organization_id,
    normalized_mode
  )
  on conflict (organization_id)
  do update set sales_capture_mode = excluded.sales_capture_mode
  returning * into saved_settings;

  return saved_settings;
end;
$$;

grant execute on function public.configure_dashboard_sales_capture_mode(uuid, text)
  to authenticated;

create or replace function public.enforce_menu_sales_capture_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  configured_mode text;
begin
  configured_mode := public.get_dashboard_sales_capture_mode(new.organization_id);

  if configured_mode = 'pos_import' and new.pos_import_batch_id is null then
    raise exception 'This workspace is in POS import mode. Manual sales are disabled to prevent double depletion.';
  end if;

  if configured_mode = 'manual_sales' and new.pos_import_batch_id is not null then
    raise exception 'This workspace is in manual sales mode. POS import posting is disabled to prevent duplicate depletion.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_menu_sales_capture_mode on public.menu_sales;
create trigger enforce_menu_sales_capture_mode
before insert on public.menu_sales
for each row execute function public.enforce_menu_sales_capture_mode();

notify pgrst, 'reload schema';
