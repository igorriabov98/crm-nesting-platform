DO $$
BEGIN
  CREATE TYPE public.product_fastening_type AS ENUM (
    'metal_plate',
    'wp_plate',
    'a4_plate',
    'white_sticker',
    'none_required'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.product_completion_type AS ENUM (
    'mounting_set',
    'chain_set'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'product_version_incomplete';

CREATE TABLE IF NOT EXISTS public.product_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  status text NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'archived')),
  drawing_number text NOT NULL,
  change_summary text,
  fastening_types public.product_fastening_type[] NOT NULL DEFAULT '{}'::public.product_fastening_type[],
  completion_type public.product_completion_type,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_product_versions_product
  ON public.product_versions(product_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_versions_current_unique
  ON public.product_versions(product_id)
  WHERE status = 'current';

ALTER TABLE public.product_files
  ADD COLUMN IF NOT EXISTS product_version_id uuid REFERENCES public.product_versions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_product_files_product_version
  ON public.product_files(product_version_id);

ALTER TABLE public.machine_items
  ADD COLUMN IF NOT EXISTS product_version_id uuid REFERENCES public.product_versions(id);

CREATE INDEX IF NOT EXISTS idx_machine_items_product_version
  ON public.machine_items(product_version_id);

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS product_version_id uuid REFERENCES public.product_versions(id);

CREATE INDEX IF NOT EXISTS idx_tasks_product_version_active
  ON public.tasks(product_version_id, task_type, status)
  WHERE product_version_id IS NOT NULL AND status IN ('pending', 'in_progress');

ALTER TABLE public.product_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read product versions" ON public.product_versions;
DROP POLICY IF EXISTS "Catalog managers insert product versions" ON public.product_versions;
DROP POLICY IF EXISTS "Catalog managers update product versions" ON public.product_versions;

CREATE POLICY "Authenticated read product versions" ON public.product_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Catalog managers insert product versions" ON public.product_versions FOR INSERT TO authenticated WITH CHECK (
  get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'engineer')
);
CREATE POLICY "Catalog managers update product versions" ON public.product_versions FOR UPDATE TO authenticated USING (
  get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'engineer')
);

INSERT INTO public.product_versions (
  product_id,
  version_number,
  status,
  drawing_number,
  change_summary,
  fastening_types,
  completion_type,
  created_by,
  created_at
)
SELECT
  p.id,
  1,
  'current',
  p.drawing_number,
  NULL,
  '{}'::public.product_fastening_type[],
  NULL,
  p.created_by,
  p.created_at
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.product_versions pv
  WHERE pv.product_id = p.id
);

WITH current_versions AS (
  SELECT DISTINCT ON (product_id)
    id,
    product_id
  FROM public.product_versions
  WHERE status = 'current'
  ORDER BY product_id, version_number DESC, created_at DESC, id
)
UPDATE public.product_files pf
SET product_version_id = cv.id
FROM current_versions cv
WHERE pf.product_id = cv.product_id
  AND pf.product_version_id IS NULL;

CREATE OR REPLACE FUNCTION public.sync_product_drawing_number_from_current_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'current' THEN
    UPDATE public.products
    SET drawing_number = NEW.drawing_number,
        updated_at = now()
    WHERE id = NEW.product_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_versions_sync_current_drawing_number ON public.product_versions;

CREATE TRIGGER trg_product_versions_sync_current_drawing_number
  AFTER INSERT OR UPDATE OF drawing_number, status ON public.product_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_product_drawing_number_from_current_version();
