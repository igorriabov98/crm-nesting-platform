CREATE OR REPLACE FUNCTION receive_consumable_request(
  p_request_id UUID,
  p_quantity NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request consumable_requests%ROWTYPE;
  v_item consumables%ROWTYPE;
  v_total NUMERIC(14,3);
  v_remaining NUMERIC(14,3);
  v_new_status consumable_request_status;
  v_head UUID;
  v_today DATE := (now() AT TIME ZONE 'Europe/Kyiv')::date;
BEGIN
  SELECT * INTO v_request
  FROM consumable_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявка не найдена'; END IF;
  IF NOT consumables_can_manage_factory(v_request.factory_id) THEN
    RAISE EXCEPTION 'Недостаточно прав для получения на этом заводе';
  END IF;
  IF v_request.status <> 'delivery' THEN
    RAISE EXCEPTION 'Получение доступно только для заявки в доставке';
  END IF;
  IF p_quantity <= 0 OR p_quantity > (v_request.requested_quantity - v_request.received_quantity) THEN
    RAISE EXCEPTION 'Некорректное количество получения';
  END IF;

  SELECT * INTO v_item FROM consumables WHERE id = v_request.consumable_id;
  PERFORM consumables_apply_stock_movement(
    v_request.consumable_id,
    'request_receipt',
    p_quantity,
    'Получение по заявке',
    p_request_id,
    auth.uid()
  );

  INSERT INTO consumable_request_receipts(request_id, quantity, received_by)
  VALUES (p_request_id, p_quantity, auth.uid());

  v_total := v_request.received_quantity + p_quantity;
  v_remaining := v_request.requested_quantity - v_total;
  v_new_status := CASE
    WHEN v_remaining = 0 THEN 'received'::consumable_request_status
    ELSE 'delivery'::consumable_request_status
  END;

  IF v_remaining = 0 THEN
    UPDATE consumable_requests
    SET received_quantity = v_total,
        status = v_new_status,
        completed_at = now(),
        updated_at = now()
    WHERE id = p_request_id;

    UPDATE tasks
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE consumable_request_id = p_request_id
      AND task_type::text = 'consumable_request_shortage'
      AND status IN ('pending', 'in_progress');
  ELSE
    UPDATE consumable_requests
    SET received_quantity = v_total, updated_at = now()
    WHERE id = p_request_id;

    v_head := consumables_supply_department_head();
    IF NOT EXISTS (
      SELECT 1 FROM tasks
      WHERE consumable_request_id = p_request_id
        AND task_type::text = 'consumable_request_shortage'
        AND status IN ('pending', 'in_progress')
    ) THEN
      INSERT INTO tasks(
        machine_id,
        assigned_to,
        task_type,
        title,
        description,
        status,
        start_date,
        deadline,
        consumable_request_id
      )
      VALUES (
        NULL,
        v_head,
        'consumable_request_shortage',
        'Недопоставка расходника: ' || v_item.name,
        'Получено ' || trim(to_char(v_total, 'FM999999990.999')) || ' из ' ||
          trim(to_char(v_request.requested_quantity, 'FM999999990.999')) || ' ' || v_item.unit ||
          '. Осталось доставить: ' || trim(to_char(v_remaining, 'FM999999990.999')) || ' ' || v_item.unit || '.',
        'pending',
        v_today,
        v_today,
        p_request_id
      );
    END IF;

    PERFORM consumables_notify_supply(
      p_request_id,
      'consumable_request_shortage',
      'Расходник получен не полностью',
      v_item.name || ': получено ' || trim(to_char(v_total, 'FM999999990.999')) || ' из ' ||
        trim(to_char(v_request.requested_quantity, 'FM999999990.999')) || ' ' || v_item.unit
    );
    PERFORM consumables_notify_production(
      v_request.factory_id,
      p_request_id,
      'consumable_request_partial_receipt',
      'Частичное получение',
      v_item.name || ': осталось получить ' || trim(to_char(v_remaining, 'FM999999990.999')) || ' ' || v_item.unit
    );
  END IF;

  INSERT INTO consumable_request_events(request_id, event_type, old_status, new_status, details, created_by)
  VALUES (
    p_request_id,
    'receipt',
    v_request.status,
    v_new_status,
    jsonb_build_object('quantity', p_quantity, 'received_total', v_total, 'remaining', v_remaining),
    auth.uid()
  );

  PERFORM sync_consumable_auto_draft(v_request.consumable_id);
END;
$$;

GRANT EXECUTE ON FUNCTION receive_consumable_request(UUID, NUMERIC) TO authenticated, service_role;
