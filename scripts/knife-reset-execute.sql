\set ON_ERROR_STOP on
\pset pager off

-- NEVER run this file as a migration or from deploy.yml.
-- Required psql variables:
--   actor_id             UUID of the accountable CRM operator
--   expected_fingerprint Exact value printed by knife-reset-preflight.sql
--   confirm              DELETE_ALL_KNIFE_DATA_WITHOUT_BACKUP

\if :{?actor_id}
\else
  \echo 'actor_id is required'
  \quit
\endif
\if :{?expected_fingerprint}
\else
  \echo 'expected_fingerprint is required'
  \quit
\endif
\if :{?confirm}
\else
  \echo 'confirm is required'
  \quit
\endif

begin transaction isolation level serializable;
set local lock_timeout = '30s';
set local statement_timeout = '30min';
set constraints all deferred;

select pg_advisory_xact_lock(hashtextextended('irreversible-knife-reset-all-factories-v1', 0));

lock table
  public.technologist_requests,
  public.request_sheet_metal, public.request_round_tube, public.request_circle,
  public.request_pipe, public.request_knives, public.request_components,
  public.request_paint, public.request_mesh, public.request_chain_cord,
  public.materials, public.material_variants,
  public.inventory, public.inventory_reservations, public.inventory_transactions,
  public.inventory_transfers, public.inventory_transfer_items,
  public.supply_order_delivery_schedules, public.supply_order_delivery_length_discrepancies,
  public.long_stock_cutting_plans, public.long_stock_cutting_plan_items,
  public.long_stock_cutting_plan_versions, public.long_stock_cutting_segments,
  public.long_stock_cutting_candidates, public.long_stock_cutting_candidate_bars,
  public.long_stock_cutting_bar_cuts, public.long_stock_cutting_business_scraps,
  public.long_stock_cutting_actual_losses, public.long_stock_cutting_bar_reservations,
  public.long_stock_cutting_fact_bars,
  public.technologist_request_completions, public.technologist_request_waste_items,
  public.technologist_request_plan_fact_items, public.future_detailing_batches,
  public.future_detailing_items, public.technologist_completion_changes,
  public.machine_cutting_archives, public.production_cutting_cycle_requests,
  public.production_fact_cutting_event_reservations,
  public.production_fact_cutting_event_scrap_promotions,
  public.business_scrap_correction_requests, public.business_scrap_correction_items,
  public.business_scrap_correction_holds, public.department_requests,
  public.department_request_attachments, public.tasks, public.notifications,
  public.finance_expenses, public.finance_event_actions,
  public.finance_telegram_notifications, public.finance_telegram_dialog_states,
  public.meeting_agenda_pool_items, public.meeting_agenda_items,
  public.metal_scrap_lots, public.metal_scrap_sales, public.metal_scrap_sale_items,
  public.metal_scrap_movements, public.metal_scrap_finance_incomes,
  public.file_archive_assets, public.file_archive_runs, public.file_archive_run_items
in share row exclusive mode;

\ir knife-reset-scope.sql

create temp table _knife_reset_control on commit drop as
select
  :'actor_id'::uuid as actor_id,
  :'expected_fingerprint'::text as expected_fingerprint,
  :'confirm'::text as confirm_text;

do $control$
declare
  v_control _knife_reset_control%rowtype;
  v_actual text;
begin
  select * into v_control from _knife_reset_control;
  select fingerprint into v_actual from _knife_reset_snapshot;

  if v_control.confirm_text <> 'DELETE_ALL_KNIFE_DATA_WITHOUT_BACKUP' then
    raise exception 'Knife reset aborted: irreversible confirmation text does not match';
  end if;
  if v_control.expected_fingerprint !~ '^[0-9a-f]{32}$'
    or v_control.expected_fingerprint is distinct from v_actual then
    raise exception 'Knife reset aborted: fingerprint changed (expected %, actual %)',
      v_control.expected_fingerprint, v_actual;
  end if;
  if not exists (select 1 from public.users where id = v_control.actor_id) then
    raise exception 'Knife reset aborted: actor does not exist';
  end if;
  if not exists (select 1 from _knife_reset_requests) then
    raise exception 'Knife reset aborted: there are no knife requests to delete';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.material_variants'::regclass
      and tgname = 'aa_material_variants_knife_profile_input_guard'
      and tgenabled <> 'D'
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.material_variants'::regclass
      and tgname = 'zz_material_variants_knife_profile_normalize'
      and tgenabled <> 'D'
  ) then
    raise exception 'Knife reset aborted: compatible knife profile migration is not active';
  end if;
end;
$control$;

create table if not exists public.knife_reset_storage_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  reset_fingerprint text not null,
  bucket_id text not null,
  object_path text not null,
  file_name text,
  source_kind text,
  source_record_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  completed_at timestamptz,
  unique (bucket_id, object_path)
);
alter table public.knife_reset_storage_cleanup_queue enable row level security;
revoke all on table public.knife_reset_storage_cleanup_queue from public, anon, authenticated;
grant all on table public.knife_reset_storage_cleanup_queue to service_role;

insert into public.knife_reset_storage_cleanup_queue(
  reset_fingerprint, bucket_id, object_path, file_name, source_kind, source_record_id
)
select snapshot.fingerprint, object.bucket_id, object.object_path,
  object.file_name, object.source_kind, object.source_record_id
from _knife_reset_storage_objects object
cross join _knife_reset_snapshot snapshot
on conflict (bucket_id, object_path) do update set
  reset_fingerprint = excluded.reset_fingerprint,
  file_name = excluded.file_name,
  source_kind = excluded.source_kind,
  source_record_id = excluded.source_record_id,
  status = 'pending',
  last_error = null,
  completed_at = null;

-- Immutable history guards are disabled only for the exact locked tables and
-- only inside this transaction. Foreign-key constraints stay enabled.
alter table public.machine_cutting_archives disable trigger user;
alter table public.production_cutting_cycle_requests disable trigger user;
alter table public.supply_order_delivery_length_discrepancies disable trigger user;
alter table public.long_stock_cutting_plans disable trigger user;
alter table public.long_stock_cutting_plan_items disable trigger user;
alter table public.long_stock_cutting_plan_versions disable trigger user;
alter table public.long_stock_cutting_segments disable trigger user;
alter table public.long_stock_cutting_candidates disable trigger user;
alter table public.long_stock_cutting_candidate_bars disable trigger user;
alter table public.long_stock_cutting_bar_cuts disable trigger user;
alter table public.long_stock_cutting_business_scraps disable trigger user;
alter table public.long_stock_cutting_actual_losses disable trigger user;

do $unreserve$
declare
  v_reservation record;
  v_actor uuid := (select actor_id from _knife_reset_control);
begin
  for v_reservation in
    select reservation.id
    from public.inventory_reservations reservation
    where reservation.id in (select id from _knife_reset_reservations)
      and reservation.consumed_at is null
    order by reservation.id
  loop
    perform public.fn_unreserve_inventory_reservation(
      v_reservation.id,
      v_actor,
      'Необратимый полный сброс данных ножей'
    );
  end loop;
end;
$unreserve$;

-- A mixed metal-scrap sale is deleted as a whole. Restore only retained lots;
-- target knife/request lots are removed below.
with restored as (
  select item.lot_id, sum(item.weight_kg) as weight_kg
  from public.metal_scrap_sale_items item
  join public.metal_scrap_sales sale on sale.id = item.sale_id
  where item.sale_id in (select id from _knife_reset_sales)
    and item.lot_id not in (select id from _knife_reset_lots)
    and sale.status = 'completed'
  group by item.lot_id
)
update public.metal_scrap_lots lot
set available_weight_kg = lot.available_weight_kg + restored.weight_kg,
    sold_weight_kg = lot.sold_weight_kg - restored.weight_kg,
    updated_at = now()
from restored
where lot.id = restored.lot_id;

delete from public.notifications where id in (select id from _knife_reset_notifications);
delete from public.meeting_agenda_items where id in (select id from _knife_reset_agenda_items);
delete from public.meeting_agenda_pool_items where id in (select id from _knife_reset_agenda_pool);

delete from public.finance_event_actions
where event_type::text = 'expense' and event_id in (select id from _knife_reset_expenses);
delete from public.finance_telegram_notifications
where event_type::text = 'expense' and event_id in (select id from _knife_reset_expenses);
delete from public.finance_telegram_dialog_states
where event_type::text = 'expense' and event_id in (select id from _knife_reset_expenses);
delete from public.finance_expenses where id in (select id from _knife_reset_expenses);

delete from public.file_archive_run_items
where id in (select id from _knife_reset_archive_run_items);

update public.file_archive_runs run
set item_count = (select count(*) from public.file_archive_run_items item where item.run_id = run.id),
    total_bytes = (select coalesce(sum(item.size_bytes), 0) from public.file_archive_run_items item where item.run_id = run.id),
    missing_relation_count = (select count(*) from public.file_archive_run_items item where item.run_id = run.id and item.machine_id is null),
    machine_count = (select count(distinct item.machine_id) from public.file_archive_run_items item where item.run_id = run.id),
    preview_hash = (
      select md5(coalesce(string_agg(item.bucket_id || '/' || item.object_path, '|' order by item.bucket_id, item.object_path), ''))
      from public.file_archive_run_items item where item.run_id = run.id
    ),
    category_summary = (
      select coalesce(jsonb_agg(jsonb_build_object(
        'category', grouped.category,
        'count', grouped.item_count,
        'bytes', grouped.total_bytes
      ) order by grouped.total_bytes desc), '[]'::jsonb)
      from (
        select item.category, count(*)::integer as item_count,
          coalesce(sum(item.size_bytes), 0)::bigint as total_bytes
        from public.file_archive_run_items item
        where item.run_id = run.id
        group by item.category
      ) grouped
    )
where run.id in (select id from _knife_reset_archive_runs);

delete from public.file_archive_runs run
where run.id in (select id from _knife_reset_archive_runs)
  and not exists (select 1 from public.file_archive_run_items item where item.run_id = run.id);

delete from public.tasks where id in (select id from _knife_reset_tasks);
delete from public.business_scrap_correction_requests where id in (select id from _knife_reset_corrections);

delete from public.metal_scrap_movements
where sale_id in (select id from _knife_reset_sales)
   or lot_id in (select id from _knife_reset_lots);
delete from public.metal_scrap_sale_items
where sale_id in (select id from _knife_reset_sales)
   or lot_id in (select id from _knife_reset_lots);
delete from public.metal_scrap_finance_incomes where sale_id in (select id from _knife_reset_sales);
delete from public.metal_scrap_sales where id in (select id from _knife_reset_sales);
delete from public.metal_scrap_lots where id in (select id from _knife_reset_lots);

delete from public.production_fact_cutting_event_scrap_promotions
where id in (select id from _knife_reset_scrap_promotions);
delete from public.production_fact_cutting_event_reservations
where id in (select id from _knife_reset_event_reservations);
delete from public.long_stock_cutting_fact_bars
where id in (select id from _knife_reset_fact_bars);

delete from public.department_requests where id in (select id from _knife_reset_department_requests);
delete from public.machine_cutting_archives where id in (select id from _knife_reset_archives);
delete from public.production_cutting_cycle_requests
where request_id in (select id from _knife_reset_requests);

delete from public.technologist_request_plan_fact_items
where request_id in (select id from _knife_reset_requests)
   or plan_id in (select id from _knife_reset_plans);
delete from public.long_stock_cutting_actual_losses
where version_id in (select id from _knife_reset_versions);
delete from public.long_stock_cutting_bar_cuts
where version_id in (select id from _knife_reset_versions);
delete from public.long_stock_cutting_bar_reservations
where version_id in (select id from _knife_reset_versions)
   or reservation_id in (select id from _knife_reset_reservations);
delete from public.long_stock_cutting_business_scraps
where version_id in (select id from _knife_reset_versions);
delete from public.long_stock_cutting_candidate_bars
where version_id in (select id from _knife_reset_versions);
delete from public.long_stock_cutting_candidates
where version_id in (select id from _knife_reset_versions);
delete from public.long_stock_cutting_segments
where version_id in (select id from _knife_reset_versions);
delete from public.long_stock_cutting_plan_versions
where id in (select id from _knife_reset_versions);
delete from public.long_stock_cutting_plan_items
where plan_id in (select id from _knife_reset_plans);
delete from public.long_stock_cutting_plans
where id in (select id from _knife_reset_plans);

delete from public.supply_order_delivery_length_discrepancies
where schedule_id in (select id from _knife_reset_schedules);
delete from public.supply_order_delivery_schedules
where id in (select id from _knife_reset_schedules);

delete from public.inventory_transfers where id in (select id from _knife_reset_transfers);
delete from public.inventory_reservations where id in (select id from _knife_reset_reservations);
delete from public.inventory_transactions transaction
where transaction.id in (select id from _knife_reset_transactions)
   or transaction.inventory_id in (select id from _knife_reset_inventory)
   or transaction.material_id in (select id from _knife_reset_materials)
   or transaction.material_variant_id in (select id from _knife_reset_variants)
   or exists (
     select 1 from _knife_reset_items item
     where item.request_item_table = transaction.request_item_table
       and item.request_item_id = transaction.request_item_id
   );
delete from public.inventory where id in (select id from _knife_reset_inventory);

delete from public.future_detailing_items
where batch_id in (
  select id from public.future_detailing_batches
  where request_id in (select id from _knife_reset_requests)
);
delete from public.future_detailing_batches
where request_id in (select id from _knife_reset_requests);
delete from public.technologist_completion_changes
where request_id in (select id from _knife_reset_requests);
delete from public.technologist_request_waste_items
where request_id in (select id from _knife_reset_requests);
delete from public.technologist_request_completions
where request_id in (select id from _knife_reset_requests);
delete from public.technologist_requests
where id in (select id from _knife_reset_requests);

do $legacy_audit_delete$
begin
  if to_regclass('public._migration_audit_long_stock_requests_20260825') is not null then
    execute $sql$
      delete from public._migration_audit_long_stock_requests_20260825 audit
      where audit.request_id in (select id from _knife_reset_requests)
    $sql$;
  end if;
end;
$legacy_audit_delete$;

delete from public.material_variants where id in (select id from _knife_reset_variants);
delete from public.materials where id in (select id from _knife_reset_materials);

alter table public.long_stock_cutting_actual_losses enable trigger user;
alter table public.long_stock_cutting_business_scraps enable trigger user;
alter table public.long_stock_cutting_bar_cuts enable trigger user;
alter table public.long_stock_cutting_candidate_bars enable trigger user;
alter table public.long_stock_cutting_candidates enable trigger user;
alter table public.long_stock_cutting_segments enable trigger user;
alter table public.long_stock_cutting_plan_versions enable trigger user;
alter table public.long_stock_cutting_plan_items enable trigger user;
alter table public.long_stock_cutting_plans enable trigger user;
alter table public.supply_order_delivery_length_discrepancies enable trigger user;
alter table public.production_cutting_cycle_requests enable trigger user;
alter table public.machine_cutting_archives enable trigger user;

-- Recompute the material fact date and lifecycle only for affected machines.
with supply_requests as (
  select request.id, request.machine_id
  from public.technologist_requests request
  where request.status in ('submitted_to_supply', 'completed')
), remaining_items as (
  select request.machine_id, item.order_status::text as order_status,
    coalesce(item.delivered_at::date, schedule.last_delivery_date) as delivered_date
  from supply_requests request
  join public.request_sheet_metal item on item.request_id = request.id
    and greatest(coalesce(item.remainder_qty, item.to_order_kg, 0) - coalesce(item.reserved_from_stock_kg, 0), 0) > 0
  left join lateral (
    select max(coalesce(delivered_at::date, delivery_date)) as last_delivery_date
    from public.supply_order_delivery_schedules schedule
    where schedule.request_item_table = 'request_sheet_metal' and schedule.request_item_id = item.id and schedule.status = 'delivered'
  ) schedule on true
  union all
  select request.machine_id, item.order_status::text, coalesce(item.delivered_at::date, schedule.last_delivery_date)
  from supply_requests request join public.request_round_tube item on item.request_id=request.id
    and greatest(coalesce(item.order_kg, 0) - coalesce(item.reserved_from_stock_kg, 0), 0) > 0
  left join lateral (select max(coalesce(delivered_at::date,delivery_date)) last_delivery_date from public.supply_order_delivery_schedules schedule where schedule.request_item_table='request_round_tube' and schedule.request_item_id=item.id and schedule.status='delivered') schedule on true
  union all
  select request.machine_id, item.order_status::text, coalesce(item.delivered_at::date, schedule.last_delivery_date)
  from supply_requests request join public.request_circle item on item.request_id=request.id
    and greatest(coalesce(item.remainder_mm, 0) - coalesce(item.reserved_from_stock_mm, 0), 0) > 0
  left join lateral (select max(coalesce(delivered_at::date,delivery_date)) last_delivery_date from public.supply_order_delivery_schedules schedule where schedule.request_item_table='request_circle' and schedule.request_item_id=item.id and schedule.status='delivered') schedule on true
  union all
  select request.machine_id, item.order_status::text, coalesce(item.delivered_at::date, schedule.last_delivery_date)
  from supply_requests request join public.request_pipe item on item.request_id=request.id
    and greatest(
      case when item.pipe_type = 'wire'::public.pipe_subtype
        then coalesce(item.remainder_kg, 0) - coalesce(item.reserved_from_stock_kg, 0)
        else coalesce(item.remainder_length_mm, 0) - coalesce(item.reserved_from_stock_length_mm, 0)
      end,
      0
    ) > 0
  left join lateral (select max(coalesce(delivered_at::date,delivery_date)) last_delivery_date from public.supply_order_delivery_schedules schedule where schedule.request_item_table='request_pipe' and schedule.request_item_id=item.id and schedule.status='delivered') schedule on true
  union all
  select request.machine_id, item.order_status::text, coalesce(item.delivered_at::date, schedule.last_delivery_date)
  from supply_requests request join public.request_knives item on item.request_id=request.id
    and greatest(coalesce(nullif(item.remainder_meters, 0) * 1000, item.to_order_mm, 0) - coalesce(item.reserved_from_stock_mm, 0), 0) > 0
  left join lateral (select max(coalesce(delivered_at::date,delivery_date)) last_delivery_date from public.supply_order_delivery_schedules schedule where schedule.request_item_table='request_knives' and schedule.request_item_id=item.id and schedule.status='delivered') schedule on true
  union all
  select request.machine_id, item.order_status::text, coalesce(item.delivered_at::date, schedule.last_delivery_date)
  from supply_requests request join public.request_components item on item.request_id=request.id
    and greatest(coalesce(item.quantity_needed, 0) - coalesce(item.stock_remainder, 0) - coalesce(item.reserved_from_stock, 0), 0) > 0
  left join lateral (select max(coalesce(delivered_at::date,delivery_date)) last_delivery_date from public.supply_order_delivery_schedules schedule where schedule.request_item_table='request_components' and schedule.request_item_id=item.id and schedule.status='delivered') schedule on true
  union all
  select request.machine_id, item.order_status::text, coalesce(item.delivered_at::date, schedule.last_delivery_date)
  from supply_requests request join public.request_paint item on item.request_id=request.id
    and greatest(coalesce(item.remainder_kg, item.to_order_kg, 0) - coalesce(item.reserved_from_stock_kg, 0), 0) > 0
  left join lateral (select max(coalesce(delivered_at::date,delivery_date)) last_delivery_date from public.supply_order_delivery_schedules schedule where schedule.request_item_table='request_paint' and schedule.request_item_id=item.id and schedule.status='delivered') schedule on true
  union all
  select request.machine_id, item.order_status::text, coalesce(item.delivered_at::date, schedule.last_delivery_date)
  from supply_requests request join public.request_mesh item on item.request_id=request.id
    and greatest(coalesce(item.remainder_qty, 0) - coalesce(item.reserved_from_stock_qty, 0), 0) > 0
  left join lateral (select max(coalesce(delivered_at::date,delivery_date)) last_delivery_date from public.supply_order_delivery_schedules schedule where schedule.request_item_table='request_mesh' and schedule.request_item_id=item.id and schedule.status='delivered') schedule on true
  union all
  select request.machine_id, item.order_status::text, coalesce(item.delivered_at::date, schedule.last_delivery_date)
  from supply_requests request join public.request_chain_cord item on item.request_id=request.id
    and greatest(coalesce(item.remainder_meters, 0) - coalesce(item.reserved_from_stock_meters, 0), 0) > 0
  left join lateral (select max(coalesce(delivered_at::date,delivery_date)) last_delivery_date from public.supply_order_delivery_schedules schedule where schedule.request_item_table='request_chain_cord' and schedule.request_item_id=item.id and schedule.status='delivered') schedule on true
), state as (
  select machine.id as machine_id,
    count(item.*) as item_count,
    count(item.*) filter (where item.order_status in ('ordered','delivered')) as ordered_count,
    count(item.*) filter (where item.order_status = 'delivered') as delivered_count,
    max(item.delivered_date) as actual_material_date
  from public.machines machine
  left join remaining_items item on item.machine_id = machine.id
  where machine.id in (select machine_id from _knife_reset_requests)
  group by machine.id
)
update public.machines machine
set actual_material_date = case when state.item_count > 0 and state.delivered_count = state.item_count then state.actual_material_date else null end,
    status = case
      when machine.actual_shipping_date is not null then 'shipped'::public.machine_status
      when exists (select 1 from public.production_machine_facts fact where fact.machine_id = machine.id) then 'in_production'::public.machine_status
      when state.item_count > 0 and state.delivered_count = state.item_count then 'material_received'::public.machine_status
      when state.item_count > 0 and state.ordered_count = state.item_count then 'purchasing'::public.machine_status
      when exists (select 1 from public.technologist_requests request where request.machine_id=machine.id and request.status in ('submitted_to_supply','completed')) then 'request_ready'::public.machine_status
      when machine.factory_id is not null and machine.material_type is not null and machine.material_type <> 'undefined'::public.material_type and machine.planned_material_date is not null then 'planned'::public.machine_status
      when machine.is_confirmed then 'confirmed'::public.machine_status
      else 'created'::public.machine_status
    end,
    updated_at = now()
from state
where machine.id = state.machine_id;

do $postconditions$
declare
  v_probe_material uuid;
  v_guard_error text;
begin
  if exists (select 1 from public.technologist_requests where id in (select id from _knife_reset_requests))
    or exists (select 1 from public.materials where category = 'knives'::public.material_category)
    or exists (select 1 from public.material_variants where category = 'knives'::public.material_category)
    or exists (select 1 from public.inventory where id in (select id from _knife_reset_inventory)) then
    raise exception 'Knife reset postcondition failed: target database rows remain';
  end if;

  insert into public.materials(name, category, is_active)
  values ('__knife_reset_guard_probe__', 'knives'::public.material_category, false)
  returning id into v_probe_material;

  begin
    insert into public.material_variants(
      material_id, category, width_mm, height_mm, knife_material,
      knife_bevel_count, standard_length_mm
    ) values (
      v_probe_material, 'knives'::public.material_category, 200, 20,
      'guard-probe', 0, 6000
    );
    v_guard_error := 'GUARD_ACCEPTED_INVALID_KNIFE_LENGTH';
  exception when others then
    v_guard_error := sqlerrm;
  end;

  delete from public.materials where id = v_probe_material;
  if v_guard_error = 'GUARD_ACCEPTED_INVALID_KNIFE_LENGTH'
    or position('В профиле ножа нельзя указывать длину' in v_guard_error) = 0 then
    raise exception 'Knife reset postcondition failed: knife length guard did not reject the probe (%)', v_guard_error;
  end if;
end;
$postconditions$;

select fingerprint, jsonb_pretty(report) as deleted_scope
from _knife_reset_snapshot;

commit;

-- Storage is intentionally not deleted in the transaction. Run the separately
-- confirmed cleanup worker after COMMIT; failures remain retryable in
-- knife_reset_storage_cleanup_queue.
