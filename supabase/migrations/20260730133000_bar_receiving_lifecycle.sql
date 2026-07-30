-- Whole-bar receiving lifecycle for knives and circle.
-- Existing delivered rows are intentionally not backfilled or recalculated.

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.fn_prepare_supply_knife_future_scrap(uuid,uuid)'::regprocedure)
  INTO v_definition;

  IF position('v_reservation.request_item_table IS DISTINCT FROM ''request_knives''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_prepare_supply_knife_future_scrap definition';
  END IF;

  v_definition := replace(
    v_definition,
    'fn_prepare_supply_knife_future_scrap',
    'fn_prepare_supply_bar_future_scrap'
  );
  v_definition := replace(
    v_definition,
    'v_reservation.request_item_table IS DISTINCT FROM ''request_knives''',
    'v_reservation.request_item_table NOT IN (''request_knives'', ''request_circle'')'
  );
  v_definition := replace(v_definition, 'принятого ножа', 'принятого бруска');
  v_definition := replace(v_definition, 'поставки ножа', 'поставки бруска');

  EXECUTE v_definition;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_prepare_supply_bar_future_scrap(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_prepare_supply_bar_future_scrap(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prepare_supply_bar_future_scrap(uuid, uuid) TO service_role;

-- Backward-compatible entry point for integrations that still call the knife name.
CREATE OR REPLACE FUNCTION public.fn_prepare_supply_knife_future_scrap(
  p_reservation_id uuid,
  p_performed_by uuid
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.fn_prepare_supply_bar_future_scrap(p_reservation_id, p_performed_by);
$$;

REVOKE ALL ON FUNCTION public.fn_prepare_supply_knife_future_scrap(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_prepare_supply_knife_future_scrap(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prepare_supply_knife_future_scrap(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_prepare_supply_knife_future_scrap_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.fn_prepare_supply_bar_future_scrap(NEW.id, NEW.reserved_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prepare_supply_knife_future_scrap
  ON public.inventory_reservations;

CREATE TRIGGER trg_prepare_supply_knife_future_scrap
AFTER INSERT ON public.inventory_reservations
FOR EACH ROW
WHEN (
  NEW.reservation_source = 'supply_receipt'
  AND NEW.request_item_table IN ('request_knives', 'request_circle')
  AND NEW.supply_order_schedule_id IS NOT NULL
)
EXECUTE FUNCTION public.fn_prepare_supply_knife_future_scrap_trigger();

-- Extend the latest atomic receiving RPC without introducing a second public API.
DO $$
DECLARE
  v_definition text;
  v_validation_anchor text := $anchor$
    IF v_target_factory_id IS DISTINCT FROM v_factory_id THEN
      RAISE EXCEPTION 'Нельзя распределить приход между разными заводами';
    END IF;
$anchor$;
  v_validation_replacement text := $replacement$
    IF v_target_factory_id IS DISTINCT FROM v_factory_id THEN
      RAISE EXCEPTION 'Нельзя распределить приход между разными заводами';
    END IF;

    SELECT COALESCE(sum(COALESCE(allocated_quantity, received_quantity, quantity)), 0)
    INTO v_delivered_total
    FROM public.supply_order_delivery_schedules
    WHERE request_item_table = v_allocation_table
      AND request_item_id = v_allocation_id
      AND status = 'delivered';

    v_required := public.fn_supply_item_required_quantity(v_allocation_table, v_target_item);
    IF v_allocation_quantity > GREATEST(v_required - v_delivered_total, 0) + 0.000001 THEN
      RAISE EXCEPTION 'Распределение превышает актуальный остаток потребности';
    END IF;
$replacement$;
BEGIN
  SELECT pg_get_functiondef(
    'public.fn_receive_supply_order_schedule_v2(uuid,uuid,numeric,jsonb,numeric,numeric)'::regprocedure
  ) INTO v_definition;

  IF position('v_schedule.request_item_table = ''request_knives''' IN v_definition) = 0
    OR position(v_validation_anchor IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_receive_supply_order_schedule_v2 definition';
  END IF;

  v_definition := replace(
    v_definition,
    'v_schedule.request_item_table = ''request_knives''',
    'v_schedule.request_item_table IN (''request_knives'', ''request_circle'')'
  );
  v_definition := replace(v_definition, 'Для ножей укажите', 'Для ножей и круга укажите');
  v_definition := replace(v_definition, 'Общая длина ножей', 'Общая длина брусков');
  v_definition := replace(v_definition, 'только для ножей', 'только для ножей и круга');
  v_definition := replace(v_definition, 'брусков ножа', 'брусков');
  v_definition := replace(v_definition, v_validation_anchor, v_validation_replacement);

  EXECUTE v_definition;
END;
$$;

-- Cutting writes off only the logical need and promotes the linked future
-- remainder for both supported bar categories. Rollback remains unchanged and
-- restores the event snapshot, including the full source bar and future state.
DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.fn_apply_production_fact_cutting(uuid,uuid)'::regprocedure)
  INTO v_definition;

  IF position('reservation.request_item_table = ''request_knives''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_apply_production_fact_cutting definition';
  END IF;

  v_definition := replace(
    v_definition,
    'reservation.request_item_table = ''request_knives''',
    'reservation.request_item_table IN (''request_knives'', ''request_circle'')'
  );
  v_definition := replace(v_definition, 'принятого ножа', 'принятого бруска');

  EXECUTE v_definition;
END;
$$;

-- Supply-bar future scrap cannot participate in preliminary chains. It becomes
-- reservable through the ordinary stock process only after cutting promotes it.
CREATE OR REPLACE FUNCTION public.fn_block_supply_bar_future_scrap_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.inventory AS future_scrap
    JOIN public.inventory_reservations AS source_reservation
      ON source_reservation.id = future_scrap.source_reservation_id
    WHERE future_scrap.id = NEW.inventory_id
      AND future_scrap.is_business_scrap = true
      AND future_scrap.business_scrap_state = 'future'
      AND future_scrap.deleted_at IS NULL
      AND source_reservation.reservation_source = 'supply_receipt'
      AND source_reservation.request_item_table IN ('request_knives', 'request_circle')
  ) THEN
    RAISE EXCEPTION 'Будущий остаток принятого бруска станет доступен только после факта Заготовки';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_block_supply_bar_future_scrap_reservation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_block_supply_bar_future_scrap_reservation() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_block_supply_bar_future_scrap_reservation
  ON public.inventory_reservations;

CREATE TRIGGER trg_block_supply_bar_future_scrap_reservation
BEFORE INSERT ON public.inventory_reservations
FOR EACH ROW
EXECUTE FUNCTION public.fn_block_supply_bar_future_scrap_reservation();
