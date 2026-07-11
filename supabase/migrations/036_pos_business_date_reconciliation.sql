-- Preserve POS business dates and transaction identity so revenue can be
-- reconciled to the correct operating day, regardless of import cadence.

alter table if exists public.pos_sales_import_batches
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists operating_date date,
  add column if not exists period_start_date date,
  add column if not exists period_end_date date,
  add column if not exists import_scope text not null default 'single_day',
  add column if not exists date_status text not null default 'unverified',
  add column if not exists source_file_hash text,
  add column if not exists reconciliation_note text;

alter table if exists public.pos_sales_import_batches
  drop constraint if exists pos_sales_import_batches_import_scope_check;

alter table if exists public.pos_sales_import_batches
  add constraint pos_sales_import_batches_import_scope_check check (
    import_scope in ('single_day', 'multi_day', 'weekly', 'scheduled_days', 'manual')
  );

alter table if exists public.pos_sales_import_batches
  drop constraint if exists pos_sales_import_batches_date_status_check;

alter table if exists public.pos_sales_import_batches
  add constraint pos_sales_import_batches_date_status_check check (
    date_status in ('verified', 'unverified', 'mixed_dates', 'missing_dates', 'exception')
  );

alter table if exists public.pos_sales_import_rows
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists business_date date,
  add column if not exists transaction_timestamp timestamptz,
  add column if not exists source_transaction_id text,
  add column if not exists source_check_id text,
  add column if not exists row_fingerprint text,
  add column if not exists date_status text not null default 'unverified';

alter table if exists public.pos_sales_import_rows
  drop constraint if exists pos_sales_import_rows_date_status_check;

alter table if exists public.pos_sales_import_rows
  add constraint pos_sales_import_rows_date_status_check check (
    date_status in ('verified', 'unverified', 'missing_date', 'exception')
  );

alter table if exists public.menu_sales
  add column if not exists operating_date date,
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists pos_business_date date,
  add column if not exists pos_transaction_timestamp timestamptz,
  add column if not exists pos_source_transaction_id text,
  add column if not exists pos_source_check_id text;

update public.menu_sales
   set operating_date = coalesce(operating_date, created_at::date),
       pos_business_date = coalesce(pos_business_date, operating_date, created_at::date)
 where operating_date is null
    or pos_business_date is null;

create index if not exists idx_pos_sales_import_batches_period
  on public.pos_sales_import_batches(
    organization_id,
    location_id,
    period_start_date,
    period_end_date
  );

create index if not exists idx_pos_sales_import_rows_business_date
  on public.pos_sales_import_rows(
    organization_id,
    location_id,
    business_date
  );

create unique index if not exists idx_pos_sales_import_rows_transaction_unique
  on public.pos_sales_import_rows(
    organization_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    business_date,
    source_transaction_id,
    pos_item_key
  )
  where source_transaction_id is not null
    and business_date is not null;

create unique index if not exists idx_pos_sales_import_rows_fingerprint_unique
  on public.pos_sales_import_rows(
    organization_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    row_fingerprint
  )
  where row_fingerprint is not null;

create index if not exists idx_menu_sales_operating_date
  on public.menu_sales(organization_id, location_id, operating_date desc);

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
  pos_source_check_id_value text default null
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
  text,
  date,
  uuid,
  date,
  timestamptz,
  text,
  text
) to authenticated;

drop function if exists public.get_dashboard_menu_sales_history();

create function public.get_dashboard_menu_sales_history()
returns table (
  menu_sale_id uuid,
  created_at timestamptz,
  operating_date date,
  pos_business_date date,
  recipe_name text,
  sold_quantity numeric,
  output_uom text,
  component_name text,
  depleted_qty numeric,
  unit_cost numeric,
  cost_impact numeric,
  selling_unit_price numeric,
  total_revenue numeric,
  gross_profit numeric,
  gross_margin_pct numeric,
  component_uom text
)
language sql
security definer
set search_path = public
as $$
  with sale_lines as (
    select
      ms.id as menu_sale_id,
      ms.created_at,
      coalesce(ms.operating_date, ms.created_at::date) as operating_date,
      ms.pos_business_date,
      r.name as recipe_name,
      ms.sold_quantity,
      r.output_uom,
      coalesce(ii.name, 'Component') as component_name,
      abs(te.quantity) as depleted_qty,
      te.unit_cost,
      abs(te.quantity * te.unit_cost) as cost_impact,
      sum(abs(te.quantity * te.unit_cost)) over (partition by ms.id) as total_food_cost,
      ms.selling_unit_price,
      ms.total_revenue,
      coalesce(ii.on_hand_uom, ii.recipe_uom, ii.base_uom) as component_uom
    from public.menu_sales ms
    join public.recipes r on r.id = ms.recipe_id
    join public.transformation_events te
      on te.source_table = 'menu_sales'
     and te.source_id = ms.id
    left join public.inventory_items ii
      on ii.id = te.inventory_item_id
    join public.profiles p on p.organization_id = ms.organization_id
    where p.id = auth.uid()
  )
  select
    menu_sale_id,
    created_at,
    operating_date,
    pos_business_date,
    recipe_name,
    sold_quantity,
    output_uom,
    component_name,
    depleted_qty,
    unit_cost,
    cost_impact,
    selling_unit_price,
    total_revenue,
    total_revenue - total_food_cost as gross_profit,
    case
      when total_revenue > 0 then
        ((total_revenue - total_food_cost) / total_revenue) * 100
      else null
    end as gross_margin_pct,
    component_uom
  from sale_lines
  order by operating_date desc, created_at desc, component_name asc;
$$;

grant execute on function public.get_dashboard_menu_sales_history() to authenticated;

create or replace function public.reconcile_dashboard_pos_import_batch(
  target_batch_id uuid,
  reconciliation_note_value text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_batch public.pos_sales_import_batches;
  imported_day record;
  affected_days integer := 0;
begin
  select *
    into selected_batch
  from public.pos_sales_import_batches batch
  where batch.id = target_batch_id;

  if selected_batch.id is null then
    raise exception 'POS import batch not found.';
  end if;

  perform public.require_dashboard_permission(selected_batch.organization_id, 'costing');

  update public.pos_sales_import_batches
     set date_status = case
           when period_start_date is null or period_end_date is null then 'missing_dates'
           when period_start_date = period_end_date then 'verified'
           else 'mixed_dates'
         end,
         reconciliation_note = nullif(trim(coalesce(reconciliation_note_value, '')), '')
   where id = selected_batch.id;

  for imported_day in
    select distinct row.business_date
    from public.pos_sales_import_rows row
    where row.batch_id = selected_batch.id
      and row.business_date is not null
  loop
    insert into public.operating_days (
      organization_id,
      operating_date,
      status,
      reconciliation_status,
      reconciliation_note,
      reconciled_by,
      reconciled_at
    ) values (
      selected_batch.organization_id,
      imported_day.business_date,
      'open',
      'reconciled',
      coalesce(
        nullif(trim(coalesce(reconciliation_note_value, '')), ''),
        'POS import reconciled to operating date.'
      ),
      auth.uid(),
      now()
    )
    on conflict (organization_id, operating_date)
    do update set
      reconciliation_status = 'reconciled',
      reconciliation_note = excluded.reconciliation_note,
      reconciled_by = auth.uid(),
      reconciled_at = now();

    affected_days := affected_days + 1;
  end loop;

  return affected_days;
end;
$$;

grant execute on function public.reconcile_dashboard_pos_import_batch(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
