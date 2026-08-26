-- Shared read-only scope builder for the separately approved knife reset.
-- Include with psql \ir from knife-reset-preflight.sql or knife-reset-execute.sql.

do $scope$
declare
  v_missing text;
begin
  select string_agg(required.name, ', ' order by required.name)
  into v_missing
  from unnest(array[
    'public.technologist_requests', 'public.request_sheet_metal',
    'public.request_round_tube', 'public.request_circle', 'public.request_pipe',
    'public.request_knives', 'public.request_components', 'public.request_paint',
    'public.request_mesh', 'public.request_chain_cord',
    'public.users', 'public.machines', 'public.production_machine_facts',
    'public.materials', 'public.material_variants', 'public.inventory',
    'public.inventory_reservations', 'public.inventory_transactions',
    'public.supply_order_delivery_schedules',
    'public.supply_order_delivery_schedule_changes',
    'public.supply_order_delivery_length_discrepancies',
    'public.inventory_transfers',
    'public.inventory_transfer_items', 'public.long_stock_cutting_plans',
    'public.long_stock_cutting_plan_versions', 'public.long_stock_cutting_plan_items',
    'public.long_stock_cutting_segments', 'public.long_stock_cutting_candidates',
    'public.long_stock_cutting_candidate_bars', 'public.long_stock_cutting_bar_cuts',
    'public.long_stock_cutting_business_scraps', 'public.long_stock_cutting_actual_losses',
    'public.long_stock_cutting_bar_reservations', 'public.long_stock_cutting_fact_bars',
    'public.technologist_request_completions', 'public.technologist_request_waste_items',
    'public.technologist_request_plan_fact_items', 'public.future_detailing_batches',
    'public.future_detailing_items', 'public.technologist_completion_changes',
    'public.machine_cutting_archives', 'public.production_cutting_cycle_requests',
    'public.production_fact_cutting_event_reservations',
    'public.production_fact_cutting_event_scrap_promotions',
    'public.business_scrap_correction_requests', 'public.business_scrap_correction_items',
    'public.business_scrap_correction_holds', 'public.department_requests',
    'public.department_request_attachments', 'public.tasks', 'public.notifications',
    'public.finance_expenses', 'public.finance_event_actions',
    'public.finance_telegram_notifications', 'public.finance_telegram_dialog_states',
    'public.meeting_agenda_pool_items', 'public.meeting_agenda_items',
    'public.metal_scrap_lots', 'public.metal_scrap_sales',
    'public.metal_scrap_sale_items', 'public.metal_scrap_movements',
    'public.metal_scrap_finance_incomes', 'public.file_archive_assets',
    'public.file_archive_runs', 'public.file_archive_run_items'
  ]) as required(name)
  where to_regclass(required.name) is null;

  if v_missing is not null then
    raise exception 'Knife reset aborted: required tables are missing: %', v_missing;
  end if;
end;
$scope$;

create temp table _knife_reset_known_fk (
  parent_table text not null,
  child_table text not null,
  primary key (parent_table, child_table)
) on commit drop;

insert into _knife_reset_known_fk(parent_table, child_table) values
  ('business_scrap_correction_items','business_scrap_correction_holds'),
  ('business_scrap_correction_requests','business_scrap_correction_holds'),
  ('business_scrap_correction_requests','business_scrap_correction_items'),
  ('department_requests','department_request_attachments'),
  ('department_requests','department_request_events'),
  ('department_requests','department_request_mail_messages'),
  ('department_requests','department_request_mail_threads'),
  ('department_requests','long_stock_cutting_plan_versions'),
  ('department_requests','machine_layout_requests'),
  ('department_requests','notifications'),
  ('department_requests','tasks'),
  ('future_detailing_batches','future_detailing_items'),
  ('file_archive_runs','file_archive_assets'),
  ('file_archive_runs','file_archive_run_items'),
  ('inventory','business_scrap_correction_holds'),
  ('inventory','inventory'),
  ('inventory','inventory_reservations'),
  ('inventory','inventory_transactions'),
  ('inventory','inventory_transfer_items'),
  ('inventory','long_stock_cutting_business_scraps'),
  ('inventory','long_stock_cutting_candidate_bars'),
  ('inventory','long_stock_cutting_fact_bars'),
  ('inventory','metal_scrap_lots'),
  ('inventory','production_fact_cutting_event_reservations'),
  ('inventory','production_fact_cutting_event_scrap_promotions'),
  ('inventory','supply_order_delivery_schedules'),
  ('inventory_reservations','inventory'),
  ('inventory_reservations','long_stock_cutting_bar_reservations'),
  ('inventory_reservations','long_stock_cutting_fact_bars'),
  ('inventory_reservations','production_fact_cutting_event_reservations'),
  ('inventory_transfer_items','inventory_reservations'),
  ('inventory_transfers','inventory_transfer_items'),
  ('inventory_transfers','long_stock_cutting_plan_versions'),
  ('inventory_transfers','tasks'),
  ('long_stock_cutting_candidate_bars','long_stock_cutting_actual_losses'),
  ('long_stock_cutting_candidate_bars','long_stock_cutting_bar_cuts'),
  ('long_stock_cutting_candidate_bars','long_stock_cutting_bar_reservations'),
  ('long_stock_cutting_candidate_bars','long_stock_cutting_business_scraps'),
  ('long_stock_cutting_candidate_bars','long_stock_cutting_fact_bars'),
  ('long_stock_cutting_candidates','long_stock_cutting_bar_cuts'),
  ('long_stock_cutting_candidates','long_stock_cutting_candidate_bars'),
  ('long_stock_cutting_candidates','long_stock_cutting_plan_versions'),
  ('long_stock_cutting_plan_items','long_stock_cutting_segments'),
  ('long_stock_cutting_plan_versions','department_requests'),
  ('long_stock_cutting_plan_versions','long_stock_cutting_candidates'),
  ('long_stock_cutting_plan_versions','long_stock_cutting_segments'),
  ('long_stock_cutting_plan_versions','tasks'),
  ('long_stock_cutting_plan_versions','technologist_request_plan_fact_items'),
  ('long_stock_cutting_plans','department_requests'),
  ('long_stock_cutting_plans','long_stock_cutting_plan_items'),
  ('long_stock_cutting_plans','long_stock_cutting_plan_versions'),
  ('long_stock_cutting_plans','tasks'),
  ('long_stock_cutting_plans','technologist_request_plan_fact_items'),
  ('long_stock_cutting_segments','long_stock_cutting_bar_cuts'),
  ('material_variants','inventory'),
  ('material_variants','inventory_reservations'),
  ('material_variants','inventory_transactions'),
  ('material_variants','inventory_transfer_items'),
  ('material_variants','long_stock_cutting_plans'),
  ('material_variants','material_variants'),
  ('material_variants','metal_scrap_lots'),
  ('material_variants','production_fact_cutting_event_reservations'),
  ('material_variants','request_chain_cord'),
  ('material_variants','request_circle'),
  ('material_variants','request_components'),
  ('material_variants','request_knives'),
  ('material_variants','request_mesh'),
  ('material_variants','request_paint'),
  ('material_variants','request_pipe'),
  ('material_variants','request_round_tube'),
  ('material_variants','request_sheet_metal'),
  ('material_variants','technologist_request_waste_items'),
  ('materials','inventory'),
  ('materials','inventory_reservations'),
  ('materials','inventory_transactions'),
  ('materials','inventory_transfer_items'),
  ('materials','material_variants'),
  ('materials','metal_scrap_lots'),
  ('materials','production_fact_cutting_event_reservations'),
  ('materials','request_chain_cord'),
  ('materials','request_circle'),
  ('materials','request_components'),
  ('materials','request_knives'),
  ('materials','request_mesh'),
  ('materials','request_paint'),
  ('materials','request_pipe'),
  ('materials','request_round_tube'),
  ('materials','request_sheet_metal'),
  ('materials','technologist_request_waste_items'),
  ('metal_scrap_lots','metal_scrap_movements'),
  ('metal_scrap_lots','metal_scrap_sale_items'),
  ('metal_scrap_sales','metal_scrap_finance_incomes'),
  ('metal_scrap_sales','metal_scrap_movements'),
  ('metal_scrap_sales','metal_scrap_sale_items'),
  ('supply_order_delivery_schedules','inventory_reservations'),
  ('supply_order_delivery_schedules','long_stock_cutting_plan_versions'),
  ('supply_order_delivery_schedules','supply_order_delivery_length_discrepancies'),
  ('supply_order_delivery_schedules','supply_order_delivery_schedule_changes'),
  ('supply_order_delivery_schedules','supply_order_delivery_schedules'),
  ('supply_order_delivery_schedules','tasks'),
  ('tasks','business_scrap_correction_requests'),
  ('tasks','future_detailing_batches'),
  ('tasks','machine_layout_requests'),
  ('tasks','machine_outsourcing_transport_needs'),
  ('tasks','meeting_action_items'),
  ('tasks','metal_scrap_lots'),
  ('tasks','production_fact_cutting_events'),
  ('tasks','production_plan_date_change_requests'),
  ('tasks','task_delegations'),
  ('tasks','transport_trip_date_change_requests'),
  ('technologist_request_completions','machine_cutting_archives'),
  ('technologist_request_completions','production_cutting_cycle_requests'),
  ('technologist_request_completions','technologist_request_plan_fact_items'),
  ('technologist_request_completions','technologist_request_waste_items'),
  ('technologist_request_waste_items','metal_scrap_lots'),
  ('technologist_requests','business_scrap_correction_requests'),
  ('technologist_requests','department_requests'),
  ('technologist_requests','detailing_request_checks'),
  ('technologist_requests','detailing_reservations'),
  ('technologist_requests','future_detailing_batches'),
  ('technologist_requests','long_stock_cutting_plan_items'),
  ('technologist_requests','machine_cutting_archives'),
  ('technologist_requests','metal_scrap_lots'),
  ('technologist_requests','production_cutting_cycle_requests'),
  ('technologist_requests','request_chain_cord'),
  ('technologist_requests','request_circle'),
  ('technologist_requests','request_components'),
  ('technologist_requests','request_knives'),
  ('technologist_requests','request_mesh'),
  ('technologist_requests','request_paint'),
  ('technologist_requests','request_pipe'),
  ('technologist_requests','request_round_tube'),
  ('technologist_requests','request_sheet_metal'),
  ('technologist_requests','technologist_completion_changes'),
  ('technologist_requests','technologist_request_completions'),
  ('technologist_requests','technologist_request_plan_fact_items'),
  ('technologist_requests','technologist_request_waste_items');

do $dependencies$
declare
  v_unknown text;
begin
  select string_agg(
    format('%I.%I -> %I.%I (%s)', parent_ns.nspname, parent.relname,
      child_ns.nspname, child.relname, constraint_row.conname),
    E'\n' order by parent.relname, child.relname, constraint_row.conname
  ) into v_unknown
  from pg_constraint constraint_row
  join pg_class parent on parent.oid = constraint_row.confrelid
  join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
  join pg_class child on child.oid = constraint_row.conrelid
  join pg_namespace child_ns on child_ns.oid = child.relnamespace
  where constraint_row.contype = 'f'
    and parent_ns.nspname = 'public'
    and child_ns.nspname = 'public'
    and parent.relname in (select distinct parent_table from _knife_reset_known_fk)
    and not exists (
      select 1 from _knife_reset_known_fk known
      where known.parent_table = parent.relname
        and known.child_table = child.relname
    );

  if v_unknown is not null then
    raise exception E'Knife reset aborted: unknown foreign-key dependencies:\n%', v_unknown;
  end if;

  select string_agg(candidate.table_name, ', ' order by candidate.table_name)
  into v_unknown
  from (
    select columns.table_name
    from information_schema.columns columns
    where columns.table_schema = 'public'
    group by columns.table_name
    having bool_or(columns.column_name = 'request_item_table')
       and bool_or(columns.column_name = 'request_item_id')
  ) candidate
  where candidate.table_name not in (
    'business_scrap_correction_items', 'department_requests',
    'inventory_reservations', 'inventory_transactions', 'inventory_transfer_items',
    'long_stock_cutting_plan_items', 'production_fact_cutting_event_reservations',
    'supply_order_delivery_schedules', '_migration_audit_long_stock_requests_20260825'
  );

  if v_unknown is not null then
    raise exception 'Knife reset aborted: unknown polymorphic request-item dependencies: %', v_unknown;
  end if;

  select string_agg(candidate.table_name, ', ' order by candidate.table_name)
  into v_unknown
  from (
    select columns.table_name
    from information_schema.columns columns
    where columns.table_schema = 'public'
    group by columns.table_name
    having bool_or(columns.column_name = 'source_table')
       and bool_or(columns.column_name = 'source_id')
  ) candidate
  where candidate.table_name not in (
    'technologist_request_plan_fact_items', 'technologist_request_waste_items'
  );

  if v_unknown is not null then
    raise exception 'Knife reset aborted: unknown polymorphic source dependencies: %', v_unknown;
  end if;

  select string_agg(candidate.table_name, ', ' order by candidate.table_name)
  into v_unknown
  from (
    select columns.table_name
    from information_schema.columns columns
    where columns.table_schema = 'public'
    group by columns.table_name
    having bool_or(columns.column_name = 'source_type')
       and bool_or(columns.column_name = 'source_key')
  ) candidate
  where candidate.table_name not in (
    'finance_expenses', 'meeting_agenda_items', 'meeting_agenda_pool_items'
  );

  if v_unknown is not null then
    raise exception 'Knife reset aborted: unknown polymorphic source-key dependencies: %', v_unknown;
  end if;

  select string_agg(candidate.table_name, ', ' order by candidate.table_name)
  into v_unknown
  from (
    select columns.table_name
    from information_schema.columns columns
    where columns.table_schema = 'public'
    group by columns.table_name
    having bool_or(columns.column_name = 'event_type')
       and bool_or(columns.column_name = 'event_id')
  ) candidate
  where candidate.table_name not in (
    'finance_event_actions', 'finance_telegram_dialog_states',
    'finance_telegram_notifications'
  );

  if v_unknown is not null then
    raise exception 'Knife reset aborted: unknown polymorphic finance-event dependencies: %', v_unknown;
  end if;

  select string_agg(candidate.table_name, ', ' order by candidate.table_name)
  into v_unknown
  from (
    select columns.table_name
    from information_schema.columns columns
    where columns.table_schema = 'public'
    group by columns.table_name
    having bool_or(columns.column_name = 'source_kind')
       and bool_or(columns.column_name = 'source_record_id')
  ) candidate
  where candidate.table_name not in ('file_archive_assets', 'file_archive_run_items');

  if v_unknown is not null then
    raise exception 'Knife reset aborted: unknown polymorphic archive dependencies: %', v_unknown;
  end if;
end;
$dependencies$;

create temp table _knife_reset_requests on commit drop as
select distinct request.id, request.machine_id
from public.technologist_requests request
join public.request_knives knife on knife.request_id = request.id;
alter table _knife_reset_requests add primary key (id);

create temp table _knife_reset_items (
  request_item_table text not null,
  request_item_id uuid not null,
  request_id uuid not null,
  primary key (request_item_table, request_item_id)
) on commit drop;

insert into _knife_reset_items
select 'request_sheet_metal', id, request_id from public.request_sheet_metal where request_id in (select id from _knife_reset_requests)
union all select 'request_round_tube', id, request_id from public.request_round_tube where request_id in (select id from _knife_reset_requests)
union all select 'request_circle', id, request_id from public.request_circle where request_id in (select id from _knife_reset_requests)
union all select 'request_pipe', id, request_id from public.request_pipe where request_id in (select id from _knife_reset_requests)
union all select 'request_knives', id, request_id from public.request_knives where request_id in (select id from _knife_reset_requests)
union all select 'request_components', id, request_id from public.request_components where request_id in (select id from _knife_reset_requests)
union all select 'request_paint', id, request_id from public.request_paint where request_id in (select id from _knife_reset_requests)
union all select 'request_mesh', id, request_id from public.request_mesh where request_id in (select id from _knife_reset_requests)
union all select 'request_chain_cord', id, request_id from public.request_chain_cord where request_id in (select id from _knife_reset_requests);

create temp table _knife_reset_materials on commit drop as
select id from public.materials where category = 'knives'::public.material_category;
alter table _knife_reset_materials add primary key (id);

create temp table _knife_reset_variants on commit drop as
select variant.id
from public.material_variants variant
where variant.category = 'knives'::public.material_category
   or variant.material_id in (select id from _knife_reset_materials);
alter table _knife_reset_variants add primary key (id);

do $material_integrity$
begin
  if exists (
    select 1 from public.material_variants variant
    join public.materials material on material.id = variant.material_id
    where variant.category = 'knives'::public.material_category
      and material.category <> 'knives'::public.material_category
  ) then
    raise exception 'Knife reset aborted: a knife variant belongs to a non-knife material';
  end if;
  if exists (
    select 1 from public.material_variants variant
    where variant.id not in (select id from _knife_reset_variants)
      and variant.canonical_variant_id in (select id from _knife_reset_variants)
  ) then
    raise exception 'Knife reset aborted: a non-knife variant points to a knife canonical variant';
  end if;
  if exists (
    select 1
    from (
      select 'request_sheet_metal'::text as source_table, id, material_id, material_variant_id from public.request_sheet_metal
      union all select 'request_round_tube', id, material_id, material_variant_id from public.request_round_tube
      union all select 'request_circle', id, material_id, material_variant_id from public.request_circle
      union all select 'request_pipe', id, material_id, material_variant_id from public.request_pipe
      union all select 'request_knives', id, material_id, material_variant_id from public.request_knives
      union all select 'request_components', id, material_id, material_variant_id from public.request_components
      union all select 'request_paint', id, material_id, material_variant_id from public.request_paint
      union all select 'request_mesh', id, material_id, material_variant_id from public.request_mesh
      union all select 'request_chain_cord', id, material_id, material_variant_id from public.request_chain_cord
    ) request_item
    where (request_item.material_id in (select id from _knife_reset_materials)
        or request_item.material_variant_id in (select id from _knife_reset_variants))
      and not exists (
        select 1 from _knife_reset_items target
        where target.request_item_table = request_item.source_table
          and target.request_item_id = request_item.id
      )
  ) then
    raise exception 'Knife reset aborted: a retained request item points to knife catalog data';
  end if;
  if exists (
    select 1 from public.technologist_request_waste_items waste
    where waste.request_id not in (select id from _knife_reset_requests)
      and (waste.material_id in (select id from _knife_reset_materials)
        or waste.material_variant_id in (select id from _knife_reset_variants))
  ) then
    raise exception 'Knife reset aborted: retained completion history points to knife catalog data';
  end if;
end;
$material_integrity$;

create temp table _knife_reset_plans on commit drop as
select distinct plan.id
from public.long_stock_cutting_plans plan
left join public.long_stock_cutting_plan_items item on item.plan_id = plan.id
where plan.material_variant_id in (select id from _knife_reset_variants)
   or item.request_id in (select id from _knife_reset_requests)
   or exists (
     select 1 from _knife_reset_items target
     where target.request_item_table = item.request_item_table
       and target.request_item_id = item.request_item_id
   );
alter table _knife_reset_plans add primary key (id);

create temp table _knife_reset_inventory on commit drop as
select distinct inventory.id
from public.inventory inventory
where inventory.material_id in (select id from _knife_reset_materials)
   or inventory.material_variant_id in (select id from _knife_reset_variants)
   or exists (
     select 1
     from public.long_stock_cutting_business_scraps scrap
     join public.long_stock_cutting_plan_versions version on version.id = scrap.version_id
     where scrap.inventory_id = inventory.id
       and version.plan_id in (select id from _knife_reset_plans)
   );
alter table _knife_reset_inventory add primary key (id);

insert into _knife_reset_plans(id)
select distinct version.plan_id
from public.long_stock_cutting_plan_versions version
join public.long_stock_cutting_candidate_bars bar on bar.version_id = version.id
where bar.source_inventory_id in (select id from _knife_reset_inventory)
on conflict do nothing;

insert into _knife_reset_inventory(id)
select scrap.inventory_id
from public.long_stock_cutting_business_scraps scrap
join public.long_stock_cutting_plan_versions version on version.id = scrap.version_id
where version.plan_id in (select id from _knife_reset_plans)
on conflict do nothing;

do $inventory_integrity$
begin
  if exists (
    select 1 from public.inventory inventory
    where inventory.id not in (select id from _knife_reset_inventory)
      and inventory.source_inventory_id in (select id from _knife_reset_inventory)
  ) then
    raise exception 'Knife reset aborted: a retained inventory row points to deleted knife inventory';
  end if;
end;
$inventory_integrity$;

create temp table _knife_reset_versions on commit drop as
select version.id, version.plan_id
from public.long_stock_cutting_plan_versions version
where version.plan_id in (select id from _knife_reset_plans);
alter table _knife_reset_versions add primary key (id);

create temp table _knife_reset_schedules on commit drop as
select distinct schedule.id
from public.supply_order_delivery_schedules schedule
where exists (
    select 1 from _knife_reset_items item
    where item.request_item_table = schedule.request_item_table
      and item.request_item_id = schedule.request_item_id
  )
  or schedule.request_item_table = 'request_knives'
  or schedule.receipt_inventory_id in (select id from _knife_reset_inventory)
  or schedule.id in (
    select version.invalidation_receipt_schedule_id
    from public.long_stock_cutting_plan_versions version
    where version.id in (select id from _knife_reset_versions)
      and version.invalidation_receipt_schedule_id is not null
  );
alter table _knife_reset_schedules add primary key (id);

do $schedule_closure$
declare
  v_inserted integer := 1;
begin
  while v_inserted > 0 loop
    insert into _knife_reset_schedules(id)
    select schedule.id
    from public.supply_order_delivery_schedules schedule
    where schedule.receipt_parent_schedule_id in (select id from _knife_reset_schedules)
       or schedule.id in (
         select parent.receipt_parent_schedule_id
         from public.supply_order_delivery_schedules parent
         where parent.id in (select id from _knife_reset_schedules)
           and parent.receipt_parent_schedule_id is not null
       )
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
  end loop;
end;
$schedule_closure$;

create temp table _knife_reset_transfers on commit drop as
select distinct transfer.id
from public.inventory_transfers transfer
join public.inventory_transfer_items item on item.transfer_id = transfer.id
where item.source_inventory_id in (select id from _knife_reset_inventory)
   or item.destination_inventory_id in (select id from _knife_reset_inventory)
   or item.material_id in (select id from _knife_reset_materials)
   or item.material_variant_id in (select id from _knife_reset_variants)
   or exists (
     select 1 from _knife_reset_items target
     where target.request_item_table = item.request_item_table
       and target.request_item_id = item.request_item_id
   )
   or transfer.id in (
     select version.invalidation_inventory_transfer_id
     from public.long_stock_cutting_plan_versions version
     where version.id in (select id from _knife_reset_versions)
       and version.invalidation_inventory_transfer_id is not null
   );
alter table _knife_reset_transfers add primary key (id);

create temp table _knife_reset_reservations on commit drop as
select distinct reservation.id
from public.inventory_reservations reservation
where reservation.inventory_id in (select id from _knife_reset_inventory)
   or reservation.source_inventory_id in (select id from _knife_reset_inventory)
   or reservation.business_scrap_inventory_id in (select id from _knife_reset_inventory)
   or reservation.material_id in (select id from _knife_reset_materials)
   or reservation.material_variant_id in (select id from _knife_reset_variants)
   or reservation.inventory_transfer_item_id in (
     select id from public.inventory_transfer_items
     where transfer_id in (select id from _knife_reset_transfers)
   )
   or exists (
     select 1 from _knife_reset_items item
     where item.request_item_table = reservation.request_item_table
       and item.request_item_id = reservation.request_item_id
   );
alter table _knife_reset_reservations add primary key (id);

create temp table _knife_reset_lots on commit drop as
select distinct lot.id
from public.metal_scrap_lots lot
where lot.request_id in (select id from _knife_reset_requests)
   or lot.material_id in (select id from _knife_reset_materials)
   or lot.material_variant_id in (select id from _knife_reset_variants)
   or lot.source_inventory_id in (select id from _knife_reset_inventory);
alter table _knife_reset_lots add primary key (id);

create temp table _knife_reset_sales on commit drop as
select distinct item.sale_id as id
from public.metal_scrap_sale_items item
where item.lot_id in (select id from _knife_reset_lots);
alter table _knife_reset_sales add primary key (id);

create temp table _knife_reset_corrections on commit drop as
select correction.id
from public.business_scrap_correction_requests correction
where correction.technologist_request_id in (select id from _knife_reset_requests);
alter table _knife_reset_corrections add primary key (id);

create temp table _knife_reset_department_requests on commit drop as
select distinct department_request.id
from public.department_requests department_request
where department_request.technologist_request_id in (select id from _knife_reset_requests)
   or department_request.long_stock_plan_id in (select id from _knife_reset_plans)
   or department_request.long_stock_returned_version_id in (select id from _knife_reset_versions)
   or department_request.id in (
     select version.invalidation_department_request_id
     from public.long_stock_cutting_plan_versions version
     where version.id in (select id from _knife_reset_versions)
       and version.invalidation_department_request_id is not null
   )
   or exists (
     select 1 from _knife_reset_items item
     where item.request_item_table = department_request.request_item_table
       and item.request_item_id = department_request.request_item_id
   );
alter table _knife_reset_department_requests add primary key (id);

create temp table _knife_reset_tasks on commit drop as
select distinct task.id
from public.tasks task
where task.supply_order_schedule_id in (select id from _knife_reset_schedules)
   or task.inventory_transfer_id in (select id from _knife_reset_transfers)
   or task.department_request_id in (select id from _knife_reset_department_requests)
   or task.long_stock_cutting_plan_id in (select id from _knife_reset_plans)
   or task.long_stock_cutting_plan_version_id in (select id from _knife_reset_versions)
   or task.id in (
     select correction.task_id from public.business_scrap_correction_requests correction
     where correction.id in (select id from _knife_reset_corrections) and correction.task_id is not null
   )
   or task.id in (
     select batch.confirmation_task_id from public.future_detailing_batches batch
     where batch.request_id in (select id from _knife_reset_requests) and batch.confirmation_task_id is not null
   )
   or task.id in (
     select lot.review_task_id from public.metal_scrap_lots lot
     where lot.id in (select id from _knife_reset_lots) and lot.review_task_id is not null
   );
alter table _knife_reset_tasks add primary key (id);

create temp table _knife_reset_archives on commit drop as
select archive.id
from public.machine_cutting_archives archive
where archive.request_id in (select id from _knife_reset_requests);
alter table _knife_reset_archives add primary key (id);

create temp table _knife_reset_expenses on commit drop as
select distinct expense.id
from public.finance_expenses expense
where (
    expense.source_type = 'supply_order'
    and exists (
      select 1 from _knife_reset_items item
      where position(item.request_item_table || ':' || item.request_item_id::text in coalesce(expense.source_key, '')) > 0
    )
  ) or (
    expense.source_type = 'material_receipt_variance'
    and exists (
      select 1 from _knife_reset_schedules schedule
      where expense.source_key = 'material_receipt_variance:' || schedule.id::text
    )
  );
alter table _knife_reset_expenses add primary key (id);

create temp table _knife_reset_agenda_pool on commit drop as
select pool.id
from public.meeting_agenda_pool_items pool
where exists (
  select 1 from _knife_reset_schedules schedule
  where pool.source_key in (
    'material_receipt_variance:' || schedule.id::text,
    'pool:material_receipt_variance:' || schedule.id::text
  )
);
alter table _knife_reset_agenda_pool add primary key (id);

create temp table _knife_reset_agenda_items on commit drop as
select agenda.id
from public.meeting_agenda_items agenda
where exists (
  select 1 from _knife_reset_schedules schedule
  where agenda.source_key in (
    'material_receipt_variance:' || schedule.id::text,
    'pool:material_receipt_variance:' || schedule.id::text
  )
);
alter table _knife_reset_agenda_items add primary key (id);

create temp table _knife_reset_notifications on commit drop as
select distinct notification.id
from public.notifications notification
where notification.related_department_request_id in (select id from _knife_reset_department_requests)
   or exists (
     select 1
     from public.long_stock_cutting_plans plan
     where plan.id in (select id from _knife_reset_plans)
       and notification.type in (
         'long_stock_cutting_recalculation', 'long_stock_cutting_supply_shortage'
       )
       and concat_ws(' ', notification.title, notification.message) like '%№' || plan.plan_number::text || '%'
   )
   or exists (
     select 1
     from public.meeting_agenda_pool_items pool
     where pool.id in (select id from _knife_reset_agenda_pool)
       and notification.type = 'material_receipt_variance'
       and notification.title = pool.title
       and notification.message = pool.description
       and notification.related_machine_id is not distinct from pool.machine_id
   );
alter table _knife_reset_notifications add primary key (id);

create temp table _knife_reset_transactions on commit drop as
select distinct transaction.id
from public.inventory_transactions transaction
where transaction.inventory_id in (select id from _knife_reset_inventory)
   or transaction.material_id in (select id from _knife_reset_materials)
   or transaction.material_variant_id in (select id from _knife_reset_variants)
   or exists (
     select 1 from _knife_reset_items item
     where item.request_item_table = transaction.request_item_table
       and item.request_item_id = transaction.request_item_id
   );
alter table _knife_reset_transactions add primary key (id);

create temp table _knife_reset_event_reservations on commit drop as
select distinct event_reservation.id
from public.production_fact_cutting_event_reservations event_reservation
where event_reservation.inventory_id in (select id from _knife_reset_inventory)
   or event_reservation.business_scrap_inventory_id in (select id from _knife_reset_inventory)
   or event_reservation.material_id in (select id from _knife_reset_materials)
   or event_reservation.material_variant_id in (select id from _knife_reset_variants)
   or exists (
     select 1 from _knife_reset_items item
     where item.request_item_table = event_reservation.request_item_table
       and item.request_item_id = event_reservation.request_item_id
   );
alter table _knife_reset_event_reservations add primary key (id);

create temp table _knife_reset_fact_bars on commit drop as
select distinct fact_bar.id
from public.long_stock_cutting_fact_bars fact_bar
where fact_bar.version_id in (select id from _knife_reset_versions)
   or fact_bar.reservation_id in (select id from _knife_reset_reservations)
   or fact_bar.source_inventory_id in (select id from _knife_reset_inventory)
   or fact_bar.result_inventory_id in (select id from _knife_reset_inventory);
alter table _knife_reset_fact_bars add primary key (id);

create temp table _knife_reset_scrap_promotions on commit drop as
select promotion.id
from public.production_fact_cutting_event_scrap_promotions promotion
where promotion.inventory_id in (select id from _knife_reset_inventory);
alter table _knife_reset_scrap_promotions add primary key (id);

create temp table _knife_reset_storage_objects on commit drop as
with direct_objects as (
  select 'nesting-files'::text as bucket_id, archive.storage_path as object_path,
    archive.file_name, 'machine_cutting_archive'::text as source_kind, archive.id as source_record_id
  from public.machine_cutting_archives archive
  where archive.id in (select id from _knife_reset_archives)
  union all
  select 'department-request-files', attachment.storage_path, attachment.file_name,
    'department_request_attachment', attachment.id
  from public.department_request_attachments attachment
  where attachment.request_id in (select id from _knife_reset_department_requests)
  union all
  select version.pdf_metadata->>'bucket_id', version.pdf_metadata->>'object_path',
    version.pdf_metadata->>'file_name', 'long_stock_cutting_plan_pdf', version.id
  from public.long_stock_cutting_plan_versions version
  where version.id in (select id from _knife_reset_versions)
    and coalesce(version.pdf_metadata->>'bucket_id', '') <> ''
    and coalesce(version.pdf_metadata->>'object_path', '') <> ''
), tracked_objects as (
  select asset.bucket_id, asset.object_path, asset.file_name, asset.source_kind, asset.source_record_id
  from public.file_archive_assets asset
  where (asset.source_kind = 'machine_cutting_archive' and asset.source_record_id in (select id from _knife_reset_archives))
     or (asset.source_kind = 'department_request_attachment' and asset.source_record_id in (
       select attachment.id from public.department_request_attachments attachment
       where attachment.request_id in (select id from _knife_reset_department_requests)
     ))
)
select distinct on (object.bucket_id, object.object_path)
  object.bucket_id, object.object_path, object.file_name, object.source_kind, object.source_record_id
from (
  select * from direct_objects
  union all
  select * from tracked_objects
) object
where coalesce(object.bucket_id, '') <> '' and coalesce(object.object_path, '') <> ''
order by object.bucket_id, object.object_path, object.source_kind;
alter table _knife_reset_storage_objects add primary key (bucket_id, object_path);

create temp table _knife_reset_archive_run_items on commit drop as
select distinct run_item.id, run_item.run_id
from public.file_archive_run_items run_item
where (run_item.source_kind = 'machine_cutting_archive'
    and run_item.source_record_id in (select id from _knife_reset_archives))
   or (run_item.source_kind = 'department_request_attachment'
    and run_item.source_record_id in (
      select attachment.id from public.department_request_attachments attachment
      where attachment.request_id in (select id from _knife_reset_department_requests)
    ))
   or (run_item.bucket_id, run_item.object_path) in (
     select bucket_id, object_path from _knife_reset_storage_objects
   );
alter table _knife_reset_archive_run_items add primary key (id);

create temp table _knife_reset_archive_runs on commit drop as
select distinct run_id as id from _knife_reset_archive_run_items;
alter table _knife_reset_archive_runs add primary key (id);

create temp table _knife_reset_legacy_audit_count (
  row_count bigint not null
) on commit drop;

do $legacy_audit$
begin
  if to_regclass('public._migration_audit_long_stock_requests_20260825') is null then
    insert into _knife_reset_legacy_audit_count values (0);
  else
    execute $sql$
      insert into _knife_reset_legacy_audit_count
      select count(*)
      from public._migration_audit_long_stock_requests_20260825 audit
      where audit.request_id in (select id from _knife_reset_requests)
    $sql$;
  end if;
end;
$legacy_audit$;

create temp table _knife_reset_snapshot on commit drop as
select
  md5(jsonb_build_object(
    'requests', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_requests),
    'items', (select coalesce(jsonb_agg(request_item_table || ':' || request_item_id::text order by request_item_table, request_item_id), '[]') from _knife_reset_items),
    'materials', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_materials),
    'variants', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_variants),
    'inventory', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_inventory),
    'reservations', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_reservations),
    'transactions', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_transactions),
    'schedules', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_schedules),
    'plans', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_plans),
    'versions', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_versions),
    'transfers', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_transfers),
    'event_reservations', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_event_reservations),
    'fact_bars', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_fact_bars),
    'scrap_promotions', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_scrap_promotions),
    'corrections', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_corrections),
    'department_requests', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_department_requests),
    'tasks', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_tasks),
    'archives', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_archives),
    'agenda_pool', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_agenda_pool),
    'agenda_items', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_agenda_items),
    'notifications', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_notifications),
    'archive_run_items', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_archive_run_items),
    'archive_runs', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_archive_runs),
    'lots', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_lots),
    'sales', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_sales),
    'expenses', (select coalesce(jsonb_agg(id order by id), '[]') from _knife_reset_expenses),
    'storage', (select coalesce(jsonb_agg(bucket_id || '/' || object_path order by bucket_id, object_path), '[]') from _knife_reset_storage_objects)
  )::text) as fingerprint,
  (jsonb_build_object(
    'material_requests', (select count(*) from _knife_reset_requests),
    'request_items_all_categories', (select count(*) from _knife_reset_items),
    'knife_request_items', (select count(*) from _knife_reset_items where request_item_table = 'request_knives'),
    'knife_materials', (select count(*) from _knife_reset_materials),
    'knife_variants', (select count(*) from _knife_reset_variants),
    'inventory_rows', (select count(*) from _knife_reset_inventory),
    'reservations', (select count(*) from _knife_reset_reservations),
    'active_reservations', (select count(*) from public.inventory_reservations where id in (select id from _knife_reset_reservations) and consumed_at is null),
    'delivery_schedules', (select count(*) from _knife_reset_schedules),
    'delivery_schedule_changes', (select count(*) from public.supply_order_delivery_schedule_changes where schedule_id in (select id from _knife_reset_schedules)),
    'delivery_length_discrepancies', (select count(*) from public.supply_order_delivery_length_discrepancies where schedule_id in (select id from _knife_reset_schedules)),
    'cutting_plans', (select count(*) from _knife_reset_plans),
    'cutting_versions', (select count(*) from _knife_reset_versions),
    'cutting_plan_items', (select count(*) from public.long_stock_cutting_plan_items where plan_id in (select id from _knife_reset_plans)),
    'cutting_segments', (select count(*) from public.long_stock_cutting_segments where version_id in (select id from _knife_reset_versions)),
    'cutting_candidates', (select count(*) from public.long_stock_cutting_candidates where version_id in (select id from _knife_reset_versions)),
    'cutting_candidate_bars', (select count(*) from public.long_stock_cutting_candidate_bars where version_id in (select id from _knife_reset_versions)),
    'cutting_bar_cuts', (select count(*) from public.long_stock_cutting_bar_cuts where version_id in (select id from _knife_reset_versions)),
    'cutting_business_scraps', (select count(*) from public.long_stock_cutting_business_scraps where version_id in (select id from _knife_reset_versions)),
    'cutting_actual_losses', (select count(*) from public.long_stock_cutting_actual_losses where version_id in (select id from _knife_reset_versions)),
    'cutting_bar_reservations', (select count(*) from public.long_stock_cutting_bar_reservations where version_id in (select id from _knife_reset_versions) or reservation_id in (select id from _knife_reset_reservations)),
    'inventory_transfers', (select count(*) from _knife_reset_transfers),
    'inventory_transfer_items', (select count(*) from public.inventory_transfer_items where transfer_id in (select id from _knife_reset_transfers)),
    'inventory_transactions', (select count(*) from _knife_reset_transactions),
    'production_event_links', (select count(*) from _knife_reset_event_reservations),
    'production_scrap_promotion_links', (select count(*) from _knife_reset_scrap_promotions),
    'cutting_fact_links', (select count(*) from _knife_reset_fact_bars)
  ) || jsonb_build_object(
    'production_cutting_cycle_links', (select count(*) from public.production_cutting_cycle_requests where request_id in (select id from _knife_reset_requests)),
    'request_completions', (select count(*) from public.technologist_request_completions where request_id in (select id from _knife_reset_requests)),
    'request_waste_items', (select count(*) from public.technologist_request_waste_items where request_id in (select id from _knife_reset_requests)),
    'request_plan_fact_items', (select count(*) from public.technologist_request_plan_fact_items where request_id in (select id from _knife_reset_requests) or plan_id in (select id from _knife_reset_plans)),
    'future_detailing_batches', (select count(*) from public.future_detailing_batches where request_id in (select id from _knife_reset_requests)),
    'future_detailing_items', (select count(*) from public.future_detailing_items where batch_id in (select id from public.future_detailing_batches where request_id in (select id from _knife_reset_requests))),
    'completion_changes', (select count(*) from public.technologist_completion_changes where request_id in (select id from _knife_reset_requests)),
    'tasks', (select count(*) from _knife_reset_tasks),
    'notifications_exactly_linked', (select count(*) from _knife_reset_notifications),
    'department_requests', (select count(*) from _knife_reset_department_requests),
    'department_request_attachments', (select count(*) from public.department_request_attachments where request_id in (select id from _knife_reset_department_requests)),
    'business_scrap_corrections', (select count(*) from _knife_reset_corrections),
    'business_scrap_correction_items', (select count(*) from public.business_scrap_correction_items where correction_request_id in (select id from _knife_reset_corrections)),
    'business_scrap_correction_holds', (select count(*) from public.business_scrap_correction_holds where correction_request_id in (select id from _knife_reset_corrections)),
    'machine_cutting_archives', (select count(*) from _knife_reset_archives),
    'finance_payments', (select count(*) from _knife_reset_expenses),
    'finance_event_actions', (select count(*) from public.finance_event_actions where event_type::text = 'expense' and event_id in (select id from _knife_reset_expenses)),
    'finance_telegram_notifications', (select count(*) from public.finance_telegram_notifications where event_type::text = 'expense' and event_id in (select id from _knife_reset_expenses)),
    'finance_telegram_dialog_states', (select count(*) from public.finance_telegram_dialog_states where event_type::text = 'expense' and event_id in (select id from _knife_reset_expenses)),
    'meeting_agenda_pool_items', (select count(*) from _knife_reset_agenda_pool),
    'meeting_agenda_items', (select count(*) from _knife_reset_agenda_items),
    'metal_scrap_lots', (select count(*) from _knife_reset_lots),
    'mixed_metal_scrap_sales', (select count(*) from _knife_reset_sales),
    'metal_scrap_sale_items', (select count(*) from public.metal_scrap_sale_items where sale_id in (select id from _knife_reset_sales) or lot_id in (select id from _knife_reset_lots)),
    'metal_scrap_movements', (select count(*) from public.metal_scrap_movements where sale_id in (select id from _knife_reset_sales) or lot_id in (select id from _knife_reset_lots)),
    'metal_scrap_finance_incomes', (select count(*) from public.metal_scrap_finance_incomes where sale_id in (select id from _knife_reset_sales)),
    'storage_objects', (select count(*) from _knife_reset_storage_objects),
    'archive_run_items', (select count(*) from _knife_reset_archive_run_items),
    'archive_runs_touched', (select count(*) from _knife_reset_archive_runs),
    'tracked_archive_objects', (select count(*) from public.file_archive_assets asset where (asset.bucket_id, asset.object_path) in (select bucket_id, object_path from _knife_reset_storage_objects)),
    'legacy_migration_audit_rows', (select row_count from _knife_reset_legacy_audit_count)
  )) as report;
