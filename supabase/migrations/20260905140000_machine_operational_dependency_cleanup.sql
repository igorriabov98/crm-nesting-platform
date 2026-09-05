-- Atomically retire the unfinished operational footprint of an archived or
-- deleted machine while preserving received, produced and financial history.

CREATE OR REPLACE FUNCTION public.fn_machine_for_transport_need_cleanup_v1(
  p_need_source text,
  p_need_id uuid
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_machine_id uuid;
BEGIN
  IF p_need_source = 'inventory_transfer' THEN
    SELECT transfer.machine_id
    INTO v_machine_id
    FROM public.inventory_transfers transfer
    WHERE transfer.id = p_need_id;
  ELSIF p_need_source = 'detailing_transfer' THEN
    SELECT transfer.machine_id
    INTO v_machine_id
    FROM public.detailing_transfers transfer
    WHERE transfer.id = p_need_id;
  ELSIF p_need_source = 'outsourcing' THEN
    SELECT operation.machine_id
    INTO v_machine_id
    FROM public.machine_outsourcing_transport_needs need
    JOIN public.machine_outsourcing_operations operation
      ON operation.id = need.operation_id
    WHERE need.id = p_need_id;
  ELSIF p_need_source = 'supply_schedule' THEN
    SELECT request.machine_id
    INTO v_machine_id
    FROM public.supply_order_delivery_schedules schedule
    JOIN (
      SELECT 'request_sheet_metal'::text AS request_item_table, id, request_id
      FROM public.request_sheet_metal
      UNION ALL
      SELECT 'request_round_tube', id, request_id FROM public.request_round_tube
      UNION ALL
      SELECT 'request_circle', id, request_id FROM public.request_circle
      UNION ALL
      SELECT 'request_pipe', id, request_id FROM public.request_pipe
      UNION ALL
      SELECT 'request_knives', id, request_id FROM public.request_knives
      UNION ALL
      SELECT 'request_components', id, request_id FROM public.request_components
      UNION ALL
      SELECT 'request_paint', id, request_id FROM public.request_paint
      UNION ALL
      SELECT 'request_mesh', id, request_id FROM public.request_mesh
      UNION ALL
      SELECT 'request_chain_cord', id, request_id FROM public.request_chain_cord
    ) item
      ON item.request_item_table = schedule.request_item_table
     AND item.id = schedule.request_item_id
    JOIN public.technologist_requests request ON request.id = item.request_id
    WHERE schedule.id = p_need_id;
  END IF;

  RETURN v_machine_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_machine_for_transport_need_cleanup_v1(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- A private, transaction-scoped authorization marker lets the cleanup repair
-- legacy rows that were already marked cancelled while active reservations or
-- schedules survived. It does not weaken immutable-history guards for clients.
CREATE TABLE IF NOT EXISTS public.machine_operational_cleanup_context_v1 (
  backend_pid integer NOT NULL,
  transaction_id bigint NOT NULL,
  machine_id uuid NOT NULL,
  request_item_table text NOT NULL,
  request_item_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (backend_pid, transaction_id, request_item_table, request_item_id)
);

ALTER TABLE public.machine_operational_cleanup_context_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.machine_operational_cleanup_context_v1
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_reject_cancelled_long_stock_request_item_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_cancelled boolean := false;
BEGIN
  IF new.request_item_table NOT IN ('request_circle', 'request_pipe', 'request_knives') THEN
    RETURN new;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.machine_operational_cleanup_context_v1 context
    WHERE context.backend_pid = pg_backend_pid()
      AND context.transaction_id = txid_current()
      AND context.request_item_table = new.request_item_table
      AND context.request_item_id = new.request_item_id
  ) THEN
    RETURN new;
  END IF;

  EXECUTE format(
    'SELECT order_status = ''cancelled'' FROM public.%I WHERE id = $1',
    new.request_item_table
  ) INTO v_cancelled USING new.request_item_id;
  IF COALESCE(v_cancelled, false) THEN
    RAISE EXCEPTION 'Отменённая по пересчёту позиция недоступна для закупки и резервирования';
  END IF;
  RETURN new;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_reject_cancelled_long_stock_request_item_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_guard_cancelled_long_stock_request_item_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF old.order_status = 'cancelled' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.machine_operational_cleanup_context_v1 context
      WHERE context.backend_pid = pg_backend_pid()
        AND context.transaction_id = txid_current()
        AND context.request_item_table = TG_TABLE_NAME
        AND context.request_item_id = old.id
    ) THEN
      RAISE EXCEPTION 'Отменённая по пересчёту позиция сохранена как неизменяемая история';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN old ELSE new END;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_guard_cancelled_long_stock_request_item_history()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_cleanup_machine_operational_dependencies_v1(
  p_machine_id uuid,
  p_actor uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_machine public.machines%ROWTYPE;
  v_reason text := COALESCE(NULLIF(btrim(p_reason), ''), 'Заказ архивирован или удалён');
  v_transfer record;
  v_reservation record;
  v_dependency record;
  v_version record;
  v_bar record;
  v_trip record;
  v_table text;
  v_rows integer;
  v_active_links integer;
  v_route_start_key text;
  v_route_start text;
  v_route text;
  v_direction text;
  v_inventory_transfers integer := 0;
  v_inventory_reservations integer := 0;
  v_detailing_transfers integer := 0;
  v_detailing_reservations integer := 0;
  v_future_detailing integer := 0;
  v_supply_items integer := 0;
  v_supply_schedules integer := 0;
  v_outsourcing_needs integer := 0;
  v_outsourcing_operations integer := 0;
  v_transport_links integer := 0;
  v_transport_trips integer := 0;
  v_long_stock_bars integer := 0;
  v_future_scraps integer := 0;
  v_dependency_invalidations integer := 0;
  v_source_dependencies_cancelled integer := 0;
  v_tasks integer := 0;
  v_agenda_references integer := 0;
BEGIN
  IF p_machine_id IS NULL THEN
    RAISE EXCEPTION 'Не указан заказ для очистки';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Не указан пользователь для очистки заказа';
  END IF;

  SELECT * INTO v_machine
  FROM public.machines
  WHERE id = p_machine_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Заказ не найден';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'request_sheet_metal', 'request_round_tube', 'request_circle',
    'request_pipe', 'request_knives', 'request_components', 'request_paint',
    'request_mesh', 'request_chain_cord'
  ]
  LOOP
    EXECUTE format(
      'INSERT INTO public.machine_operational_cleanup_context_v1('
      || 'backend_pid, transaction_id, machine_id, request_item_table, request_item_id, actor_id'
      || ') '
      || 'SELECT pg_backend_pid(), txid_current(), $1, %L, item.id, $2 '
      || 'FROM public.%I item '
      || 'JOIN public.technologist_requests request ON request.id = item.request_id '
      || 'WHERE request.machine_id = $1 '
      || 'ON CONFLICT (backend_pid, transaction_id, request_item_table, request_item_id) '
      || 'DO UPDATE SET actor_id = excluded.actor_id, created_at = now()',
      v_table,
      v_table
    ) USING p_machine_id, p_actor;
  END LOOP;

  -- Snapshot active trip links before their source rows change state. The
  -- source-neutral link table lets mixed trips keep needs of other machines.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.machine_cleanup_need_links (
    link_id uuid PRIMARY KEY,
    trip_id uuid NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.machine_cleanup_need_links;

  INSERT INTO pg_temp.machine_cleanup_need_links(link_id, trip_id)
  SELECT link.id, link.transport_order_id
  FROM public.transport_trip_need_links link
  JOIN public.machine_outsourcing_transport_orders trip
    ON trip.id = link.transport_order_id
  WHERE link.released_at IS NULL
    AND trip.status IN ('needed', 'found', 'in_transit')
    AND public.fn_machine_for_transport_need_cleanup_v1(link.need_source, link.need_id)
      = p_machine_id;

  -- A producer future remnant may already be selected by another active map.
  -- Invalidate those consumers first so their reservations are released by the
  -- established long-stock lifecycle before the producer remnants disappear.
  FOR v_dependency IN
    SELECT dependency.id
    FROM public.long_stock_cutting_source_dependencies dependency
    JOIN public.long_stock_cutting_plan_versions producer_version
      ON producer_version.id = dependency.producer_version_id
    JOIN public.long_stock_cutting_plan_items producer_item
      ON producer_item.plan_id = producer_version.plan_id
    JOIN public.technologist_requests producer_request
      ON producer_request.id = producer_item.request_id
    WHERE producer_request.machine_id = p_machine_id
      AND dependency.status NOT IN ('fulfilled', 'invalidated')
      AND NOT EXISTS (
        SELECT 1
        FROM public.long_stock_cutting_plan_items other_item
        JOIN public.technologist_requests other_request
          ON other_request.id = other_item.request_id
        WHERE other_item.plan_id = producer_version.plan_id
          AND other_request.machine_id <> p_machine_id
      )
    ORDER BY dependency.consumer_version_id, dependency.consumer_bar_id
  LOOP
    IF public.fn_invalidate_long_stock_dependency_v1(
      v_dependency.id,
      p_actor,
      v_reason || ': исходный заказ больше не будет производиться'
    ) THEN
      v_dependency_invalidations := v_dependency_invalidations + 1;
    END IF;
  END LOOP;

  -- The archived order can itself consume another order's future remnant. Its
  -- unfinished dependency is no longer actionable; the underlying reservation
  -- is released below while fulfilled dependencies remain immutable history.
  UPDATE public.long_stock_cutting_source_dependencies dependency
  SET status = 'invalidated',
      invalidation_reason = COALESCE(NULLIF(dependency.invalidation_reason, ''), v_reason),
      invalidated_at = COALESCE(dependency.invalidated_at, now())
  FROM public.long_stock_cutting_plan_versions consumer_version
  JOIN public.long_stock_cutting_plan_items consumer_item
    ON consumer_item.plan_id = consumer_version.plan_id
  JOIN public.technologist_requests consumer_request
    ON consumer_request.id = consumer_item.request_id
  WHERE dependency.consumer_version_id = consumer_version.id
    AND consumer_request.machine_id = p_machine_id
    AND dependency.status NOT IN ('fulfilled', 'invalidated');
  GET DIAGNOSTICS v_source_dependencies_cancelled = ROW_COUNT;

  -- Close only selected, approved bars that belong exclusively to this order.
  -- Cut bars are immutable production facts and are deliberately untouched.
  FOR v_bar IN
    SELECT DISTINCT bar.id
    FROM public.long_stock_cutting_candidate_bars bar
    JOIN public.long_stock_cutting_candidates candidate
      ON candidate.id = bar.candidate_id
     AND candidate.version_id = bar.version_id
    JOIN public.long_stock_cutting_plan_versions version
      ON version.id = bar.version_id
     AND version.selected_candidate_number = candidate.candidate_number
     AND version.status = 'approved'
    JOIN public.long_stock_cutting_plan_items item ON item.plan_id = version.plan_id
    JOIN public.technologist_requests request ON request.id = item.request_id
    WHERE request.machine_id = p_machine_id
      AND bar.status = 'planned'
      AND NOT EXISTS (
        SELECT 1
        FROM public.long_stock_cutting_plan_items other_item
        JOIN public.technologist_requests other_request
          ON other_request.id = other_item.request_id
        WHERE other_item.plan_id = version.plan_id
          AND other_request.machine_id <> p_machine_id
      )
    ORDER BY bar.id
  LOOP
    PERFORM public.fn_set_long_stock_cutting_bar_status(v_bar.id, 'cancelled', p_actor);
    v_long_stock_bars := v_long_stock_bars + 1;
  END LOOP;

  -- Cancel material transfers before detaching/releasing reservations. This
  -- preserves partially received quantities and prevents refresh logic from
  -- turning a zero remainder into a completed active transfer.
  FOR v_transfer IN
    SELECT id
    FROM public.inventory_transfers
    WHERE machine_id = p_machine_id
      AND status IN ('needs_date', 'scheduled', 'partially_received')
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    UPDATE public.inventory_reservations reservation
    SET inventory_transfer_item_id = NULL
    FROM public.inventory_transfer_items item
    WHERE item.transfer_id = v_transfer.id
      AND reservation.inventory_transfer_item_id = item.id
      AND reservation.consumed_at IS NULL;

    UPDATE public.inventory_transfers
    SET status = 'cancelled',
        cancelled_at = COALESCE(cancelled_at, now()),
        updated_by = p_actor,
        updated_at = now()
    WHERE id = v_transfer.id;
    PERFORM public.fn_sync_inventory_transfer_task(v_transfer.id, p_actor);
    v_inventory_transfers := v_inventory_transfers + 1;
  END LOOP;

  -- The same ordering is required for detailing: cancel the transport object,
  -- then release the still-reserved remainder. Received pieces stay on hand.
  FOR v_transfer IN
    SELECT id
    FROM public.detailing_transfers
    WHERE machine_id = p_machine_id
      AND status IN ('needs_date', 'scheduled', 'partially_received')
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    UPDATE public.detailing_transfers
    SET status = 'cancelled',
        cancelled_at = COALESCE(cancelled_at, now()),
        updated_by = p_actor,
        updated_at = now()
    WHERE id = v_transfer.id;
    PERFORM public.fn_sync_detailing_transfer_task(v_transfer.id, p_actor);
    v_detailing_transfers := v_detailing_transfers + 1;
  END LOOP;

  FOR v_reservation IN
    SELECT id
    FROM public.inventory_reservations
    WHERE machine_id = p_machine_id
      AND consumed_at IS NULL
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    PERFORM public.fn_unreserve_inventory_reservation(
      v_reservation.id,
      p_actor,
      v_reason || ': снятие складской брони'
    );
    v_inventory_reservations := v_inventory_reservations + 1;
  END LOOP;

  -- Canonical unreserve updates the quantity used by each material category,
  -- but legacy rows may still contain values in companion display fields.
  -- Zero every reservation projection so procurement cannot show stale cover.
  UPDATE public.request_sheet_metal item
  SET reserved_from_stock_kg = 0
  FROM public.technologist_requests request
  WHERE request.id = item.request_id
    AND request.machine_id = p_machine_id
    AND COALESCE(item.reserved_from_stock_kg, 0) <> 0;

  UPDATE public.request_round_tube item
  SET reserved_from_stock_kg = 0, reserved_from_stock_m = 0
  FROM public.technologist_requests request
  WHERE request.id = item.request_id
    AND request.machine_id = p_machine_id
    AND (
      COALESCE(item.reserved_from_stock_kg, 0) <> 0
      OR COALESCE(item.reserved_from_stock_m, 0) <> 0
    );

  UPDATE public.request_circle item
  SET reserved_from_stock_mm = 0
  FROM public.technologist_requests request
  WHERE request.id = item.request_id
    AND request.machine_id = p_machine_id
    AND COALESCE(item.reserved_from_stock_mm, 0) <> 0;

  UPDATE public.request_pipe item
  SET reserved_from_stock_length_mm = 0,
      reserved_from_stock_qty = 0,
      reserved_from_stock_kg = 0
  FROM public.technologist_requests request
  WHERE request.id = item.request_id
    AND request.machine_id = p_machine_id
    AND (
      COALESCE(item.reserved_from_stock_length_mm, 0) <> 0
      OR COALESCE(item.reserved_from_stock_qty, 0) <> 0
      OR COALESCE(item.reserved_from_stock_kg, 0) <> 0
    );

  UPDATE public.request_knives item
  SET reserved_from_stock_mm = 0, reserved_from_stock_qty = 0
  FROM public.technologist_requests request
  WHERE request.id = item.request_id
    AND request.machine_id = p_machine_id
    AND (
      COALESCE(item.reserved_from_stock_mm, 0) <> 0
      OR COALESCE(item.reserved_from_stock_qty, 0) <> 0
    );

  UPDATE public.request_components item
  SET reserved_from_stock = 0
  FROM public.technologist_requests request
  WHERE request.id = item.request_id
    AND request.machine_id = p_machine_id
    AND COALESCE(item.reserved_from_stock, 0) <> 0;

  UPDATE public.request_paint item
  SET reserved_from_stock_kg = 0
  FROM public.technologist_requests request
  WHERE request.id = item.request_id
    AND request.machine_id = p_machine_id
    AND COALESCE(item.reserved_from_stock_kg, 0) <> 0;

  UPDATE public.request_mesh item
  SET reserved_from_stock_qty = 0
  FROM public.technologist_requests request
  WHERE request.id = item.request_id
    AND request.machine_id = p_machine_id
    AND COALESCE(item.reserved_from_stock_qty, 0) <> 0;

  UPDATE public.request_chain_cord item
  SET reserved_from_stock_meters = 0
  FROM public.technologist_requests request
  WHERE request.id = item.request_id
    AND request.machine_id = p_machine_id
    AND COALESCE(item.reserved_from_stock_meters, 0) <> 0;

  FOR v_reservation IN
    SELECT id
    FROM public.detailing_reservations
    WHERE machine_id = p_machine_id
      AND status IN ('active', 'partially_consumed')
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    PERFORM public.detailing_release_reservation_internal(
      v_reservation.id,
      p_actor,
      v_reason || ': снятие брони деталировки',
      true
    );
    v_detailing_reservations := v_detailing_reservations + 1;
  END LOOP;

  UPDATE public.tasks task
  SET status = 'cancelled', completed_at = now(), updated_at = now()
  FROM public.future_detailing_batches batch
  WHERE batch.machine_id = p_machine_id
    AND batch.status IN ('planned', 'awaiting_confirmation')
    AND batch.confirmation_task_id = task.id
    AND task.status IN ('pending', 'in_progress');

  UPDATE public.future_detailing_items item
  SET status = 'cancelled',
      variance_reason = COALESCE(NULLIF(item.variance_reason, ''), v_reason),
      updated_at = now()
  FROM public.future_detailing_batches batch
  WHERE batch.id = item.batch_id
    AND batch.machine_id = p_machine_id
    AND batch.status IN ('planned', 'awaiting_confirmation')
    AND item.status IN ('planned', 'awaiting_confirmation');

  UPDATE public.future_detailing_batches
  SET status = 'cancelled', updated_at = now()
  WHERE machine_id = p_machine_id
    AND status IN ('planned', 'awaiting_confirmation');
  GET DIAGNOSTICS v_future_detailing = ROW_COUNT;

  -- A schedule is the procurement/transport need. Delivered rows remain as
  -- receipt documents; only the unfulfilled schedule remainder is cancelled.
  UPDATE public.supply_order_delivery_schedules schedule
  SET status = 'cancelled',
      change_reason = COALESCE(NULLIF(schedule.change_reason, ''), v_reason),
      updated_by = p_actor,
      updated_at = now()
  FROM (
    SELECT 'request_sheet_metal'::text AS request_item_table, item.id
    FROM public.request_sheet_metal item
    JOIN public.technologist_requests request ON request.id = item.request_id
    WHERE request.machine_id = p_machine_id
    UNION ALL
    SELECT 'request_round_tube', item.id FROM public.request_round_tube item
    JOIN public.technologist_requests request ON request.id = item.request_id
    WHERE request.machine_id = p_machine_id
    UNION ALL
    SELECT 'request_circle', item.id FROM public.request_circle item
    JOIN public.technologist_requests request ON request.id = item.request_id
    WHERE request.machine_id = p_machine_id
    UNION ALL
    SELECT 'request_pipe', item.id FROM public.request_pipe item
    JOIN public.technologist_requests request ON request.id = item.request_id
    WHERE request.machine_id = p_machine_id
    UNION ALL
    SELECT 'request_knives', item.id FROM public.request_knives item
    JOIN public.technologist_requests request ON request.id = item.request_id
    WHERE request.machine_id = p_machine_id
    UNION ALL
    SELECT 'request_components', item.id FROM public.request_components item
    JOIN public.technologist_requests request ON request.id = item.request_id
    WHERE request.machine_id = p_machine_id
    UNION ALL
    SELECT 'request_paint', item.id FROM public.request_paint item
    JOIN public.technologist_requests request ON request.id = item.request_id
    WHERE request.machine_id = p_machine_id
    UNION ALL
    SELECT 'request_mesh', item.id FROM public.request_mesh item
    JOIN public.technologist_requests request ON request.id = item.request_id
    WHERE request.machine_id = p_machine_id
    UNION ALL
    SELECT 'request_chain_cord', item.id FROM public.request_chain_cord item
    JOIN public.technologist_requests request ON request.id = item.request_id
    WHERE request.machine_id = p_machine_id
  ) machine_item
  WHERE schedule.request_item_table = machine_item.request_item_table
    AND schedule.request_item_id = machine_item.id
    AND schedule.status = 'planned';
  GET DIAGNOSTICS v_supply_schedules = ROW_COUNT;

  -- During physical deletion the request rows disappear in the same
  -- transaction. Do not first turn long-stock request rows into immutable
  -- cancelled history, because their dedicated history guard intentionally
  -- forbids deleting a cancelled row. Archive keeps and audits those rows.
  IF COALESCE(v_machine.is_archived, false) THEN
    FOREACH v_table IN ARRAY ARRAY[
      'request_sheet_metal', 'request_round_tube', 'request_circle',
      'request_pipe', 'request_knives', 'request_components', 'request_paint',
      'request_mesh', 'request_chain_cord'
    ]
    LOOP
      IF v_table IN ('request_circle', 'request_pipe', 'request_knives') THEN
        EXECUTE format(
          'UPDATE public.%I item '
          || 'SET order_status = ''cancelled''::public.order_item_status, '
          || 'cancelled_at = COALESCE(item.cancelled_at, now()), '
          || 'cancelled_by = COALESCE(item.cancelled_by, $2), '
          || 'cancellation_reason = COALESCE(NULLIF(item.cancellation_reason, ''''), $3) '
          || 'FROM public.technologist_requests request '
          || 'WHERE request.id = item.request_id '
          || 'AND request.machine_id = $1 '
          || 'AND item.order_status IN (''pending'', ''ordered'')',
          v_table
        ) USING p_machine_id, p_actor, v_reason;
      ELSE
        EXECUTE format(
          'UPDATE public.%I item '
          || 'SET order_status = ''cancelled''::public.order_item_status '
          || 'FROM public.technologist_requests request '
          || 'WHERE request.id = item.request_id '
          || 'AND request.machine_id = $1 '
          || 'AND item.order_status IN (''pending'', ''ordered'')',
          v_table
        ) USING p_machine_id;
      END IF;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_supply_items := v_supply_items + v_rows;
    END LOOP;
  END IF;

  UPDATE public.tasks task
  SET status = 'cancelled', completed_at = now(), updated_at = now()
  FROM public.business_scrap_correction_requests correction
  WHERE correction.machine_id = p_machine_id
    AND correction.status = 'pending'
    AND correction.task_id = task.id
    AND task.status IN ('pending', 'in_progress');

  UPDATE public.business_scrap_correction_requests
  SET status = 'cancelled',
      decision_comment = COALESCE(NULLIF(decision_comment, ''), v_reason),
      decided_by = COALESCE(decided_by, p_actor),
      decided_at = COALESCE(decided_at, now()),
      updated_at = now()
  WHERE machine_id = p_machine_id
    AND status = 'pending';

  UPDATE public.machine_outsourcing_transport_needs need
  SET status = 'cancelled', transport_order_id = NULL, updated_at = now()
  FROM public.machine_outsourcing_operations operation
  WHERE operation.id = need.operation_id
    AND operation.machine_id = p_machine_id
    AND need.status IN ('open', 'linked');
  GET DIAGNOSTICS v_outsourcing_needs = ROW_COUNT;

  UPDATE public.machine_outsourcing_operations
  SET archived_at = COALESCE(archived_at, now()),
      archived_by = COALESCE(archived_by, p_actor),
      updated_by = p_actor,
      updated_at = now()
  WHERE machine_id = p_machine_id
    AND archived_at IS NULL;
  GET DIAGNOSTICS v_outsourcing_operations = ROW_COUNT;

  UPDATE public.transport_trip_need_links link
  SET released_at = now(),
      released_reason = v_reason,
      released_by = p_actor,
      pickup_stop_id = NULL,
      delivery_stop_id = NULL
  FROM pg_temp.machine_cleanup_need_links cleanup
  WHERE cleanup.link_id = link.id
    AND link.released_at IS NULL;
  GET DIAGNOSTICS v_transport_links = ROW_COUNT;

  FOR v_trip IN
    SELECT DISTINCT cleanup.trip_id
    FROM pg_temp.machine_cleanup_need_links cleanup
    ORDER BY cleanup.trip_id
  LOOP
    UPDATE public.tasks task
    SET status = 'cancelled', completed_at = now(), updated_at = now()
    FROM public.transport_trip_date_change_requests request
    WHERE request.transport_order_id = v_trip.trip_id
      AND request.status = 'pending'
      AND request.task_id = task.id
      AND task.status IN ('pending', 'in_progress');

    UPDATE public.transport_trip_date_change_items item
    SET status = 'rejected', decided_at = now()
    FROM public.transport_trip_date_change_requests request
    WHERE request.transport_order_id = v_trip.trip_id
      AND request.status = 'pending'
      AND item.request_id = request.id;

    UPDATE public.transport_trip_date_change_requests
    SET status = 'rejected',
        decided_by = p_actor,
        decided_at = now(),
        decision_comment = v_reason,
        updated_at = now()
    WHERE transport_order_id = v_trip.trip_id
      AND status = 'pending';

    SELECT count(*)::integer
    INTO v_active_links
    FROM public.transport_trip_need_links
    WHERE transport_order_id = v_trip.trip_id
      AND released_at IS NULL;

    IF v_active_links = 0 THEN
      UPDATE public.machine_outsourcing_transport_orders
      SET status = 'cancelled',
          cancellation_reason = v_reason,
          cancelled_at = COALESCE(cancelled_at, now()),
          cancelled_by = COALESCE(cancelled_by, p_actor),
          date_change_state = CASE
            WHEN date_change_state = 'pending' THEN 'rejected'
            ELSE date_change_state
          END,
          updated_by = p_actor,
          updated_at = now()
      WHERE id = v_trip.trip_id
        AND status IN ('needed', 'found', 'in_transit');
      v_transport_trips := v_transport_trips + 1;
      CONTINUE;
    END IF;

    -- Released links retain textual endpoints as history. Their stop FKs are
    -- cleared above, so unused future stops can now be removed safely.
    DELETE FROM public.transport_trip_stops stop
    WHERE stop.transport_order_id = v_trip.trip_id
      AND stop.status = 'planned'
      AND NOT EXISTS (
        SELECT 1
        FROM public.transport_trip_need_links link
        WHERE link.transport_order_id = v_trip.trip_id
          AND link.released_at IS NULL
          AND (link.pickup_stop_id = stop.id OR link.delivery_stop_id = stop.id)
      );

    UPDATE public.transport_trip_stops
    SET sequence_no = sequence_no + 1000000, updated_at = now()
    WHERE transport_order_id = v_trip.trip_id;

    WITH ranked AS (
      SELECT id,
             (row_number() OVER (ORDER BY sequence_no, created_at, id) - 1)::integer AS next_sequence
      FROM public.transport_trip_stops
      WHERE transport_order_id = v_trip.trip_id
    )
    UPDATE public.transport_trip_stops stop
    SET sequence_no = ranked.next_sequence, updated_at = now()
    FROM ranked
    WHERE stop.id = ranked.id;

    WITH bounds AS (
      SELECT min(sequence_no) AS first_sequence, max(sequence_no) AS last_sequence
      FROM public.transport_trip_stops
      WHERE transport_order_id = v_trip.trip_id
    )
    UPDATE public.transport_trip_stops stop
    SET stop_kind = CASE
          WHEN stop.sequence_no = bounds.first_sequence THEN 'start'
          WHEN stop.sequence_no = bounds.last_sequence THEN 'finish'
          ELSE 'service'
        END,
        updated_at = now()
    FROM bounds
    WHERE stop.transport_order_id = v_trip.trip_id
      AND stop.status = 'planned';

    SELECT stop.point_key, stop.point_label
    INTO v_route_start_key, v_route_start
    FROM public.transport_trip_stops stop
    WHERE stop.transport_order_id = v_trip.trip_id
    ORDER BY stop.sequence_no, stop.id
    LIMIT 1;

    SELECT string_agg(stop.point_label, ' → ' ORDER BY stop.sequence_no, stop.id)
    INTO v_route
    FROM public.transport_trip_stops stop
    WHERE stop.transport_order_id = v_trip.trip_id;

    IF v_route_start IS NULL THEN
      SELECT link.source_point_key,
             link.source_point_label,
             link.source_point_label || ' → ' || string_agg(
               DISTINCT link.destination_point_label,
               ' → ' ORDER BY link.destination_point_label
             )
      INTO v_route_start_key, v_route_start, v_route
      FROM public.transport_trip_need_links link
      WHERE link.transport_order_id = v_trip.trip_id
        AND link.released_at IS NULL
      GROUP BY link.source_point_key, link.source_point_label
      ORDER BY link.source_point_label
      LIMIT 1;
    END IF;

    SELECT CASE
      WHEN count(DISTINCT link.direction::text) > 1 THEN 'mixed'
      ELSE min(link.direction::text)
    END
    INTO v_direction
    FROM public.transport_trip_need_links link
    WHERE link.transport_order_id = v_trip.trip_id
      AND link.released_at IS NULL;

    UPDATE public.machine_outsourcing_transport_orders
    SET direction = v_direction::public.outsourcing_transport_direction,
        route_start_key = v_route_start_key,
        route_start = v_route_start,
        route = v_route,
        date_change_state = CASE
          WHEN date_change_state = 'pending' THEN 'not_required'
          ELSE date_change_state
        END,
        updated_by = p_actor,
        updated_at = now()
    WHERE id = v_trip.trip_id
      AND status IN ('needed', 'found', 'in_transit');
    v_transport_trips := v_transport_trips + 1;
  END LOOP;

  -- Any untouched projected remnant of this machine must disappear from the
  -- warehouse. Used or fact-backed remnants stay as immutable history.
  UPDATE public.inventory future_scrap
  SET total_quantity = 0,
      reserved_quantity = 0,
      total_secondary_quantity = CASE
        WHEN total_secondary_quantity IS NULL THEN NULL ELSE 0
      END,
      reserved_secondary_quantity = CASE
        WHEN reserved_secondary_quantity IS NULL THEN NULL ELSE 0
      END,
      deleted_at = COALESCE(deleted_at, now()),
      deleted_by = COALESCE(deleted_by, p_actor),
      delete_comment = COALESCE(NULLIF(delete_comment, ''), v_reason),
      last_updated_by = p_actor,
      updated_at = now()
  WHERE future_scrap.source_machine_id = p_machine_id
    AND future_scrap.is_business_scrap = true
    AND future_scrap.business_scrap_state = 'future'
    AND future_scrap.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.inventory_reservations reservation
      WHERE reservation.consumed_at IS NULL
        AND (
          reservation.inventory_id = future_scrap.id
          OR reservation.source_inventory_id = future_scrap.id
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.long_stock_cutting_source_dependencies dependency
      WHERE dependency.source_inventory_id = future_scrap.id
        AND dependency.status <> 'invalidated'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.long_stock_cutting_fact_bars fact_bar
      WHERE fact_bar.result_inventory_id = future_scrap.id
        AND fact_bar.rolled_back_at IS NULL
    );
  GET DIAGNOSTICS v_future_scraps = ROW_COUNT;

  UPDATE public.tasks
  SET status = 'cancelled', completed_at = now(), updated_at = now()
  WHERE machine_id = p_machine_id
    AND status IN ('pending', 'in_progress');
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  -- Meeting agenda cleanup belongs to the same database transaction as every
  -- operational dependency, so a rejected delete cannot partially hide work.
  v_agenda_references := public.fn_cleanup_machine_agenda_references(p_machine_id);

  DELETE FROM public.machine_operational_cleanup_context_v1 context
  WHERE context.backend_pid = pg_backend_pid()
    AND context.transaction_id = txid_current()
    AND context.machine_id = p_machine_id;

  RETURN jsonb_build_object(
    'machineId', p_machine_id,
    'inventoryTransfersCancelled', v_inventory_transfers,
    'inventoryReservationsReleased', v_inventory_reservations,
    'detailingTransfersCancelled', v_detailing_transfers,
    'detailingReservationsReleased', v_detailing_reservations,
    'futureDetailingCancelled', v_future_detailing,
    'supplyItemsCancelled', v_supply_items,
    'supplySchedulesCancelled', v_supply_schedules,
    'outsourcingNeedsCancelled', v_outsourcing_needs,
    'outsourcingOperationsArchived', v_outsourcing_operations,
    'transportLinksReleased', v_transport_links,
    'transportTripsUpdated', v_transport_trips,
    'longStockBarsCancelled', v_long_stock_bars,
    'futureScrapsRemoved', v_future_scraps,
    'dependentPlansInvalidated', v_dependency_invalidations,
    'sourceDependenciesCancelled', v_source_dependencies_cancelled,
    'tasksCancelled', v_tasks,
    'agendaReferencesRemoved', v_agenda_references
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_cleanup_machine_operational_dependencies_v1(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cleanup_machine_operational_dependencies_v1(uuid, uuid, text)
  TO service_role;

-- Keep direct archive updates safe as well: an active detailing transfer is
-- cancelled while its requested/received history is still intact, then the
-- remaining reservation is returned to available stock.
CREATE OR REPLACE FUNCTION public.detailing_machine_change_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid;
  v_reservation record;
BEGIN
  v_actor := COALESCE(auth.uid(), NEW.archived_by, NEW.created_by);

  IF COALESCE(NEW.is_archived, false) AND NOT COALESCE(OLD.is_archived, false) THEN
    PERFORM public.detailing_rebuild_machine_transfers(NEW.id, v_actor);
    FOR v_reservation IN
      SELECT id
      FROM public.detailing_reservations
      WHERE machine_id = NEW.id
        AND status IN ('active', 'partially_consumed')
      FOR UPDATE
    LOOP
      PERFORM public.detailing_release_reservation_internal(
        v_reservation.id, v_actor, 'Заказ архивирован', true
      );
    END LOOP;
  ELSIF NEW.factory_id IS DISTINCT FROM OLD.factory_id THEN
    PERFORM public.detailing_rebuild_machine_transfers(NEW.id, v_actor);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.detailing_machine_change_trigger()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.archive_machine_and_compact_production_queue(
  p_machine_id uuid,
  p_archived_by uuid,
  p_archive_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_machine record;
  v_active_queue_size integer := 0;
  v_cleanup jsonb;
BEGIN
  IF p_machine_id IS NULL THEN RAISE EXCEPTION 'Не указана машина'; END IF;
  IF p_archived_by IS NULL THEN RAISE EXCEPTION 'Не указан пользователь'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('machine-production-queue', 0));

  SELECT
    m.id, m.name, m.production_month, m.factory_id,
    m.production_workshop, m.production_queue_number,
    COALESCE(m.is_archived, false) AS is_archived
  INTO v_machine
  FROM public.machines m
  WHERE m.id = p_machine_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Машина не найдена'; END IF;
  IF v_machine.is_archived THEN RAISE EXCEPTION 'Машина уже архивирована'; END IF;

  UPDATE public.machines
  SET is_archived = true,
      archived_at = now(),
      archived_by = p_archived_by,
      archive_reason = NULLIF(btrim(p_archive_reason), ''),
      updated_at = now()
  WHERE id = p_machine_id;

  v_cleanup := public.fn_cleanup_machine_operational_dependencies_v1(
    p_machine_id,
    p_archived_by,
    COALESCE(NULLIF(btrim(p_archive_reason), ''), 'Заказ архивирован')
  );

  IF v_machine.production_month IS NOT NULL
     AND v_machine.factory_id IS NOT NULL
     AND v_machine.production_workshop IS NOT NULL THEN
    WITH ranked AS (
      SELECT m.id,
             row_number() OVER (
               ORDER BY m.production_queue_number NULLS LAST, m.created_at, m.id
             )::integer AS queue_number
      FROM public.machines m
      WHERE m.production_month = v_machine.production_month
        AND m.factory_id = v_machine.factory_id
        AND m.production_workshop = v_machine.production_workshop
        AND COALESCE(m.is_archived, false) = false
    )
    UPDATE public.machines m
    SET production_queue_number = ranked.queue_number, updated_at = now()
    FROM ranked
    WHERE m.id = ranked.id
      AND m.production_queue_number IS DISTINCT FROM ranked.queue_number;

    SELECT count(*)
    INTO v_active_queue_size
    FROM public.machines m
    WHERE m.production_month = v_machine.production_month
      AND m.factory_id = v_machine.factory_id
      AND m.production_workshop = v_machine.production_workshop
      AND COALESCE(m.is_archived, false) = false;
  END IF;

  RETURN jsonb_build_object(
    'machineId', v_machine.id,
    'machineName', v_machine.name,
    'productionMonth', v_machine.production_month,
    'factoryId', v_machine.factory_id,
    'workshop', v_machine.production_workshop,
    'archivedQueueNumber', v_machine.production_queue_number,
    'activeQueueSize', v_active_queue_size,
    'cleanup', v_cleanup
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_machine_and_compact_production_queue(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_machine_and_compact_production_queue(uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_delete_machine_with_inventory_cleanup(
  p_machine_id uuid,
  p_performed_by uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role public.user_role;
  v_deleted_id uuid;
  v_table text;
  v_has_fact boolean;
  v_fact_categories text[] := '{}'::text[];
BEGIN
  IF p_machine_id IS NULL THEN RAISE EXCEPTION 'Не указан заказ'; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  IF p_performed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Нельзя удалить заказ от имени другого пользователя';
  END IF;

  SELECT role INTO v_role FROM public.users WHERE id = auth.uid();
  IF v_role NOT IN ('financial_director', 'commercial_director', 'planning_director') THEN
    RAISE EXCEPTION 'Удалять заказы могут только директора';
  END IF;

  PERFORM 1 FROM public.machines WHERE id = p_machine_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ не найден или уже удалён'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.technologist_request_completions
    WHERE machine_id = p_machine_id AND state = 'finalized'
  ) OR EXISTS (
    SELECT 1 FROM public.long_stock_cutting_plan_items item
    JOIN public.technologist_requests request ON request.id = item.request_id
    JOIN public.long_stock_cutting_plan_versions version ON version.plan_id = item.plan_id
    WHERE request.machine_id = p_machine_id
      AND (version.status <> 'draft' OR version.definition_sealed)
  ) THEN
    v_fact_categories := array_append(v_fact_categories, 'технологические данные');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.production_machine_facts WHERE machine_id = p_machine_id
  ) OR EXISTS (
    SELECT 1 FROM public.production_fact_cutting_events
    WHERE machine_id = p_machine_id AND status IN ('applied', 'kept')
  ) OR EXISTS (
    SELECT 1 FROM public.inventory_reservations
    WHERE machine_id = p_machine_id AND consumed_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.detailing_consumption_events
    WHERE machine_id = p_machine_id AND status = 'applied'
  ) THEN
    v_fact_categories := array_append(v_fact_categories, 'производственные факты');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_transfer_items item
    JOIN public.inventory_transfers transfer ON transfer.id = item.transfer_id
    WHERE transfer.machine_id = p_machine_id
      AND COALESCE(item.received_quantity, 0) > 0
  ) OR EXISTS (
    SELECT 1
    FROM public.detailing_transfer_items item
    JOIN public.detailing_transfers transfer ON transfer.id = item.transfer_id
    WHERE transfer.machine_id = p_machine_id
      AND COALESCE(item.received_quantity, 0) > 0
  ) THEN
    v_fact_categories := array_append(v_fact_categories, 'факты приёмки или перемещения');
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'request_sheet_metal', 'request_round_tube', 'request_circle',
    'request_pipe', 'request_knives', 'request_components', 'request_paint',
    'request_mesh', 'request_chain_cord'
  ]
  LOOP
    EXECUTE format(
      'SELECT EXISTS ('
      || 'SELECT 1 FROM public.%I item '
      || 'JOIN public.technologist_requests request ON request.id = item.request_id '
      || 'WHERE request.machine_id = $1 '
      || 'AND (item.order_status = ''delivered'' OR item.delivered_at IS NOT NULL)'
      || ')',
      v_table
    ) INTO v_has_fact USING p_machine_id;
    EXIT WHEN v_has_fact;
  END LOOP;

  IF v_has_fact OR EXISTS (
    SELECT 1
    FROM public.supply_order_delivery_schedules schedule
    JOIN (
      SELECT 'request_sheet_metal'::text AS request_item_table, item.id
      FROM public.request_sheet_metal item
      JOIN public.technologist_requests request ON request.id = item.request_id
      WHERE request.machine_id = p_machine_id
      UNION ALL
      SELECT 'request_round_tube', item.id FROM public.request_round_tube item
      JOIN public.technologist_requests request ON request.id = item.request_id
      WHERE request.machine_id = p_machine_id
      UNION ALL
      SELECT 'request_circle', item.id FROM public.request_circle item
      JOIN public.technologist_requests request ON request.id = item.request_id
      WHERE request.machine_id = p_machine_id
      UNION ALL
      SELECT 'request_pipe', item.id FROM public.request_pipe item
      JOIN public.technologist_requests request ON request.id = item.request_id
      WHERE request.machine_id = p_machine_id
      UNION ALL
      SELECT 'request_knives', item.id FROM public.request_knives item
      JOIN public.technologist_requests request ON request.id = item.request_id
      WHERE request.machine_id = p_machine_id
      UNION ALL
      SELECT 'request_components', item.id FROM public.request_components item
      JOIN public.technologist_requests request ON request.id = item.request_id
      WHERE request.machine_id = p_machine_id
      UNION ALL
      SELECT 'request_paint', item.id FROM public.request_paint item
      JOIN public.technologist_requests request ON request.id = item.request_id
      WHERE request.machine_id = p_machine_id
      UNION ALL
      SELECT 'request_mesh', item.id FROM public.request_mesh item
      JOIN public.technologist_requests request ON request.id = item.request_id
      WHERE request.machine_id = p_machine_id
      UNION ALL
      SELECT 'request_chain_cord', item.id FROM public.request_chain_cord item
      JOIN public.technologist_requests request ON request.id = item.request_id
      WHERE request.machine_id = p_machine_id
    ) machine_item
      ON machine_item.request_item_table = schedule.request_item_table
     AND machine_item.id = schedule.request_item_id
    WHERE schedule.status = 'delivered'
       OR COALESCE(schedule.received_quantity, 0) > 0
  ) THEN
    v_fact_categories := array_append(v_fact_categories, 'принятые поставки');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.transport_trip_need_links link
    JOIN public.machine_outsourcing_transport_orders trip
      ON trip.id = link.transport_order_id
    WHERE public.fn_machine_for_transport_need_cleanup_v1(link.need_source, link.need_id)
          = p_machine_id
      AND (
        trip.status = 'completed'
        OR trip.started_at IS NOT NULL
        OR trip.completed_at IS NOT NULL
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.machine_outsourcing_operations
    WHERE machine_id = p_machine_id
      AND (actual_sent_at IS NOT NULL OR actual_returned_at IS NOT NULL)
  ) THEN
    v_fact_categories := array_append(v_fact_categories, 'транспортные факты');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoices invoice
    WHERE invoice.machine_id = p_machine_id
      AND (
        invoice.status = 'paid'
        OR EXISTS (
          SELECT 1 FROM public.invoice_payments payment
          WHERE payment.invoice_id = invoice.id
        )
      )
  ) THEN
    v_fact_categories := array_append(v_fact_categories, 'финансовые факты');
  END IF;

  IF cardinality(v_fact_categories) > 0 THEN
    RAISE EXCEPTION 'Удаление невозможно: заказ содержит подтверждённые %. Архивируйте заказ вместо удаления.',
      array_to_string(v_fact_categories, ', ');
  END IF;

  PERFORM public.fn_cleanup_machine_operational_dependencies_v1(
    p_machine_id,
    p_performed_by,
    'Заказ удалён'
  );

  FOREACH v_table IN ARRAY ARRAY[
    'request_sheet_metal', 'request_round_tube', 'request_circle',
    'request_pipe', 'request_knives', 'request_components', 'request_paint',
    'request_mesh', 'request_chain_cord'
  ]
  LOOP
    EXECUTE format(
      'INSERT INTO public.machine_operational_cleanup_context_v1('
      || 'backend_pid, transaction_id, machine_id, request_item_table, request_item_id, actor_id'
      || ') '
      || 'SELECT pg_backend_pid(), txid_current(), $1, %L, item.id, $2 '
      || 'FROM public.%I item '
      || 'JOIN public.technologist_requests request ON request.id = item.request_id '
      || 'WHERE request.machine_id = $1 '
      || 'ON CONFLICT (backend_pid, transaction_id, request_item_table, request_item_id) '
      || 'DO UPDATE SET actor_id = excluded.actor_id, created_at = now()',
      v_table,
      v_table
    ) USING p_machine_id, p_performed_by;
  END LOOP;

  UPDATE public.inventory_transactions
  SET machine_id = NULL
  WHERE machine_id = p_machine_id;

  DELETE FROM public.machines
  WHERE id = p_machine_id
  RETURNING id INTO v_deleted_id;

  IF v_deleted_id IS NULL THEN RAISE EXCEPTION 'Заказ не найден или уже удалён'; END IF;

  DELETE FROM public.machine_operational_cleanup_context_v1 context
  WHERE context.backend_pid = pg_backend_pid()
    AND context.transaction_id = txid_current()
    AND context.machine_id = p_machine_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_delete_machine_with_inventory_cleanup(uuid, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_delete_machine_with_inventory_cleanup(uuid, uuid)
  TO authenticated;

-- Existing archived machines were hidden by application filters but retained
-- active reservations and future stock. Re-run the same idempotent cleanup for
-- every historical archive so warehouse/procurement/transport agree at once.
DO $backfill$
DECLARE
  v_machine record;
  v_actor uuid;
BEGIN
  FOR v_machine IN
    SELECT id, name, archived_by, created_by
    FROM public.machines
    WHERE COALESCE(is_archived, false) = true
    ORDER BY archived_at NULLS LAST, created_at, id
  LOOP
    v_actor := COALESCE(
      v_machine.archived_by,
      v_machine.created_by,
      (SELECT id FROM public.users ORDER BY created_at, id LIMIT 1)
    );
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'Не найден пользователь для очистки архивного заказа %', v_machine.name;
    END IF;

    PERFORM public.fn_cleanup_machine_operational_dependencies_v1(
      v_machine.id,
      v_actor,
      'Очистка ранее архивированного заказа'
    );
  END LOOP;
END;
$backfill$;
