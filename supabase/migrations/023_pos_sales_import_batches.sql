-- POS import batches preserve the source file review trail for sales, revenue, voids, promos, and discounts.

alter table if exists public.menu_sales
  add column if not exists gross_sales numeric(18, 6) not null default 0,
  add column if not exists discount_amount numeric(18, 6) not null default 0,
  add column if not exists promo_amount numeric(18, 6) not null default 0,
  add column if not exists void_amount numeric(18, 6) not null default 0,
  add column if not exists net_sales numeric(18, 6) not null default 0,
  add column if not exists pos_import_batch_id uuid,
  add column if not exists pos_source_label text,
  add column if not exists pos_source_code text;

update public.menu_sales
   set gross_sales = total_revenue,
       net_sales = total_revenue
 where total_revenue > 0
   and gross_sales = 0
   and net_sales = 0;

create table if not exists public.pos_sales_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_name text not null default 'POS sales import',
  status text not null default 'posted',
  row_count integer not null default 0,
  matched_row_count integer not null default 0,
  unmatched_row_count integer not null default 0,
  gross_sales numeric(18, 6) not null default 0,
  discount_amount numeric(18, 6) not null default 0,
  promo_amount numeric(18, 6) not null default 0,
  void_amount numeric(18, 6) not null default 0,
  net_sales numeric(18, 6) not null default 0,
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  uploaded_at timestamptz not null default now(),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_sales_import_batches_status_check check (
    status in ('draft', 'reviewed', 'posted', 'cancelled')
  )
);

create table if not exists public.pos_sales_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.pos_sales_import_batches(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  row_number integer not null,
  pos_item_key text not null,
  pos_item_label text not null,
  pos_item_code text,
  recipe_id uuid references public.recipes(id) on delete set null,
  sold_quantity numeric(18, 6) not null default 0,
  gross_sales numeric(18, 6) not null default 0,
  discount_amount numeric(18, 6) not null default 0,
  promo_amount numeric(18, 6) not null default 0,
  void_amount numeric(18, 6) not null default 0,
  net_sales numeric(18, 6) not null default 0,
  status text not null default 'matched',
  raw_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint pos_sales_import_rows_status_check check (
    status in ('matched', 'unmatched', 'posted', 'skipped', 'error')
  )
);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'menu_sales'
      and constraint_name = 'menu_sales_pos_import_batch_id_fkey'
  ) then
    alter table public.menu_sales
      add constraint menu_sales_pos_import_batch_id_fkey
      foreign key (pos_import_batch_id)
      references public.pos_sales_import_batches(id)
      on delete set null;
  end if;
end;
$$;

drop trigger if exists set_pos_sales_import_batches_updated_at
  on public.pos_sales_import_batches;
create trigger set_pos_sales_import_batches_updated_at
before update on public.pos_sales_import_batches
for each row execute function public.set_updated_at();

create index if not exists idx_pos_sales_import_batches_org
  on public.pos_sales_import_batches(organization_id, uploaded_at desc);

create index if not exists idx_pos_sales_import_rows_batch
  on public.pos_sales_import_rows(batch_id, row_number asc);

alter table public.pos_sales_import_batches enable row level security;
alter table public.pos_sales_import_rows enable row level security;

drop policy if exists "pos_sales_import_batches_member_select"
  on public.pos_sales_import_batches;
create policy "pos_sales_import_batches_member_select"
on public.pos_sales_import_batches
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "pos_sales_import_batches_member_insert"
  on public.pos_sales_import_batches;
create policy "pos_sales_import_batches_member_insert"
on public.pos_sales_import_batches
for insert
to authenticated
with check (public.user_can_record_operations(organization_id));

drop policy if exists "pos_sales_import_batches_member_update"
  on public.pos_sales_import_batches;
create policy "pos_sales_import_batches_member_update"
on public.pos_sales_import_batches
for update
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_record_operations(organization_id));

drop policy if exists "pos_sales_import_rows_member_select"
  on public.pos_sales_import_rows;
create policy "pos_sales_import_rows_member_select"
on public.pos_sales_import_rows
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "pos_sales_import_rows_member_insert"
  on public.pos_sales_import_rows;
create policy "pos_sales_import_rows_member_insert"
on public.pos_sales_import_rows
for insert
to authenticated
with check (public.user_can_record_operations(organization_id));

drop function if exists public.create_dashboard_menu_sale_with_revenue(
  uuid,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  uuid,
  text,
  text
);

create function public.create_dashboard_menu_sale_with_revenue(
  target_recipe_id uuid,
  sold_quantity numeric,
  gross_sales_value numeric default null,
  discount_amount_value numeric default 0,
  promo_amount_value numeric default 0,
  void_amount_value numeric default 0,
  pos_import_batch_id_value uuid default null,
  pos_source_label_value text default null,
  pos_source_code_value text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_organization_id uuid;
  selected_recipe public.recipes;
  sale_source_id uuid;
  component_line record;
  required_quantity numeric(18, 6);
  depleted_line_count integer := 0;
  has_legacy_item_id boolean;
  clean_gross_sales numeric(18, 6);
  clean_discount_amount numeric(18, 6);
  clean_promo_amount numeric(18, 6);
  clean_void_amount numeric(18, 6);
  clean_net_sales numeric(18, 6);
  clean_selling_unit_price numeric(18, 6);
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to record menu sales.';
  end if;

  select p.organization_id
    into current_organization_id
  from public.profiles p
  where p.id = current_user_id;

  if current_organization_id is null then
    raise exception 'Create a workspace before recording menu sales.';
  end if;

  perform public.require_dashboard_permission(current_organization_id, 'operations');

  if sold_quantity is null or sold_quantity <= 0 then
    raise exception 'Sold quantity must be greater than zero.';
  end if;

  select *
    into selected_recipe
  from public.recipes
  where id = target_recipe_id
    and organization_id = current_organization_id
    and is_active = true;

  if selected_recipe.id is null then
    raise exception 'Menu item not found for this workspace.';
  end if;

  if selected_recipe.recipe_type::text not in ('final_menu_item', 'final_dish') then
    raise exception 'Only final menu items can be recorded as sales.';
  end if;

  if pos_import_batch_id_value is not null and not exists (
    select 1
    from public.pos_sales_import_batches b
    where b.id = pos_import_batch_id_value
      and b.organization_id = current_organization_id
  ) then
    raise exception 'POS import batch not found for this workspace.';
  end if;

  clean_gross_sales :=
    case
      when gross_sales_value is null then sold_quantity * coalesce(selected_recipe.selling_price, 0)
      else greatest(gross_sales_value, 0)
    end;
  clean_discount_amount := greatest(coalesce(discount_amount_value, 0), 0);
  clean_promo_amount := greatest(coalesce(promo_amount_value, 0), 0);
  clean_void_amount := greatest(coalesce(void_amount_value, 0), 0);
  clean_net_sales := greatest(
    clean_gross_sales - clean_discount_amount - clean_promo_amount - clean_void_amount,
    0
  );
  clean_selling_unit_price := clean_net_sales / nullif(sold_quantity, 0);

  insert into public.menu_sales (
    tenant_id,
    organization_id,
    recipe_id,
    sold_quantity,
    selling_unit_price,
    total_revenue,
    gross_sales,
    discount_amount,
    promo_amount,
    void_amount,
    net_sales,
    pos_import_batch_id,
    pos_source_label,
    pos_source_code,
    created_by
  ) values (
    current_user_id,
    current_organization_id,
    selected_recipe.id,
    sold_quantity,
    clean_selling_unit_price,
    clean_net_sales,
    clean_gross_sales,
    clean_discount_amount,
    clean_promo_amount,
    clean_void_amount,
    clean_net_sales,
    pos_import_batch_id_value,
    nullif(trim(coalesce(pos_source_label_value, '')), ''),
    nullif(trim(coalesce(pos_source_code_value, '')), ''),
    current_user_id
  )
  returning id into sale_source_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transformation_events'
      and column_name = 'item_id'
  )
    into has_legacy_item_id;

  for component_line in
    select
      rc.component_inventory_item_id,
      rc.qty_in_recipe_uom,
      ii.current_cost_per_base_uom
    from public.recipe_components rc
    join public.inventory_items ii
      on ii.id = rc.component_inventory_item_id
    where rc.recipe_id = selected_recipe.id
      and rc.organization_id = current_organization_id
      and rc.component_inventory_item_id is not null
  loop
    required_quantity :=
      (component_line.qty_in_recipe_uom / nullif(selected_recipe.standard_batch_output_qty, 0))
      * sold_quantity;

    if has_legacy_item_id then
      execute '
        insert into public.transformation_events (
          organization_id,
          event_type,
          inventory_item_id,
          item_id,
          quantity,
          unit_cost,
          source_table,
          source_id,
          created_by
        ) values (
          $1,
          ''sales_depletion'',
          $2,
          $2,
          $3,
          $4,
          ''menu_sales'',
          $5,
          $6
        )'
      using
        current_organization_id,
        component_line.component_inventory_item_id,
        -1 * required_quantity,
        coalesce(component_line.current_cost_per_base_uom, 0),
        sale_source_id,
        current_user_id;
    else
      insert into public.transformation_events (
        organization_id,
        event_type,
        inventory_item_id,
        quantity,
        unit_cost,
        source_table,
        source_id,
        created_by
      ) values (
        current_organization_id,
        'sales_depletion',
        component_line.component_inventory_item_id,
        -1 * required_quantity,
        coalesce(component_line.current_cost_per_base_uom, 0),
        'menu_sales',
        sale_source_id,
        current_user_id
      );
    end if;

    update public.inventory_items
       set on_hand_qty = on_hand_qty - required_quantity
     where id = component_line.component_inventory_item_id
       and organization_id = current_organization_id;

    depleted_line_count := depleted_line_count + 1;
  end loop;

  if depleted_line_count = 0 then
    raise exception 'Attach at least one component before recording sales.';
  end if;

  return depleted_line_count;
end;
$$;

grant execute on function public.create_dashboard_menu_sale_with_revenue(
  uuid,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  uuid,
  text,
  text
) to authenticated;
