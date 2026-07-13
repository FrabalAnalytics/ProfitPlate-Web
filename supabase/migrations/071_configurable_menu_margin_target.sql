-- Move the menu margin benchmark out of dashboard code so each restaurant can
-- tune its target without a deploy.

alter table if exists public.system_settings
  add column if not exists target_menu_margin_pct numeric(5, 2) not null default 65;

alter table if exists public.system_settings
  drop constraint if exists system_settings_target_menu_margin_pct_check;

alter table if exists public.system_settings
  add constraint system_settings_target_menu_margin_pct_check check (
    target_menu_margin_pct >= 0
    and target_menu_margin_pct <= 100
  );

update public.system_settings
   set target_menu_margin_pct = 65
 where target_menu_margin_pct is null;

notify pgrst, 'reload schema';
