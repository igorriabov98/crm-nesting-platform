-- Split CRM inventory by factory while preserving the existing stock lifecycle.

BEGIN;

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS factory_id uuid REFERENCES public.factories(id);

DO $$
DECLARE
  v_beregovo_id uuid;
BEGIN
  SELECT id INTO v_beregovo_id
  FROM public.factories
  WHERE name = 'Берегово'
  LIMIT 1;

  IF v_beregovo_id IS NULL THEN
    RAISE EXCEPTION 'Factory "Берегово" not found';
  END IF;

  UPDATE public.inventory
  SET factory_id = v_beregovo_id
  WHERE factory_id IS NULL;
END $$;

ALTER TABLE public.inventory
  ALTER COLUMN factory_id SET NOT NULL;

ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS factory_id uuid REFERENCES public.factories(id);

UPDATE public.inventory_transactions t
SET factory_id = i.factory_id
FROM public.inventory i
WHERE t.inventory_id = i.id
  AND t.factory_id IS NULL;

DROP INDEX IF EXISTS public.idx_inventory_material_legacy;
DROP INDEX IF EXISTS public.idx_inventory_material_variant;
DROP INDEX IF EXISTS public.idx_inventory_material_variant_no_piece;
DROP INDEX IF EXISTS public.idx_inventory_material_variant_piece;

CREATE UNIQUE INDEX idx_inventory_material_legacy
  ON public.inventory(factory_id, material_id)
  WHERE material_variant_id IS NULL
    AND is_business_scrap = false;

CREATE UNIQUE INDEX idx_inventory_material_variant_no_piece
  ON public.inventory(factory_id, material_id, material_variant_id)
  WHERE material_variant_id IS NOT NULL
    AND piece_length_mm IS NULL
    AND is_business_scrap = false;

CREATE UNIQUE INDEX idx_inventory_material_variant_piece
  ON public.inventory(factory_id, material_id, material_variant_id, piece_length_mm)
  WHERE material_variant_id IS NOT NULL
    AND piece_length_mm IS NOT NULL
    AND is_business_scrap = false;

CREATE INDEX IF NOT EXISTS idx_inventory_factory_updated
  ON public.inventory(factory_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_factory_created
  ON public.inventory_transactions(factory_id, created_at DESC);

DROP FUNCTION IF EXISTS public.fn_upsert_inventory_stock(
  uuid, uuid, numeric, numeric, text, numeric, text, uuid, boolean, uuid, uuid, uuid, numeric
);

CREATE OR REPLACE FUNCTION public.fn_upsert_inventory_stock(
  p_material_id uuid,
  p_material_variant_id uuid,
  p_piece_length_mm numeric,
  p_quantity numeric,
  p_unit text,
  p_secondary_quantity numeric,
  p_secondary_unit text,
  p_performed_by uuid,
  p_is_business_scrap boolean DEFAULT false,
  p_source_inventory_id uuid DEFAULT NULL,
  p_source_reservation_id uuid DEFAULT NULL,
  p_source_machine_id uuid DEFAULT NULL,
  p_source_piece_length_mm numeric DEFAULT NULL,
  p_factory_id uuid DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_inventory_id uuid;
  v_factory_id uuid;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количество должно быть больше 0';
  END IF;

  v_factory_id := p_factory_id;

  IF v_factory_id IS NULL AND p_source_inventory_id IS NOT NULL THEN
    SELECT factory_id INTO v_factory_id
    FROM public.inventory
    WHERE id = p_source_inventory_id;
  END IF;

  IF v_factory_id IS NULL AND p_source_machine_id IS NOT NULL THEN
    SELECT factory_id INTO v_factory_id
    FROM public.machines
    WHERE id = p_source_machine_id;
  END IF;

  IF v_factory_id IS NULL THEN
    RAISE EXCEPTION 'Для складского остатка не определен завод';
  END IF;

  IF p_is_business_scrap THEN
    INSERT INTO public.inventory (
      factory_id, material_id, material_variant_id, piece_length_mm, total_quantity, reserved_quantity, unit,
      total_secondary_quantity, reserved_secondary_quantity, secondary_unit, last_updated_by,
      is_business_scrap, source_inventory_id, source_reservation_id, source_machine_id, source_piece_length_mm
    )
    VALUES (
      v_factory_id, p_material_id, p_material_variant_id, p_piece_length_mm, p_quantity, 0, p_unit,
      p_secondary_quantity, CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE 0 END, p_secondary_unit, p_performed_by,
      true, p_source_inventory_id, p_source_reservation_id, p_source_machine_id, p_source_piece_length_mm
    )
    RETURNING id INTO v_inventory_id;

    RETURN v_inventory_id;
  END IF;

  IF p_material_variant_id IS NULL THEN
    INSERT INTO public.inventory (
      factory_id, material_id, material_variant_id, piece_length_mm, total_quantity, reserved_quantity, unit,
      total_secondary_quantity, reserved_secondary_quantity, secondary_unit, last_updated_by,
      is_business_scrap, source_inventory_id, source_reservation_id, source_machine_id, source_piece_length_mm
    )
    VALUES (
      v_factory_id, p_material_id, NULL, NULL, p_quantity, 0, p_unit,
      p_secondary_quantity, CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE 0 END, p_secondary_unit, p_performed_by,
      p_is_business_scrap, p_source_inventory_id, p_source_reservation_id, p_source_machine_id, p_source_piece_length_mm
    )
    ON CONFLICT (factory_id, material_id) WHERE material_variant_id IS NULL AND is_business_scrap = false DO UPDATE SET
      total_quantity = CASE WHEN inventory.deleted_at IS NULL THEN inventory.total_quantity + EXCLUDED.total_quantity ELSE EXCLUDED.total_quantity END,
      total_secondary_quantity = CASE
        WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.total_secondary_quantity
        WHEN inventory.deleted_at IS NULL THEN COALESCE(inventory.total_secondary_quantity, 0) + EXCLUDED.total_secondary_quantity
        ELSE EXCLUDED.total_secondary_quantity
      END,
      reserved_quantity = CASE WHEN inventory.deleted_at IS NULL THEN inventory.reserved_quantity ELSE 0 END,
      reserved_secondary_quantity = CASE
        WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.reserved_secondary_quantity
        WHEN inventory.deleted_at IS NULL THEN COALESCE(inventory.reserved_secondary_quantity, 0)
        ELSE 0
      END,
      secondary_unit = COALESCE(inventory.secondary_unit, EXCLUDED.secondary_unit),
      source_inventory_id = COALESCE(inventory.source_inventory_id, EXCLUDED.source_inventory_id),
      source_reservation_id = COALESCE(inventory.source_reservation_id, EXCLUDED.source_reservation_id),
      source_machine_id = COALESCE(inventory.source_machine_id, EXCLUDED.source_machine_id),
      source_piece_length_mm = COALESCE(inventory.source_piece_length_mm, EXCLUDED.source_piece_length_mm),
      deleted_at = NULL,
      deleted_by = NULL,
      delete_comment = NULL,
      last_updated_by = p_performed_by,
      updated_at = now()
    RETURNING id INTO v_inventory_id;
  ELSIF p_piece_length_mm IS NULL THEN
    INSERT INTO public.inventory (
      factory_id, material_id, material_variant_id, piece_length_mm, total_quantity, reserved_quantity, unit,
      total_secondary_quantity, reserved_secondary_quantity, secondary_unit, last_updated_by,
      is_business_scrap, source_inventory_id, source_reservation_id, source_machine_id, source_piece_length_mm
    )
    VALUES (
      v_factory_id, p_material_id, p_material_variant_id, NULL, p_quantity, 0, p_unit,
      p_secondary_quantity, CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE 0 END, p_secondary_unit, p_performed_by,
      p_is_business_scrap, p_source_inventory_id, p_source_reservation_id, p_source_machine_id, p_source_piece_length_mm
    )
    ON CONFLICT (factory_id, material_id, material_variant_id) WHERE material_variant_id IS NOT NULL AND piece_length_mm IS NULL AND is_business_scrap = false DO UPDATE SET
      total_quantity = CASE WHEN inventory.deleted_at IS NULL THEN inventory.total_quantity + EXCLUDED.total_quantity ELSE EXCLUDED.total_quantity END,
      total_secondary_quantity = CASE
        WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.total_secondary_quantity
        WHEN inventory.deleted_at IS NULL THEN COALESCE(inventory.total_secondary_quantity, 0) + EXCLUDED.total_secondary_quantity
        ELSE EXCLUDED.total_secondary_quantity
      END,
      reserved_quantity = CASE WHEN inventory.deleted_at IS NULL THEN inventory.reserved_quantity ELSE 0 END,
      reserved_secondary_quantity = CASE
        WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.reserved_secondary_quantity
        WHEN inventory.deleted_at IS NULL THEN COALESCE(inventory.reserved_secondary_quantity, 0)
        ELSE 0
      END,
      secondary_unit = COALESCE(inventory.secondary_unit, EXCLUDED.secondary_unit),
      source_inventory_id = COALESCE(inventory.source_inventory_id, EXCLUDED.source_inventory_id),
      source_reservation_id = COALESCE(inventory.source_reservation_id, EXCLUDED.source_reservation_id),
      source_machine_id = COALESCE(inventory.source_machine_id, EXCLUDED.source_machine_id),
      source_piece_length_mm = COALESCE(inventory.source_piece_length_mm, EXCLUDED.source_piece_length_mm),
      deleted_at = NULL,
      deleted_by = NULL,
      delete_comment = NULL,
      last_updated_by = p_performed_by,
      updated_at = now()
    RETURNING id INTO v_inventory_id;
  ELSE
    INSERT INTO public.inventory (
      factory_id, material_id, material_variant_id, piece_length_mm, total_quantity, reserved_quantity, unit,
      total_secondary_quantity, reserved_secondary_quantity, secondary_unit, last_updated_by,
      is_business_scrap, source_inventory_id, source_reservation_id, source_machine_id, source_piece_length_mm
    )
    VALUES (
      v_factory_id, p_material_id, p_material_variant_id, p_piece_length_mm, p_quantity, 0, p_unit,
      p_secondary_quantity, CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE 0 END, p_secondary_unit, p_performed_by,
      p_is_business_scrap, p_source_inventory_id, p_source_reservation_id, p_source_machine_id, p_source_piece_length_mm
    )
    ON CONFLICT (factory_id, material_id, material_variant_id, piece_length_mm) WHERE material_variant_id IS NOT NULL AND piece_length_mm IS NOT NULL AND is_business_scrap = false DO UPDATE SET
      total_quantity = CASE WHEN inventory.deleted_at IS NULL THEN inventory.total_quantity + EXCLUDED.total_quantity ELSE EXCLUDED.total_quantity END,
      total_secondary_quantity = CASE
        WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.total_secondary_quantity
        WHEN inventory.deleted_at IS NULL THEN COALESCE(inventory.total_secondary_quantity, 0) + EXCLUDED.total_secondary_quantity
        ELSE EXCLUDED.total_secondary_quantity
      END,
      reserved_quantity = CASE WHEN inventory.deleted_at IS NULL THEN inventory.reserved_quantity ELSE 0 END,
      reserved_secondary_quantity = CASE
        WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.reserved_secondary_quantity
        WHEN inventory.deleted_at IS NULL THEN COALESCE(inventory.reserved_secondary_quantity, 0)
        ELSE 0
      END,
      secondary_unit = COALESCE(inventory.secondary_unit, EXCLUDED.secondary_unit),
      source_inventory_id = COALESCE(inventory.source_inventory_id, EXCLUDED.source_inventory_id),
      source_reservation_id = COALESCE(inventory.source_reservation_id, EXCLUDED.source_reservation_id),
      source_machine_id = COALESCE(inventory.source_machine_id, EXCLUDED.source_machine_id),
      source_piece_length_mm = COALESCE(inventory.source_piece_length_mm, EXCLUDED.source_piece_length_mm),
      deleted_at = NULL,
      deleted_by = NULL,
      delete_comment = NULL,
      last_updated_by = p_performed_by,
      updated_at = now()
    RETURNING id INTO v_inventory_id;
  END IF;

  RETURN v_inventory_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_upsert_inventory_stock(
  p_material_id uuid,
  p_material_variant_id uuid,
  p_piece_length_mm numeric,
  p_quantity numeric,
  p_unit text,
  p_secondary_quantity numeric,
  p_secondary_unit text,
  p_performed_by uuid,
  p_is_business_scrap boolean DEFAULT false,
  p_source_inventory_id uuid DEFAULT NULL,
  p_source_reservation_id uuid DEFAULT NULL,
  p_source_piece_length_mm numeric DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_beregovo_id uuid;
  v_factory_id uuid;
BEGIN
  IF p_source_inventory_id IS NULL THEN
    SELECT id INTO v_beregovo_id
    FROM public.factories
    WHERE name = 'Берегово'
    LIMIT 1;

    IF v_beregovo_id IS NULL THEN
      RAISE EXCEPTION 'Factory "Берегово" not found';
    END IF;

    v_factory_id := v_beregovo_id;
  END IF;

  RETURN public.fn_upsert_inventory_stock(
    p_material_id := p_material_id,
    p_material_variant_id := p_material_variant_id,
    p_piece_length_mm := p_piece_length_mm,
    p_quantity := p_quantity,
    p_unit := p_unit,
    p_secondary_quantity := p_secondary_quantity,
    p_secondary_unit := p_secondary_unit,
    p_performed_by := p_performed_by,
    p_is_business_scrap := p_is_business_scrap,
    p_source_inventory_id := p_source_inventory_id,
    p_source_reservation_id := p_source_reservation_id,
    p_source_machine_id := NULL,
    p_source_piece_length_mm := p_source_piece_length_mm,
    p_factory_id := v_factory_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.fn_add_inventory_receipt(
  uuid, numeric, text, uuid, text, numeric, text, uuid, uuid, numeric
);

CREATE OR REPLACE FUNCTION public.fn_add_inventory_receipt(
  p_material_id uuid,
  p_quantity numeric,
  p_unit text,
  p_performed_by uuid,
  p_comment text DEFAULT NULL,
  p_secondary_quantity numeric DEFAULT NULL,
  p_secondary_unit text DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_material_variant_id uuid DEFAULT NULL,
  p_piece_length_mm numeric DEFAULT NULL,
  p_factory_id uuid DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_inventory_id uuid;
  v_factory_id uuid;
BEGIN
  v_inventory_id := public.fn_upsert_inventory_stock(
    p_material_id,
    p_material_variant_id,
    p_piece_length_mm,
    p_quantity,
    p_unit,
    p_secondary_quantity,
    p_secondary_unit,
    p_performed_by,
    false,
    NULL,
    NULL,
    NULL,
    NULL,
    p_factory_id
  );

  SELECT factory_id INTO v_factory_id
  FROM public.inventory
  WHERE id = v_inventory_id;

  INSERT INTO public.inventory_transactions (
    factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity,
    secondary_quantity, performed_by, comment, supplier_id
  )
  VALUES (
    v_factory_id, v_inventory_id, p_material_id, p_material_variant_id, 'receipt', p_quantity,
    p_secondary_quantity, p_performed_by, p_comment, p_supplier_id
  );

  RETURN v_inventory_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_add_inventory_receipt(
  p_material_id uuid,
  p_quantity numeric,
  p_unit text,
  p_performed_by uuid,
  p_comment text DEFAULT NULL,
  p_secondary_quantity numeric DEFAULT NULL,
  p_secondary_unit text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_beregovo_id uuid;
BEGIN
  SELECT id INTO v_beregovo_id
  FROM public.factories
  WHERE name = 'Берегово'
  LIMIT 1;

  IF v_beregovo_id IS NULL THEN
    RAISE EXCEPTION 'Factory "Берегово" not found';
  END IF;

  RETURN public.fn_add_inventory_receipt(
    p_material_id := p_material_id,
    p_quantity := p_quantity,
    p_unit := p_unit,
    p_performed_by := p_performed_by,
    p_comment := p_comment,
    p_secondary_quantity := p_secondary_quantity,
    p_secondary_unit := p_secondary_unit,
    p_supplier_id := NULL,
    p_material_variant_id := NULL,
    p_piece_length_mm := NULL,
    p_factory_id := v_beregovo_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_add_inventory_receipt(
  p_material_id uuid,
  p_quantity numeric,
  p_unit text,
  p_performed_by uuid,
  p_comment text DEFAULT NULL,
  p_secondary_quantity numeric DEFAULT NULL,
  p_secondary_unit text DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_beregovo_id uuid;
BEGIN
  SELECT id INTO v_beregovo_id
  FROM public.factories
  WHERE name = 'Берегово'
  LIMIT 1;

  IF v_beregovo_id IS NULL THEN
    RAISE EXCEPTION 'Factory "Берегово" not found';
  END IF;

  RETURN public.fn_add_inventory_receipt(
    p_material_id := p_material_id,
    p_quantity := p_quantity,
    p_unit := p_unit,
    p_performed_by := p_performed_by,
    p_comment := p_comment,
    p_secondary_quantity := p_secondary_quantity,
    p_secondary_unit := p_secondary_unit,
    p_supplier_id := p_supplier_id,
    p_material_variant_id := NULL,
    p_piece_length_mm := NULL,
    p_factory_id := v_beregovo_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_adjust_inventory_record(
  p_inventory_id uuid,
  p_new_total numeric,
  p_performed_by uuid,
  p_comment text,
  p_new_secondary_total numeric DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_inventory public.inventory%ROWTYPE;
  v_diff numeric;
  v_secondary_diff numeric;
BEGIN
  IF p_comment IS NULL OR btrim(p_comment) = '' THEN
    RAISE EXCEPTION 'Укажите причину корректировки';
  END IF;

  SELECT * INTO v_inventory FROM public.inventory WHERE id = p_inventory_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Остаток материала не найден';
  END IF;

  IF p_new_total < v_inventory.reserved_quantity THEN
    RAISE EXCEPTION 'Новый остаток меньше забронированного количества';
  END IF;

  IF p_new_secondary_total IS NOT NULL AND p_new_secondary_total < COALESCE(v_inventory.reserved_secondary_quantity, 0) THEN
    RAISE EXCEPTION 'Новый вторичный остаток меньше забронированного количества';
  END IF;

  v_diff := p_new_total - v_inventory.total_quantity;
  v_secondary_diff := CASE
    WHEN p_new_secondary_total IS NULL THEN NULL
    ELSE p_new_secondary_total - COALESCE(v_inventory.total_secondary_quantity, 0)
  END;

  UPDATE public.inventory
  SET total_quantity = p_new_total,
      total_secondary_quantity = COALESCE(p_new_secondary_total, total_secondary_quantity),
      reserved_secondary_quantity = CASE
        WHEN p_new_secondary_total IS NULL THEN reserved_secondary_quantity
        ELSE COALESCE(reserved_secondary_quantity, 0)
      END,
      last_updated_by = p_performed_by,
      updated_at = now()
  WHERE id = p_inventory_id;

  INSERT INTO public.inventory_transactions (
    factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity,
    secondary_quantity, performed_by, comment
  )
  VALUES (
    v_inventory.factory_id, v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id, 'adjustment',
    v_diff, v_secondary_diff, p_performed_by, p_comment
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_archive_inventory_item(
  p_inventory_id uuid,
  p_performed_by uuid,
  p_comment text DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_inventory public.inventory%ROWTYPE;
BEGIN
  SELECT * INTO v_inventory FROM public.inventory WHERE id = p_inventory_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Остаток материала не найден';
  END IF;

  IF v_inventory.deleted_at IS NOT NULL THEN
    RETURN;
  END IF;

  IF COALESCE(v_inventory.reserved_quantity, 0) > 0
     OR COALESCE(v_inventory.reserved_secondary_quantity, 0) > 0 THEN
    RAISE EXCEPTION 'Нельзя удалить материал со склада: есть активная бронь';
  END IF;

  UPDATE public.inventory
  SET total_quantity = 0,
      total_secondary_quantity = CASE WHEN secondary_unit IS NULL THEN NULL ELSE 0 END,
      reserved_quantity = 0,
      reserved_secondary_quantity = CASE WHEN secondary_unit IS NULL THEN NULL ELSE 0 END,
      deleted_at = now(),
      deleted_by = p_performed_by,
      delete_comment = NULLIF(btrim(COALESCE(p_comment, '')), ''),
      last_updated_by = p_performed_by,
      updated_at = now()
  WHERE id = p_inventory_id;

  INSERT INTO public.inventory_transactions (
    factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity,
    secondary_quantity, performed_by, comment
  )
  VALUES (
    v_inventory.factory_id,
    v_inventory.id,
    v_inventory.material_id,
    v_inventory.material_variant_id,
    'write_off',
    -COALESCE(v_inventory.available_quantity, 0),
    CASE
      WHEN v_inventory.secondary_unit IS NULL THEN NULL
      ELSE -COALESCE(v_inventory.available_secondary_quantity, 0)
    END,
    p_performed_by,
    COALESCE(NULLIF(btrim(COALESCE(p_comment, '')), ''), 'Удаление со склада')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_mark_supply_order_delivered(
  p_items jsonb,
  p_performed_by uuid
)
RETURNS void AS $$
DECLARE
  v_item jsonb;
  v_table text;
  v_id uuid;
  v_row record;
  v_material_id uuid;
  v_material_variant_id uuid;
  v_supplier_id uuid;
  v_quantity numeric;
  v_unit text;
  v_secondary_quantity numeric;
  v_secondary_unit text;
  v_piece_length_mm numeric;
  v_comment text;
  v_factory_id uuid;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Выберите позиции';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_table := v_item->>'table';
    v_id := NULLIF(v_item->>'id', '')::uuid;

    IF v_table NOT IN (
      'request_sheet_metal',
      'request_round_tube',
      'request_circle',
      'request_pipe',
      'request_knives',
      'request_components',
      'request_paint',
      'request_mesh',
      'request_chain_cord'
    ) THEN
      RAISE EXCEPTION 'Некорректная таблица позиции';
    END IF;

    EXECUTE format('SELECT * FROM %I WHERE id = $1 FOR UPDATE', v_table)
      INTO v_row
      USING v_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Позиция закупки не найдена';
    END IF;

    IF v_row.order_status <> 'ordered' THEN
      RAISE EXCEPTION 'Позицию можно принять только после отметки "Заказано"';
    END IF;

    SELECT m.factory_id INTO v_factory_id
    FROM public.technologist_requests tr
    JOIN public.machines m ON m.id = tr.machine_id
    WHERE tr.id = v_row.request_id
    LIMIT 1;

    IF v_factory_id IS NULL THEN
      RAISE EXCEPTION 'Для приемки не определен завод машины';
    END IF;

    v_material_id := COALESCE(NULLIF(v_item->>'material_id', '')::uuid, v_row.material_id);
    v_material_variant_id := COALESCE(NULLIF(v_item->>'material_variant_id', '')::uuid, v_row.material_variant_id);
    v_supplier_id := COALESCE(NULLIF(v_item->>'supplier_id', '')::uuid, v_row.supplier_id);
    v_quantity := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
    v_unit := COALESCE(NULLIF(v_item->>'unit', ''), 'кг');
    v_secondary_quantity := NULLIF(v_item->>'secondary_quantity', '')::numeric;
    v_secondary_unit := NULLIF(v_item->>'secondary_unit', '');
    v_piece_length_mm := NULLIF(v_item->>'piece_length_mm', '')::numeric;
    v_comment := NULLIF(v_item->>'comment', '');

    IF v_material_id IS NULL THEN
      RAISE EXCEPTION 'Позиция не привязана к материалу';
    END IF;

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Позиция полностью закрыта складом и не требует закупки';
    END IF;

    IF v_supplier_id IS NULL THEN
      RAISE EXCEPTION 'Назначьте поставщика для позиции';
    END IF;

    IF v_table = 'request_pipe' THEN
      IF v_row.pipe_type <> 'wire' THEN
        IF v_piece_length_mm IS NULL OR v_piece_length_mm <= 0 THEN
          RAISE EXCEPTION 'Для трубы не удалось определить длину складской позиции';
        END IF;
        IF v_secondary_quantity IS NULL OR v_secondary_quantity <= 0 THEN
          RAISE EXCEPTION 'Для трубы укажите количество штук';
        END IF;
      END IF;
    END IF;

    IF v_table = 'request_knives' AND (v_piece_length_mm IS NULL OR v_piece_length_mm <= 0) THEN
      RAISE EXCEPTION 'Для ножа не указана длина складской позиции';
    END IF;

    PERFORM public.fn_add_inventory_receipt(
      v_material_id,
      v_quantity,
      v_unit,
      p_performed_by,
      COALESCE(v_comment, 'Приход по листу закупки'),
      v_secondary_quantity,
      v_secondary_unit,
      v_supplier_id,
      v_material_variant_id,
      v_piece_length_mm,
      v_factory_id
    );

    EXECUTE format('UPDATE %I SET order_status = $1, delivered_at = now(), supplier_id = $2 WHERE id = $3', v_table)
      USING 'delivered'::order_item_status, v_supplier_id, v_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.fn_receive_supply_order_schedule(uuid, uuid, numeric);
DROP FUNCTION IF EXISTS public.fn_receive_supply_order_schedule(uuid, uuid);

CREATE OR REPLACE FUNCTION public.fn_receive_supply_order_schedule(
  p_schedule_id uuid,
  p_performed_by uuid,
  p_received_quantity numeric
)
RETURNS void AS $$
DECLARE
  v_schedule public.supply_order_delivery_schedules%ROWTYPE;
  v_item record;
  v_material_id uuid;
  v_material_variant_id uuid;
  v_supplier_id uuid;
  v_piece_length_mm numeric;
  v_secondary_quantity numeric;
  v_secondary_unit text;
  v_required numeric;
  v_delivered_total numeric;
  v_received_quantity numeric;
  v_machine_id uuid;
  v_machine_name text;
  v_factory_id uuid;
  v_item_name text;
  v_title text;
  v_description text;
  v_source_key text;
  v_today date;
  v_has_procurement_head boolean;
BEGIN
  v_received_quantity := COALESCE(p_received_quantity, 0);
  IF v_received_quantity <= 0 THEN
    RAISE EXCEPTION 'Фактическое количество прихода должно быть больше 0';
  END IF;

  SELECT * INTO v_schedule
  FROM public.supply_order_delivery_schedules
  WHERE id = p_schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Дата поставки не найдена';
  END IF;

  IF v_schedule.status = 'delivered' THEN
    RAISE EXCEPTION 'Поставка уже принята';
  END IF;

  IF v_schedule.quantity <= 0 THEN
    RAISE EXCEPTION 'Количество поставки должно быть больше 0';
  END IF;

  EXECUTE format('SELECT * FROM %I WHERE id = $1 FOR UPDATE', v_schedule.request_item_table)
    INTO v_item
    USING v_schedule.request_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Позиция закупки не найдена';
  END IF;

  IF v_item.order_status <> 'ordered' THEN
    RAISE EXCEPTION 'Поставку можно принять только после отметки позиции "Заказано"';
  END IF;

  v_material_id := v_item.material_id;
  v_material_variant_id := v_item.material_variant_id;
  v_supplier_id := COALESCE(v_schedule.supplier_id, v_item.supplier_id);

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'Позиция не привязана к материалу';
  END IF;

  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Назначьте поставщика для поставки';
  END IF;

  v_required := CASE v_schedule.request_item_table
    WHEN 'request_sheet_metal' THEN COALESCE(v_item.remainder_qty, v_item.to_order_kg, 0)
    WHEN 'request_round_tube' THEN COALESCE(v_item.order_kg, 0)
    WHEN 'request_circle' THEN COALESCE(v_item.remainder_mm, 0) - COALESCE(v_item.reserved_from_stock_mm, 0)
    WHEN 'request_pipe' THEN CASE
      WHEN v_item.pipe_type = 'wire' THEN COALESCE(v_item.remainder_kg, 0) - COALESCE(v_item.reserved_from_stock_kg, 0)
      ELSE COALESCE(v_item.remainder_length_mm, 0) - COALESCE(v_item.reserved_from_stock_length_mm, 0)
    END
    WHEN 'request_knives' THEN CASE
      WHEN COALESCE(v_item.remainder_meters, 0) > 0 THEN COALESCE(v_item.remainder_meters, 0) * 1000
      ELSE COALESCE(v_item.to_order_mm, 0)
    END - COALESCE(v_item.reserved_from_stock_mm, 0)
    WHEN 'request_components' THEN COALESCE(v_item.quantity_needed, 0) - COALESCE(v_item.stock_remainder, 0) - COALESCE(v_item.reserved_from_stock, 0)
    WHEN 'request_paint' THEN COALESCE(v_item.remainder_kg, v_item.to_order_kg, 0) - COALESCE(v_item.reserved_from_stock_kg, 0)
    WHEN 'request_mesh' THEN COALESCE(v_item.remainder_qty, 0) - COALESCE(v_item.reserved_from_stock_qty, 0)
    WHEN 'request_chain_cord' THEN (COALESCE(v_item.remainder_meters, 0) - COALESCE(v_item.reserved_from_stock_meters, 0)) * 1000
    ELSE 0
  END;
  v_required := GREATEST(COALESCE(v_required, 0), 0);

  IF v_schedule.request_item_table = 'request_knives' THEN
    v_piece_length_mm := v_item.length_mm;
    IF v_piece_length_mm IS NULL OR v_piece_length_mm <= 0 THEN
      RAISE EXCEPTION 'Для ножа не указана длина складской позиции';
    END IF;
    v_secondary_quantity := v_received_quantity / v_piece_length_mm;
    v_secondary_unit := 'шт';
  ELSE
    v_piece_length_mm := NULL;
    v_secondary_quantity := NULL;
    v_secondary_unit := NULL;
  END IF;

  SELECT tr.machine_id, m.name, m.factory_id
  INTO v_machine_id, v_machine_name, v_factory_id
  FROM public.technologist_requests tr
  LEFT JOIN public.machines m ON m.id = tr.machine_id
  WHERE tr.id = v_item.request_id
  LIMIT 1;

  IF v_factory_id IS NULL THEN
    RAISE EXCEPTION 'Для приемки не определен завод машины';
  END IF;

  PERFORM public.fn_add_inventory_receipt(
    v_material_id,
    v_received_quantity,
    v_schedule.unit,
    p_performed_by,
    'Приход по графику поставки: ' || v_schedule.delivery_date::text || '. План: ' || v_schedule.quantity::text || ', факт: ' || v_received_quantity::text,
    v_secondary_quantity,
    v_secondary_unit,
    v_supplier_id,
    v_material_variant_id,
    v_piece_length_mm,
    v_factory_id
  );

  UPDATE public.supply_order_delivery_schedules
  SET status = 'delivered',
      received_quantity = v_received_quantity,
      delivered_at = now(),
      received_by = p_performed_by,
      updated_by = p_performed_by,
      updated_at = now()
  WHERE id = p_schedule_id;

  SELECT COALESCE(sum(received_quantity), 0)
  INTO v_delivered_total
  FROM public.supply_order_delivery_schedules
  WHERE request_item_table = v_schedule.request_item_table
    AND request_item_id = v_schedule.request_item_id
    AND status = 'delivered';

  IF v_delivered_total >= v_required THEN
    EXECUTE format('UPDATE %I SET order_status = $1, delivered_at = now(), supplier_id = COALESCE(supplier_id, $2) WHERE id = $3', v_schedule.request_item_table)
      USING 'delivered'::order_item_status, v_supplier_id, v_schedule.request_item_id;
  END IF;

  v_item_name := CASE v_schedule.request_item_table
    WHEN 'request_sheet_metal' THEN COALESCE(v_item.material_name, 'Листовой металл')
    WHEN 'request_round_tube' THEN COALESCE(v_item.material_name, 'Круг / Труба')
    WHEN 'request_circle' THEN COALESCE(v_item.steel_grade, 'Круг')
    WHEN 'request_pipe' THEN COALESCE(v_item.size, 'Труба')
    WHEN 'request_knives' THEN COALESCE(v_item.knife_type, 'Ножи')
    WHEN 'request_components' THEN COALESCE(v_item.component_name, 'Комплектация')
    WHEN 'request_paint' THEN COALESCE(v_item.paint_type, v_item.ral_code, 'Краска')
    WHEN 'request_mesh' THEN COALESCE(v_item.description, 'Сетка')
    WHEN 'request_chain_cord' THEN COALESCE(v_item.parameters, 'Цепь / Шнур')
    ELSE 'Материал'
  END;

  IF v_received_quantity < v_schedule.quantity OR v_received_quantity >= v_schedule.quantity * 1.3 THEN
    v_source_key := 'material_receipt_variance:' || p_schedule_id::text;
    v_title := CASE
      WHEN v_received_quantity < v_schedule.quantity THEN 'Недовес при приемке материала'
      ELSE 'Перепоставка материала +30%'
    END;
    v_description := concat(
      v_item_name,
      CASE WHEN v_machine_name IS NOT NULL THEN ' для машины ' || v_machine_name ELSE '' END,
      '. Дата снабжения: ', to_char(v_schedule.delivery_date, 'DD.MM.YYYY'),
      '. План: ', v_schedule.quantity::text, ' ', v_schedule.unit,
      '. Факт: ', v_received_quantity::text, ' ', v_schedule.unit,
      '. Нужно проверить заявку снабжения и решение по остатку/излишку.'
    );

    INSERT INTO public.meeting_agenda_pool_items (
      source_key,
      source_type,
      machine_id,
      title,
      description,
      status,
      updated_at
    )
    VALUES (
      v_source_key,
      'material_receipt_variance',
      v_machine_id,
      v_title,
      v_description,
      'new',
      now()
    )
    ON CONFLICT (source_key) DO UPDATE
    SET title = EXCLUDED.title,
        description = EXCLUDED.description,
        machine_id = EXCLUDED.machine_id,
        updated_at = now()
    WHERE meeting_agenda_pool_items.status = 'new';

    INSERT INTO public.notifications (user_id, type, title, message, related_machine_id)
    SELECT id, 'material_receipt_variance', v_title, v_description, v_machine_id
    FROM public.users
    WHERE role = 'planning_director'
      AND is_active = true;
  END IF;

  IF v_received_quantity < v_schedule.quantity THEN
    v_today := (now() AT TIME ZONE 'Europe/Chisinau')::date;

    SELECT EXISTS (
      SELECT 1 FROM public.users WHERE role = 'procurement_head' AND is_active = true
    )
    INTO v_has_procurement_head;

    INSERT INTO public.tasks (
      machine_id,
      supply_order_schedule_id,
      assigned_to,
      task_type,
      title,
      description,
      status,
      start_date,
      deadline
    )
    SELECT
      v_machine_id,
      p_schedule_id,
      u.id,
      'supply_material_receipt_shortage'::task_type,
      'Разобрать недовес по поставке',
      v_description,
      'pending',
      v_today,
      v_today
    FROM public.users u
    WHERE u.is_active = true
      AND (
        (v_has_procurement_head AND u.role = 'procurement_head')
        OR (NOT v_has_procurement_head AND u.role = 'supply_manager')
      )
    ON CONFLICT (supply_order_schedule_id, assigned_to, task_type)
      WHERE supply_order_schedule_id IS NOT NULL
        AND status IN ('pending', 'in_progress')
    DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_receive_supply_order_schedule(
  p_schedule_id uuid,
  p_performed_by uuid
) RETURNS void AS $$
DECLARE
  v_planned_quantity numeric;
BEGIN
  SELECT quantity
  INTO v_planned_quantity
  FROM public.supply_order_delivery_schedules
  WHERE id = p_schedule_id;

  IF v_planned_quantity IS NULL THEN
    RAISE EXCEPTION 'График поставки не найден';
  END IF;

  PERFORM public.fn_receive_supply_order_schedule(
    p_schedule_id,
    p_performed_by,
    v_planned_quantity
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_reserve_inventory_for_machine(
  p_material_id uuid,
  p_machine_id uuid,
  p_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid,
  p_secondary_quantity numeric DEFAULT NULL,
  p_material_variant_id uuid DEFAULT NULL,
  p_piece_length_mm numeric DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_inventory public.inventory%ROWTYPE;
  v_reservation_id uuid;
  v_last_reservation_id uuid;
  v_remaining numeric := p_quantity;
  v_available_pieces numeric;
  v_full_pieces numeric;
  v_full_quantity numeric;
  v_cut_quantity numeric;
  v_scrap_quantity numeric;
  v_scrap_inventory_id uuid;
  v_possible numeric;
  v_is_cut_table boolean := p_request_item_table IN ('request_pipe', 'request_knives') AND p_piece_length_mm IS NOT NULL;
  v_machine_factory_id uuid;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количество бронирования должно быть больше 0';
  END IF;

  SELECT factory_id INTO v_machine_factory_id
  FROM public.machines
  WHERE id = p_machine_id;

  IF v_machine_factory_id IS NULL THEN
    RAISE EXCEPTION 'Для бронирования не определен завод машины';
  END IF;

  IF v_is_cut_table THEN
    SELECT COALESCE(SUM(FLOOR(COALESCE(available_secondary_quantity, 0)) * piece_length_mm), 0)
    INTO v_possible
    FROM public.inventory
    WHERE factory_id = v_machine_factory_id
      AND material_id = p_material_id
      AND (p_material_variant_id IS NULL OR material_variant_id = p_material_variant_id)
      AND piece_length_mm IS NOT NULL
      AND piece_length_mm > 0
      AND COALESCE(available_secondary_quantity, 0) > 0
      AND deleted_at IS NULL;

    IF v_possible < p_quantity THEN
      RAISE EXCEPTION 'Недостаточно на складе выбранного завода. Доступно: % мм', v_possible;
    END IF;

    FOR v_inventory IN
      SELECT *
      FROM public.inventory
      WHERE factory_id = v_machine_factory_id
        AND material_id = p_material_id
        AND (p_material_variant_id IS NULL OR material_variant_id = p_material_variant_id)
        AND piece_length_mm IS NOT NULL
        AND piece_length_mm > 0
        AND COALESCE(available_secondary_quantity, 0) > 0
        AND deleted_at IS NULL
      ORDER BY
        CASE WHEN is_business_scrap THEN 0 ELSE 1 END,
        CASE WHEN NOT is_business_scrap AND p_piece_length_mm IS NOT NULL AND piece_length_mm = p_piece_length_mm THEN 0 ELSE 1 END,
        piece_length_mm ASC,
        updated_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_available_pieces := FLOOR(COALESCE(v_inventory.available_secondary_quantity, 0));
      IF v_available_pieces <= 0 THEN
        CONTINUE;
      END IF;

      v_full_pieces := LEAST(FLOOR(v_remaining / v_inventory.piece_length_mm), v_available_pieces);
      IF v_full_pieces > 0 THEN
        v_full_quantity := v_full_pieces * v_inventory.piece_length_mm;

        UPDATE public.inventory
        SET total_quantity = total_quantity - v_full_quantity,
            total_secondary_quantity = COALESCE(total_secondary_quantity, 0) - v_full_pieces,
            last_updated_by = p_reserved_by,
            updated_at = now()
        WHERE id = v_inventory.id;

        v_reservation_id := public.fn_insert_cut_reservation(
          v_inventory.id,
          p_material_id,
          v_inventory.material_variant_id,
          p_machine_id,
          p_request_item_table,
          p_request_item_id,
          v_full_quantity,
          v_full_pieces,
          p_reserved_by,
          v_inventory.piece_length_mm,
          NULL,
          NULL
        );
        v_last_reservation_id := COALESCE(v_last_reservation_id, v_reservation_id);

        INSERT INTO public.inventory_transactions (
          factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity,
          secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
        )
        VALUES (
          v_inventory.factory_id, v_inventory.id, p_material_id, v_inventory.material_variant_id, 'reserve', -v_full_quantity,
          -v_full_pieces, p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by, 'Бронирование целых кусков'
        );

        v_remaining := v_remaining - v_full_quantity;
        v_available_pieces := v_available_pieces - v_full_pieces;
      END IF;

      IF v_remaining > 0 AND v_available_pieces > 0 THEN
        v_cut_quantity := v_remaining;
        v_scrap_quantity := v_inventory.piece_length_mm - v_cut_quantity;
        IF v_scrap_quantity < 0 THEN
          RAISE EXCEPTION 'Некорректный раскрой: остаток меньше 0';
        END IF;

        UPDATE public.inventory
        SET total_quantity = total_quantity - v_inventory.piece_length_mm,
            total_secondary_quantity = COALESCE(total_secondary_quantity, 0) - 1,
            last_updated_by = p_reserved_by,
            updated_at = now()
        WHERE id = v_inventory.id;

        IF v_scrap_quantity > 0 THEN
          v_scrap_inventory_id := public.fn_upsert_inventory_stock(
            p_material_id,
            v_inventory.material_variant_id,
            v_scrap_quantity,
            v_scrap_quantity,
            v_inventory.unit,
            1,
            COALESCE(v_inventory.secondary_unit, 'шт'),
            p_reserved_by,
            true,
            v_inventory.id,
            NULL,
            p_machine_id,
            v_inventory.piece_length_mm,
            v_inventory.factory_id
          );
        ELSE
          v_scrap_inventory_id := NULL;
        END IF;

        v_reservation_id := public.fn_insert_cut_reservation(
          v_inventory.id,
          p_material_id,
          v_inventory.material_variant_id,
          p_machine_id,
          p_request_item_table,
          p_request_item_id,
          v_cut_quantity,
          1,
          p_reserved_by,
          v_inventory.piece_length_mm,
          v_scrap_inventory_id,
          NULLIF(v_scrap_quantity, 0)
        );
        v_last_reservation_id := COALESCE(v_last_reservation_id, v_reservation_id);

        IF v_scrap_inventory_id IS NOT NULL THEN
          UPDATE public.inventory
          SET source_reservation_id = v_reservation_id
          WHERE id = v_scrap_inventory_id
            AND source_reservation_id IS NULL;
        END IF;

        INSERT INTO public.inventory_transactions (
          factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity,
          secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
        )
        VALUES (
          v_inventory.factory_id, v_inventory.id, p_material_id, v_inventory.material_variant_id, 'reserve', -v_cut_quantity,
          -1, p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by, 'Раскрой и бронирование куска'
        );

        IF v_scrap_inventory_id IS NOT NULL THEN
          INSERT INTO public.inventory_transactions (
            factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity,
            secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
          )
          VALUES (
            v_inventory.factory_id, v_scrap_inventory_id, p_material_id, v_inventory.material_variant_id, 'receipt', v_scrap_quantity,
            1, p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by, 'Деловой отход после раскроя'
          );
        END IF;

        v_remaining := 0;
      END IF;
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Недостаточно на складе выбранного завода. Не хватает: % мм', v_remaining;
    END IF;

    PERFORM public.fn_set_request_reserved_quantity(p_request_item_table, p_request_item_id);
    RETURN v_last_reservation_id;
  END IF;

  IF p_material_variant_id IS NOT NULL AND p_piece_length_mm IS NOT NULL THEN
    SELECT * INTO v_inventory
    FROM public.inventory
    WHERE factory_id = v_machine_factory_id
      AND material_id = p_material_id
      AND material_variant_id = p_material_variant_id
      AND piece_length_mm = p_piece_length_mm
      AND is_business_scrap = false
      AND deleted_at IS NULL
    FOR UPDATE;
  ELSIF p_material_variant_id IS NOT NULL THEN
    SELECT * INTO v_inventory
    FROM public.inventory
    WHERE factory_id = v_machine_factory_id
      AND material_id = p_material_id
      AND material_variant_id = p_material_variant_id
      AND piece_length_mm IS NULL
      AND is_business_scrap = false
      AND deleted_at IS NULL
    FOR UPDATE;
  ELSE
    SELECT * INTO v_inventory
    FROM public.inventory
    WHERE factory_id = v_machine_factory_id
      AND material_id = p_material_id
      AND material_variant_id IS NULL
      AND is_business_scrap = false
      AND deleted_at IS NULL
    FOR UPDATE;
  END IF;

  IF NOT FOUND AND p_material_variant_id IS NULL AND p_piece_length_mm IS NULL THEN
    SELECT * INTO v_inventory
    FROM public.inventory
    WHERE factory_id = v_machine_factory_id
      AND material_id = p_material_id
      AND available_quantity > 0
      AND is_business_scrap = false
      AND deleted_at IS NULL
    ORDER BY updated_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Материала нет на складе выбранного завода';
  END IF;

  IF v_inventory.available_quantity < p_quantity THEN
    RAISE EXCEPTION 'Недостаточно на складе выбранного завода. Доступно: % %', v_inventory.available_quantity, v_inventory.unit;
  END IF;

  IF p_secondary_quantity IS NOT NULL AND COALESCE(v_inventory.available_secondary_quantity, 0) < p_secondary_quantity THEN
    RAISE EXCEPTION 'Недостаточно на складе выбранного завода. Доступно: % %', COALESCE(v_inventory.available_secondary_quantity, 0), COALESCE(v_inventory.secondary_unit, '');
  END IF;

  INSERT INTO public.inventory_reservations (
    inventory_id, material_id, material_variant_id, machine_id, request_item_table, request_item_id,
    reserved_quantity, reserved_secondary_quantity, reserved_by
  )
  VALUES (
    v_inventory.id, p_material_id, v_inventory.material_variant_id, p_machine_id, p_request_item_table, p_request_item_id,
    p_quantity, p_secondary_quantity, p_reserved_by
  )
  RETURNING id INTO v_reservation_id;

  UPDATE public.inventory
  SET reserved_quantity = reserved_quantity + p_quantity,
      reserved_secondary_quantity = CASE
        WHEN p_secondary_quantity IS NULL THEN reserved_secondary_quantity
        ELSE COALESCE(reserved_secondary_quantity, 0) + p_secondary_quantity
      END,
      last_updated_by = p_reserved_by,
      updated_at = now()
  WHERE id = v_inventory.id;

  INSERT INTO public.inventory_transactions (
    factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity,
    secondary_quantity, machine_id, request_item_table, request_item_id, performed_by
  )
  VALUES (
    v_inventory.factory_id, v_inventory.id, p_material_id, v_inventory.material_variant_id, 'reserve', -p_quantity,
    CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE -p_secondary_quantity END,
    p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by
  );

  PERFORM public.fn_set_request_reserved_quantity(p_request_item_table, p_request_item_id);
  RETURN v_reservation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_reserve_inventory_row_for_machine(
  p_inventory_id uuid,
  p_machine_id uuid,
  p_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid,
  p_secondary_quantity numeric DEFAULT NULL,
  p_is_cut_reservation boolean DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_inventory public.inventory%ROWTYPE;
  v_machine_factory_id uuid;
  v_reservation_id uuid;
  v_last_reservation_id uuid;
  v_remaining numeric := p_quantity;
  v_available_pieces numeric;
  v_full_pieces numeric;
  v_full_quantity numeric;
  v_cut_quantity numeric;
  v_scrap_quantity numeric;
  v_scrap_inventory_id uuid;
  v_possible numeric;
  v_is_cut_table boolean;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количество бронирования должно быть больше 0';
  END IF;

  SELECT factory_id INTO v_machine_factory_id
  FROM public.machines
  WHERE id = p_machine_id;

  IF v_machine_factory_id IS NULL THEN
    RAISE EXCEPTION 'Для бронирования не определен завод машины';
  END IF;

  SELECT * INTO v_inventory
  FROM public.inventory
  WHERE id = p_inventory_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Выбранный складской остаток не найден';
  END IF;

  IF v_inventory.factory_id IS DISTINCT FROM v_machine_factory_id THEN
    RAISE EXCEPTION 'Выбранный складской остаток относится к другому заводу';
  END IF;

  v_is_cut_table := COALESCE(
    p_is_cut_reservation,
    p_request_item_table IN ('request_pipe', 'request_knives') AND v_inventory.piece_length_mm IS NOT NULL
  );

  IF v_is_cut_table THEN
    IF v_inventory.piece_length_mm IS NULL OR v_inventory.piece_length_mm <= 0 THEN
      RAISE EXCEPTION 'Выбранный складской остаток не является мерным куском';
    END IF;

    v_available_pieces := FLOOR(COALESCE(v_inventory.available_secondary_quantity, 0));
    v_possible := v_available_pieces * v_inventory.piece_length_mm;

    IF v_possible < p_quantity THEN
      RAISE EXCEPTION 'Недостаточно на выбранной складской строке. Доступно: % мм', v_possible;
    END IF;

    IF v_available_pieces <= 0 THEN
      RAISE EXCEPTION 'В выбранной складской строке нет доступных кусков';
    END IF;

    v_full_pieces := LEAST(FLOOR(v_remaining / v_inventory.piece_length_mm), v_available_pieces);
    IF v_full_pieces > 0 THEN
      v_full_quantity := v_full_pieces * v_inventory.piece_length_mm;

      UPDATE public.inventory
      SET total_quantity = total_quantity - v_full_quantity,
          total_secondary_quantity = COALESCE(total_secondary_quantity, 0) - v_full_pieces,
          last_updated_by = p_reserved_by,
          updated_at = now()
      WHERE id = v_inventory.id;

      v_reservation_id := public.fn_insert_cut_reservation(
        v_inventory.id,
        v_inventory.material_id,
        v_inventory.material_variant_id,
        p_machine_id,
        p_request_item_table,
        p_request_item_id,
        v_full_quantity,
        v_full_pieces,
        p_reserved_by,
        v_inventory.piece_length_mm,
        NULL,
        NULL
      );
      v_last_reservation_id := COALESCE(v_last_reservation_id, v_reservation_id);

      INSERT INTO public.inventory_transactions (
        factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity,
        secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
      )
      VALUES (
        v_inventory.factory_id, v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id, 'reserve', -v_full_quantity,
        -v_full_pieces, p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by, 'Бронирование целых кусков'
      );

      v_remaining := v_remaining - v_full_quantity;
      v_available_pieces := v_available_pieces - v_full_pieces;
    END IF;

    IF v_remaining > 0 AND v_available_pieces > 0 THEN
      v_cut_quantity := v_remaining;
      v_scrap_quantity := v_inventory.piece_length_mm - v_cut_quantity;
      IF v_scrap_quantity < 0 THEN
        RAISE EXCEPTION 'Некорректный раскрой: остаток меньше 0';
      END IF;

      UPDATE public.inventory
      SET total_quantity = total_quantity - v_inventory.piece_length_mm,
          total_secondary_quantity = COALESCE(total_secondary_quantity, 0) - 1,
          last_updated_by = p_reserved_by,
          updated_at = now()
      WHERE id = v_inventory.id;

      IF v_scrap_quantity > 0 THEN
        v_scrap_inventory_id := public.fn_upsert_inventory_stock(
          v_inventory.material_id,
          v_inventory.material_variant_id,
          v_scrap_quantity,
          v_scrap_quantity,
          v_inventory.unit,
          1,
          COALESCE(v_inventory.secondary_unit, 'шт'),
          p_reserved_by,
          true,
          v_inventory.id,
          NULL,
          p_machine_id,
          v_inventory.piece_length_mm,
          v_inventory.factory_id
        );
      ELSE
        v_scrap_inventory_id := NULL;
      END IF;

      v_reservation_id := public.fn_insert_cut_reservation(
        v_inventory.id,
        v_inventory.material_id,
        v_inventory.material_variant_id,
        p_machine_id,
        p_request_item_table,
        p_request_item_id,
        v_cut_quantity,
        1,
        p_reserved_by,
        v_inventory.piece_length_mm,
        v_scrap_inventory_id,
        NULLIF(v_scrap_quantity, 0)
      );
      v_last_reservation_id := COALESCE(v_last_reservation_id, v_reservation_id);

      IF v_scrap_inventory_id IS NOT NULL THEN
        UPDATE public.inventory
        SET source_reservation_id = v_reservation_id
        WHERE id = v_scrap_inventory_id
          AND source_reservation_id IS NULL;
      END IF;

      INSERT INTO public.inventory_transactions (
        factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity,
        secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
      )
      VALUES (
        v_inventory.factory_id, v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id, 'reserve', -v_cut_quantity,
        -1, p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by, 'Раскрой и бронирование выбранного куска'
      );

      IF v_scrap_inventory_id IS NOT NULL THEN
        INSERT INTO public.inventory_transactions (
          factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity,
          secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
        )
        VALUES (
          v_inventory.factory_id, v_scrap_inventory_id, v_inventory.material_id, v_inventory.material_variant_id, 'receipt', v_scrap_quantity,
          1, p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by, 'Деловой отход после раскроя'
        );
      END IF;

      v_remaining := 0;
    END IF;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Недостаточно на выбранной складской строке. Не хватает: % мм', v_remaining;
    END IF;

    PERFORM public.fn_set_request_reserved_quantity(p_request_item_table, p_request_item_id);
    RETURN v_last_reservation_id;
  END IF;

  IF v_inventory.available_quantity < p_quantity THEN
    RAISE EXCEPTION 'Недостаточно на выбранной складской строке. Доступно: % %', v_inventory.available_quantity, v_inventory.unit;
  END IF;

  IF p_secondary_quantity IS NOT NULL AND COALESCE(v_inventory.available_secondary_quantity, 0) < p_secondary_quantity THEN
    RAISE EXCEPTION 'Недостаточно на выбранной складской строке. Доступно: % %', COALESCE(v_inventory.available_secondary_quantity, 0), COALESCE(v_inventory.secondary_unit, '');
  END IF;

  INSERT INTO public.inventory_reservations (
    inventory_id, material_id, material_variant_id, machine_id, request_item_table, request_item_id,
    reserved_quantity, reserved_secondary_quantity, reserved_by
  )
  VALUES (
    v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id, p_machine_id, p_request_item_table, p_request_item_id,
    p_quantity, p_secondary_quantity, p_reserved_by
  )
  RETURNING id INTO v_reservation_id;

  UPDATE public.inventory
  SET reserved_quantity = reserved_quantity + p_quantity,
      reserved_secondary_quantity = CASE
        WHEN p_secondary_quantity IS NULL THEN reserved_secondary_quantity
        ELSE COALESCE(reserved_secondary_quantity, 0) + p_secondary_quantity
      END,
      last_updated_by = p_reserved_by,
      updated_at = now()
  WHERE id = v_inventory.id;

  INSERT INTO public.inventory_transactions (
    factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity,
    secondary_quantity, machine_id, request_item_table, request_item_id, performed_by
  )
  VALUES (
    v_inventory.factory_id, v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id, 'reserve', -p_quantity,
    CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE -p_secondary_quantity END,
    p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by
  );

  PERFORM public.fn_set_request_reserved_quantity(p_request_item_table, p_request_item_id);
  RETURN v_reservation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_unreserve_inventory_reservation(
  p_reservation_id uuid,
  p_performed_by uuid,
  p_comment text DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_reservation public.inventory_reservations%ROWTYPE;
  v_scrap public.inventory%ROWTYPE;
  v_source_inventory public.inventory%ROWTYPE;
  v_can_rejoin boolean := false;
  v_return_inventory_id uuid;
  v_return_quantity numeric;
BEGIN
  SELECT * INTO v_reservation
  FROM public.inventory_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_source_inventory
  FROM public.inventory
  WHERE id = COALESCE(v_reservation.source_inventory_id, v_reservation.inventory_id)
  FOR UPDATE;

  IF v_reservation.is_cut_reservation THEN
    IF v_reservation.business_scrap_inventory_id IS NOT NULL AND COALESCE(v_reservation.business_scrap_quantity, 0) > 0 THEN
      SELECT * INTO v_scrap
      FROM public.inventory
      WHERE id = v_reservation.business_scrap_inventory_id
      FOR UPDATE;

      v_can_rejoin := FOUND
        AND COALESCE(v_scrap.available_quantity, 0) >= COALESCE(v_reservation.business_scrap_quantity, 0)
        AND COALESCE(v_scrap.available_secondary_quantity, 0) >= 1
        AND v_scrap.deleted_at IS NULL;
    ELSE
      v_can_rejoin := true;
    END IF;

    IF v_can_rejoin THEN
      IF v_reservation.business_scrap_inventory_id IS NOT NULL AND COALESCE(v_reservation.business_scrap_quantity, 0) > 0 THEN
        UPDATE public.inventory
        SET total_quantity = total_quantity - v_reservation.business_scrap_quantity,
            total_secondary_quantity = COALESCE(total_secondary_quantity, 0) - 1,
            last_updated_by = p_performed_by,
            updated_at = now()
        WHERE id = v_reservation.business_scrap_inventory_id;
      END IF;

      UPDATE public.inventory
      SET total_quantity = total_quantity + COALESCE(v_reservation.original_piece_length_mm, 0) * COALESCE(v_reservation.consumed_piece_count, 1),
          total_secondary_quantity = COALESCE(total_secondary_quantity, 0) + COALESCE(v_reservation.consumed_piece_count, 1),
          last_updated_by = p_performed_by,
          updated_at = now()
      WHERE id = COALESCE(v_reservation.source_inventory_id, v_reservation.inventory_id);

      INSERT INTO public.inventory_transactions (
        factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity,
        secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
      )
      VALUES (
        v_source_inventory.factory_id,
        COALESCE(v_reservation.source_inventory_id, v_reservation.inventory_id),
        v_reservation.material_id,
        v_reservation.material_variant_id,
        'unreserve',
        v_reservation.reserved_quantity,
        v_reservation.reserved_secondary_quantity,
        v_reservation.machine_id,
        v_reservation.request_item_table,
        v_reservation.request_item_id,
        p_performed_by,
        COALESCE(p_comment, 'Снятие брони с восстановлением куска')
      );
    ELSE
      v_return_quantity := v_reservation.reserved_quantity;
      v_return_inventory_id := public.fn_upsert_inventory_stock(
        v_reservation.material_id,
        v_reservation.material_variant_id,
        v_return_quantity,
        v_return_quantity,
        'мм',
        1,
        'шт',
        p_performed_by,
        true,
        COALESCE(v_reservation.source_inventory_id, v_reservation.inventory_id),
        NULL,
        v_reservation.machine_id,
        v_reservation.original_piece_length_mm,
        v_source_inventory.factory_id
      );

      INSERT INTO public.inventory_transactions (
        factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity,
        secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
      )
      VALUES (
        v_source_inventory.factory_id,
        v_return_inventory_id,
        v_reservation.material_id,
        v_reservation.material_variant_id,
        'unreserve',
        v_return_quantity,
        1,
        v_reservation.machine_id,
        v_reservation.request_item_table,
        v_reservation.request_item_id,
        p_performed_by,
        COALESCE(p_comment, 'Снятие брони, возврат забронированного куска')
      );
    END IF;

    UPDATE public.inventory
    SET source_reservation_id = NULL
    WHERE source_reservation_id = p_reservation_id;

    DELETE FROM public.inventory_reservations WHERE id = p_reservation_id;
    PERFORM public.fn_set_request_reserved_quantity(v_reservation.request_item_table, v_reservation.request_item_id);
    RETURN;
  END IF;

  UPDATE public.inventory
  SET reserved_quantity = GREATEST(reserved_quantity - v_reservation.reserved_quantity, 0),
      reserved_secondary_quantity = CASE
        WHEN v_reservation.reserved_secondary_quantity IS NULL THEN reserved_secondary_quantity
        ELSE GREATEST(COALESCE(reserved_secondary_quantity, 0) - v_reservation.reserved_secondary_quantity, 0)
      END,
      last_updated_by = p_performed_by,
      updated_at = now()
  WHERE id = v_reservation.inventory_id;

  INSERT INTO public.inventory_transactions (
    factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity,
    secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
  )
  VALUES (
    v_source_inventory.factory_id,
    v_reservation.inventory_id,
    v_reservation.material_id,
    v_reservation.material_variant_id,
    'unreserve',
    v_reservation.reserved_quantity,
    v_reservation.reserved_secondary_quantity,
    v_reservation.machine_id,
    v_reservation.request_item_table,
    v_reservation.request_item_id,
    p_performed_by,
    p_comment
  );

  UPDATE public.inventory
  SET source_reservation_id = NULL
  WHERE source_reservation_id = p_reservation_id;

  DELETE FROM public.inventory_reservations WHERE id = p_reservation_id;
  PERFORM public.fn_set_request_reserved_quantity(v_reservation.request_item_table, v_reservation.request_item_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_reserve_future_business_scrap_for_machine(
  p_inventory_id uuid,
  p_machine_id uuid,
  p_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid,
  p_secondary_quantity numeric DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_inventory public.inventory%ROWTYPE;
  v_consumer_cutting_date date;
  v_machine_factory_id uuid;
  v_reservation_id uuid;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количество бронирования должно быть больше 0';
  END IF;

  SELECT factory_id INTO v_machine_factory_id
  FROM public.machines
  WHERE id = p_machine_id;

  IF v_machine_factory_id IS NULL THEN
    RAISE EXCEPTION 'Для бронирования не определен завод машины';
  END IF;

  SELECT * INTO v_inventory
  FROM public.inventory
  WHERE id = p_inventory_id
    AND is_business_scrap = true
    AND business_scrap_state = 'future'
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Будущий деловой остаток не найден';
  END IF;

  IF v_inventory.factory_id IS DISTINCT FROM v_machine_factory_id THEN
    RAISE EXCEPTION 'Будущий деловой остаток относится к другому заводу';
  END IF;

  IF v_inventory.available_from_date IS NULL THEN
    RAISE EXCEPTION 'У будущего делового остатка не указана дата доступности';
  END IF;

  IF current_date < (v_inventory.available_from_date - 7) THEN
    RAISE EXCEPTION 'Будущий деловой остаток можно бронировать только за 7 дней до даты доступности';
  END IF;

  SELECT ps.date_start INTO v_consumer_cutting_date
  FROM public.production_stages ps
  WHERE ps.machine_id = p_machine_id
    AND ps.stage_type = 'cutting'
    AND ps.is_skipped = false
  ORDER BY ps.date_start NULLS LAST
  LIMIT 1;

  IF v_consumer_cutting_date IS NULL THEN
    RAISE EXCEPTION 'У машины-потребителя не указана дата начала заготовки';
  END IF;

  IF v_consumer_cutting_date <= v_inventory.available_from_date THEN
    RAISE EXCEPTION 'Будущий остаток можно бронировать только для машин с заготовкой позже даты доступности остатка';
  END IF;

  IF v_inventory.available_quantity < p_quantity THEN
    RAISE EXCEPTION 'Недостаточно будущего делового остатка. Доступно: % %', v_inventory.available_quantity, v_inventory.unit;
  END IF;

  IF p_secondary_quantity IS NOT NULL AND COALESCE(v_inventory.available_secondary_quantity, 0) < p_secondary_quantity THEN
    RAISE EXCEPTION 'Недостаточно будущего делового остатка. Доступно: % %', COALESCE(v_inventory.available_secondary_quantity, 0), COALESCE(v_inventory.secondary_unit, '');
  END IF;

  INSERT INTO public.inventory_reservations (
    inventory_id, material_id, material_variant_id, machine_id, request_item_table, request_item_id,
    reserved_quantity, reserved_secondary_quantity, reserved_by
  )
  VALUES (
    v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id, p_machine_id, p_request_item_table, p_request_item_id,
    p_quantity, p_secondary_quantity, p_reserved_by
  )
  RETURNING id INTO v_reservation_id;

  UPDATE public.inventory
  SET reserved_quantity = reserved_quantity + p_quantity,
      reserved_secondary_quantity = CASE
        WHEN p_secondary_quantity IS NULL THEN reserved_secondary_quantity
        ELSE COALESCE(reserved_secondary_quantity, 0) + p_secondary_quantity
      END,
      last_updated_by = p_reserved_by,
      updated_at = now()
  WHERE id = v_inventory.id;

  PERFORM public.fn_set_request_reserved_quantity(p_request_item_table, p_request_item_id);

  INSERT INTO public.inventory_transactions (
    factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity,
    secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
  )
  VALUES (
    v_inventory.factory_id, v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id, 'reserve', -p_quantity,
    CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE -p_secondary_quantity END,
    p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by, 'Бронь будущего делового остатка'
  );

  RETURN v_reservation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
