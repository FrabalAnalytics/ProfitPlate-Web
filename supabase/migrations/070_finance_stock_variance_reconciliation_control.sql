-- Require Finance to confirm physical stock count variance reconciliation
-- before daily AvT losses are treated as management-ready.

insert into public.operating_control_policies (
  organization_id,
  department,
  control_key,
  control_label,
  source_kind,
  blocks_operational_close,
  allows_deferment,
  allows_waiver,
  priority,
  effective_from
)
select
  organization.id,
  'Finance',
  'finance_stock_variance_reconciliation',
  'Physical count variance reconciled',
  'register',
  true,
  true,
  true,
  90,
  current_date
from public.organizations organization
where not exists (
  select 1
  from public.operating_control_policies existing
  where existing.organization_id = organization.id
    and existing.location_id is null
    and existing.control_key = 'finance_stock_variance_reconciliation'
    and existing.effective_to is null
);

notify pgrst, 'reload schema';
