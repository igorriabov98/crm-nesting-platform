CREATE TABLE IF NOT EXISTS public.product_production_drawings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_version_id uuid NOT NULL REFERENCES public.product_versions(id) ON DELETE CASCADE,
  file_name text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 240),
  file_path text NOT NULL UNIQUE,
  mime_type text NOT NULL DEFAULT 'application/pdf' CHECK (mime_type = 'application/pdf'),
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 52428800),
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_production_drawings_version_created
  ON public.product_production_drawings(product_version_id, created_at DESC);

ALTER TABLE public.product_production_drawings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.product_production_drawings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.product_production_drawings TO service_role;

-- No anon/authenticated policies are created. The application accesses this table
-- only through server-side service-role operations after checking both resources.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('product-production-drawings', 'product-production-drawings', false, 52428800)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit;

-- No storage.objects policy grants anon/authenticated access to this bucket.
-- Signed upload/download URLs are issued by the server after authorization.
