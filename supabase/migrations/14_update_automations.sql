/* Обновить триггер автосоздания этапов производства */
/* Теперь при создании машины этапы создаются БЕЗ привязки к покрытию */
/* (покрытие определяется по товарам, которых ещё нет на момент создания) */
/* Логика обязательности цинка/малярки переносится на UI */

/* Обновить триггер инвойса: */
/* amount теперь = total_cost из view (не из machines.invoice_amount) */
CREATE OR REPLACE FUNCTION fn_upsert_invoice_on_shipping()
RETURNS TRIGGER AS $$
DECLARE
  v_machine machines%ROWTYPE;
  v_total_cost decimal;
BEGIN
  IF NEW.stage_type = 'shipping' AND NEW.date_end IS NOT NULL THEN
    SELECT * INTO v_machine FROM machines WHERE id = NEW.machine_id;
    
    /* Считаем total_cost из товаров + расходов */
    SELECT
      COALESCE(SUM(mi.price * mi.quantity), 0) +
      COALESCE((SELECT SUM(me.amount) FROM machine_expenses me WHERE me.machine_id = NEW.machine_id), 0)
    INTO v_total_cost
    FROM machine_items mi
    WHERE mi.machine_id = NEW.machine_id;

    INSERT INTO invoices (machine_id, amount, payment_date, status)
    VALUES (
      NEW.machine_id,
      v_total_cost,
      NEW.date_end + INTERVAL '14 days',
      'not_paid'
    )
    ON CONFLICT (machine_id) DO UPDATE SET
      amount = v_total_cost,
      payment_date = NEW.date_end + INTERVAL '14 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
