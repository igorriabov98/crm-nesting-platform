-- A cutting need (e.g. 12 x 500 mm) is not the number of purchased bars.
-- Recheck the selected immutable layout inside the receiving transaction as
-- well as in the application preview. The existing RPC still checks actor,
-- permissions, material/factory identity, logical need and receipt totals.
CREATE OR REPLACE FUNCTION public.fn_assert_whole_bar_receipt_allocation_v1(
  p_table text,
  p_item_id uuid,
  p_planned_length numeric,
  p_received_length numeric,
  p_piece_count numeric,
  p_logical_quantity numeric,
  p_outstanding_logical numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_plan_id uuid;
  v_item_id uuid;
  v_candidate_id uuid;
  v_length numeric := COALESCE(p_planned_length, p_received_length);
  v_received_pieces numeric;
  v_expected_pieces numeric;
  v_logical_quantity numeric;
BEGIN
  SELECT item.plan_id, item.id INTO v_plan_id, v_item_id
  FROM public.long_stock_cutting_plan_items item
  WHERE item.request_item_table = p_table
    AND item.request_item_id = p_item_id
    AND item.link_state = 'active';

  IF v_plan_id IS NULL THEN
    -- Legacy positions without a cutting map retain their original contract.
    IF p_piece_count > ceil(p_outstanding_logical / p_received_length) THEN
      RAISE EXCEPTION 'Количество хлыстов превышает остаток потребности';
    END IF;
    RETURN;
  END IF;

  -- Use the same lock as approval/recalculation; read the version after locking.
  PERFORM 1 FROM public.long_stock_cutting_plans WHERE id = v_plan_id FOR UPDATE;
  SELECT candidate.id INTO v_candidate_id
  FROM public.long_stock_cutting_plan_versions version
  JOIN public.long_stock_cutting_candidates candidate
    ON candidate.version_id = version.id
    AND candidate.candidate_number = version.selected_candidate_number
  JOIN public.long_stock_cutting_plan_items item ON item.id = v_item_id
  WHERE version.plan_id = v_plan_id
    AND item.link_state = 'active'
    AND (
      (version.status = 'approved' AND item.cutting_status IN ('plan_approved', 'accepted'))
      OR (
        -- A measured length discrepancy invalidates the map after the first
        -- technical row. Finish that same atomic batch against its original
        -- layout, while keeping the map blocked for subsequent receipts/cutting.
        version.status = 'invalid' AND item.cutting_status = 'requires_recalculation'
        AND current_setting('app.receiving_batch_mode', true) = 'on'
        AND EXISTS (
          SELECT 1 FROM public.supply_order_delivery_schedules receipt
          WHERE receipt.id = version.invalidation_receipt_schedule_id
            AND receipt.status = 'delivered'
            AND receipt.xmin::text = pg_current_xact_id()::text
        )
      )
    );
  IF v_candidate_id IS NULL THEN
    RAISE EXCEPTION 'Для приёмки нужна актуальная утверждённая карта раскроя';
  END IF;

  SELECT count(*) INTO v_expected_pieces
  FROM public.long_stock_cutting_candidate_bars bar
  WHERE bar.candidate_id = v_candidate_id
    AND bar.source_type = 'new_stock' AND bar.stock_length_mm = v_length;

  SELECT COALESCE(sum(COALESCE(
    schedule.allocated_piece_count,
    schedule.allocated_physical_quantity / NULLIF(schedule.received_piece_length_mm, 0),
    CASE WHEN schedule.receipt_parent_schedule_id IS NULL THEN schedule.received_piece_count ELSE 0 END,
    0
  )), 0) INTO v_received_pieces
  FROM public.supply_order_delivery_schedules schedule
  WHERE schedule.request_item_table = p_table AND schedule.request_item_id = p_item_id
    AND schedule.status = 'delivered'
    AND COALESCE(schedule.planned_piece_length_mm, schedule.received_piece_length_mm) = v_length;

  IF trunc(v_received_pieces) <> v_received_pieces
    OR v_received_pieces < 0
    OR p_piece_count > v_expected_pieces - v_received_pieces THEN
    RAISE EXCEPTION 'Количество хлыстов превышает остаток по утверждённой карте раскроя';
  END IF;

  -- Preserve cut coverage on partial receipts: for the 11+1 layout the first
  -- bar closes 5500 mm and the second 500 mm, although both are 6000 mm stock.
  SELECT sum(cut.cut_length_mm) INTO v_logical_quantity
  FROM (
    SELECT bar.id
    FROM public.long_stock_cutting_candidate_bars bar
    WHERE bar.candidate_id = v_candidate_id
      AND bar.source_type = 'new_stock' AND bar.stock_length_mm = v_length
    ORDER BY bar.bar_number
    OFFSET v_received_pieces::integer LIMIT p_piece_count::integer
  ) selected_bar
  JOIN public.long_stock_cutting_bar_cuts cut ON cut.bar_id = selected_bar.id
  JOIN public.long_stock_cutting_segments segment ON segment.id = cut.segment_id
    AND segment.plan_item_id = v_item_id;

  IF COALESCE(v_logical_quantity, 0) <= 0 OR abs(p_logical_quantity - LEAST(
    v_logical_quantity, p_piece_count * p_received_length, p_outstanding_logical
  )) > 0.000001 THEN
    RAISE EXCEPTION 'Распределение отрезков не соответствует утверждённой карте раскроя';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_assert_whole_bar_receipt_allocation_v1(text, uuid, numeric, numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  v_definition text;
  v_anchor text := E'    IF v_allocation_quantity > GREATEST(v_required - v_delivered_total, 0) + 0.000001 THEN\n      RAISE EXCEPTION ''Распределение превышает актуальный остаток потребности'';\n    END IF;';
  v_guard text := E'\n    IF p_received_piece_count IS NOT NULL THEN\n      PERFORM public.fn_assert_whole_bar_receipt_allocation_v1(\n        v_allocation_table, v_allocation_id,\n        CASE WHEN v_allocation_id = v_schedule.request_item_id\n          THEN v_schedule.planned_piece_length_mm ELSE p_received_piece_length_mm END,\n        p_received_piece_length_mm, v_allocation_pieces, v_allocation_quantity,\n        GREATEST(v_required - v_delivered_total, 0)\n      );\n    END IF;';
BEGIN
  SELECT pg_get_functiondef('public.fn_receive_supply_order_schedule_v2(uuid,uuid,numeric,jsonb,numeric,numeric)'::regprocedure)
    INTO v_definition;
  IF position('fn_assert_whole_bar_receipt_allocation_v1' IN v_definition) > 0 THEN RETURN; END IF;
  IF position(v_anchor IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_receive_supply_order_schedule_v2 definition';
  END IF;
  EXECUTE replace(v_definition, v_anchor, v_anchor || v_guard);
END;
$$;
