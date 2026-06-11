CREATE INDEX IF NOT EXISTS idx_inv_transactions_material_created
ON inventory_transactions(material_id, created_at DESC);
