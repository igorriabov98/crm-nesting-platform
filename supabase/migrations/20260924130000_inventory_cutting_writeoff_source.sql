-- Preserve the exact reservation consumed by each future cutting write-off.
-- Existing transactions stay unchanged: equal amounts can represent different receipts.
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS source_reservation_id uuid
    REFERENCES public.inventory_reservations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inventory_transactions_source_reservation_idx
  ON public.inventory_transactions(source_reservation_id)
  WHERE source_reservation_id IS NOT NULL;

DO $$
DECLARE
  v_definition text;
  v_before text := $fragment$
    INSERT INTO public.inventory_transactions (
      factory_id,
      inventory_id,
      material_id,
      material_variant_id,
      transaction_type,
      quantity,
      secondary_quantity,
      machine_id,
      request_item_table,
      request_item_id,
      performed_by,
      comment
    )
    SELECT
      inventory.factory_id,
      event_reservation.inventory_id,
      event_reservation.material_id,
      event_reservation.material_variant_id,
      'write_off'::public.inventory_transaction_type,
      -COALESCE(event_reservation.consumed_quantity, event_reservation.reserved_quantity),
      CASE
        WHEN event_reservation.consumed_secondary_quantity IS NULL THEN NULL
        ELSE -event_reservation.consumed_secondary_quantity
      END,
      v_fact.machine_id,
      event_reservation.request_item_table,
      event_reservation.request_item_id,
      p_performed_by,
      'Автоматическое списание потребности по факту заготовки'$fragment$;
  v_after text := $fragment$
    INSERT INTO public.inventory_transactions (
      factory_id,
      inventory_id,
      material_id,
      material_variant_id,
      transaction_type,
      quantity,
      secondary_quantity,
      machine_id,
      request_item_table,
      request_item_id,
      source_reservation_id,
      performed_by,
      comment
    )
    SELECT
      inventory.factory_id,
      event_reservation.inventory_id,
      event_reservation.material_id,
      event_reservation.material_variant_id,
      'write_off'::public.inventory_transaction_type,
      -COALESCE(event_reservation.consumed_quantity, event_reservation.reserved_quantity),
      CASE
        WHEN event_reservation.consumed_secondary_quantity IS NULL THEN NULL
        ELSE -event_reservation.consumed_secondary_quantity
      END,
      v_fact.machine_id,
      event_reservation.request_item_table,
      event_reservation.request_item_id,
      event_reservation.reservation_id,
      p_performed_by,
      'Автоматическое списание потребности по факту заготовки'$fragment$;
BEGIN
  SELECT pg_get_functiondef(
    'public.fn_apply_production_fact_cutting_before_long_stock_return(uuid,uuid)'::regprocedure
  ) INTO v_definition;
  IF v_definition IS NULL OR length(v_definition) - length(replace(v_definition, v_before, '')) <> length(v_before) THEN
    RAISE EXCEPTION 'Unexpected cutting write-off function definition; migration not applied';
  END IF;
  EXECUTE replace(v_definition, v_before, v_after);
END $$;
