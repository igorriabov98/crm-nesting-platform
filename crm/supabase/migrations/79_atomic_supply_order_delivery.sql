-- Make supply delivery atomic and keep supplier/length data on the request row.

ALTER TABLE request_circle ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE request_pipe ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE request_knives ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE request_components ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE request_paint ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE request_mesh ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE request_chain_cord ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id);

CREATE OR REPLACE FUNCTION fn_mark_supply_order_delivered(
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

    PERFORM fn_add_inventory_receipt(
      v_material_id,
      v_quantity,
      v_unit,
      p_performed_by,
      COALESCE(v_comment, 'Приход по листу закупки'),
      v_secondary_quantity,
      v_secondary_unit,
      v_supplier_id,
      v_material_variant_id,
      v_piece_length_mm
    );

    EXECUTE format('UPDATE %I SET order_status = $1, delivered_at = now(), supplier_id = $2 WHERE id = $3', v_table)
      USING 'delivered'::order_item_status, v_supplier_id, v_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
