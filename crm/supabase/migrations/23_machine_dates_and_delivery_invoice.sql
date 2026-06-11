-- Machine-level planning, material, shipping, and delivery dates.
ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS planned_material_date date,
  ADD COLUMN IF NOT EXISTS actual_material_date date,
  ADD COLUMN IF NOT EXISTS actual_shipping_date date,
  ADD COLUMN IF NOT EXISTS delivery_to_client_date date;

DROP VIEW IF EXISTS machines_with_totals CASCADE;

CREATE VIEW machines_with_totals AS
SELECT
  m.*,
  COALESCE(
    (SELECT SUM(mi.weight * mi.quantity) / 1000
     FROM machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) AS total_weight,
  COALESCE(
    (SELECT SUM(mi.price * mi.quantity)
     FROM machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) AS total_items_cost,
  COALESCE(
    (SELECT SUM(me.amount)
     FROM machine_expenses me
     WHERE me.machine_id = m.id),
    0
  ) AS total_expenses,
  COALESCE(
    (SELECT SUM(mi.price * mi.quantity)
     FROM machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) + COALESCE(
    (SELECT SUM(me.amount)
     FROM machine_expenses me
     WHERE me.machine_id = m.id),
    0
  ) AS total_cost,
  COALESCE(
    (SELECT COUNT(mi.id)
     FROM machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) AS item_count,
  EXISTS(
    SELECT 1
    FROM machine_items mi
    WHERE mi.machine_id = m.id AND mi.coating = 'zinc'
  ) AS has_zinc,
  EXISTS(
    SELECT 1
    FROM machine_items mi
    WHERE mi.machine_id = m.id AND mi.coating = 'powder_coating'
  ) AS has_painting
FROM machines m;

DROP TRIGGER IF EXISTS trg_update_payment_date_from_shipping ON production_stages;
DROP TRIGGER IF EXISTS trg_after_shipping_update ON production_stages;
DROP TRIGGER IF EXISTS trg_upsert_invoice_on_shipping ON production_stages;
DROP TRIGGER IF EXISTS trg_upsert_invoice_on_delivery ON machines;

DROP FUNCTION IF EXISTS update_invoice_payment_date();
DROP FUNCTION IF EXISTS trg_upsert_invoice_on_shipping();
DROP FUNCTION IF EXISTS fn_upsert_invoice_on_shipping();

CREATE OR REPLACE FUNCTION fn_upsert_invoice_on_delivery()
RETURNS TRIGGER AS $$
DECLARE
  v_total_cost decimal;
BEGIN
  IF NEW.delivery_to_client_date IS NOT NULL
     AND (OLD.delivery_to_client_date IS NULL
          OR OLD.delivery_to_client_date != NEW.delivery_to_client_date) THEN
    SELECT
      COALESCE(SUM(mi.price * mi.quantity), 0) +
      COALESCE((SELECT SUM(me.amount) FROM machine_expenses me WHERE me.machine_id = NEW.id), 0)
    INTO v_total_cost
    FROM machine_items mi
    WHERE mi.machine_id = NEW.id;

    INSERT INTO invoices (machine_id, amount, payment_date, status)
    VALUES (NEW.id, v_total_cost, NEW.delivery_to_client_date + INTERVAL '14 days', 'not_paid')
    ON CONFLICT (machine_id) DO UPDATE SET
      amount = v_total_cost,
      payment_date = NEW.delivery_to_client_date + INTERVAL '14 days';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_upsert_invoice_on_delivery
  AFTER UPDATE OF delivery_to_client_date ON machines
  FOR EACH ROW
  EXECUTE FUNCTION fn_upsert_invoice_on_delivery();
