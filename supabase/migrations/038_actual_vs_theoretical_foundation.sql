-- Build the first Actual-vs-Theoretical read model.
-- This does not mutate stock. It summarizes recorded POS/menu sales depletion,
-- waste, production variance, and stock variance by operating date/location.

create table if not exists public.avt_daily_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operating_date date not null,
  location_id uuid references public.locations(id) on delete set null,
  status text not null default 'provisional',
  sales_count integer not null default 0,
  revenue numeric(18, 6) not null default 0,
  theoretical_food_cost numeric(18, 6) not null default 0,
  production_variance_cost numeric(18, 6) not null default 0,
  waste_cost numeric(18, 6) not null default 0,
  stock_variance_cost numeric(18, 6) not null default 0,
  total_variance_cost numeric(18, 6) not null default 0,
  gross_profit numeric(18, 6) not null default 0,
  gross_margin_pct numeric(12, 6),
  food_cost_pct numeric(12, 6),
  readiness_flags jsonb not null default '[]'::jsonb,
  generated_by uuid references auth.users(id) on delete set null default auth.uid(),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint avt_daily_snapshots_status_check check (
    status in ('ready', 'provisional', 'missing_pos', 'missing_depletion', 'exception')
  ),
  constraint avt_daily_snapshots_unique unique (
    organization_id,
    operating_date,
    location_id
  )
);

drop trigger if exists set_avt_daily_snapshots_updated_at
  on public.avt_daily_snapshots;
create trigger set_avt_daily_snapshots_updated_at
before update on public.avt_daily_snapshots
for each row execute function public.set_updated_at();

create index if not exists idx_avt_daily_snapshots_org_date
  on public.avt_daily_snapshots(organization_id, operating_date desc);

create unique index if not exists idx_avt_daily_snapshots_unique_scope
  on public.avt_daily_snapshots(
    organization_id,
    operating_date,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table public.avt_daily_snapshots enable row level security;

drop policy if exists "avt_daily_snapshots_member_select"
  on public.avt_daily_snapshots;
create policy "avt_daily_snapshots_member_select"
on public.avt_daily_snapshots
for select
to authenticated
using (public.user_can_access_organization(organization_id));

drop policy if exists "avt_daily_snapshots_member_write"
  on public.avt_daily_snapshots;
create policy "avt_daily_snapshots_member_write"
on public.avt_daily_snapshots
for all
to authenticated
using (public.user_can_access_organization(organization_id))
with check (public.user_can_access_organization(organization_id));

create or replace function public.get_dashboard_avt_summary(
  target_organization_id uuid,
  start_date_value date default null,
  end_date_value date default null
)
returns table (
  operating_date date,
  location_id uuid,
  location_name text,
  status text,
  sales_count integer,
  revenue numeric,
  theoretical_food_cost numeric,
  production_variance_cost numeric,
  waste_cost numeric,
  stock_variance_cost numeric,
  total_variance_cost numeric,
  gross_profit numeric,
  gross_margin_pct numeric,
  food_cost_pct numeric,
  readiness_flags jsonb
)
language sql
security definer
set search_path = public
as $$
  with bounds as (
    select
      coalesce(start_date_value, current_date - interval '30 days')::date as start_date,
      coalesce(end_date_value, current_date)::date as end_date
  ),
  sales as (
    select
      coalesce(ms.operating_date, ms.created_at::date) as operating_date,
      ms.location_id,
      count(distinct ms.id)::integer as sales_count,
      coalesce(sum(ms.total_revenue), 0) as revenue
    from public.menu_sales ms
    cross join bounds b
    where ms.organization_id = target_organization_id
      and public.user_can_access_organization(target_organization_id)
      and coalesce(ms.operating_date, ms.created_at::date)
        between b.start_date and b.end_date
    group by coalesce(ms.operating_date, ms.created_at::date), ms.location_id
  ),
  depletion as (
    select
      coalesce(ms.operating_date, te.created_at::date) as operating_date,
      coalesce(te.location_id, ms.location_id) as location_id,
      coalesce(sum(abs(te.quantity * te.unit_cost)), 0) as theoretical_food_cost,
      count(te.id)::integer as depletion_event_count
    from public.transformation_events te
    join public.menu_sales ms
      on te.source_table = 'menu_sales'
     and te.source_id = ms.id
    cross join bounds b
    where te.organization_id = target_organization_id
      and public.user_can_access_organization(target_organization_id)
      and te.event_type::text = 'sales_depletion'
      and coalesce(ms.operating_date, te.created_at::date)
        between b.start_date and b.end_date
    group by
      coalesce(ms.operating_date, te.created_at::date),
      coalesce(te.location_id, ms.location_id)
  ),
  production_variance as (
    select
      va.created_at::date as operating_date,
      va.location_id,
      coalesce(sum(abs(va.hard_currency_impact)), 0) as production_variance_cost
    from public.variance_attributions va
    cross join bounds b
    where va.organization_id = target_organization_id
      and public.user_can_access_organization(target_organization_id)
      and va.variance_type::text in ('yield_variance', 'waste_variance')
      and va.source_table = 'production_runs'
      and va.created_at::date between b.start_date and b.end_date
    group by va.created_at::date, va.location_id
  ),
  waste as (
    select
      we.created_at::date as operating_date,
      ii.location_id,
      coalesce(sum(we.quantity * we.unit_cost), 0) as waste_cost
    from public.waste_events we
    left join public.inventory_items ii
      on ii.id = we.inventory_item_id
    cross join bounds b
    where we.organization_id = target_organization_id
      and public.user_can_access_organization(target_organization_id)
      and we.created_at::date between b.start_date and b.end_date
    group by we.created_at::date, ii.location_id
  ),
  stock_variance as (
    select
      va.created_at::date as operating_date,
      va.location_id,
      coalesce(sum(abs(va.hard_currency_impact)), 0) as stock_variance_cost
    from public.variance_attributions va
    cross join bounds b
    where va.organization_id = target_organization_id
      and public.user_can_access_organization(target_organization_id)
      and va.variance_type::text in ('unrecorded_depletion', 'portioning_variance')
      and va.created_at::date between b.start_date and b.end_date
    group by va.created_at::date, va.location_id
  ),
  keys as (
    select operating_date, location_id from sales
    union
    select operating_date, location_id from depletion
    union
    select operating_date, location_id from production_variance
    union
    select operating_date, location_id from waste
    union
    select operating_date, location_id from stock_variance
  ),
  joined as (
    select
      keys.operating_date,
      keys.location_id,
      coalesce(loc.name, 'Unassigned') as location_name,
      coalesce(sales.sales_count, 0) as sales_count,
      coalesce(sales.revenue, 0) as revenue,
      coalesce(depletion.theoretical_food_cost, 0) as theoretical_food_cost,
      coalesce(depletion.depletion_event_count, 0) as depletion_event_count,
      coalesce(production_variance.production_variance_cost, 0) as production_variance_cost,
      coalesce(waste.waste_cost, 0) as waste_cost,
      coalesce(stock_variance.stock_variance_cost, 0) as stock_variance_cost
    from keys
    left join sales
      on sales.operating_date = keys.operating_date
     and sales.location_id is not distinct from keys.location_id
    left join depletion
      on depletion.operating_date = keys.operating_date
     and depletion.location_id is not distinct from keys.location_id
    left join production_variance
      on production_variance.operating_date = keys.operating_date
     and production_variance.location_id is not distinct from keys.location_id
    left join waste
      on waste.operating_date = keys.operating_date
     and waste.location_id is not distinct from keys.location_id
    left join stock_variance
      on stock_variance.operating_date = keys.operating_date
     and stock_variance.location_id is not distinct from keys.location_id
    left join public.locations loc
      on loc.id = keys.location_id
  )
  select
    joined.operating_date,
    joined.location_id,
    joined.location_name,
    case
      when joined.sales_count = 0 then 'missing_pos'
      when joined.depletion_event_count = 0 then 'missing_depletion'
      when exists (
        select 1
        from public.operating_days od
        where od.organization_id = target_organization_id
          and od.operating_date = joined.operating_date
          and od.reconciliation_status <> 'reconciled'
      ) then 'provisional'
      else 'ready'
    end as status,
    joined.sales_count,
    joined.revenue,
    joined.theoretical_food_cost,
    joined.production_variance_cost,
    joined.waste_cost,
    joined.stock_variance_cost,
    joined.production_variance_cost
      + joined.waste_cost
      + joined.stock_variance_cost as total_variance_cost,
    joined.revenue
      - joined.theoretical_food_cost
      - joined.production_variance_cost
      - joined.waste_cost
      - joined.stock_variance_cost as gross_profit,
    case
      when joined.revenue > 0 then
        (
          (
            joined.revenue
            - joined.theoretical_food_cost
            - joined.production_variance_cost
            - joined.waste_cost
            - joined.stock_variance_cost
          ) / joined.revenue
        ) * 100
      else null
    end as gross_margin_pct,
    case
      when joined.revenue > 0 then
        (
          joined.theoretical_food_cost
          + joined.production_variance_cost
          + joined.waste_cost
          + joined.stock_variance_cost
        ) / joined.revenue * 100
      else null
    end as food_cost_pct,
    (
      select coalesce(jsonb_agg(flag), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'key',
          'missing_pos',
          'label',
          'No POS revenue',
          'message',
          'No POS/menu sales were found for this operating date and location.'
        ) as flag
        where joined.sales_count = 0
        union all
        select jsonb_build_object(
          'key',
          'missing_depletion',
          'label',
          'No recipe depletion',
          'message',
          'Sales exist, but recipe stock depletion has not been recorded.'
        )
        where joined.sales_count > 0 and joined.depletion_event_count = 0
        union all
        select jsonb_build_object(
          'key',
          'pos_not_reconciled',
          'label',
          'POS reconciliation pending',
          'message',
          'Financial reconciliation is not yet marked reconciled for this operating day.'
        )
        where exists (
          select 1
          from public.operating_days od
          where od.organization_id = target_organization_id
            and od.operating_date = joined.operating_date
            and od.reconciliation_status <> 'reconciled'
        )
      ) flags
    ) as readiness_flags
  from joined
  order by joined.operating_date desc, joined.location_name asc;
$$;

grant execute on function public.get_dashboard_avt_summary(uuid, date, date)
  to authenticated;

create or replace function public.refresh_dashboard_avt_snapshots(
  target_organization_id uuid,
  start_date_value date default null,
  end_date_value date default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  summary_row record;
  refreshed_count integer := 0;
begin
  perform public.require_dashboard_permission(target_organization_id, 'costing');

  for summary_row in
    select *
    from public.get_dashboard_avt_summary(
      target_organization_id,
      start_date_value,
      end_date_value
    )
  loop
    update public.avt_daily_snapshots
       set
      status = summary_row.status,
      sales_count = summary_row.sales_count,
      revenue = summary_row.revenue,
      theoretical_food_cost = summary_row.theoretical_food_cost,
      production_variance_cost = summary_row.production_variance_cost,
      waste_cost = summary_row.waste_cost,
      stock_variance_cost = summary_row.stock_variance_cost,
      total_variance_cost = summary_row.total_variance_cost,
      gross_profit = summary_row.gross_profit,
      gross_margin_pct = summary_row.gross_margin_pct,
      food_cost_pct = summary_row.food_cost_pct,
      readiness_flags = summary_row.readiness_flags,
      generated_by = auth.uid(),
      generated_at = now()
     where organization_id = target_organization_id
       and operating_date = summary_row.operating_date
       and location_id is not distinct from summary_row.location_id;

    if not found then
      insert into public.avt_daily_snapshots (
        organization_id,
        operating_date,
        location_id,
        status,
        sales_count,
        revenue,
        theoretical_food_cost,
        production_variance_cost,
        waste_cost,
        stock_variance_cost,
        total_variance_cost,
        gross_profit,
        gross_margin_pct,
        food_cost_pct,
        readiness_flags,
        generated_by,
        generated_at
      ) values (
        target_organization_id,
        summary_row.operating_date,
        summary_row.location_id,
        summary_row.status,
        summary_row.sales_count,
        summary_row.revenue,
        summary_row.theoretical_food_cost,
        summary_row.production_variance_cost,
        summary_row.waste_cost,
        summary_row.stock_variance_cost,
        summary_row.total_variance_cost,
        summary_row.gross_profit,
        summary_row.gross_margin_pct,
        summary_row.food_cost_pct,
        summary_row.readiness_flags,
        auth.uid(),
        now()
      );
    end if;

    refreshed_count := refreshed_count + 1;
  end loop;

  return refreshed_count;
end;
$$;

grant execute on function public.refresh_dashboard_avt_snapshots(uuid, date, date)
  to authenticated;

notify pgrst, 'reload schema';
