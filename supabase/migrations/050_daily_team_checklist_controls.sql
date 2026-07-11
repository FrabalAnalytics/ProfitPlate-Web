-- Daily team checklist controls turn the ProfitPlate playbook into operating
-- evidence. These are intentionally register-backed so the existing daily
-- checklist UI can declare activity, zero activity, or exceptions.

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
  seed.department,
  seed.control_key,
  seed.control_label,
  'register',
  true,
  seed.allows_deferment,
  true,
  seed.priority,
  current_date
from public.organizations organization
cross join (
  values
    (
      'Procurement',
      'procurement_invoice_price_check',
      'Supplier invoice price check',
      false,
      130
    ),
    (
      'Inventory',
      'store_issue_receipt_check',
      'Store issues and department receipts checked',
      false,
      130
    ),
    (
      'Inventory',
      'store_stock_count_variance_check',
      'Store stock count and variance reviewed',
      true,
      110
    ),
    (
      'Kitchen',
      'kitchen_requisition_receipt_check',
      'Kitchen requisitions received or escalated',
      false,
      130
    ),
    (
      'Kitchen',
      'kitchen_production_check',
      'Kitchen production logged or zero declared',
      false,
      130
    ),
    (
      'Kitchen',
      'kitchen_waste_declaration',
      'Kitchen waste recorded or zero declared',
      false,
      130
    ),
    (
      'Bar',
      'bar_waste_declaration',
      'Bar waste recorded or zero declared',
      false,
      120
    ),
    (
      'Finance',
      'finance_pos_import_check',
      'POS import completed or no-sales declared',
      false,
      140
    ),
    (
      'Finance',
      'finance_unmapped_pos_review',
      'Unmapped POS items reviewed',
      false,
      130
    ),
    (
      'Finance',
      'finance_avt_exception_review',
      'AvT exceptions reviewed',
      true,
      120
    )
) as seed(
  department,
  control_key,
  control_label,
  allows_deferment,
  priority
)
where not exists (
  select 1
  from public.operating_control_policies existing
  where existing.organization_id = organization.id
    and existing.location_id is null
    and existing.control_key = seed.control_key
    and existing.effective_to is null
);

notify pgrst, 'reload schema';
