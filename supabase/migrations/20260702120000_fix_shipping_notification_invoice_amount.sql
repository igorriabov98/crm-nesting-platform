-- Fix legacy shipping notification after machines.invoice_amount was removed.
-- Shipping readiness no longer creates invoices; invoices are based on delivery_to_client_date.

DROP TRIGGER IF EXISTS trg_update_payment_date_from_shipping ON production_stages;
DROP TRIGGER IF EXISTS trg_after_shipping_update ON production_stages;
DROP TRIGGER IF EXISTS trg_upsert_invoice_on_shipping ON production_stages;

DROP FUNCTION IF EXISTS update_invoice_payment_date();
DROP FUNCTION IF EXISTS trg_upsert_invoice_on_shipping();
DROP FUNCTION IF EXISTS fn_upsert_invoice_on_shipping();

CREATE OR REPLACE FUNCTION notify_on_shipping_complete()
RETURNS TRIGGER AS $$
DECLARE
  v_machine_name text;
  v_creator_id uuid;
  v_factory_id uuid;
BEGIN
  IF NEW.stage_type = 'shipping'
     AND NEW.date_end IS NOT NULL
     AND OLD.date_end IS NULL THEN
    SELECT name, created_by, factory_id
    INTO v_machine_name, v_creator_id, v_factory_id
    FROM machines
    WHERE id = NEW.machine_id;

    PERFORM notify_user(
      v_creator_id,
      'готовность_к_погрузке',
      'Готовность к погрузке',
      'Машина ' || v_machine_name || ' готова к погрузке. Дата готовности: ' || NEW.date_end,
      NEW.machine_id
    );

    PERFORM notify_by_role(
      v_factory_id,
      'commercial_director',
      'готовность_к_погрузке',
      'Готовность к погрузке',
      'Машина ' || v_machine_name || ' готова к погрузке. Дата готовности: ' || NEW.date_end,
      NEW.machine_id
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_shipping ON production_stages;
CREATE TRIGGER trg_notify_shipping
AFTER UPDATE OF date_end ON production_stages
FOR EACH ROW
WHEN (NEW.stage_type = 'shipping' AND NEW.date_end IS NOT NULL)
EXECUTE FUNCTION notify_on_shipping_complete();
