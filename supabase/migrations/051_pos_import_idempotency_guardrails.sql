-- POS import is the preferred sales-capture mode, so posting must be
-- idempotent. Re-uploading the same POS evidence should not deplete stock a
-- second time. This migration blocks future duplicate POS postings without
-- rewriting historical test data.

alter table if exists public.menu_sales
  add column if not exists pos_row_fingerprint text;

create index if not exists idx_menu_sales_pos_row_fingerprint
  on public.menu_sales(organization_id, pos_row_fingerprint)
  where pos_row_fingerprint is not null;

create index if not exists idx_menu_sales_pos_identity
  on public.menu_sales(
    organization_id,
    location_id,
    pos_business_date,
    pos_source_transaction_id,
    pos_source_check_id,
    pos_source_code
  )
  where pos_import_batch_id is not null
    and pos_source_transaction_id is not null;

create or replace function public.enforce_menu_sales_pos_idempotency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_fingerprint text;
  normalized_transaction_id text;
  normalized_check_id text;
  normalized_source_code text;
  resolved_business_date date;
begin
  if new.pos_import_batch_id is null then
    return new;
  end if;

  normalized_fingerprint := nullif(lower(trim(coalesce(new.pos_row_fingerprint, ''))), '');
  normalized_transaction_id := nullif(lower(trim(coalesce(new.pos_source_transaction_id, ''))), '');
  normalized_check_id := nullif(lower(trim(coalesce(new.pos_source_check_id, ''))), '');
  normalized_source_code := nullif(lower(trim(coalesce(new.pos_source_code, ''))), '');
  resolved_business_date := coalesce(new.pos_business_date, new.operating_date);

  if normalized_fingerprint is not null
     and exists (
       select 1
       from public.menu_sales existing
       where existing.organization_id = new.organization_id
         and existing.pos_import_batch_id is not null
         and lower(trim(coalesce(existing.pos_row_fingerprint, ''))) =
           normalized_fingerprint
         and existing.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
     ) then
    raise exception 'This POS row has already been posted. Duplicate import was blocked to prevent double depletion.';
  end if;

  if normalized_transaction_id is not null
     and resolved_business_date is not null
     and exists (
       select 1
       from public.menu_sales existing
       where existing.organization_id = new.organization_id
         and existing.pos_import_batch_id is not null
         and coalesce(existing.location_id, '00000000-0000-0000-0000-000000000000'::uuid) =
           coalesce(new.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
         and coalesce(existing.pos_business_date, existing.operating_date) =
           resolved_business_date
         and lower(trim(coalesce(existing.pos_source_transaction_id, ''))) =
           normalized_transaction_id
         and coalesce(lower(trim(coalesce(existing.pos_source_check_id, ''))), '') =
           coalesce(normalized_check_id, '')
         and coalesce(lower(trim(coalesce(existing.pos_source_code, ''))), '') =
           coalesce(normalized_source_code, '')
         and existing.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
     ) then
    raise exception 'This POS transaction line has already been posted for the business date/location. Duplicate import was blocked to prevent double depletion.';
  end if;

  new.pos_row_fingerprint := normalized_fingerprint;

  return new;
end;
$$;

drop trigger if exists enforce_menu_sales_pos_idempotency
  on public.menu_sales;
create trigger enforce_menu_sales_pos_idempotency
before insert or update of
  organization_id,
  location_id,
  operating_date,
  pos_business_date,
  pos_import_batch_id,
  pos_source_transaction_id,
  pos_source_check_id,
  pos_source_code,
  pos_row_fingerprint
on public.menu_sales
for each row execute function public.enforce_menu_sales_pos_idempotency();

drop function if exists public.create_dashboard_menu_sale_with_revenue(
  uuid,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  uuid,
  text,
  text,
  date,
  uuid,
  date,
  timestamptz,
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
  pos_source_code_value text default null,
  operating_date_value date default null,
  location_id_value uuid default null,
  pos_business_date_value date default null,
  pos_transaction_timestamp_value timestamptz default null,
  pos_source_transaction_id_value text default null,
  pos_source_check_id_value text default null,
  pos_row_fingerprint_value text default null
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
  clean_gross_sales numeric(18, 6);
  clean_discount_amount numeric(18, 6);
  clean_promo_amount numeric(18, 6);
  clean_void_amount numeric(18, 6);
  clean_net_sales numeric(18, 6);
  clean_selling_unit_price numeric(18, 6);
  resolved_operating_date date;
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

  if location_id_value is not null and not exists (
    select 1
    from public.locations location
    where location.id = location_id_value
      and location.organization_id = current_organization_id
  ) then
    raise exception 'The selected location does not belong to this workspace.';
  end if;

  resolved_operating_date := coalesce(
    operating_date_value,
    pos_business_date_value,
    (coalesce(pos_transaction_timestamp_value, now()) at time zone (
      select coalesce(organization.operating_timezone, 'Africa/Lagos')
      from public.organizations organization
      where organization.id = current_organization_id
    ))::date
  );

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
    operating_date,
    location_id,
    pos_business_date,
    pos_transaction_timestamp,
    pos_import_batch_id,
    pos_source_label,
    pos_source_code,
    pos_source_transaction_id,
    pos_source_check_id,
    pos_row_fingerprint,
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
    resolved_operating_date,
    location_id_value,
    coalesce(pos_business_date_value, resolved_operating_date),
    pos_transaction_timestamp_value,
    pos_import_batch_id_value,
    nullif(trim(coalesce(pos_source_label_value, '')), ''),
    nullif(trim(coalesce(pos_source_code_value, '')), ''),
    nullif(trim(coalesce(pos_source_transaction_id_value, '')), ''),
    nullif(trim(coalesce(pos_source_check_id_value, '')), ''),
    nullif(trim(coalesce(pos_row_fingerprint_value, '')), ''),
    current_user_id
  )
  returning id into sale_source_id;

  return public.deplete_dashboard_menu_sale_stock(
    current_organization_id,
    sale_source_id,
    selected_recipe.id,
    sold_quantity,
    location_id_value,
    current_user_id
  );
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
  text,
  date,
  uuid,
  date,
  timestamptz,
  text,
  text,
  text
) to authenticated;

notify pgrst, 'reload schema';
