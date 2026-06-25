CREATE OR REPLACE FUNCTION public.consumables_can_adjust_stock()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.is_active = true
      AND (
        u.role::text = 'planning_director'
        OR EXISTS (
          SELECT 1
          FROM public.department_members dm
          JOIN public.departments d ON d.id = dm.department_id
          LEFT JOIN public.positions p ON p.id = dm.position_id
          WHERE dm.user_id = u.id
            AND dm.is_department_head = true
            AND (
              lower(replace(COALESCE(d.name, ''), 'ё', 'е')) LIKE '%планирован%'
              OR lower(replace(COALESCE(p.name, ''), 'ё', 'е')) LIKE '%планирован%'
            )
        )
        OR (
          EXISTS (
            SELECT 1
            FROM public.department_members dm
            JOIN public.positions p ON p.id = dm.position_id
            WHERE dm.user_id = u.id
              AND p.is_active = true
              AND p.name = 'Администратор CRM'
          )
          AND (
            lower(regexp_replace(replace(COALESCE(u.full_name, ''), 'ё', 'е'), '\s+', ' ', 'g')) IN (
              'игорь рябов',
              'игор рябов',
              'igor riabov',
              'ihor riabov'
            )
            OR lower(COALESCE(u.email, '')) LIKE '%igorriabov%'
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.record_consumable_stock_operation(
  p_consumable_id UUID,
  p_operation consumable_movement_type,
  p_quantity NUMERIC,
  p_comment TEXT DEFAULT NULL,
  p_new_balance NUMERIC DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_factory UUID;
  v_current NUMERIC(14,3);
  v_delta NUMERIC(14,3);
BEGIN
  SELECT factory_id INTO v_factory FROM consumables WHERE id = p_consumable_id;
  IF v_factory IS NULL THEN RAISE EXCEPTION 'Расходник не найден'; END IF;
  IF NOT consumables_can_manage_factory(v_factory) THEN
    RAISE EXCEPTION 'Недостаточно прав для этого завода';
  END IF;

  IF p_operation = 'manual_receipt' THEN
    RAISE EXCEPTION 'Ручной приход отключен. Приход расходников фиксируется только через получение заявки.';
  ELSIF p_operation = 'consumption' THEN
    IF p_quantity <= 0 THEN RAISE EXCEPTION 'Количество расхода должно быть больше нуля'; END IF;
    v_delta := -p_quantity;
  ELSIF p_operation = 'adjustment' THEN
    IF NOT consumables_can_adjust_stock() THEN
      RAISE EXCEPTION 'Сверка остатков доступна только Игорю Рябову (Администратор CRM) и начальнику отдела планирования.';
    END IF;
    IF p_new_balance IS NULL OR p_new_balance < 0 OR trim(COALESCE(p_comment, '')) = '' THEN
      RAISE EXCEPTION 'Для сверки укажите новый остаток и причину';
    END IF;
    SELECT current_quantity INTO v_current
    FROM consumable_balances
    WHERE consumable_id = p_consumable_id
    FOR UPDATE;
    v_delta := p_new_balance - COALESCE(v_current, 0);
  ELSE
    RAISE EXCEPTION 'Недопустимый тип операции';
  END IF;

  RETURN consumables_apply_stock_movement(
    p_consumable_id,
    p_operation,
    v_delta,
    p_comment,
    NULL,
    auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.consumables_can_adjust_stock() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_consumable_stock_operation(UUID, consumable_movement_type, NUMERIC, TEXT, NUMERIC) TO authenticated, service_role;
