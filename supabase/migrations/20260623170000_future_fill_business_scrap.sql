-- Future-fill nesting and future business scrap lifecycle.

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS business_scrap_state text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS available_from_date date,
  ADD COLUMN IF NOT EXISTS available_from_stage_id uuid REFERENCES public.production_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_nesting_project_id text,
  ADD COLUMN IF NOT EXISTS source_nesting_sheet_id text,
  ADD COLUMN IF NOT EXISTS source_remnant_geom jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_business_scrap_state_check'
      AND conrelid = 'public.inventory'::regclass
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT inventory_business_scrap_state_check
      CHECK (business_scrap_state IN ('available', 'future'));
  END IF;
END $$;

UPDATE public.inventory
SET business_scrap_state = 'available'
WHERE business_scrap_state IS NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_business_scrap_state
  ON public.inventory(business_scrap_state, available_from_date)
  WHERE is_business_scrap = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_future_scrap_stage
  ON public.inventory(available_from_stage_id)
  WHERE is_business_scrap = true AND business_scrap_state = 'future';

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_future_scrap_source_sheet
  ON public.inventory(source_nesting_project_id, source_nesting_sheet_id)
  WHERE is_business_scrap = true
    AND source_nesting_project_id IS NOT NULL
    AND source_nesting_sheet_id IS NOT NULL;

ALTER TABLE public.nesting_batches
  ADD COLUMN IF NOT EXISTS source_nesting_project_id text,
  ADD COLUMN IF NOT EXISTS is_future_fill boolean NOT NULL DEFAULT false;

ALTER TABLE public.nesting_batch_items
  ADD COLUMN IF NOT EXISTS fill_role text NOT NULL DEFAULT 'original';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'nesting_batch_items_fill_role_check'
      AND conrelid = 'public.nesting_batch_items'::regclass
  ) THEN
    ALTER TABLE public.nesting_batch_items
      ADD CONSTRAINT nesting_batch_items_fill_role_check
      CHECK (fill_role IN ('original', 'future'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_nesting_batches_future_fill_source
  ON public.nesting_batches(source_nesting_project_id)
  WHERE is_future_fill = true;

CREATE INDEX IF NOT EXISTS idx_nesting_batch_items_fill_role
  ON public.nesting_batch_items(batch_id, fill_role);

CREATE TABLE IF NOT EXISTS public.nesting_precut_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  machine_item_id uuid NOT NULL REFERENCES public.machine_items(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  part_id text,
  part_name text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  source_nesting_project_id text NOT NULL,
  source_nesting_sheet_id text,
  source_nesting_placement jsonb,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nesting_precut_parts_unique_source
  ON public.nesting_precut_parts(
    machine_item_id,
    source_nesting_project_id,
    COALESCE(source_nesting_sheet_id, ''),
    COALESCE(part_id, ''),
    part_name
  );

CREATE INDEX IF NOT EXISTS idx_nesting_precut_parts_item
  ON public.nesting_precut_parts(machine_item_id);

CREATE INDEX IF NOT EXISTS idx_nesting_precut_parts_project
  ON public.nesting_precut_parts(source_nesting_project_id);

ALTER TABLE public.nesting_precut_parts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Nesting managers read precut parts" ON public.nesting_precut_parts;
DROP POLICY IF EXISTS "Nesting managers insert precut parts" ON public.nesting_precut_parts;
DROP POLICY IF EXISTS "Nesting managers update precut parts" ON public.nesting_precut_parts;
DROP POLICY IF EXISTS "Nesting managers delete precut parts" ON public.nesting_precut_parts;

CREATE POLICY "Nesting managers read precut parts"
  ON public.nesting_precut_parts FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));

CREATE POLICY "Nesting managers insert precut parts"
  ON public.nesting_precut_parts FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));

CREATE POLICY "Nesting managers update precut parts"
  ON public.nesting_precut_parts FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'))
  WITH CHECK (public.get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));

CREATE POLICY "Nesting managers delete precut parts"
  ON public.nesting_precut_parts FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));

CREATE OR REPLACE FUNCTION public.fn_promote_due_future_business_scrap(
  p_today date DEFAULT current_date
)
RETURNS integer AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH promoted AS (
    UPDATE public.inventory i
    SET business_scrap_state = 'available',
        updated_at = now()
    FROM public.production_stages ps
    WHERE i.is_business_scrap = true
      AND i.business_scrap_state = 'future'
      AND i.deleted_at IS NULL
      AND i.available_from_stage_id = ps.id
      AND ps.stage_type = 'cutting'
      AND ps.date_start IS NOT NULL
      AND ps.date_start <= p_today
    RETURNING i.id
  )
  SELECT COUNT(*) INTO v_count FROM promoted;

  RETURN v_count;
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
  v_reservation_id uuid;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количество бронирования должно быть больше 0';
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
    RAISE EXCEPTION 'Недостаточно будущего остатка. Доступно: % %', v_inventory.available_quantity, v_inventory.unit;
  END IF;

  IF p_secondary_quantity IS NOT NULL AND COALESCE(v_inventory.available_secondary_quantity, 0) < p_secondary_quantity THEN
    RAISE EXCEPTION 'Недостаточно будущего остатка. Доступно: % %', COALESCE(v_inventory.available_secondary_quantity, 0), COALESCE(v_inventory.secondary_unit, '');
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
    inventory_id, material_id, material_variant_id, transaction_type, quantity,
    secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
  )
  VALUES (
    v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id, 'reserve', -p_quantity,
    CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE -p_secondary_quantity END,
    p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by, 'Бронь будущего делового остатка'
  );

  RETURN v_reservation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
