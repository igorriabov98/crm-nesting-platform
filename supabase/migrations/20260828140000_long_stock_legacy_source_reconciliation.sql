-- Reconcile approved legacy layouts with the physical reservations that were
-- created after approval. Matching plans keep version 1 immutable and gain an
-- auditable bar-to-reservation map. A mismatch invalidates only an unstarted
-- version and opens the existing planning-recovery flow, whose next approval
-- creates version 2 from the preserved physical reservations.

create table public.long_stock_cutting_source_reconciliations (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null unique
    references public.long_stock_cutting_plan_versions(id) on delete restrict,
  plan_id uuid not null references public.long_stock_cutting_plans(id) on delete restrict,
  request_item_table text not null
    check (request_item_table in ('request_circle', 'request_pipe', 'request_knives')),
  request_item_id uuid not null,
  status text not null
    check (status in ('matched', 'invalidated', 'skipped_started', 'manual_review_required')),
  expected_sources jsonb not null check (jsonb_typeof(expected_sources) = 'array'),
  actual_sources jsonb not null check (jsonb_typeof(actual_sources) = 'array'),
  reason text,
  department_request_id uuid references public.department_requests(id) on delete restrict,
  reconciled_by uuid not null references public.users(id) on delete restrict,
  reconciled_at timestamptz not null default now()
);

create table public.long_stock_cutting_reconciled_source_bars (
  reconciliation_id uuid not null
    references public.long_stock_cutting_source_reconciliations(id) on delete restrict,
  version_id uuid not null,
  bar_id uuid not null,
  reservation_id uuid not null references public.inventory_reservations(id) on delete restrict,
  reservation_piece_number integer not null check (reservation_piece_number > 0),
  source_inventory_id uuid not null references public.inventory(id) on delete restrict,
  source_type text not null
    check (source_type in ('warehouse_stock', 'business_remnant', 'future_business_remnant')),
  stock_length_mm numeric not null check (stock_length_mm > 0),
  created_at timestamptz not null default now(),
  primary key (reconciliation_id, bar_id),
  unique (reservation_id, reservation_piece_number),
  foreign key (version_id, bar_id)
    references public.long_stock_cutting_candidate_bars(version_id, id) on delete restrict
);

create index long_stock_source_reconciliations_status_idx
  on public.long_stock_cutting_source_reconciliations(status, reconciled_at);

alter table public.long_stock_cutting_source_reconciliations enable row level security;
alter table public.long_stock_cutting_reconciled_source_bars enable row level security;
revoke all on table public.long_stock_cutting_source_reconciliations
  from public, anon, authenticated;
revoke all on table public.long_stock_cutting_reconciled_source_bars
  from public, anon, authenticated;
grant select, insert on table public.long_stock_cutting_source_reconciliations
  to service_role;
grant select, insert on table public.long_stock_cutting_reconciled_source_bars
  to service_role;

create or replace function public.fn_reconcile_approved_long_stock_sources_v1(
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target record;
  v_expected_sources jsonb;
  v_actual_sources jsonb;
  v_can_match boolean;
  v_started boolean;
  v_status text;
  v_reason text;
  v_reconciliation_id uuid;
  v_department_request_id uuid;
  v_matched_count integer := 0;
  v_invalidated_count integer := 0;
  v_started_count integer := 0;
  v_manual_count integer := 0;
  v_details jsonb := '[]'::jsonb;
begin
  for v_target in
    select
      version.id as version_id,
      version.plan_id,
      version.version_number,
      version.selected_candidate_number,
      version.created_by,
      plan.plan_number,
      plan.material_variant_id,
      variant.material_id,
      item.id as plan_item_id,
      item.request_id,
      item.request_item_table,
      item.request_item_id,
      request.machine_id,
      machine.factory_id
    from public.long_stock_cutting_plan_versions version
    join public.long_stock_cutting_plans plan on plan.id = version.plan_id
    join public.material_variants variant on variant.id = plan.material_variant_id
    join lateral (
      select plan_item.*
      from public.long_stock_cutting_plan_items plan_item
      where plan_item.plan_id = plan.id
      order by plan_item.linked_at, plan_item.id
      limit 1
    ) item on true
    join public.technologist_requests request on request.id = item.request_id
    join public.machines machine on machine.id = request.machine_id
    where version.status = 'approved'
      and not (version.input_snapshot ? 'available_stock_sources')
      and not exists (
        select 1
        from public.long_stock_cutting_source_reconciliations reconciliation
        where reconciliation.version_id = version.id
      )
    order by version.approved_at, version.id
  loop
    if p_apply then
      perform 1
      from public.long_stock_cutting_plans
      where id = v_target.plan_id
      for update;
      perform 1
      from public.long_stock_cutting_plan_versions
      where id = v_target.version_id and status = 'approved'
      for update;
      if not found then continue; end if;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'bar_id', bar.id,
      'bar_number', bar.bar_number,
      'length_mm', bar.stock_length_mm,
      'source_type', bar.source_type,
      'source_inventory_id', bar.source_inventory_id
    ) order by bar.bar_number), '[]'::jsonb)
    into v_expected_sources
    from public.long_stock_cutting_candidate_bars bar
    join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
    where candidate.version_id = v_target.version_id
      and candidate.candidate_number = v_target.selected_candidate_number;

    with reservation_rows as (
      select
        reservation.*,
        greatest(1, case
          when reservation.reserved_secondary_quantity is not null
            then floor(reservation.reserved_secondary_quantity)::integer
          when coalesce(reservation.original_piece_length_mm, 0) > 0
            then floor(reservation.reserved_quantity / reservation.original_piece_length_mm)::integer
          else 1
        end) as piece_count
      from public.inventory_reservations reservation
      where reservation.request_item_table = v_target.request_item_table
        and reservation.request_item_id = v_target.request_item_id
        and reservation.consumed_at is null
        and not reservation.is_cut_reservation
    ), physical_sources as (
      select
        reservation.id as reservation_id,
        piece_number,
        reservation.inventory_id,
        coalesce(reservation.source_inventory_id, reservation.inventory_id) as source_inventory_id,
        reservation.material_id,
        reservation.material_variant_id,
        reservation.machine_id,
        reservation.original_piece_length_mm as length_mm,
        reservation.created_at,
        case
          when inventory_row.is_business_scrap
            and inventory_row.business_scrap_state = 'future' then 'future_business_remnant'
          when inventory_row.is_business_scrap then 'business_remnant'
          else 'warehouse_stock'
        end as source_type
      from reservation_rows reservation
      cross join lateral generate_series(1, reservation.piece_count) piece_number
      join public.inventory inventory_row on inventory_row.id = reservation.inventory_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'reservation_id', source.reservation_id,
      'reservation_piece_number', source.piece_number,
      'inventory_id', source.inventory_id,
      'source_inventory_id', source.source_inventory_id,
      'source_type', source.source_type,
      'length_mm', source.length_mm,
      'material_id', source.material_id,
      'material_variant_id', source.material_variant_id,
      'machine_id', source.machine_id
    ) order by source.length_mm nulls first, source.created_at, source.reservation_id, source.piece_number), '[]'::jsonb)
    into v_actual_sources
    from physical_sources source;

    select exists (
      select 1
      from public.long_stock_cutting_candidate_bars bar
      join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
      where candidate.version_id = v_target.version_id
        and candidate.candidate_number = v_target.selected_candidate_number
        and bar.status <> 'planned'
    ) or exists (
      select 1
      from public.long_stock_cutting_fact_bars fact_bar
      where fact_bar.version_id = v_target.version_id
        and fact_bar.rolled_back_at is null
    ) into v_started;

    with expected as (
      select (entry->>'length_mm')::numeric as length_mm, count(*)::integer as piece_count
      from jsonb_array_elements(v_expected_sources) entry
      group by (entry->>'length_mm')::numeric
    ), actual as (
      select nullif(entry->>'length_mm', '')::numeric as length_mm,
             count(*)::integer as piece_count,
             bool_and(
               nullif(entry->>'material_id', '')::uuid = v_target.material_id
               and nullif(entry->>'material_variant_id', '')::uuid = v_target.material_variant_id
               and nullif(entry->>'machine_id', '')::uuid = v_target.machine_id
             ) as identity_matches
      from jsonb_array_elements(v_actual_sources) entry
      group by nullif(entry->>'length_mm', '')::numeric
    )
    select not exists (
      select 1
      from actual
      left join expected using (length_mm)
      where actual.length_mm is null
        or not coalesce(actual.identity_matches, false)
        or expected.length_mm is null
        or actual.piece_count > expected.piece_count
    ) into v_can_match;

    if v_started then
      v_status := 'skipped_started';
      v_reason := 'Версия уже начата или завершена; автоматическая сверка истории запрещена';
      v_started_count := v_started_count + 1;
    elsif v_can_match then
      v_status := 'matched';
      v_reason := null;
      v_matched_count := v_matched_count + 1;
    else
      v_status := case when p_apply then 'invalidated' else 'manual_review_required' end;
      v_reason := 'Фактические физические резервы не помещаются в утверждённый состав хлыстов версии №'
        || v_target.version_number;
      if p_apply then
        begin
          v_department_request_id := gen_random_uuid();
          insert into public.department_requests(
            id, request_kind, target_department, title, description,
            status, created_by, assigned_to, factory_id, machine_id,
            request_item_table, request_item_id, technologist_request_id,
            long_stock_plan_id, long_stock_returned_version_id, request_item_label
          ) values (
            v_department_request_id,
            'long_stock_recalculation',
            'technologist',
            'Сверить источники карты №' || v_target.plan_number,
            v_reason,
            'in_progress',
            v_target.created_by,
            v_target.created_by,
            v_target.factory_id,
            v_target.machine_id,
            v_target.request_item_table,
            v_target.request_item_id,
            v_target.request_id,
            v_target.plan_id,
            v_target.version_id,
            'Длинномер · фактические складские резервы'
          );

          perform set_config('app.long_stock_cutting_version_lifecycle', '1', true);
          update public.long_stock_cutting_plan_versions
          set status = 'invalid',
              invalidation_reason = v_reason,
              invalidation_receipt_schedule_id = null,
              invalidation_inventory_transfer_id = null,
              invalidation_department_request_id = v_department_request_id,
              invalidation_dependency_id = null,
              invalidated_by = v_target.created_by,
              invalidated_at = now()
          where id = v_target.version_id and status = 'approved';
          perform set_config('app.long_stock_cutting_version_lifecycle', '', true);

          update public.inventory inventory_row
          set total_quantity = 0,
              reserved_quantity = 0,
              total_secondary_quantity = 0,
              reserved_secondary_quantity = 0,
              deleted_at = coalesce(deleted_at, now()),
              deleted_by = coalesce(deleted_by, v_target.created_by),
              delete_comment = coalesce(delete_comment, 'Сверка источников старой карты'),
              last_updated_by = v_target.created_by,
              updated_at = now()
          from public.long_stock_cutting_business_scraps scrap_link
          where scrap_link.version_id = v_target.version_id
            and scrap_link.inventory_id = inventory_row.id
            and inventory_row.business_scrap_state = 'future'
            and coalesce(inventory_row.reserved_quantity, 0) = 0
            and coalesce(inventory_row.reserved_secondary_quantity, 0) = 0;

          perform set_config('app.long_stock_cutting_item_status', '1', true);
          update public.long_stock_cutting_plan_items
          set cutting_status = 'requires_recalculation'
          where id = v_target.plan_item_id;
          perform set_config('app.long_stock_cutting_item_status', '', true);

          if not exists (
            select 1 from public.tasks task
            where task.long_stock_cutting_plan_id = v_target.plan_id
              and task.task_type = 'long_stock_cutting_recalculation'
              and task.status in ('pending', 'in_progress')
          ) then
            insert into public.tasks(
              department_request_id, machine_id, assigned_to, task_type,
              title, description, status, start_date,
              long_stock_cutting_plan_id, long_stock_cutting_plan_version_id
            ) values (
              v_department_request_id, v_target.machine_id, v_target.created_by,
              'long_stock_cutting_recalculation',
              'Пересчитать карту №' || v_target.plan_number,
              v_reason, 'in_progress', current_date,
              v_target.plan_id, v_target.version_id
            );
          end if;
          v_invalidated_count := v_invalidated_count + 1;
        exception when others then
          v_status := 'manual_review_required';
          v_reason := v_reason || '. Автоматическая инвалидация остановлена: ' || sqlerrm;
          v_department_request_id := null;
          v_manual_count := v_manual_count + 1;
        end;
      else
        v_manual_count := v_manual_count + 1;
      end if;
    end if;

    if p_apply then
      insert into public.long_stock_cutting_source_reconciliations(
        version_id, plan_id, request_item_table, request_item_id, status,
        expected_sources, actual_sources, reason, department_request_id, reconciled_by
      ) values (
        v_target.version_id, v_target.plan_id, v_target.request_item_table,
        v_target.request_item_id, v_status, v_expected_sources, v_actual_sources,
        v_reason, v_department_request_id, v_target.created_by
      ) returning id into v_reconciliation_id;

      if v_status = 'matched' then
        with expected as (
          select
            bar.id as bar_id,
            bar.stock_length_mm::numeric as length_mm,
            row_number() over (
              partition by bar.stock_length_mm order by bar.bar_number, bar.id
            ) as piece_rank
          from public.long_stock_cutting_candidate_bars bar
          join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
          where candidate.version_id = v_target.version_id
            and candidate.candidate_number = v_target.selected_candidate_number
        ), actual as (
          select
            nullif(entry->>'reservation_id', '')::uuid as reservation_id,
            (entry->>'reservation_piece_number')::integer as reservation_piece_number,
            nullif(entry->>'inventory_id', '')::uuid as source_inventory_id,
            entry->>'source_type' as source_type,
            (entry->>'length_mm')::numeric as length_mm,
            row_number() over (
              partition by (entry->>'length_mm')::numeric
              order by nullif(entry->>'reservation_id', '')::uuid,
                       (entry->>'reservation_piece_number')::integer
            ) as piece_rank
          from jsonb_array_elements(v_actual_sources) entry
        )
        insert into public.long_stock_cutting_reconciled_source_bars(
          reconciliation_id, version_id, bar_id, reservation_id,
          reservation_piece_number, source_inventory_id, source_type, stock_length_mm
        )
        select
          v_reconciliation_id, v_target.version_id, expected.bar_id,
          actual.reservation_id, actual.reservation_piece_number,
          actual.source_inventory_id, actual.source_type, actual.length_mm
        from actual
        join expected using (length_mm, piece_rank);
      end if;
    end if;

    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'version_id', v_target.version_id,
      'plan_number', v_target.plan_number,
      'status', v_status,
      'reason', v_reason,
      'expected_sources', v_expected_sources,
      'actual_sources', v_actual_sources
    ));
  end loop;

  return jsonb_build_object(
    'apply', p_apply,
    'matched', v_matched_count,
    'invalidated', v_invalidated_count,
    'skipped_started', v_started_count,
    'manual_review_required', v_manual_count,
    'details', v_details
  );
end;
$$;

revoke all on function public.fn_reconcile_approved_long_stock_sources_v1(boolean)
  from public, anon, authenticated;
grant execute on function public.fn_reconcile_approved_long_stock_sources_v1(boolean)
  to service_role;

notify pgrst, 'reload schema';
