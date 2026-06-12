DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_terms_type') THEN
    CREATE TYPE payment_terms_type AS ENUM ('invoice_days', 'delivery_days', 'prepayment_full');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  primary_contact_name text,
  phone text,
  email text,
  country_city text,
  address text,
  notes text,
  payment_terms_type payment_terms_type NOT NULL DEFAULT 'invoice_days',
  payment_due_days integer NOT NULL DEFAULT 14 CHECK (payment_due_days >= 0),
  prepayment_percent numeric(5,2) CHECK (prepayment_percent IS NULL OR (prepayment_percent >= 0 AND prepayment_percent <= 100)),
  final_payment_due_days integer CHECK (final_payment_due_days IS NULL OR final_payment_due_days >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text,
  email text,
  role_description text,
  is_primary boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_client_contacts_client_id ON client_contacts(client_id);

ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id),
  ADD COLUMN IF NOT EXISTS payment_terms_type payment_terms_type NOT NULL DEFAULT 'invoice_days',
  ADD COLUMN IF NOT EXISTS payment_due_days integer NOT NULL DEFAULT 14 CHECK (payment_due_days >= 0),
  ADD COLUMN IF NOT EXISTS prepayment_percent numeric(5,2) CHECK (prepayment_percent IS NULL OR (prepayment_percent >= 0 AND prepayment_percent <= 100)),
  ADD COLUMN IF NOT EXISTS final_payment_due_days integer CHECK (final_payment_due_days IS NULL OR final_payment_due_days >= 0);

CREATE INDEX IF NOT EXISTS idx_machines_client_id ON machines(client_id);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_due_date date,
  ADD COLUMN IF NOT EXISTS payment_note text;

UPDATE invoices
SET due_date = COALESCE(due_date, payment_date)
WHERE due_date IS NULL;

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

CREATE OR REPLACE FUNCTION fn_machine_invoice_due_date(p_machine machines, p_invoice_date date)
RETURNS date AS $$
BEGIN
  IF p_machine.payment_terms_type = 'delivery_days' THEN
    RETURN p_machine.delivery_to_client_date + (p_machine.payment_due_days || ' days')::interval;
  END IF;

  IF p_machine.payment_terms_type = 'prepayment_full' THEN
    RETURN p_machine.delivery_to_client_date + (COALESCE(p_machine.final_payment_due_days, p_machine.payment_due_days) || ' days')::interval;
  END IF;

  RETURN p_invoice_date + (p_machine.payment_due_days || ' days')::interval;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION fn_upsert_invoice_on_delivery()
RETURNS TRIGGER AS $$
DECLARE
  v_total_cost decimal;
  v_invoice_date date := CURRENT_DATE;
  v_due_date date;
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

    v_due_date := fn_machine_invoice_due_date(NEW, v_invoice_date);

    INSERT INTO invoices (machine_id, amount, invoice_date, payment_date, due_date, status)
    VALUES (NEW.id, v_total_cost, v_invoice_date, v_due_date, v_due_date, 'not_paid')
    ON CONFLICT (machine_id) DO UPDATE SET
      amount = v_total_cost,
      payment_date = v_due_date,
      due_date = v_due_date,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_upsert_invoice_on_delivery ON machines;
CREATE TRIGGER trg_upsert_invoice_on_delivery
  AFTER UPDATE OF delivery_to_client_date ON machines
  FOR EACH ROW
  EXECUTE FUNCTION fn_upsert_invoice_on_delivery();
