-- Refresh the frozen m.* projection after machines gained creation_year and
-- annual_order_number. A PostgreSQL view does not acquire later table columns.
DROP VIEW IF EXISTS public.machines_with_totals;

CREATE VIEW public.machines_with_totals AS
SELECT
  m.*,
  COALESCE(
    (SELECT SUM(mi.weight * mi.quantity) / 1000
     FROM public.machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) AS total_weight,
  COALESCE(
    (SELECT SUM(mi.price * mi.quantity)
     FROM public.machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) AS total_items_cost,
  COALESCE(
    (SELECT SUM(me.amount)
     FROM public.machine_expenses me
     WHERE me.machine_id = m.id),
    0
  ) AS total_expenses,
  COALESCE(
    (SELECT SUM(mi.price * mi.quantity)
     FROM public.machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) + COALESCE(
    (SELECT SUM(me.amount)
     FROM public.machine_expenses me
     WHERE me.machine_id = m.id),
    0
  ) AS total_cost,
  COALESCE(
    (SELECT COUNT(mi.id)
     FROM public.machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) AS item_count,
  EXISTS(
    SELECT 1
    FROM public.machine_items mi
    WHERE mi.machine_id = m.id
      AND mi.coating IN ('zinc', 'cold_zinc')
  ) AS has_zinc,
  EXISTS(
    SELECT 1
    FROM public.machine_items mi
    WHERE mi.machine_id = m.id
      AND mi.coating = 'powder_coating'
  ) AS has_painting,
  EXISTS(
    SELECT 1
    FROM public.machine_items mi
    WHERE mi.machine_id = m.id
      AND mi.coating = 'zinc'
  ) AS has_hot_zinc,
  EXISTS(
    SELECT 1
    FROM public.machine_items mi
    WHERE mi.machine_id = m.id
      AND mi.coating = 'cold_zinc'
  ) AS has_cold_zinc
FROM public.machines m;

DO $$
DECLARE v_columns text;
BEGIN
  REVOKE SELECT ON public.machines_with_totals FROM authenticated;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'machines_with_totals'
    AND column_name <> ALL (ARRAY['freight_cost', 'total_items_cost', 'total_expenses', 'total_cost']);
  EXECUTE format('GRANT SELECT (%s) ON public.machines_with_totals TO authenticated', v_columns);
  GRANT SELECT ON public.machines_with_totals TO service_role;
END;
$$;

-- Keep the database guard for detailing receipt aligned with the department
-- access matrix used by the application. The legacy RPC only checked users.role,
-- so a permission granted in Administration -> Access was rejected by the RPC.

CREATE OR REPLACE FUNCTION public.crm_user_has_resource_permission(
  p_actor uuid,
  p_resource_key text,
  p_manage boolean DEFAULT false
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH actor AS (
    SELECT app_user.id, app_user.role
    FROM public.users app_user
    WHERE app_user.id = p_actor
      AND app_user.is_active
      AND auth.uid() = p_actor
  ), department_rows AS (
    SELECT permission.resource_key, permission.can_view, permission.can_manage
    FROM actor
    JOIN public.department_members member ON member.user_id = actor.id
    JOIN public.department_access_permissions permission
      ON permission.department_id = member.department_id
     AND permission.subject_scope = CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END
  )
  SELECT EXISTS (
    SELECT 1
    FROM actor
    WHERE public.crm_user_is_admin(actor.id)
      OR EXISTS (
        SELECT 1
        FROM department_rows permission
        WHERE permission.resource_key = p_resource_key
          AND CASE WHEN p_manage
            THEN permission.can_manage
            ELSE permission.can_view OR permission.can_manage
          END
      )
      OR (
        NOT EXISTS (SELECT 1 FROM department_rows)
        AND EXISTS (
          SELECT 1
          FROM public.role_permissions permission
          WHERE permission.role = actor.role
            AND permission.resource_key = p_resource_key
            AND CASE WHEN p_manage
              THEN permission.can_manage
              ELSE permission.can_view OR permission.can_manage
            END
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.crm_user_has_resource_permission(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_user_has_resource_permission(uuid, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_receive_detailing_transfer(
  p_transfer_id uuid,
  p_items jsonb,
  p_actor uuid
) RETURNS public.detailing_transfer_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer public.detailing_transfers%ROWTYPE;
  v_payload jsonb;
  v_item public.detailing_transfer_items%ROWTYPE;
  v_reservation public.detailing_reservations%ROWTYPE;
  v_source_allocation public.detailing_reservation_allocations%ROWTYPE;
  v_source_balance public.detailing_balances%ROWTYPE;
  v_actual integer;
  v_remaining integer;
  v_extra integer;
  v_processed integer := 0;
BEGIN
  IF NOT public.crm_user_has_resource_permission(
    p_actor,
    'inventory_detailing_receiving',
    true
  ) THEN
    RAISE EXCEPTION 'Недостаточно прав для приёмки деталировки';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Укажите фактически принятое количество';
  END IF;

  SELECT * INTO v_transfer
  FROM public.detailing_transfers
  WHERE id = p_transfer_id
    AND status IN ('needs_date', 'scheduled', 'partially_received')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Активная перевозка деталировки не найдена'; END IF;

  FOR v_payload IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_actual := (v_payload ->> 'quantity')::integer;
      SELECT * INTO v_item
      FROM public.detailing_transfer_items
      WHERE id = (v_payload ->> 'item_id')::uuid
        AND transfer_id = p_transfer_id
      FOR UPDATE;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Некорректная строка приёмки деталировки';
    END;
    IF NOT FOUND THEN RAISE EXCEPTION 'Позиция перевозки не найдена'; END IF;
    IF v_actual < 0 THEN RAISE EXCEPTION 'Фактическое количество не может быть отрицательным'; END IF;
    IF v_actual = 0 THEN CONTINUE; END IF;

    SELECT * INTO v_reservation
    FROM public.detailing_reservations
    WHERE id = v_item.reservation_id
    FOR UPDATE;

    SELECT * INTO v_source_allocation
    FROM public.detailing_reservation_allocations
    WHERE reservation_id = v_item.reservation_id
      AND factory_id = v_transfer.source_factory_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Бронь на складе-источнике не найдена'; END IF;

    SELECT * INTO v_source_balance
    FROM public.detailing_balances
    WHERE part_id = v_item.part_id
      AND factory_id = v_transfer.source_factory_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Остаток на складе-источнике не найден'; END IF;

    v_remaining := v_item.requested_quantity - v_item.received_quantity;
    v_extra := GREATEST(v_actual - v_remaining, 0);
    IF v_extra > v_source_balance.available_quantity THEN
      RAISE EXCEPTION 'Сверхплановая приёмка невозможна: свободно только % шт.', v_source_balance.available_quantity;
    END IF;

    IF v_extra > 0 THEN
      UPDATE public.detailing_balances
      SET reserved_quantity = reserved_quantity + v_extra,
          updated_by = p_actor
      WHERE id = v_source_balance.id;

      UPDATE public.detailing_reservation_allocations
      SET quantity = quantity + v_extra
      WHERE id = v_source_allocation.id;

      UPDATE public.detailing_reservations
      SET requested_quantity = requested_quantity + v_extra
      WHERE id = v_reservation.id;

      UPDATE public.detailing_transfer_items
      SET requested_quantity = requested_quantity + v_extra
      WHERE id = v_item.id;

      PERFORM public.detailing_record_movement(
        v_item.part_id, v_transfer.source_factory_id, 'reserve', 0, v_extra, p_actor,
        v_transfer.machine_id, v_reservation.id, v_transfer.id, NULL,
        'Дополнительная бронь при сверхплановой приёмке'
      );
    END IF;

    IF v_source_allocation.quantity + v_extra < v_actual THEN
      RAISE EXCEPTION 'В источнике недостаточно забронированных деталей для приёмки';
    END IF;

    UPDATE public.detailing_balances
    SET on_hand_quantity = on_hand_quantity - v_actual,
        reserved_quantity = reserved_quantity - v_actual,
        updated_by = p_actor
    WHERE id = v_source_balance.id;

    INSERT INTO public.detailing_balances(
      part_id, factory_id, on_hand_quantity, reserved_quantity, updated_by
    ) VALUES (
      v_item.part_id, v_transfer.destination_factory_id, v_actual, v_actual, p_actor
    )
    ON CONFLICT (part_id, factory_id) DO UPDATE
    SET on_hand_quantity = public.detailing_balances.on_hand_quantity + EXCLUDED.on_hand_quantity,
        reserved_quantity = public.detailing_balances.reserved_quantity + EXCLUDED.reserved_quantity,
        updated_by = p_actor;

    UPDATE public.detailing_reservation_allocations
    SET quantity = quantity - v_actual
    WHERE id = v_source_allocation.id;

    INSERT INTO public.detailing_reservation_allocations(reservation_id, factory_id, quantity)
    VALUES (v_reservation.id, v_transfer.destination_factory_id, v_actual)
    ON CONFLICT (reservation_id, factory_id) DO UPDATE
    SET quantity = public.detailing_reservation_allocations.quantity + EXCLUDED.quantity;

    UPDATE public.detailing_transfer_items
    SET received_quantity = received_quantity + v_actual
    WHERE id = v_item.id;

    PERFORM public.detailing_record_movement(
      v_item.part_id, v_transfer.source_factory_id, 'transfer_out', -v_actual, -v_actual, p_actor,
      v_transfer.machine_id, v_reservation.id, v_transfer.id, NULL,
      'Межскладская приёмка: списано со склада-источника'
    );
    PERFORM public.detailing_record_movement(
      v_item.part_id, v_transfer.destination_factory_id, 'transfer_in', v_actual, v_actual, p_actor,
      v_transfer.machine_id, v_reservation.id, v_transfer.id, NULL,
      'Межскладская приёмка: принято на склад назначения'
    );

    v_processed := v_processed + v_actual;
  END LOOP;

  IF v_processed = 0 THEN RAISE EXCEPTION 'Укажите количество больше 0 хотя бы для одной позиции'; END IF;
  RETURN public.detailing_refresh_transfer_status(p_transfer_id, p_actor);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_receive_detailing_transfer(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_receive_detailing_transfer(uuid, jsonb, uuid) TO authenticated, service_role;
