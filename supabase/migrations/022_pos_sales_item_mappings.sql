-- POS item mappings connect exported POS names/codes to ProfitPlate menu recipes.

create table if not exists public.pos_sales_item_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pos_item_key text not null,
  pos_item_label text not null,
  pos_item_code text,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_sales_item_mappings_unique_key unique (
    organization_id,
    pos_item_key
  )
);

drop trigger if exists set_pos_sales_item_mappings_updated_at
  on public.pos_sales_item_mappings;
create trigger set_pos_sales_item_mappings_updated_at
before update on public.pos_sales_item_mappings
for each row execute function public.set_updated_at();

create index if not exists idx_pos_sales_item_mappings_org
  on public.pos_sales_item_mappings(organization_id, updated_at desc);

alter table public.pos_sales_item_mappings enable row level security;

drop policy if exists "pos_sales_item_mappings_member_select"
  on public.pos_sales_item_mappings;
create policy "pos_sales_item_mappings_member_select"
on public.pos_sales_item_mappings
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "pos_sales_item_mappings_member_insert"
  on public.pos_sales_item_mappings;
create policy "pos_sales_item_mappings_member_insert"
on public.pos_sales_item_mappings
for insert
to authenticated
with check (public.user_can_record_operations(organization_id));

drop policy if exists "pos_sales_item_mappings_member_update"
  on public.pos_sales_item_mappings;
create policy "pos_sales_item_mappings_member_update"
on public.pos_sales_item_mappings
for update
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_record_operations(organization_id));
