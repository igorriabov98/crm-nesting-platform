DO $$
DECLARE
  missing_tables text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.products') IS NULL THEN
    missing_tables := array_append(missing_tables, 'public.products');
  END IF;
  IF to_regclass('public.product_files') IS NULL THEN
    missing_tables := array_append(missing_tables, 'public.product_files');
  END IF;
  IF to_regclass('public.machine_items') IS NULL THEN
    missing_tables := array_append(missing_tables, 'public.machine_items');
  END IF;
  IF to_regclass('public.request_sheet_metal') IS NULL THEN
    missing_tables := array_append(missing_tables, 'public.request_sheet_metal');
  END IF;

  IF array_length(missing_tables, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Missing prerequisite tables for 104_machine_item_nesting_runs.sql: %. Apply 103_product_catalog_and_projects.sql and request-section migrations in this same Supabase project first.', array_to_string(missing_tables, ', ');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS machine_item_nesting_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  machine_item_id uuid NOT NULL REFERENCES machine_items(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  step_file_id uuid NOT NULL REFERENCES product_files(id) ON DELETE RESTRICT,
  drawing_file_id uuid NOT NULL REFERENCES product_files(id) ON DELETE RESTRICT,
  nesting_project_id text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'calculated', 'imported', 'error')),
  quantity_multiplier numeric NOT NULL DEFAULT 1 CHECK (quantity_multiplier > 0),
  error_message text,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(machine_item_id)
);

ALTER TABLE request_sheet_metal
  ADD COLUMN IF NOT EXISTS source_nesting_run_id uuid REFERENCES machine_item_nesting_runs(id) ON DELETE SET NULL;
ALTER TABLE request_sheet_metal
  ADD COLUMN IF NOT EXISTS source_machine_item_id uuid REFERENCES machine_items(id) ON DELETE SET NULL;
ALTER TABLE request_sheet_metal
  ADD COLUMN IF NOT EXISTS source_product_id uuid REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE request_sheet_metal
  ADD COLUMN IF NOT EXISTS source_nesting_project_id text;
ALTER TABLE request_sheet_metal
  ADD COLUMN IF NOT EXISTS source_nesting_sheet_id text;

CREATE INDEX IF NOT EXISTS idx_machine_item_nesting_runs_machine ON machine_item_nesting_runs(machine_id);
CREATE INDEX IF NOT EXISTS idx_machine_item_nesting_runs_project ON machine_item_nesting_runs(nesting_project_id);
CREATE INDEX IF NOT EXISTS idx_request_sheet_metal_source_run ON request_sheet_metal(source_nesting_run_id);
CREATE INDEX IF NOT EXISTS idx_request_sheet_metal_source_item ON request_sheet_metal(source_machine_item_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_request_sheet_metal_source_sheet
  ON request_sheet_metal(request_id, source_nesting_run_id, source_nesting_sheet_id)
  WHERE source_nesting_run_id IS NOT NULL AND source_nesting_sheet_id IS NOT NULL;

ALTER TABLE machine_item_nesting_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Nesting managers read machine item nesting runs" ON machine_item_nesting_runs;
DROP POLICY IF EXISTS "Nesting managers insert machine item nesting runs" ON machine_item_nesting_runs;
DROP POLICY IF EXISTS "Nesting managers update machine item nesting runs" ON machine_item_nesting_runs;
DROP POLICY IF EXISTS "Nesting managers delete machine item nesting runs" ON machine_item_nesting_runs;

CREATE POLICY "Nesting managers read machine item nesting runs"
  ON machine_item_nesting_runs FOR SELECT TO authenticated
  USING (get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));

CREATE POLICY "Nesting managers insert machine item nesting runs"
  ON machine_item_nesting_runs FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));

CREATE POLICY "Nesting managers update machine item nesting runs"
  ON machine_item_nesting_runs FOR UPDATE TO authenticated
  USING (get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'))
  WITH CHECK (get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));

CREATE POLICY "Nesting managers delete machine item nesting runs"
  ON machine_item_nesting_runs FOR DELETE TO authenticated
  USING (get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));
