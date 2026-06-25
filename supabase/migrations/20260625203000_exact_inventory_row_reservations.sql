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

  SELECT * INTO v_inventory
  FROM public.inventory
  WHERE id = p_inventory_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Выбранный складской остаток не найден';
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
        inventory_id, material_id, material_variant_id, transaction_type, quantity,
        secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
      )
      VALUES (
        v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id, 'reserve', -v_full_quantity,
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
          v_inventory.piece_length_mm
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
        inventory_id, material_id, material_variant_id, transaction_type, quantity,
        secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
      )
      VALUES (
        v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id, 'reserve', -v_cut_quantity,
        -1, p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by, 'Раскрой и бронирование выбранного куска'
      );

      IF v_scrap_inventory_id IS NOT NULL THEN
        INSERT INTO public.inventory_transactions (
          inventory_id, material_id, material_variant_id, transaction_type, quantity,
          secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
        )
        VALUES (
          v_scrap_inventory_id, v_inventory.material_id, v_inventory.material_variant_id, 'receipt', v_scrap_quantity,
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
    inventory_id, material_id, material_variant_id, transaction_type, quantity,
    secondary_quantity, machine_id, request_item_table, request_item_id, performed_by
  )
  VALUES (
    v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id, 'reserve', -p_quantity,
    CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE -p_secondary_quantity END,
    p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by
  );

  PERFORM public.fn_set_request_reserved_quantity(p_request_item_table, p_request_item_id);
  RETURN v_reservation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
