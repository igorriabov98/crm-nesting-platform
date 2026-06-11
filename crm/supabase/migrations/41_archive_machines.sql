ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archive_reason text;

CREATE INDEX IF NOT EXISTS idx_machines_is_archived ON machines(is_archived);

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
