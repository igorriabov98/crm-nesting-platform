CREATE TABLE IF NOT EXISTS public.nesting_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nesting_project_id text NOT NULL UNIQUE,
  order_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'parsing', 'parsed', 'calculating', 'done', 'error')),
  error_message text,
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.nesting_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.nesting_batches(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  machine_item_id uuid NOT NULL REFERENCES public.machine_items(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  step_file_id uuid NOT NULL REFERENCES public.product_files(id) ON DELETE RESTRICT,
  drawing_file_id uuid NOT NULL REFERENCES public.product_files(id) ON DELETE RESTRICT,
  quantity_multiplier numeric NOT NULL DEFAULT 1 CHECK (quantity_multiplier > 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id, machine_item_id)
);

ALTER TABLE public.machine_item_nesting_runs
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.nesting_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_nesting_batches_project ON public.nesting_batches(nesting_project_id);
CREATE INDEX IF NOT EXISTS idx_nesting_batches_status ON public.nesting_batches(status);
CREATE INDEX IF NOT EXISTS idx_nesting_batch_items_batch ON public.nesting_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_nesting_batch_items_machine ON public.nesting_batch_items(machine_id);
CREATE INDEX IF NOT EXISTS idx_nesting_batch_items_item ON public.nesting_batch_items(machine_item_id);
CREATE INDEX IF NOT EXISTS idx_machine_item_nesting_runs_batch ON public.machine_item_nesting_runs(batch_id);

ALTER TABLE public.nesting_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nesting_batch_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Nesting managers read nesting batches" ON public.nesting_batches;
DROP POLICY IF EXISTS "Nesting managers insert nesting batches" ON public.nesting_batches;
DROP POLICY IF EXISTS "Nesting managers update nesting batches" ON public.nesting_batches;
DROP POLICY IF EXISTS "Nesting managers delete nesting batches" ON public.nesting_batches;

CREATE POLICY "Nesting managers read nesting batches"
  ON public.nesting_batches FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));

CREATE POLICY "Nesting managers insert nesting batches"
  ON public.nesting_batches FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));

CREATE POLICY "Nesting managers update nesting batches"
  ON public.nesting_batches FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'))
  WITH CHECK (public.get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));

CREATE POLICY "Nesting managers delete nesting batches"
  ON public.nesting_batches FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));

DROP POLICY IF EXISTS "Nesting managers read nesting batch items" ON public.nesting_batch_items;
DROP POLICY IF EXISTS "Nesting managers insert nesting batch items" ON public.nesting_batch_items;
DROP POLICY IF EXISTS "Nesting managers update nesting batch items" ON public.nesting_batch_items;
DROP POLICY IF EXISTS "Nesting managers delete nesting batch items" ON public.nesting_batch_items;

CREATE POLICY "Nesting managers read nesting batch items"
  ON public.nesting_batch_items FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));

CREATE POLICY "Nesting managers insert nesting batch items"
  ON public.nesting_batch_items FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));

CREATE POLICY "Nesting managers update nesting batch items"
  ON public.nesting_batch_items FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'))
  WITH CHECK (public.get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));

CREATE POLICY "Nesting managers delete nesting batch items"
  ON public.nesting_batch_items FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('technologist', 'planning_director', 'financial_director', 'commercial_director'));
