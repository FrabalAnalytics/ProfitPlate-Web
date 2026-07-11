create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_name_not_blank check (length(trim(name)) > 0)
);

alter table if exists public.purchase_orders
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

create index if not exists idx_suppliers_organization
on public.suppliers(organization_id);

drop trigger if exists set_suppliers_updated_at on public.suppliers;
create trigger set_suppliers_updated_at
before update on public.suppliers
for each row execute function public.set_updated_at();

alter table public.suppliers enable row level security;

drop policy if exists "suppliers_member_all" on public.suppliers;
create policy "suppliers_member_all"
on public.suppliers
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (
  public.user_can_manage_costing(organization_id)
  or public.user_can_record_operations(organization_id)
);

notify pgrst, 'reload schema';
