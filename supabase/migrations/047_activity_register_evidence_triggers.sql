-- Activity should create evidence automatically. The daily register remains the
-- close checklist, but operational postings should mark the relevant register
-- as activity_recorded so blank truly means missing, not "someone forgot to
-- confirm what the system already knows happened."

create or replace function public.mark_dashboard_operation_register_activity(
  target_organization_id uuid,
  register_key_value text,
  department_value text,
  operating_date_value date,
  notes_value text,
  source_table_value text,
  source_record_id_value uuid
)
returns public.operation_register_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_entry public.operation_register_entries;
begin
  if target_organization_id is null
     or nullif(trim(coalesce(register_key_value, '')), '') is null then
    return null;
  end if;

  insert into public.operation_register_entries (
    organization_id,
    operating_date,
    register_key,
    department,
    status,
    activity_state,
    notes,
    source_table,
    source_record_id,
    submitted_by,
    submitted_at
  ) values (
    target_organization_id,
    coalesce(operating_date_value, current_date),
    trim(register_key_value),
    coalesce(nullif(trim(coalesce(department_value, '')), ''), 'Operations'),
    'completed',
    'activity_recorded',
    coalesce(
      nullif(trim(coalesce(notes_value, '')), ''),
      'Activity was recorded by the system.'
    ),
    nullif(trim(coalesce(source_table_value, '')), ''),
    source_record_id_value,
    auth.uid(),
    now()
  )
  on conflict (organization_id, operating_date, register_key)
  do update set
    department = excluded.department,
    status = case
      when public.operation_register_entries.status = 'exception'
        then public.operation_register_entries.status
      else 'completed'
    end,
    activity_state = case
      when public.operation_register_entries.status = 'exception'
        then public.operation_register_entries.activity_state
      else 'activity_recorded'
    end,
    notes = case
      when public.operation_register_entries.status = 'exception'
        then public.operation_register_entries.notes
      else excluded.notes
    end,
    source_table = case
      when public.operation_register_entries.status = 'exception'
        then public.operation_register_entries.source_table
      else excluded.source_table
    end,
    source_record_id = case
      when public.operation_register_entries.status = 'exception'
        then public.operation_register_entries.source_record_id
      else excluded.source_record_id
    end,
    submitted_by = case
      when public.operation_register_entries.status = 'exception'
        then public.operation_register_entries.submitted_by
      else auth.uid()
    end,
    submitted_at = case
      when public.operation_register_entries.status = 'exception'
        then public.operation_register_entries.submitted_at
      else now()
    end
  returning * into saved_entry;

  return saved_entry;
end;
$$;

revoke all on function public.mark_dashboard_operation_register_activity(
  uuid,
  text,
  text,
  date,
  text,
  text,
  uuid
) from public;

create or replace function public.register_menu_sale_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.mark_dashboard_operation_register_activity(
    new.organization_id,
    'sales_register',
    'Finance',
    coalesce(new.operating_date, new.created_at::date),
    'Sales depletion activity was posted.',
    'menu_sales',
    new.id
  );

  return new;
end;
$$;

drop trigger if exists register_menu_sale_activity on public.menu_sales;
create trigger register_menu_sale_activity
after insert on public.menu_sales
for each row execute function public.register_menu_sale_activity();

create or replace function public.register_production_run_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.mark_dashboard_operation_register_activity(
    new.organization_id,
    'production_register',
    'Kitchen',
    coalesce(new.created_at::date, current_date),
    'Production activity was recorded.',
    'production_runs',
    new.id
  );

  return new;
end;
$$;

drop trigger if exists register_production_run_activity on public.production_runs;
create trigger register_production_run_activity
after insert on public.production_runs
for each row execute function public.register_production_run_activity();

create or replace function public.register_waste_event_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.mark_dashboard_operation_register_activity(
    new.organization_id,
    'waste_register',
    'Operations',
    coalesce(new.created_at::date, current_date),
    'Waste activity was recorded.',
    'waste_events',
    new.id
  );

  return new;
end;
$$;

drop trigger if exists register_waste_event_activity on public.waste_events;
create trigger register_waste_event_activity
after insert on public.waste_events
for each row execute function public.register_waste_event_activity();

create or replace function public.register_purchase_order_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.mark_dashboard_operation_register_activity(
    new.organization_id,
    'procurement_register',
    'Procurement',
    coalesce(new.created_at::date, current_date),
    'Procurement / purchase order activity was recorded.',
    'purchase_orders',
    new.id
  );

  perform public.mark_dashboard_operation_register_activity(
    new.organization_id,
    'purchase_order_register',
    'Inventory',
    coalesce(new.created_at::date, current_date),
    'Purchase order review activity was recorded.',
    'purchase_orders',
    new.id
  );

  return new;
end;
$$;

drop trigger if exists register_purchase_order_activity on public.purchase_orders;
create trigger register_purchase_order_activity
after insert on public.purchase_orders
for each row execute function public.register_purchase_order_activity();

create or replace function public.register_approval_request_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.request_type = 'inventory_requisition' then
    perform public.mark_dashboard_operation_register_activity(
      new.organization_id,
      'requisition_register',
      'Operations',
      coalesce(new.created_at::date, current_date),
      'Inventory requisition activity was recorded.',
      'approval_requests',
      new.id
    );
  elsif new.request_type = 'stock_count_approval' then
    perform public.mark_dashboard_operation_register_activity(
      new.organization_id,
      'stock_count_register',
      'Inventory',
      coalesce(new.created_at::date, current_date),
      'Stock count activity was submitted for approval.',
      'approval_requests',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists register_approval_request_activity on public.approval_requests;
create trigger register_approval_request_activity
after insert on public.approval_requests
for each row execute function public.register_approval_request_activity();

notify pgrst, 'reload schema';
