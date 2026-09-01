-- Automatic VRB mesh outsourcing requests created from confirmed sales orders.

ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'vrb_outsourcing_approval';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS requires_vrb_mesh boolean NOT NULL DEFAULT false;

INSERT INTO public.outsourcing_work_types (code, name, description, is_zinc, is_active)
VALUES (
  'vrb_mesh',
  'Заказ сетки VRB',
  'Автоматический заказ сетки VRB для подтвержденного заказа',
  false,
  true
)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_zinc = false,
    is_active = true,
    updated_at = now();

ALTER TABLE public.machine_outsourcing_operations
  ADD COLUMN IF NOT EXISTS operation_kind text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS parent_operation_id uuid
    REFERENCES public.machine_outsourcing_operations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_task_id uuid
    REFERENCES public.tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_method text,
  ADD COLUMN IF NOT EXISTS delivery_carrier_supplier_id uuid
    REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS delivery_tracking_number text,
  ADD COLUMN IF NOT EXISTS delivery_cost_planned numeric,
  ADD COLUMN IF NOT EXISTS delivery_dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_dispatched_by uuid
    REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS order_change_decision text,
  ADD COLUMN IF NOT EXISTS order_change_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS order_change_resolved_by uuid
    REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_change_ignored_fingerprint text;

ALTER TABLE public.machine_outsourcing_operations
  DROP CONSTRAINT IF EXISTS machine_outsourcing_operation_kind_check,
  DROP CONSTRAINT IF EXISTS machine_outsourcing_delivery_method_check,
  DROP CONSTRAINT IF EXISTS machine_outsourcing_delivery_cost_check,
  DROP CONSTRAINT IF EXISTS machine_outsourcing_order_change_decision_check,
  DROP CONSTRAINT IF EXISTS machine_outsourcing_vrb_delivery_check;

ALTER TABLE public.machine_outsourcing_operations
  ADD CONSTRAINT machine_outsourcing_operation_kind_check
    CHECK (operation_kind IN ('standard', 'vrb_mesh')),
  ADD CONSTRAINT machine_outsourcing_delivery_method_check
    CHECK (delivery_method IS NULL OR delivery_method IN ('own_transport', 'carrier')),
  ADD CONSTRAINT machine_outsourcing_delivery_cost_check
    CHECK (delivery_cost_planned IS NULL OR delivery_cost_planned >= 0),
  ADD CONSTRAINT machine_outsourcing_order_change_decision_check
    CHECK (order_change_decision IS NULL OR order_change_decision IN ('accepted', 'kept_original')),
  ADD CONSTRAINT machine_outsourcing_vrb_delivery_check CHECK (
    operation_kind <> 'vrb_mesh'
    OR delivery_method IS NULL
    OR (delivery_method = 'own_transport' AND delivery_carrier_supplier_id IS NULL)
    OR (delivery_method = 'carrier' AND delivery_carrier_supplier_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_machine_outsourcing_one_active_vrb_root
  ON public.machine_outsourcing_operations(machine_id)
  WHERE operation_kind = 'vrb_mesh'
    AND parent_operation_id IS NULL
    AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_machine_outsourcing_vrb_approval_task
  ON public.machine_outsourcing_operations(approval_task_id)
  WHERE approval_task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.machine_outsourcing_vrb_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL
    REFERENCES public.machine_outsourcing_operations(id) ON DELETE CASCADE,
  source_machine_item_id uuid
    REFERENCES public.machine_items(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  drawing_number text NOT NULL,
  drawing_source text,
  drawing_file_id uuid,
  requested_quantity numeric NOT NULL CHECK (requested_quantity > 0),
  requested_weight_kg numeric NOT NULL DEFAULT 0 CHECK (requested_weight_kg >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT machine_outsourcing_vrb_items_drawing_source_check
    CHECK (drawing_source IS NULL OR drawing_source IN ('product', 'project'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_machine_outsourcing_vrb_items_source
  ON public.machine_outsourcing_vrb_items(operation_id, source_machine_item_id)
  WHERE source_machine_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_machine_outsourcing_vrb_items_operation
  ON public.machine_outsourcing_vrb_items(operation_id, sort_order);

CREATE TABLE IF NOT EXISTS public.machine_outsourcing_vrb_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vrb_item_id uuid NOT NULL
    REFERENCES public.machine_outsourcing_vrb_items(id) ON DELETE CASCADE,
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity > 0),
  received_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_machine_outsourcing_vrb_receipts_item
  ON public.machine_outsourcing_vrb_receipts(vrb_item_id, received_at);

CREATE INDEX IF NOT EXISTS idx_machine_outsourcing_vrb_receipts_factory
  ON public.machine_outsourcing_vrb_receipts(factory_id, received_at DESC);

CREATE OR REPLACE FUNCTION public.vrb_replace_operation_snapshot(
  p_operation_id uuid,
  p_machine_id uuid,
  p_positive_only boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.machine_outsourcing_vrb_items
  WHERE operation_id = p_operation_id;

  INSERT INTO public.machine_outsourcing_vrb_items (
    operation_id,
    source_machine_item_id,
    product_id,
    product_name,
    drawing_number,
    drawing_source,
    drawing_file_id,
    requested_quantity,
    requested_weight_kg,
    sort_order
  )
  SELECT
    p_operation_id,
    machine_item.id,
    machine_item.product_id,
    machine_item.product_name,
    machine_item.drawing_number,
    CASE
      WHEN project_drawing.id IS NOT NULL THEN 'project'
      WHEN product_drawing.id IS NOT NULL THEN 'product'
      ELSE NULL
    END,
    COALESCE(project_drawing.id, product_drawing.id),
    CASE
      WHEN p_positive_only THEN machine_item.quantity - COALESCE(already_ordered.quantity, 0)
      ELSE machine_item.quantity
    END,
    CASE
      WHEN p_positive_only
        THEN machine_item.weight * (machine_item.quantity - COALESCE(already_ordered.quantity, 0))
      ELSE machine_item.weight * machine_item.quantity
    END,
    machine_item.sort_order
  FROM public.machine_items AS machine_item
  JOIN public.products AS product
    ON product.id = machine_item.product_id
   AND product.requires_vrb_mesh = true
  LEFT JOIN LATERAL (
    SELECT file.id
    FROM public.product_files AS file
    WHERE file.product_id = machine_item.product_id
      AND (
        file.file_kind IN ('drawing', 'pdf')
        OR lower(file.file_name) LIKE '%.pdf'
      )
    ORDER BY
      CASE file.file_kind WHEN 'drawing' THEN 0 WHEN 'pdf' THEN 1 ELSE 2 END,
      file.created_at DESC
    LIMIT 1
  ) AS product_drawing ON true
  LEFT JOIN LATERAL (
    SELECT file.id
    FROM public.product_project_files AS file
    WHERE file.version_id = machine_item.product_project_version_id
      AND (
        file.file_kind IN ('drawing', 'pdf')
        OR lower(file.file_name) LIKE '%.pdf'
      )
    ORDER BY
      CASE file.file_kind WHEN 'drawing' THEN 0 WHEN 'pdf' THEN 1 ELSE 2 END,
      file.created_at DESC
    LIMIT 1
  ) AS project_drawing ON true
  LEFT JOIN LATERAL (
    SELECT sum(item.requested_quantity) AS quantity
    FROM public.machine_outsourcing_vrb_items AS item
    JOIN public.machine_outsourcing_operations AS operation
      ON operation.id = item.operation_id
    WHERE operation.machine_id = p_machine_id
      AND operation.operation_kind = 'vrb_mesh'
      AND operation.archived_at IS NULL
      AND operation.id <> p_operation_id
      AND (
        operation.parent_operation_id IS NULL
        OR operation.parent_operation_id = (
          SELECT COALESCE(parent_operation_id, id)
          FROM public.machine_outsourcing_operations
          WHERE id = p_operation_id
        )
      )
      AND item.source_machine_item_id = machine_item.id
  ) AS already_ordered ON true
  WHERE machine_item.machine_id = p_machine_id
    AND COALESCE(machine_item.is_sample, false) = false
    AND machine_item.quantity > 0
    AND (
      NOT p_positive_only
      OR machine_item.quantity > COALESCE(already_ordered.quantity, 0)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.vrb_ensure_approval_task(p_operation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation public.machine_outsourcing_operations%ROWTYPE;
  v_assignee_id uuid;
  v_task_id uuid;
BEGIN
  SELECT * INTO v_operation
  FROM public.machine_outsourcing_operations
  WHERE id = p_operation_id
    AND operation_kind = 'vrb_mesh'
    AND archived_at IS NULL
    AND supply_terms_confirmed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_operation.approval_task_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.tasks
    WHERE id = v_operation.approval_task_id
      AND status IN ('pending', 'in_progress')
  ) THEN
    RETURN;
  END IF;

  SELECT department.head_user_id INTO v_assignee_id
  FROM public.departments AS department
  JOIN public.users AS app_user ON app_user.id = department.head_user_id
  WHERE department.is_active = true
    AND app_user.is_active = true
    AND (
      lower(department.name) LIKE '%снаб%'
      OR lower(department.name) LIKE '%закуп%'
      OR lower(department.name) LIKE '%supply%'
      OR lower(department.name) LIKE '%procurement%'
    )
  ORDER BY department.sort_order, department.id
  LIMIT 1;

  IF v_assignee_id IS NULL THEN
    SELECT member.user_id INTO v_assignee_id
    FROM public.department_members AS member
    JOIN public.departments AS department ON department.id = member.department_id
    JOIN public.users AS app_user ON app_user.id = member.user_id
    WHERE department.is_active = true
      AND member.is_department_head = true
      AND app_user.is_active = true
      AND (
        lower(department.name) LIKE '%снаб%'
        OR lower(department.name) LIKE '%закуп%'
        OR lower(department.name) LIKE '%supply%'
        OR lower(department.name) LIKE '%procurement%'
      )
    ORDER BY department.sort_order, department.id, member.user_id
    LIMIT 1;
  END IF;

  IF v_assignee_id IS NULL THEN
    SELECT id INTO v_assignee_id
    FROM public.users
    WHERE role = 'procurement_head'
      AND is_active = true
    ORDER BY created_at, id
    LIMIT 1;
  END IF;

  -- Missing supply leadership must never block sales order confirmation.
  IF v_assignee_id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_task_id
  FROM public.tasks
  WHERE machine_id = v_operation.machine_id
    AND assigned_to = v_assignee_id
    AND task_type = 'vrb_outsourcing_approval'
    AND status IN ('pending', 'in_progress')
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF v_task_id IS NULL THEN
    INSERT INTO public.tasks (
      machine_id,
      assigned_to,
      task_type,
      title,
      description,
      status,
      start_date,
      deadline,
      notified_at
    ) VALUES (
      v_operation.machine_id,
      v_assignee_id,
      'vrb_outsourcing_approval',
      'Согласовать заказ сетки VRB',
      'Выберите изготовителя, срок, стоимость и способ доставки сетки VRB.',
      'pending',
      current_date,
      current_date + 3,
      now()
    )
    ON CONFLICT (machine_id, assigned_to, task_type)
      WHERE machine_id IS NOT NULL AND status IN ('pending', 'in_progress')
    DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      deadline = EXCLUDED.deadline,
      notified_at = COALESCE(public.tasks.notified_at, EXCLUDED.notified_at),
      updated_at = now()
    RETURNING id INTO v_task_id;
  END IF;

  UPDATE public.machine_outsourcing_operations
  SET approval_task_id = v_task_id,
      updated_at = now()
  WHERE id = v_operation.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_vrb_mesh_for_machine(p_machine_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_machine public.machines%ROWTYPE;
  v_operation public.machine_outsourcing_operations%ROWTYPE;
  v_supplement public.machine_outsourcing_operations%ROWTYPE;
  v_work_type_id uuid;
  v_eligible_count integer;
  v_current_fingerprint text;
  v_changed boolean := false;
  v_after_dispatch boolean := false;
  v_has_positive_delta boolean := false;
BEGIN
  IF p_machine_id IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 928431));

  SELECT * INTO v_machine
  FROM public.machines
  WHERE id = p_machine_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO v_work_type_id
  FROM public.outsourcing_work_types
  WHERE code = 'vrb_mesh'
  LIMIT 1;
  IF v_work_type_id IS NULL THEN
    RAISE EXCEPTION 'Не найден системный тип работы Заказ сетки VRB';
  END IF;

  SELECT * INTO v_operation
  FROM public.machine_outsourcing_operations
  WHERE machine_id = p_machine_id
    AND operation_kind = 'vrb_mesh'
    AND parent_operation_id IS NULL
    AND archived_at IS NULL
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  SELECT count(*) INTO v_eligible_count
  FROM public.machine_items AS item
  JOIN public.products AS product
    ON product.id = item.product_id
   AND product.requires_vrb_mesh = true
  WHERE item.machine_id = p_machine_id
    AND COALESCE(item.is_sample, false) = false
    AND item.quantity > 0;

  SELECT md5(COALESCE(string_agg(
    format(
      '%s:%s:%s:%s:%s:%s',
      item.id,
      item.product_id,
      item.quantity,
      item.weight,
      item.product_name,
      item.drawing_number
    ),
    '|' ORDER BY item.id
  ), '')) INTO v_current_fingerprint
  FROM public.machine_items AS item
  JOIN public.products AS product
    ON product.id = item.product_id
   AND product.requires_vrb_mesh = true
  WHERE item.machine_id = p_machine_id
    AND COALESCE(item.is_sample, false) = false
    AND item.quantity > 0;

  IF v_machine.is_confirmed IS DISTINCT FROM true
     OR COALESCE(v_machine.is_archived, false) = true
     OR v_eligible_count = 0 THEN
    IF v_operation.id IS NOT NULL THEN
      IF v_operation.supply_taken_at IS NULL THEN
        UPDATE public.machine_outsourcing_operations
        SET archived_at = now(),
            note = concat_ws(E'\n', note, 'Автоматически отменено: заказ не подтвержден или VRB-позиции отсутствуют.')
        WHERE id = v_operation.id;

        UPDATE public.machine_outsourcing_transport_needs
        SET status = 'cancelled', updated_at = now()
        WHERE operation_id = v_operation.id
          AND status IN ('open', 'linked');

        IF v_operation.approval_task_id IS NOT NULL THEN
          UPDATE public.tasks
          SET status = 'cancelled', updated_at = now()
          WHERE id = v_operation.approval_task_id
            AND status IN ('pending', 'in_progress');
        END IF;
      ELSE
        IF v_operation.order_change_decision = 'kept_original'
           AND v_operation.order_change_ignored_fingerprint = v_current_fingerprint THEN
          RETURN;
        END IF;
        UPDATE public.machine_outsourcing_operations
        SET order_changed_at = COALESCE(order_changed_at, now()),
            order_change_decision = NULL,
            order_change_resolved_at = NULL,
            order_change_resolved_by = NULL,
            order_change_ignored_fingerprint = NULL
        WHERE id = v_operation.id;

        WITH archived_supplements AS (
          UPDATE public.machine_outsourcing_operations
          SET archived_at = now(),
              note = concat_ws(E'\n', note, 'Автоматически отменено: положительная разница VRB исчезла.'),
              updated_at = now()
          WHERE parent_operation_id = v_operation.id
            AND operation_kind = 'vrb_mesh'
            AND archived_at IS NULL
            AND supply_taken_at IS NULL
          RETURNING approval_task_id
        )
        UPDATE public.tasks
        SET status = 'cancelled', updated_at = now()
        WHERE id IN (
          SELECT approval_task_id
          FROM archived_supplements
          WHERE approval_task_id IS NOT NULL
        )
          AND status IN ('pending', 'in_progress');
      END IF;
    END IF;
    RETURN;
  END IF;

  IF v_operation.id IS NULL THEN
    INSERT INTO public.machine_outsourcing_operations (
      machine_id,
      work_type_id,
      operation_kind,
      executor_type,
      responsible,
      note
    ) VALUES (
      p_machine_id,
      v_work_type_id,
      'vrb_mesh',
      'supplier',
      'supply',
      'Создано автоматически после полного подтверждения заказа.'
    )
    RETURNING * INTO v_operation;
  END IF;

  IF v_operation.supply_taken_at IS NULL THEN
    PERFORM public.vrb_replace_operation_snapshot(v_operation.id, p_machine_id, false);
    PERFORM public.vrb_ensure_approval_task(v_operation.id);
    UPDATE public.machine_outsourcing_operations
    SET order_changed_at = NULL,
        order_change_decision = NULL,
        order_change_resolved_at = NULL,
        order_change_resolved_by = NULL,
        order_change_ignored_fingerprint = NULL
    WHERE id = v_operation.id;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM (
      SELECT
        COALESCE(live.source_machine_item_id, snapshot.source_machine_item_id) AS source_machine_item_id,
        live.quantity AS live_quantity,
        snapshot.quantity AS snapshot_quantity,
        live.product_id AS live_product_id,
        snapshot.product_id AS snapshot_product_id,
        live.product_name AS live_product_name,
        snapshot.product_name AS snapshot_product_name,
        live.drawing_number AS live_drawing_number,
        snapshot.drawing_number AS snapshot_drawing_number,
        live.requested_weight_kg AS live_requested_weight_kg,
        snapshot.requested_weight_kg AS snapshot_requested_weight_kg
      FROM (
        SELECT
          item.id AS source_machine_item_id,
          item.product_id,
          item.product_name,
          item.drawing_number,
          item.quantity,
          item.weight * item.quantity AS requested_weight_kg
        FROM public.machine_items AS item
        JOIN public.products AS product
          ON product.id = item.product_id
         AND product.requires_vrb_mesh = true
        WHERE item.machine_id = p_machine_id
          AND COALESCE(item.is_sample, false) = false
          AND item.quantity > 0
      ) AS live
      FULL JOIN (
        SELECT
          source_machine_item_id,
          product_id,
          product_name,
          drawing_number,
          requested_quantity AS quantity,
          requested_weight_kg
        FROM public.machine_outsourcing_vrb_items
        WHERE operation_id = v_operation.id
      ) AS snapshot USING (source_machine_item_id)
    ) AS comparison
    WHERE live_quantity IS DISTINCT FROM snapshot_quantity
       OR live_product_id IS DISTINCT FROM snapshot_product_id
       OR live_product_name IS DISTINCT FROM snapshot_product_name
       OR live_drawing_number IS DISTINCT FROM snapshot_drawing_number
       OR live_requested_weight_kg IS DISTINCT FROM snapshot_requested_weight_kg
  ) INTO v_changed;

  IF NOT v_changed THEN
    UPDATE public.machine_outsourcing_operations
    SET order_changed_at = NULL,
        order_change_decision = NULL,
        order_change_resolved_at = NULL,
        order_change_resolved_by = NULL,
        order_change_ignored_fingerprint = NULL
    WHERE id = v_operation.id;
    RETURN;
  END IF;

  IF v_operation.order_change_decision = 'kept_original'
     AND v_operation.order_change_ignored_fingerprint = v_current_fingerprint THEN
    RETURN;
  END IF;

  UPDATE public.machine_outsourcing_operations
  SET order_changed_at = COALESCE(order_changed_at, now()),
      order_change_decision = NULL,
      order_change_resolved_at = NULL,
      order_change_resolved_by = NULL,
      order_change_ignored_fingerprint = NULL
  WHERE id = v_operation.id;

  SELECT (
    v_operation.delivery_dispatched_at IS NOT NULL
    OR v_operation.actual_sent_at IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM public.machine_outsourcing_transport_needs AS need
      JOIN public.machine_outsourcing_transport_orders AS trip
        ON trip.id = need.transport_order_id
      WHERE need.operation_id = v_operation.id
        AND trip.status IN ('in_transit', 'completed')
    )
  ) INTO v_after_dispatch;

  IF NOT v_after_dispatch THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.machine_items AS item
    JOIN public.products AS product
      ON product.id = item.product_id
     AND product.requires_vrb_mesh = true
    LEFT JOIN LATERAL (
      SELECT sum(snapshot.requested_quantity) AS quantity
      FROM public.machine_outsourcing_vrb_items AS snapshot
      JOIN public.machine_outsourcing_operations AS operation
        ON operation.id = snapshot.operation_id
      WHERE operation.archived_at IS NULL
        AND (operation.id = v_operation.id OR operation.parent_operation_id = v_operation.id)
        AND (operation.id = v_operation.id OR operation.supply_taken_at IS NOT NULL)
        AND snapshot.source_machine_item_id = item.id
    ) AS ordered ON true
    WHERE item.machine_id = p_machine_id
      AND COALESCE(item.is_sample, false) = false
      AND item.quantity > COALESCE(ordered.quantity, 0)
  ) INTO v_has_positive_delta;

  SELECT * INTO v_supplement
  FROM public.machine_outsourcing_operations
  WHERE parent_operation_id = v_operation.id
    AND operation_kind = 'vrb_mesh'
    AND archived_at IS NULL
    AND actual_returned_at IS NULL
    AND supply_taken_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_has_positive_delta THEN
    IF v_supplement.id IS NULL THEN
      INSERT INTO public.machine_outsourcing_operations (
        machine_id,
        work_type_id,
        operation_kind,
        parent_operation_id,
        executor_type,
        responsible,
        note
      ) VALUES (
        p_machine_id,
        v_work_type_id,
        'vrb_mesh',
        v_operation.id,
        'supplier',
        'supply',
        'Автоматический дозаказ VRB после отправки основной заявки.'
      )
      RETURNING * INTO v_supplement;
    END IF;
    IF v_supplement.supply_taken_at IS NULL THEN
      PERFORM public.vrb_replace_operation_snapshot(v_supplement.id, p_machine_id, true);
      PERFORM public.vrb_ensure_approval_task(v_supplement.id);
    END IF;
  ELSIF v_supplement.id IS NOT NULL AND v_supplement.supply_taken_at IS NULL THEN
    UPDATE public.machine_outsourcing_operations
    SET archived_at = now(),
        note = concat_ws(E'\n', note, 'Автоматически отменено: положительная разница VRB исчезла.'),
        updated_at = now()
    WHERE id = v_supplement.id;

    IF v_supplement.approval_task_id IS NOT NULL THEN
      UPDATE public.tasks
      SET status = 'cancelled', updated_at = now()
      WHERE id = v_supplement.approval_task_id
        AND status IN ('pending', 'in_progress');
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.vrb_machine_change_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'machines' THEN
    PERFORM public.sync_vrb_mesh_for_machine(NEW.id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_vrb_mesh_for_machine(OLD.machine_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.machine_id IS DISTINCT FROM OLD.machine_id THEN
    PERFORM public.sync_vrb_mesh_for_machine(OLD.machine_id);
  END IF;
  PERFORM public.sync_vrb_mesh_for_machine(NEW.machine_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS machines_sync_vrb_mesh ON public.machines;
CREATE TRIGGER machines_sync_vrb_mesh
  AFTER INSERT OR UPDATE OF is_confirmed, is_archived ON public.machines
  FOR EACH ROW
  EXECUTE FUNCTION public.vrb_machine_change_trigger();

DROP TRIGGER IF EXISTS machine_items_sync_vrb_mesh ON public.machine_items;
CREATE TRIGGER machine_items_sync_vrb_mesh
  AFTER INSERT OR DELETE OR UPDATE OF machine_id, product_id, quantity, weight, product_name, drawing_number, product_project_version_id
  ON public.machine_items
  FOR EACH ROW
  EXECUTE FUNCTION public.vrb_machine_change_trigger();

CREATE OR REPLACE FUNCTION public.guard_vrb_mesh_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.operation_kind = 'vrb_mesh'
     AND NEW.actual_returned_at IS DISTINCT FROM OLD.actual_returned_at
     AND current_setting('app.vrb_receiving', true) IS DISTINCT FROM 'on' THEN
    NEW.actual_returned_at := OLD.actual_returned_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS machine_outsourcing_guard_vrb_completion
  ON public.machine_outsourcing_operations;
CREATE TRIGGER machine_outsourcing_guard_vrb_completion
  BEFORE UPDATE OF actual_returned_at ON public.machine_outsourcing_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_vrb_mesh_completion();

CREATE OR REPLACE FUNCTION public.vrb_operation_dispatch_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.operation_kind = 'vrb_mesh'
     AND NEW.delivery_dispatched_at IS DISTINCT FROM OLD.delivery_dispatched_at THEN
    PERFORM public.sync_vrb_mesh_for_machine(NEW.machine_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS machine_outsourcing_sync_vrb_after_carrier_dispatch
  ON public.machine_outsourcing_operations;
CREATE TRIGGER machine_outsourcing_sync_vrb_after_carrier_dispatch
  AFTER UPDATE OF delivery_dispatched_at ON public.machine_outsourcing_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.vrb_operation_dispatch_trigger();

CREATE OR REPLACE FUNCTION public.vrb_transport_trip_status_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_machine_id uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('in_transit', 'completed') THEN
    RETURN NEW;
  END IF;

  FOR v_machine_id IN
    SELECT DISTINCT operation.machine_id
    FROM public.machine_outsourcing_transport_needs AS need
    JOIN public.machine_outsourcing_operations AS operation
      ON operation.id = need.operation_id
    WHERE need.transport_order_id = NEW.id
      AND operation.operation_kind = 'vrb_mesh'
      AND operation.archived_at IS NULL
  LOOP
    PERFORM public.sync_vrb_mesh_for_machine(v_machine_id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outsourcing_transport_order_sync_vrb_status
  ON public.machine_outsourcing_transport_orders;
CREATE TRIGGER outsourcing_transport_order_sync_vrb_status
  AFTER UPDATE OF status ON public.machine_outsourcing_transport_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.vrb_transport_trip_status_trigger();

CREATE OR REPLACE FUNCTION public.fn_receive_vrb_mesh(
  p_operation_id uuid,
  p_items jsonb,
  p_factory_id uuid,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item public.machine_outsourcing_vrb_items%ROWTYPE;
  v_operation public.machine_outsourcing_operations%ROWTYPE;
  v_machine_factory_id uuid;
  v_input jsonb;
  v_item_id uuid;
  v_quantity numeric;
  v_received numeric;
  v_remaining numeric;
  v_complete boolean;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не указан сотрудник склада'; END IF;
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'Не указан завод приемки'; END IF;
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Не указана заявка VRB'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Не указаны позиции приемки VRB';
  END IF;

  SELECT * INTO v_operation
  FROM public.machine_outsourcing_operations
  WHERE id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND OR v_operation.operation_kind <> 'vrb_mesh' OR v_operation.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Активная заявка VRB не найдена';
  END IF;

  IF v_operation.delivery_method = 'carrier' THEN
    IF v_operation.delivery_dispatched_at IS NULL THEN
      RAISE EXCEPTION 'Сетка VRB еще не отправлена службой доставки';
    END IF;
  ELSIF v_operation.delivery_method = 'own_transport' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.machine_outsourcing_transport_needs AS need
      WHERE need.operation_id = v_operation.id
        AND need.direction = 'return'
        AND need.plan_state = 'confirmed'
        AND need.status = 'completed'
    ) THEN
      RAISE EXCEPTION 'Рейс с сеткой VRB еще не завершен';
    END IF;
  ELSE
    RAISE EXCEPTION 'Способ доставки VRB не согласован';
  END IF;

  SELECT factory_id INTO v_machine_factory_id
  FROM public.machines
  WHERE id = v_operation.machine_id;
  IF v_machine_factory_id IS NULL OR v_machine_factory_id IS DISTINCT FROM p_factory_id THEN
    RAISE EXCEPTION 'Заявку VRB можно принять только на завод заказа';
  END IF;

  FOR v_input IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_item_id := NULLIF(v_input->>'itemId', '')::uuid;
      v_quantity := NULLIF(v_input->>'quantity', '')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Некорректная позиция или количество VRB';
    END;
    IF v_item_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Количество приемки должно быть больше нуля';
    END IF;

    SELECT * INTO v_item
    FROM public.machine_outsourcing_vrb_items
    WHERE id = v_item_id
      AND operation_id = v_operation.id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Позиция VRB не найдена в указанной заявке'; END IF;

    SELECT COALESCE(sum(quantity), 0) INTO v_received
    FROM public.machine_outsourcing_vrb_receipts
    WHERE vrb_item_id = v_item.id;
    v_remaining := v_item.requested_quantity - v_received;
    IF v_quantity > v_remaining THEN
      RAISE EXCEPTION 'Нельзя принять больше остатка: %', v_remaining;
    END IF;

    INSERT INTO public.machine_outsourcing_vrb_receipts (
      vrb_item_id, factory_id, quantity, received_by
    ) VALUES (
      v_item.id, p_factory_id, v_quantity, p_actor
    );
  END LOOP;

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.machine_outsourcing_vrb_items AS item
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(receipt.quantity), 0) AS quantity
      FROM public.machine_outsourcing_vrb_receipts AS receipt
      WHERE receipt.vrb_item_id = item.id
    ) AS received ON true
    WHERE item.operation_id = v_operation.id
      AND received.quantity < item.requested_quantity
  ) INTO v_complete;

  IF v_complete THEN
    PERFORM set_config('app.vrb_receiving', 'on', true);
    UPDATE public.machine_outsourcing_operations
    SET actual_returned_at = current_date,
        updated_by = p_actor,
        updated_at = now()
    WHERE id = v_operation.id;
  END IF;

  RETURN jsonb_build_object(
    'operationId', v_operation.id,
    'completed', v_complete
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_resolve_vrb_order_change(
  p_operation_id uuid,
  p_decision text,
  p_actor uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation public.machine_outsourcing_operations%ROWTYPE;
  v_snapshot_count integer;
  v_current_fingerprint text;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не указан пользователь'; END IF;
  IF p_decision NOT IN ('accepted', 'kept_original') THEN
    RAISE EXCEPTION 'Некорректное решение по изменению заказа';
  END IF;

  SELECT * INTO v_operation
  FROM public.machine_outsourcing_operations
  WHERE id = p_operation_id
    AND operation_kind = 'vrb_mesh'
    AND archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявка VRB не найдена'; END IF;
  IF v_operation.order_changed_at IS NULL THEN
    RAISE EXCEPTION 'В заявке нет неразобранных изменений заказа';
  END IF;

  IF p_decision = 'accepted' THEN
    IF v_operation.delivery_dispatched_at IS NOT NULL
       OR v_operation.actual_sent_at IS NOT NULL
       OR EXISTS (
         SELECT 1
         FROM public.machine_outsourcing_transport_needs AS need
         JOIN public.machine_outsourcing_transport_orders AS trip
           ON trip.id = need.transport_order_id
         WHERE need.operation_id = v_operation.id
           AND trip.status IN ('in_transit', 'completed')
       ) THEN
      RAISE EXCEPTION 'После отправки изменения принимаются отдельным дозаказом';
    END IF;

    UPDATE public.transport_trip_need_links
    SET released_at = now(),
        released_reason = 'Состав VRB изменен до отправки',
        released_by = p_actor,
        pickup_stop_id = NULL,
        delivery_stop_id = NULL
    WHERE need_source = 'outsourcing'
      AND need_id IN (
        SELECT id
        FROM public.machine_outsourcing_transport_needs
        WHERE operation_id = v_operation.id
      )
      AND released_at IS NULL;

    UPDATE public.machine_outsourcing_transport_needs
    SET status = 'cancelled',
        transport_order_id = NULL,
        updated_at = now()
    WHERE operation_id = v_operation.id
      AND status IN ('open', 'linked');

    PERFORM public.vrb_replace_operation_snapshot(v_operation.id, v_operation.machine_id, false);

    SELECT count(*) INTO v_snapshot_count
    FROM public.machine_outsourcing_vrb_items
    WHERE operation_id = v_operation.id;

    UPDATE public.machine_outsourcing_operations
    SET supplier_id = NULL,
        planned_send_date = NULL,
        planned_return_date = NULL,
        service_cost_planned = NULL,
        supply_terms_confirmed_at = NULL,
        supply_terms_confirmed_by = NULL,
        delivery_method = NULL,
        delivery_carrier_supplier_id = NULL,
        delivery_tracking_number = NULL,
        delivery_cost_planned = NULL,
        delivery_dispatched_at = NULL,
        delivery_dispatched_by = NULL,
        order_changed_at = NULL,
        order_change_decision = 'accepted',
        order_change_resolved_at = now(),
        order_change_resolved_by = p_actor,
        order_change_ignored_fingerprint = NULL,
        updated_by = p_actor,
        updated_at = now()
    WHERE id = v_operation.id;

    IF v_operation.approval_task_id IS NOT NULL THEN
      UPDATE public.tasks
      SET assigned_to = p_actor,
          status = CASE
            WHEN v_snapshot_count = 0 THEN 'cancelled'::public.task_status
            ELSE 'pending'::public.task_status
          END,
          completed_at = NULL,
          updated_at = now()
      WHERE id = v_operation.approval_task_id;
    END IF;

    IF v_snapshot_count = 0 THEN
      UPDATE public.machine_outsourcing_operations
      SET archived_at = now(),
          note = concat_ws(E'\n', note, 'Архивировано: после принятия изменений VRB-позиций не осталось.'),
          updated_by = p_actor,
          updated_at = now()
      WHERE id = v_operation.id;
    END IF;
  ELSE
    SELECT md5(COALESCE(string_agg(
      format(
        '%s:%s:%s:%s:%s:%s',
        item.id,
        item.product_id,
        item.quantity,
        item.weight,
        item.product_name,
        item.drawing_number
      ),
      '|' ORDER BY item.id
    ), '')) INTO v_current_fingerprint
    FROM public.machine_items AS item
    JOIN public.products AS product
      ON product.id = item.product_id
     AND product.requires_vrb_mesh = true
    WHERE item.machine_id = v_operation.machine_id
      AND COALESCE(item.is_sample, false) = false
      AND item.quantity > 0;

    UPDATE public.machine_outsourcing_operations
    SET order_changed_at = NULL,
        order_change_decision = 'kept_original',
        order_change_resolved_at = now(),
        order_change_resolved_by = p_actor,
        order_change_ignored_fingerprint = v_current_fingerprint,
        updated_by = p_actor,
        updated_at = now()
    WHERE id = v_operation.id;
  END IF;
END;
$$;

ALTER TABLE public.machine_outsourcing_vrb_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_outsourcing_vrb_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS machine_outsourcing_vrb_items_select
  ON public.machine_outsourcing_vrb_items;
CREATE POLICY machine_outsourcing_vrb_items_select
  ON public.machine_outsourcing_vrb_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.machine_outsourcing_operations AS operation
      JOIN public.machines AS machine ON machine.id = operation.machine_id
      WHERE operation.id = machine_outsourcing_vrb_items.operation_id
        AND (
          public.is_director()
          OR machine.factory_id = public.get_user_factory_id()
          OR public.get_user_role() IN (
            'sales_manager', 'production_manager', 'supply_manager', 'procurement_head'
          )
        )
    )
  );

DROP POLICY IF EXISTS machine_outsourcing_vrb_receipts_select
  ON public.machine_outsourcing_vrb_receipts;
CREATE POLICY machine_outsourcing_vrb_receipts_select
  ON public.machine_outsourcing_vrb_receipts
  FOR SELECT TO authenticated
  USING (
    public.is_director()
    OR factory_id = public.get_user_factory_id()
    OR public.get_user_role() IN ('supply_manager', 'procurement_head')
  );

DROP POLICY IF EXISTS machine_outsourcing_vrb_items_service_role_modify
  ON public.machine_outsourcing_vrb_items;
CREATE POLICY machine_outsourcing_vrb_items_service_role_modify
  ON public.machine_outsourcing_vrb_items
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS machine_outsourcing_vrb_receipts_service_role_modify
  ON public.machine_outsourcing_vrb_receipts;
CREATE POLICY machine_outsourcing_vrb_receipts_service_role_modify
  ON public.machine_outsourcing_vrb_receipts
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.machine_outsourcing_vrb_items TO authenticated;
GRANT SELECT ON public.machine_outsourcing_vrb_receipts TO authenticated;

REVOKE ALL ON FUNCTION public.vrb_replace_operation_snapshot(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_vrb_mesh_for_machine(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vrb_ensure_approval_task(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vrb_machine_change_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_vrb_mesh_completion()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vrb_operation_dispatch_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vrb_transport_trip_status_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_receive_vrb_mesh(uuid, jsonb, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_resolve_vrb_order_change(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.vrb_replace_operation_snapshot(uuid, uuid, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_vrb_mesh_for_machine(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.vrb_ensure_approval_task(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_receive_vrb_mesh(uuid, jsonb, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_resolve_vrb_order_change(uuid, text, uuid)
  TO service_role;

COMMENT ON COLUMN public.products.requires_vrb_mesh IS
  'Creates a VRB mesh outsourcing request when an order containing the product is confirmed.';
COMMENT ON COLUMN public.machine_outsourcing_operations.operation_kind IS
  'standard is a production stage; vrb_mesh is a non-blocking purchasing risk.';
COMMENT ON TABLE public.machine_outsourcing_vrb_items IS
  'Frozen VRB request lines. Source order line may be deleted without losing the request.';
COMMENT ON TABLE public.machine_outsourcing_vrb_receipts IS
  'Partial warehouse receipts for VRB mesh; these rows do not create inventory stock.';
