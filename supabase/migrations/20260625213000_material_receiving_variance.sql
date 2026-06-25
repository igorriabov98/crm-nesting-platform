ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'supply_material_receipt_shortage';

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS supply_order_schedule_id uuid REFERENCES supply_order_delivery_schedules(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_supply_order_schedule_active_type
  ON tasks(supply_order_schedule_id, assigned_to, task_type)
  WHERE supply_order_schedule_id IS NOT NULL
    AND status IN ('pending', 'in_progress');

DROP FUNCTION IF EXISTS fn_receive_supply_order_schedule(uuid, uuid);

CREATE OR REPLACE FUNCTION fn_receive_supply_order_schedule(
  p_schedule_id uuid,
  p_performed_by uuid,
  p_received_quantity numeric
)
RETURNS void AS $$
DECLARE
  v_schedule supply_order_delivery_schedules%ROWTYPE;
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
  FROM supply_order_delivery_schedules
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

  PERFORM fn_add_inventory_receipt(
    v_material_id,
    v_received_quantity,
    v_schedule.unit,
    p_performed_by,
    'Приход по графику поставки: ' || v_schedule.delivery_date::text || '. План: ' || v_schedule.quantity::text || ', факт: ' || v_received_quantity::text,
    v_secondary_quantity,
    v_secondary_unit,
    v_supplier_id,
    v_material_variant_id,
    v_piece_length_mm
  );

  UPDATE supply_order_delivery_schedules
  SET status = 'delivered',
      received_quantity = v_received_quantity,
      delivered_at = now(),
      received_by = p_performed_by,
      updated_by = p_performed_by,
      updated_at = now()
  WHERE id = p_schedule_id;

  SELECT COALESCE(sum(received_quantity), 0)
  INTO v_delivered_total
  FROM supply_order_delivery_schedules
  WHERE request_item_table = v_schedule.request_item_table
    AND request_item_id = v_schedule.request_item_id
    AND status = 'delivered';

  IF v_delivered_total >= v_required THEN
    EXECUTE format('UPDATE %I SET order_status = $1, delivered_at = now(), supplier_id = COALESCE(supplier_id, $2) WHERE id = $3', v_schedule.request_item_table)
      USING 'delivered'::order_item_status, v_supplier_id, v_schedule.request_item_id;
  END IF;

  SELECT tr.machine_id, m.name
  INTO v_machine_id, v_machine_name
  FROM technologist_requests tr
  LEFT JOIN machines m ON m.id = tr.machine_id
  WHERE tr.id = v_item.request_id
  LIMIT 1;

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

    INSERT INTO meeting_agenda_pool_items (
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

    INSERT INTO notifications (user_id, type, title, message, related_machine_id)
    SELECT id, 'material_receipt_variance', v_title, v_description, v_machine_id
    FROM users
    WHERE role = 'planning_director'
      AND is_active = true;
  END IF;

  IF v_received_quantity < v_schedule.quantity THEN
    v_today := (now() AT TIME ZONE 'Europe/Chisinau')::date;

    SELECT EXISTS (
      SELECT 1 FROM users WHERE role = 'procurement_head' AND is_active = true
    )
    INTO v_has_procurement_head;

    INSERT INTO tasks (
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
      'Разобрать недовес поставки',
      v_description,
      'pending',
      v_today,
      v_today
    FROM users u
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

CREATE OR REPLACE FUNCTION fn_receive_supply_order_schedule(
  p_schedule_id uuid,
  p_performed_by uuid
) RETURNS void AS $$
DECLARE
  v_planned_quantity numeric;
BEGIN
  SELECT quantity
  INTO v_planned_quantity
  FROM supply_order_delivery_schedules
  WHERE id = p_schedule_id;

  IF v_planned_quantity IS NULL THEN
    RAISE EXCEPTION 'График поставки не найден';
  END IF;

  PERFORM fn_receive_supply_order_schedule(
    p_schedule_id,
    p_performed_by,
    v_planned_quantity
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
