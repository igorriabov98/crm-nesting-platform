ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'product_project_engineering';
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'product_project_sales_review';

DO $$
DECLARE
  existing_constraint text;
BEGIN
  SELECT conname
    INTO existing_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.product_projects'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%'
    AND pg_get_constraintdef(oid) LIKE '%added_to_products%'
  LIMIT 1;

  IF existing_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.product_projects DROP CONSTRAINT %I', existing_constraint);
  END IF;
END $$;

ALTER TABLE public.product_projects
  ALTER COLUMN status SET DEFAULT 'new_project',
  ADD CONSTRAINT product_projects_status_check
    CHECK (status IN ('new_project', 'draft', 'engineering', 'client_review', 'approved', 'added_to_products', 'cancelled'));

ALTER TABLE public.product_project_versions
  ADD COLUMN IF NOT EXISTS name_uk text,
  ADD COLUMN IF NOT EXISTS name_en text,
  ADD COLUMN IF NOT EXISTS uktzed text,
  ADD COLUMN IF NOT EXISTS drawing_number text,
  ADD COLUMN IF NOT EXISTS unit_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS base_price_eur numeric,
  ADD CONSTRAINT product_project_versions_unit_weight_positive
    CHECK (unit_weight_kg IS NULL OR unit_weight_kg > 0),
  ADD CONSTRAINT product_project_versions_base_price_nonnegative
    CHECK (base_price_eur IS NULL OR base_price_eur >= 0);

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS product_project_id uuid REFERENCES public.product_projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tasks_product_project
  ON public.tasks(product_project_id);

CREATE INDEX IF NOT EXISTS idx_tasks_product_project_active
  ON public.tasks(product_project_id, task_type, status)
  WHERE product_project_id IS NOT NULL AND status IN ('pending', 'in_progress');

ALTER TABLE public.machine_items
  ADD COLUMN IF NOT EXISTS product_project_id uuid REFERENCES public.product_projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_project_version_id uuid REFERENCES public.product_project_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_machine_items_product_project
  ON public.machine_items(product_project_id);

CREATE INDEX IF NOT EXISTS idx_machine_items_product_project_version
  ON public.machine_items(product_project_version_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_source_project_unique
  ON public.products(source_project_id)
  WHERE source_project_id IS NOT NULL;
