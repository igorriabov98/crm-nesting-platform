DROP POLICY IF EXISTS "Authenticated delete" ON supplier_delivery_days;
DROP POLICY IF EXISTS "Authenticated delete" ON supplier_material_categories;

CREATE POLICY "Authenticated delete" ON supplier_delivery_days
FOR DELETE TO authenticated
USING (true);

CREATE POLICY "Authenticated delete" ON supplier_material_categories
FOR DELETE TO authenticated
USING (true);
