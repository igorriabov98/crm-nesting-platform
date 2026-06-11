DROP POLICY IF EXISTS "Authenticated delete request_sheet_metal" ON request_sheet_metal;
DROP POLICY IF EXISTS "Authenticated delete" ON request_sheet_metal;
CREATE POLICY "Authenticated delete request_sheet_metal"
  ON request_sheet_metal FOR DELETE TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated delete request_round_tube" ON request_round_tube;
DROP POLICY IF EXISTS "Authenticated delete" ON request_round_tube;
CREATE POLICY "Authenticated delete request_round_tube"
  ON request_round_tube FOR DELETE TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated delete request_knives" ON request_knives;
DROP POLICY IF EXISTS "Authenticated delete" ON request_knives;
CREATE POLICY "Authenticated delete request_knives"
  ON request_knives FOR DELETE TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated delete request_components" ON request_components;
DROP POLICY IF EXISTS "Authenticated delete" ON request_components;
CREATE POLICY "Authenticated delete request_components"
  ON request_components FOR DELETE TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated delete request_paint" ON request_paint;
DROP POLICY IF EXISTS "Authenticated delete" ON request_paint;
CREATE POLICY "Authenticated delete request_paint"
  ON request_paint FOR DELETE TO authenticated
  USING (true);
