-- Ordinary-material receipts must enter through the operator-confirmed v3
-- endpoint. Keep v2 available for whole-bar compatibility, but reject stale
-- clients or direct callers that would otherwise restore automatic allocation.

DO $migration$
DECLARE
  v_definition text;
  v_anchor text := $anchor$
  IF v_source_item IS NULL THEN RAISE EXCEPTION 'Позиция закупки не найдена'; END IF;
$anchor$;
  v_replacement text := $replacement$
  IF v_source_item IS NULL THEN RAISE EXCEPTION 'Позиция закупки не найдена'; END IF;
  IF (
    v_schedule.request_item_table NOT IN ('request_knives', 'request_circle')
    AND NOT (
      v_schedule.request_item_table = 'request_pipe'
      AND COALESCE(v_source_item->>'pipe_type', '') <> 'wire'
    )
  ) AND current_setting('app.manual_quantity_receipt_v3', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Обычные материалы принимаются только через окно ручного распределения';
  END IF;
$replacement$;
BEGIN
  SELECT pg_get_functiondef(
    'public.fn_receive_supply_order_schedule_v2(uuid,uuid,numeric,jsonb,numeric,numeric)'::regprocedure
  ) INTO v_definition;

  IF position(v_anchor IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_receive_supply_order_schedule_v2 definition';
  END IF;

  EXECUTE replace(v_definition, v_anchor, v_replacement);
END;
$migration$;

REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_v2(uuid, uuid, numeric, jsonb, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_v2(uuid, uuid, numeric, jsonb, numeric, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_receive_supply_order_schedule_v2(uuid, uuid, numeric, jsonb, numeric, numeric) TO service_role;
