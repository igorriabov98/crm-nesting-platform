/* Удаляем старые поля из machines */
/* (tonnage, product, coating, ral_number, invoice_amount, drawings) */
/* Они переехали в machine_items и machine_expenses */
ALTER TABLE machines DROP COLUMN IF EXISTS tonnage;
ALTER TABLE machines DROP COLUMN IF EXISTS product;
ALTER TABLE machines DROP COLUMN IF EXISTS coating;
ALTER TABLE machines DROP COLUMN IF EXISTS ral_number;
ALTER TABLE machines DROP COLUMN IF EXISTS invoice_amount;
ALTER TABLE machines DROP COLUMN IF EXISTS drawings;

/* Добавляем computed view для удобства */
CREATE OR REPLACE VIEW machines_with_totals AS
SELECT
  m.*,
  COALESCE(items.total_weight, 0) AS total_weight,
  COALESCE(items.total_items_cost, 0) AS total_items_cost,
  COALESCE(expenses.total_expenses, 0) AS total_expenses,
  COALESCE(items.total_items_cost, 0) + COALESCE(expenses.total_expenses, 0) AS total_cost,
  COALESCE(items.item_count, 0) AS item_count,
  COALESCE(items.has_zinc, false) AS has_zinc,
  COALESCE(items.has_painting, false) AS has_painting
FROM machines m
LEFT JOIN (
  SELECT
    machine_id,
    SUM(weight * quantity) AS total_weight,
    SUM(price * quantity) AS total_items_cost,
    COUNT(*) AS item_count,
    BOOL_OR(coating = 'zinc') AS has_zinc,
    BOOL_OR(coating = 'powder_coating') AS has_painting
  FROM machine_items
  GROUP BY machine_id
) items ON items.machine_id = m.id
LEFT JOIN (
  SELECT
    machine_id,
    SUM(amount) AS total_expenses
  FROM machine_expenses
  GROUP BY machine_id
) expenses ON expenses.machine_id = m.id;
