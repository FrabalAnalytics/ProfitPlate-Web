-- AvT should report not only variance, but whether the variance is trustworthy.
-- This wrapper preserves the existing AvT summary contract and adds a
-- confidence score/status from readiness flags, daily close blockers, and
-- unresolved register exceptions.

create or replace function public.get_dashboard_avt_summary_with_confidence(
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
  readiness_flags jsonb,
  confidence_score numeric,
  confidence_status text
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select *
    from public.get_dashboard_avt_summary(
      target_organization_id,
      start_date_value,
      end_date_value
    )
  ),
  enriched as (
    select
      base.*,
      coalesce(public.get_dashboard_day_close_blockers(
        target_organization_id,
        base.operating_date
      ), '[]'::jsonb) as day_close_blockers,
      exists (
        select 1
        from public.operation_register_entries entry
        where entry.organization_id = target_organization_id
          and entry.operating_date = base.operating_date
          and entry.status = 'exception'
      ) as has_register_exception,
      coalesce((
        select day.status
        from public.operating_days day
        where day.organization_id = target_organization_id
          and day.operating_date = base.operating_date
        limit 1
      ), 'open') as operating_day_status
    from base
  ),
  scored as (
    select
      enriched.*,
      greatest(
        0,
        least(
          100,
          100
          - case
              when enriched.status = 'missing_pos' then 35
              when enriched.status = 'missing_depletion' then 35
              when enriched.status = 'exception' then 30
              when enriched.status = 'provisional' then 20
              else 0
            end
          - least(jsonb_array_length(enriched.day_close_blockers) * 8, 24)
          - case when enriched.has_register_exception then 15 else 0 end
          - case
              when enriched.operating_day_status in ('closed', 'locked') then 0
              else 10
            end
        )
      )::numeric as calculated_confidence_score
    from enriched
  )
  select
    scored.operating_date,
    scored.location_id,
    scored.location_name,
    scored.status,
    scored.sales_count,
    scored.revenue,
    scored.theoretical_food_cost,
    scored.production_variance_cost,
    scored.waste_cost,
    scored.stock_variance_cost,
    scored.total_variance_cost,
    scored.gross_profit,
    scored.gross_margin_pct,
    scored.food_cost_pct,
    scored.readiness_flags
      || (
        select coalesce(jsonb_agg(flag), '[]'::jsonb)
        from (
          select jsonb_build_object(
            'key',
            'day_close_blockers',
            'label',
            'Day close blockers open',
            'message',
            jsonb_array_length(scored.day_close_blockers)::text
              || ' operating control blocker'
              || case when jsonb_array_length(scored.day_close_blockers) = 1 then ' is' else 's are' end
              || ' still open for this date.'
          ) as flag
          where jsonb_array_length(scored.day_close_blockers) > 0
          union all
          select jsonb_build_object(
            'key',
            'register_exception',
            'label',
            'Register exception open',
            'message',
            'At least one daily operating register has an unresolved exception.'
          )
          where scored.has_register_exception
          union all
          select jsonb_build_object(
            'key',
            'day_not_closed',
            'label',
            'Operating day not closed',
            'message',
            'This date is not closed or locked, so AvT remains operationally provisional.'
          )
          where scored.operating_day_status not in ('closed', 'locked')
        ) flags
      ) as readiness_flags,
    scored.calculated_confidence_score as confidence_score,
    case
      when scored.calculated_confidence_score >= 85 then 'high'
      when scored.calculated_confidence_score >= 65 then 'usable'
      when scored.calculated_confidence_score >= 40 then 'weak'
      else 'unreliable'
    end as confidence_status
  from scored
  order by scored.operating_date desc, scored.location_name asc;
$$;

grant execute on function public.get_dashboard_avt_summary_with_confidence(uuid, date, date)
  to authenticated;

notify pgrst, 'reload schema';
