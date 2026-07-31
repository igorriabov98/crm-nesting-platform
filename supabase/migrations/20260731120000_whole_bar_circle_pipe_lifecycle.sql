-- Whole-bar stock lifecycle for circles and non-wire pipes.
-- Existing quantitative stock rows and active reservations keep their legacy behavior.

ALTER TABLE public.inventory_reservations
  ADD COLUMN IF NOT EXISTS logical_reserved_quantity numeric;

ALTER TABLE public.inventory_transfer_items
  ADD COLUMN IF NOT EXISTS logical_requested_quantity numeric,
  ADD COLUMN IF NOT EXISTS logical_received_quantity numeric;

UPDATE public.inventory_reservations
SET logical_reserved_quantity = reserved_quantity
WHERE logical_reserved_quantity IS NULL;

UPDATE public.inventory_reservations
SET logical_reserved_quantity = reserved_quantity - business_scrap_quantity
WHERE reservation_source = 'supply_receipt'
  AND COALESCE(business_scrap_quantity, 0) > 0
  AND reserved_quantity > business_scrap_quantity;

ALTER TABLE public.inventory_reservations
  ALTER COLUMN logical_reserved_quantity SET DEFAULT NULL;

ALTER TABLE public.inventory_reservations
  DROP CONSTRAINT IF EXISTS inventory_reservations_logical_quantity_check;

ALTER TABLE public.inventory_reservations
  ADD CONSTRAINT inventory_reservations_logical_quantity_check
  CHECK (
    logical_reserved_quantity IS NULL
    OR (
      logical_reserved_quantity > 0
      AND logical_reserved_quantity <= reserved_quantity
    )
  );

ALTER TABLE public.inventory_reservations
  DROP CONSTRAINT IF EXISTS inventory_reservations_reservation_source_check;

ALTER TABLE public.inventory_reservations
  ADD CONSTRAINT inventory_reservations_reservation_source_check
  CHECK (reservation_source IN ('stock', 'supply_receipt', 'whole_bar_stock', 'correction_hold'));

CREATE OR REPLACE FUNCTION public.fn_whole_bar_request_matches_inventory(
  p_request_item_table text,
  p_request_item_id uuid,
  p_inventory_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inventory public.inventory%ROWTYPE;
  v_variant public.material_variants%ROWTYPE;
  v_circle public.request_circle%ROWTYPE;
  v_pipe public.request_pipe%ROWTYPE;
BEGIN
  SELECT * INTO v_inventory
  FROM public.inventory
  WHERE id = p_inventory_id
    AND deleted_at IS NULL;

  IF NOT FOUND OR v_inventory.material_variant_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_variant
  FROM public.material_variants
  WHERE id = v_inventory.material_variant_id;

  IF NOT FOUND OR v_variant.material_id IS DISTINCT FROM v_inventory.material_id THEN
    RETURN false;
  END IF;

  IF p_request_item_table = 'request_circle' THEN
    SELECT * INTO v_circle FROM public.request_circle WHERE id = p_request_item_id;
    IF NOT FOUND OR v_circle.material_id IS DISTINCT FROM v_inventory.material_id THEN
      RETURN false;
    END IF;
    RETURN v_variant.category = 'circle'::public.material_category
      AND v_variant.diameter_mm IS NOT DISTINCT FROM v_circle.diameter_mm
      AND v_variant.steel_type_id IS NOT DISTINCT FROM v_circle.steel_type_id
      AND lower(btrim(COALESCE(v_variant.material_grade, ''))) = lower(btrim(COALESCE(v_circle.steel_grade, '')))
      AND COALESCE(v_variant.is_calibrated, false) = COALESCE(v_circle.is_calibrated, false);
  END IF;

  IF p_request_item_table = 'request_pipe' THEN
    SELECT * INTO v_pipe FROM public.request_pipe WHERE id = p_request_item_id;
    IF NOT FOUND
      OR v_pipe.pipe_type = 'wire'::public.pipe_subtype
      OR v_pipe.material_id IS DISTINCT FROM v_inventory.material_id THEN
      RETURN false;
    END IF;
    RETURN v_variant.category = 'pipe'::public.material_category
      AND v_variant.pipe_type IS NOT DISTINCT FROM v_pipe.pipe_type
      AND lower(regexp_replace(COALESCE(v_variant.piece_description, ''), '[[:space:]]', '', 'g'))
        = lower(regexp_replace(COALESCE(v_pipe.size, ''), '[[:space:]]', '', 'g'))
      AND v_variant.wall_thickness_mm IS NOT DISTINCT FROM v_pipe.wall_thickness_mm
      AND v_variant.diameter_mm IS NOT DISTINCT FROM v_pipe.diameter_mm
      AND v_variant.steel_type_id IS NOT DISTINCT FROM v_pipe.steel_type_id;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_whole_bar_request_matches_inventory(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_whole_bar_request_matches_inventory(text, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_whole_bar_request_matches_inventory(text, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_prepare_whole_bar_stock_future_scrap(
  p_reservation_id uuid,
  p_performed_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reservation public.inventory_reservations%ROWTYPE;
  v_source public.inventory%ROWTYPE;
  v_stage public.production_stages%ROWTYPE;
  v_scrap_quantity numeric;
  v_scrap_inventory_id uuid;
BEGIN
  SELECT * INTO v_reservation
  FROM public.inventory_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_reservation.reservation_source IS DISTINCT FROM 'whole_bar_stock'
    OR v_reservation.consumed_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  IF v_reservation.business_scrap_inventory_id IS NOT NULL THEN
    RETURN v_reservation.business_scrap_inventory_id;
  END IF;

  SELECT * INTO v_source
  FROM public.inventory
  WHERE id = v_reservation.inventory_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Складская строка хлыста не найдена';
  END IF;

  v_scrap_quantity := v_reservation.reserved_quantity
    - COALESCE(v_reservation.logical_reserved_quantity, v_reservation.reserved_quantity);

  IF v_scrap_quantity <= 0 THEN
    RETURN NULL;
  END IF;
  IF COALESCE(v_reservation.original_piece_length_mm, 0) <= 0
    OR v_scrap_quantity >= v_reservation.original_piece_length_mm THEN
    RAISE EXCEPTION 'Некорректный будущий остаток хлыста';
  END IF;

  SELECT * INTO v_stage
  FROM public.production_stages
  WHERE machine_id = v_reservation.machine_id
    AND stage_type = 'cutting'::public.stage_type
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.production_stages AS existing (
      machine_id, stage_type, workshop, updated_by
    ) VALUES (
      v_reservation.machine_id, 'cutting'::public.stage_type, 1, p_performed_by
    )
    ON CONFLICT (machine_id, stage_type) DO UPDATE
    SET updated_by = COALESCE(existing.updated_by, EXCLUDED.updated_by)
    RETURNING * INTO v_stage;
  END IF;

  INSERT INTO public.inventory (
    factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    is_business_scrap, business_scrap_state,
    available_from_date, available_from_stage_id,
    source_inventory_id, source_reservation_id, source_machine_id,
    source_piece_length_mm, last_updated_by
  ) VALUES (
    v_source.factory_id,
    v_reservation.material_id,
    v_reservation.material_variant_id,
    v_scrap_quantity,
    v_scrap_quantity,
    0,
    v_source.unit,
    1,
    0,
    COALESCE(v_source.secondary_unit, 'шт'),
    true,
    'future',
    v_stage.date_start,
    v_stage.id,
    v_source.id,
    v_reservation.id,
    v_reservation.machine_id,
    v_reservation.original_piece_length_mm,
    p_performed_by
  ) RETURNING id INTO v_scrap_inventory_id;

  UPDATE public.inventory_reservations
  SET source_inventory_id = COALESCE(source_inventory_id, v_source.id),
      business_scrap_inventory_id = v_scrap_inventory_id,
      business_scrap_quantity = v_scrap_quantity
  WHERE id = v_reservation.id;

  RETURN v_scrap_inventory_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_prepare_whole_bar_stock_future_scrap(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_prepare_whole_bar_stock_future_scrap(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prepare_whole_bar_stock_future_scrap(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_reserve_whole_bar_inventory_row_for_machine(
  p_inventory_id uuid,
  p_machine_id uuid,
  p_logical_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inventory public.inventory%ROWTYPE;
  v_machine_factory_id uuid;
  v_piece_count numeric;
  v_physical_quantity numeric;
  v_reservation_id uuid;
BEGIN
  IF COALESCE(p_logical_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'Количество бронирования должно быть больше 0';
  END IF;

  SELECT factory_id INTO v_machine_factory_id
  FROM public.machines WHERE id = p_machine_id;
  IF v_machine_factory_id IS NULL THEN
    RAISE EXCEPTION 'Для машины не определён завод';
  END IF;

  SELECT * INTO v_inventory
  FROM public.inventory
  WHERE id = p_inventory_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Выбранный складской остаток не найден'; END IF;
  IF v_inventory.factory_id IS DISTINCT FROM v_machine_factory_id THEN
    RAISE EXCEPTION 'Выбранный складской остаток относится к другому заводу';
  END IF;
  IF v_inventory.business_scrap_state = 'future' THEN
    RAISE EXCEPTION 'Будущий деловой остаток станет доступен только после факта Заготовки';
  END IF;
  IF COALESCE(v_inventory.piece_length_mm, 0) <= 0 THEN
    RAISE EXCEPTION 'Старый количественный остаток не является мерным хлыстом';
  END IF;
  IF NOT public.fn_whole_bar_request_matches_inventory(
    p_request_item_table, p_request_item_id, p_inventory_id
  ) THEN
    RAISE EXCEPTION 'Характеристики хлыста не соответствуют позиции заявки';
  END IF;

  v_piece_count := ceil(p_logical_quantity / v_inventory.piece_length_mm);
  v_physical_quantity := v_piece_count * v_inventory.piece_length_mm;

  IF floor(COALESCE(v_inventory.available_secondary_quantity, 0)) < v_piece_count
    OR v_inventory.available_quantity < v_physical_quantity THEN
    RAISE EXCEPTION 'Недостаточно целых хлыстов. Доступно: % шт',
      floor(COALESCE(v_inventory.available_secondary_quantity, 0));
  END IF;

  INSERT INTO public.inventory_reservations (
    inventory_id, source_inventory_id, material_id, material_variant_id,
    machine_id, request_item_table, request_item_id,
    reserved_quantity, logical_reserved_quantity, reserved_secondary_quantity,
    reserved_by, original_piece_length_mm, is_cut_reservation, reservation_source
  ) VALUES (
    v_inventory.id, v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id,
    p_machine_id, p_request_item_table, p_request_item_id,
    v_physical_quantity, p_logical_quantity, v_piece_count,
    p_reserved_by, v_inventory.piece_length_mm, false, 'whole_bar_stock'
  ) RETURNING id INTO v_reservation_id;

  UPDATE public.inventory
  SET reserved_quantity = reserved_quantity + v_physical_quantity,
      reserved_secondary_quantity = COALESCE(reserved_secondary_quantity, 0) + v_piece_count,
      last_updated_by = p_reserved_by,
      updated_at = now()
  WHERE id = v_inventory.id;

  PERFORM public.fn_prepare_whole_bar_stock_future_scrap(v_reservation_id, p_reserved_by);
  PERFORM public.fn_set_request_reserved_quantity(p_request_item_table, p_request_item_id);

  INSERT INTO public.inventory_transactions (
    factory_id, inventory_id, material_id, material_variant_id, transaction_type,
    quantity, secondary_quantity, machine_id, request_item_table, request_item_id,
    performed_by, comment
  ) VALUES (
    v_inventory.factory_id, v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id,
    'reserve', -v_physical_quantity, -v_piece_count, p_machine_id,
    p_request_item_table, p_request_item_id, p_reserved_by,
    'Бронирование целых хлыстов; потребность ' || p_logical_quantity::text || ' ' || v_inventory.unit
  );

  RETURN v_reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reserve_whole_bar_inventory_row_for_machine(uuid, uuid, numeric, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_reserve_whole_bar_inventory_row_for_machine(uuid, uuid, numeric, text, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_reserve_whole_bar_inventory_row_for_machine(uuid, uuid, numeric, text, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_reserve_whole_bar_inventory_row_for_machine_transfer(
  p_inventory_id uuid,
  p_machine_id uuid,
  p_logical_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inventory public.inventory%ROWTYPE;
  v_machine_factory_id uuid;
  v_piece_count numeric;
  v_physical_quantity numeric;
  v_reservation_id uuid;
BEGIN
  PERFORM public.inventory_transfer_assert_actor(
    p_reserved_by,
    ARRAY[
      'technologist', 'supply_manager', 'procurement_head',
      'planning_director', 'financial_director', 'commercial_director'
    ]::public.user_role[]
  );

  IF COALESCE(p_logical_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'Количество бронирования должно быть больше 0';
  END IF;
  SELECT factory_id INTO v_machine_factory_id FROM public.machines WHERE id = p_machine_id;
  IF v_machine_factory_id IS NULL THEN RAISE EXCEPTION 'Для машины не определён завод'; END IF;

  SELECT * INTO v_inventory
  FROM public.inventory
  WHERE id = p_inventory_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Выбранный складской остаток не найден'; END IF;
  IF v_inventory.factory_id IS NOT DISTINCT FROM v_machine_factory_id THEN
    RAISE EXCEPTION 'Для склада завода машины используйте обычное бронирование';
  END IF;
  IF v_inventory.business_scrap_state = 'future' THEN
    RAISE EXCEPTION 'Будущий деловой остаток ещё нельзя перевозить';
  END IF;
  IF COALESCE(v_inventory.piece_length_mm, 0) <= 0 THEN
    RAISE EXCEPTION 'Старый количественный остаток не является мерным хлыстом';
  END IF;
  IF NOT public.fn_whole_bar_request_matches_inventory(
    p_request_item_table, p_request_item_id, p_inventory_id
  ) THEN
    RAISE EXCEPTION 'Характеристики хлыста не соответствуют позиции заявки';
  END IF;

  v_piece_count := ceil(p_logical_quantity / v_inventory.piece_length_mm);
  v_physical_quantity := v_piece_count * v_inventory.piece_length_mm;
  IF floor(COALESCE(v_inventory.available_secondary_quantity, 0)) < v_piece_count
    OR v_inventory.available_quantity < v_physical_quantity THEN
    RAISE EXCEPTION 'Недостаточно целых хлыстов. Доступно: % шт',
      floor(COALESCE(v_inventory.available_secondary_quantity, 0));
  END IF;

  INSERT INTO public.inventory_reservations (
    inventory_id, source_inventory_id, material_id, material_variant_id,
    machine_id, request_item_table, request_item_id,
    reserved_quantity, logical_reserved_quantity, reserved_secondary_quantity,
    reserved_by, original_piece_length_mm, is_cut_reservation, reservation_source
  ) VALUES (
    v_inventory.id, v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id,
    p_machine_id, p_request_item_table, p_request_item_id,
    v_physical_quantity, p_logical_quantity, v_piece_count,
    p_reserved_by, v_inventory.piece_length_mm, false, 'stock'
  ) RETURNING id INTO v_reservation_id;

  UPDATE public.inventory
  SET reserved_quantity = reserved_quantity + v_physical_quantity,
      reserved_secondary_quantity = COALESCE(reserved_secondary_quantity, 0) + v_piece_count,
      last_updated_by = p_reserved_by,
      updated_at = now()
  WHERE id = v_inventory.id;

  PERFORM public.inventory_attach_reservation_to_transfer(
    v_reservation_id, v_machine_factory_id, p_reserved_by
  );
  UPDATE public.inventory_reservations
  SET reservation_source = 'whole_bar_stock'
  WHERE id = v_reservation_id;
  UPDATE public.inventory_transfer_items
  SET logical_requested_quantity = p_logical_quantity,
      logical_received_quantity = 0
  WHERE id = (
    SELECT inventory_transfer_item_id
    FROM public.inventory_reservations
    WHERE id = v_reservation_id
  );
  PERFORM public.fn_set_request_reserved_quantity(p_request_item_table, p_request_item_id);

  INSERT INTO public.inventory_transactions (
    factory_id, inventory_id, material_id, material_variant_id, transaction_type,
    quantity, secondary_quantity, machine_id, request_item_table, request_item_id,
    performed_by, comment
  ) VALUES (
    v_inventory.factory_id, v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id,
    'reserve', -v_physical_quantity, -v_piece_count, p_machine_id,
    p_request_item_table, p_request_item_id, p_reserved_by,
    'Бронирование целых хлыстов для межзаводской перевозки; потребность '
      || p_logical_quantity::text || ' ' || v_inventory.unit
  );

  RETURN v_reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reserve_whole_bar_inventory_row_for_machine_transfer(uuid, uuid, numeric, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_reserve_whole_bar_inventory_row_for_machine_transfer(uuid, uuid, numeric, text, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_reserve_whole_bar_inventory_row_for_machine_transfer(uuid, uuid, numeric, text, uuid, uuid) TO authenticated, service_role;

-- Destination reservations are inserted by the existing transfer receiver. Promote
-- them to whole-bar reservations before insert while the source reservation is locked.
CREATE OR REPLACE FUNCTION public.fn_prepare_transferred_whole_bar_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_reservation public.inventory_reservations%ROWTYPE;
BEGIN
  IF NEW.reservation_source IS DISTINCT FROM 'stock'
    OR NEW.source_inventory_id IS NULL
    OR NEW.inventory_id IS NOT DISTINCT FROM NEW.source_inventory_id THEN
    RETURN NEW;
  END IF;

  SELECT reservation.* INTO v_source_reservation
  FROM public.inventory_reservations AS reservation
  WHERE reservation.inventory_id = NEW.source_inventory_id
    AND reservation.machine_id = NEW.machine_id
    AND reservation.request_item_table = NEW.request_item_table
    AND reservation.request_item_id = NEW.request_item_id
    AND reservation.reservation_source = 'whole_bar_stock'
    AND reservation.consumed_at IS NULL
  ORDER BY reservation.created_at
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN RETURN NEW; END IF;

  NEW.reservation_source := 'whole_bar_stock';
  NEW.logical_reserved_quantity := LEAST(
    NEW.reserved_quantity,
    COALESCE(v_source_reservation.logical_reserved_quantity, v_source_reservation.reserved_quantity)
  );
  NEW.original_piece_length_mm := v_source_reservation.original_piece_length_mm;
  NEW.is_cut_reservation := false;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_finalize_transferred_whole_bar_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.reservation_source = 'whole_bar_stock' THEN
    PERFORM public.fn_prepare_whole_bar_stock_future_scrap(NEW.id, NEW.reserved_by);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_reduce_whole_bar_logical_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.reservation_source = 'whole_bar_stock'
    AND NEW.reserved_quantity < OLD.reserved_quantity THEN
    NEW.logical_reserved_quantity := GREATEST(
      COALESCE(OLD.logical_reserved_quantity, OLD.reserved_quantity)
        - (OLD.reserved_quantity - NEW.reserved_quantity),
      0.000001
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_track_whole_bar_transfer_logical_quantity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.logical_requested_quantity IS NOT NULL THEN
    NEW.logical_received_quantity := LEAST(
      NEW.logical_requested_quantity,
      NEW.received_quantity
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prepare_transferred_whole_bar_reservation ON public.inventory_reservations;
CREATE TRIGGER trg_prepare_transferred_whole_bar_reservation
BEFORE INSERT ON public.inventory_reservations
FOR EACH ROW EXECUTE FUNCTION public.fn_prepare_transferred_whole_bar_reservation();

DROP TRIGGER IF EXISTS trg_finalize_transferred_whole_bar_reservation ON public.inventory_reservations;
CREATE TRIGGER trg_finalize_transferred_whole_bar_reservation
AFTER INSERT ON public.inventory_reservations
FOR EACH ROW EXECUTE FUNCTION public.fn_finalize_transferred_whole_bar_reservation();

DROP TRIGGER IF EXISTS trg_reduce_whole_bar_logical_reservation ON public.inventory_reservations;
CREATE TRIGGER trg_reduce_whole_bar_logical_reservation
BEFORE UPDATE OF reserved_quantity ON public.inventory_reservations
FOR EACH ROW EXECUTE FUNCTION public.fn_reduce_whole_bar_logical_reservation();

DROP TRIGGER IF EXISTS trg_track_whole_bar_transfer_logical_quantity ON public.inventory_transfer_items;
CREATE TRIGGER trg_track_whole_bar_transfer_logical_quantity
BEFORE UPDATE OF received_quantity ON public.inventory_transfer_items
FOR EACH ROW EXECUTE FUNCTION public.fn_track_whole_bar_transfer_logical_quantity();

DO $$
DECLARE
  v_definition text;
  v_anchor text := '    v_remaining := GREATEST(v_item.requested_quantity - v_item.received_quantity, 0);';
  v_status_anchor text := '    AND status IN (''needs_date'', ''scheduled'', ''partially_received'')';
  v_status_replacement text := $status$
    AND (
      status IN ('needs_date', 'scheduled', 'partially_received')
      OR (
        status = 'completed'
        AND EXISTS (
          SELECT 1
          FROM public.inventory_transfer_items AS completed_item
          WHERE completed_item.transfer_id = p_transfer_id
            AND completed_item.logical_requested_quantity IS NOT NULL
        )
      )
    )
$status$;
  v_replacement text := $replacement$
    v_remaining := GREATEST(v_item.requested_quantity - v_item.received_quantity, 0);
    IF v_item.logical_requested_quantity IS NOT NULL THEN
      IF v_remaining <= 0 THEN
        v_processed := v_processed + v_actual;
        CONTINUE;
      END IF;
      v_actual := LEAST(v_actual, v_remaining);
    END IF;
$replacement$;
BEGIN
  IF to_regprocedure('public.fn_receive_inventory_transfer(uuid,jsonb,uuid)') IS NOT NULL THEN
    SELECT pg_get_functiondef('public.fn_receive_inventory_transfer(uuid,jsonb,uuid)'::regprocedure)
    INTO v_definition;
    IF position(v_anchor IN v_definition) = 0 OR position(v_status_anchor IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Unexpected fn_receive_inventory_transfer definition';
    END IF;
    v_definition := replace(v_definition, v_anchor, v_replacement);
    v_definition := replace(v_definition, v_status_anchor, v_status_replacement);
    EXECUTE v_definition;
  END IF;
END;
$$;

-- Keep the existing unreserve implementation intact and wrap only the new source.
ALTER FUNCTION public.fn_unreserve_inventory_reservation(uuid, uuid, text)
  RENAME TO fn_unreserve_inventory_reservation_before_whole_bar;

CREATE OR REPLACE FUNCTION public.fn_unreserve_inventory_reservation(
  p_reservation_id uuid,
  p_performed_by uuid,
  p_comment text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation public.inventory_reservations%ROWTYPE;
  v_scrap public.inventory%ROWTYPE;
BEGIN
  SELECT * INTO v_reservation
  FROM public.inventory_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;

  IF v_reservation.reservation_source = 'whole_bar_stock'
    AND v_reservation.business_scrap_inventory_id IS NOT NULL THEN
    SELECT * INTO v_scrap
    FROM public.inventory
    WHERE id = v_reservation.business_scrap_inventory_id
    FOR UPDATE;

    IF FOUND AND (
      v_scrap.business_scrap_state IS DISTINCT FROM 'future'
      OR COALESCE(v_scrap.reserved_quantity, 0) > 0
      OR v_scrap.deleted_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Нельзя снять бронь: будущий остаток хлыста уже изменён';
    END IF;

    IF FOUND THEN
      UPDATE public.inventory
      SET total_quantity = 0,
          reserved_quantity = 0,
          total_secondary_quantity = 0,
          reserved_secondary_quantity = 0,
          deleted_at = now(),
          deleted_by = p_performed_by,
          delete_comment = COALESCE(p_comment, 'Снятие брони целых хлыстов'),
          last_updated_by = p_performed_by,
          updated_at = now()
      WHERE id = v_scrap.id;
    END IF;
  END IF;

  PERFORM public.fn_unreserve_inventory_reservation_before_whole_bar(
    p_reservation_id, p_performed_by, p_comment
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_unreserve_inventory_reservation(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_unreserve_inventory_reservation(uuid, uuid, text) TO authenticated, service_role;

-- Adapt the current functions in place so later fixes remain preserved.
DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.fn_set_request_reserved_quantity(text,uuid,numeric,numeric)'::regprocedure)
  INTO v_definition;
  IF position('SUM(reserved_quantity)' IN v_definition) = 0
    OR position('reservation_source = ''stock''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_set_request_reserved_quantity definition';
  END IF;
  v_definition := replace(
    v_definition,
    'SUM(reserved_quantity)',
    'SUM(COALESCE(logical_reserved_quantity, reserved_quantity))'
  );
  v_definition := replace(
    v_definition,
    'reservation_source = ''stock''',
    'reservation_source IN (''stock'', ''whole_bar_stock'')'
  );
  EXECUTE v_definition;
END;
$$;

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.fn_prepare_supply_bar_future_scrap(uuid,uuid)'::regprocedure)
  INTO v_definition;
  IF position('request_knives'', ''request_circle' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_prepare_supply_bar_future_scrap definition';
  END IF;
  v_definition := replace(
    v_definition,
    '''request_knives'', ''request_circle''',
    '''request_knives'', ''request_circle'', ''request_pipe'''
  );
  v_definition := replace(v_definition, 'v_scrap_quantity <= 0.000001', 'v_scrap_quantity <= 0');
  v_definition := replace(
    v_definition,
    'v_scrap_quantity >= v_reservation.original_piece_length_mm - 0.000001',
    'v_scrap_quantity >= v_reservation.original_piece_length_mm'
  );
  EXECUTE v_definition;
END;
$$;

DROP TRIGGER IF EXISTS trg_prepare_supply_knife_future_scrap ON public.inventory_reservations;
CREATE TRIGGER trg_prepare_supply_knife_future_scrap
AFTER INSERT ON public.inventory_reservations
FOR EACH ROW
WHEN (
  NEW.reservation_source = 'supply_receipt'
  AND NEW.request_item_table IN ('request_knives', 'request_circle', 'request_pipe')
  AND NEW.supply_order_schedule_id IS NOT NULL
)
EXECUTE FUNCTION public.fn_prepare_supply_knife_future_scrap_trigger();

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.fn_receive_supply_order_schedule_v2(uuid,uuid,numeric,jsonb,numeric,numeric)'::regprocedure
  ) INTO v_definition;
  IF position('v_schedule.request_item_table IN (''request_knives'', ''request_circle'')' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_receive_supply_order_schedule_v2 definition';
  END IF;
  v_definition := replace(
    v_definition,
    'v_schedule.request_item_table IN (''request_knives'', ''request_circle'')',
    '(v_schedule.request_item_table IN (''request_knives'', ''request_circle'') OR '
      || '(v_schedule.request_item_table = ''request_pipe'' AND COALESCE(v_source_item->>''pipe_type'', '''') <> ''wire''))'
  );
  v_definition := replace(v_definition, 'Для ножей и круга укажите', 'Для ножей, круга и трубы укажите');
  v_definition := replace(v_definition, 'только для ножей и круга', 'только для ножей, круга и трубы');
  EXECUTE v_definition;
END;
$$;

DO $$
DECLARE
  v_definition text;
  v_fact_anchor text := '  PERFORM public.fn_reserve_delivered_supply_for_cutting(v_fact.machine_id, p_performed_by);';
  v_fact_replacement text := $replacement$
  PERFORM public.fn_reserve_delivered_supply_for_cutting(v_fact.machine_id, p_performed_by);

  IF EXISTS (
    SELECT 1
    FROM public.inventory_reservations AS pending_reservation
    JOIN public.inventory_transfer_items AS pending_item
      ON pending_item.id = pending_reservation.inventory_transfer_item_id
    WHERE pending_reservation.machine_id = v_fact.machine_id
      AND pending_reservation.consumed_at IS NULL
      AND pending_item.received_quantity < pending_item.requested_quantity
  ) THEN
    RAISE EXCEPTION 'Факт Заготовки заблокирован до полной приёмки межзаводской перевозки';
  END IF;
$replacement$;
BEGIN
  SELECT pg_get_functiondef('public.fn_apply_production_fact_cutting(uuid,uuid)'::regprocedure)
  INTO v_definition;
  IF position('reservation.reservation_source = ''supply_receipt''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_apply_production_fact_cutting definition';
  END IF;
  IF position(v_fact_anchor IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Missing transfer guard anchor in fn_apply_production_fact_cutting';
  END IF;
  v_definition := replace(
    v_definition,
    'reservation.reservation_source = ''supply_receipt''',
    'reservation.reservation_source IN (''supply_receipt'', ''whole_bar_stock'')'
  );
  v_definition := replace(
    v_definition,
    '''request_knives'', ''request_circle''',
    '''request_knives'', ''request_circle'', ''request_pipe'''
  );
  v_definition := replace(
    v_definition,
    'reservation.reserved_quantity - reservation.business_scrap_quantity',
    'COALESCE(reservation.logical_reserved_quantity, reservation.reserved_quantity - reservation.business_scrap_quantity)'
  );
  v_definition := replace(v_definition, v_fact_anchor, v_fact_replacement);
  EXECUTE v_definition;
END;
$$;

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
      AND source_reservation.reservation_source IN ('supply_receipt', 'whole_bar_stock')
      AND source_reservation.request_item_table IN ('request_knives', 'request_circle', 'request_pipe')
  ) THEN
    RAISE EXCEPTION 'Будущий остаток принятого хлыста станет доступен только после факта Заготовки';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_block_supply_bar_future_scrap_reservation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_block_supply_bar_future_scrap_reservation() FROM anon, authenticated;

DO $$
DECLARE
  v_definition text;
  v_anchor text := E'BEGIN\n  v_inventory_id := public.fn_upsert_inventory_stock(';
  v_replacement text := $replacement$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.materials AS material
    WHERE material.id = p_material_id
      AND material.category IN ('circle'::public.material_category, 'pipe'::public.material_category)
      AND NOT EXISTS (
        SELECT 1
        FROM public.material_variants AS exact_variant
        WHERE exact_variant.id = p_material_variant_id
          AND exact_variant.material_id = p_material_id
          AND exact_variant.category = material.category
      )
  ) THEN
    RAISE EXCEPTION 'Для нового прихода круга и трубы нужна точная характеристика материала';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.materials AS material
    LEFT JOIN public.material_variants AS variant ON variant.id = p_material_variant_id
    WHERE material.id = p_material_id
      AND (
        material.category = 'circle'::public.material_category
        OR (
          material.category = 'pipe'::public.material_category
          AND variant.pipe_type IS DISTINCT FROM 'wire'::public.pipe_subtype
        )
      )
  ) THEN
    IF COALESCE(p_piece_length_mm, 0) <= 0
      OR COALESCE(p_secondary_quantity, 0) <= 0
      OR p_secondary_quantity <> trunc(p_secondary_quantity)
      OR p_quantity IS DISTINCT FROM p_piece_length_mm * p_secondary_quantity THEN
      RAISE EXCEPTION 'Для круга и непроволочной трубы приход задаётся длиной хлыста и целым количеством штук';
    END IF;
  END IF;

  v_inventory_id := public.fn_upsert_inventory_stock(
$replacement$;
BEGIN
  SELECT pg_get_functiondef(
    'public.fn_add_inventory_receipt(uuid,numeric,text,uuid,text,numeric,text,uuid,uuid,numeric,uuid)'::regprocedure
  ) INTO v_definition;
  IF position(v_anchor IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_add_inventory_receipt definition';
  END IF;
  v_definition := replace(v_definition, v_anchor, v_replacement);
  EXECUTE v_definition;
END;
$$;

NOTIFY pgrst, 'reload schema';
