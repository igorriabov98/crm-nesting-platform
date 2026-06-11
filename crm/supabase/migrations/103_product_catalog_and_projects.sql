CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_uk text NOT NULL,
  name_en text NOT NULL,
  uktzed text NOT NULL,
  drawing_number text NOT NULL,
  characteristics text NOT NULL DEFAULT '',
  unit_weight_kg numeric NOT NULL CHECK (unit_weight_kg > 0),
  base_price_eur numeric NOT NULL DEFAULT 0 CHECK (base_price_eur >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  source_project_id uuid,
  source_version_id uuid,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file_kind text NOT NULL CHECK (file_kind IN ('drawing', 'step', 'photo', 'other')),
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text,
  file_size bigint,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  client_id uuid REFERENCES clients(id),
  description text NOT NULL DEFAULT '',
  characteristics text NOT NULL DEFAULT '',
  client_wishes text NOT NULL DEFAULT '',
  assigned_engineer_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'engineering', 'client_review', 'approved', 'added_to_products', 'cancelled')),
  approved_version_id uuid,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_project_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES product_projects(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  version_label text,
  description text NOT NULL DEFAULT '',
  characteristics text NOT NULL DEFAULT '',
  client_wishes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'client_review', 'approved', 'superseded')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, version_number)
);

ALTER TABLE product_projects
  DROP CONSTRAINT IF EXISTS product_projects_approved_version_id_fkey;

ALTER TABLE product_projects
  ADD CONSTRAINT product_projects_approved_version_id_fkey
  FOREIGN KEY (approved_version_id) REFERENCES product_project_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS product_project_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES product_projects(id) ON DELETE CASCADE,
  version_id uuid REFERENCES product_project_versions(id) ON DELETE CASCADE,
  file_kind text NOT NULL CHECK (file_kind IN ('drawing', 'step', 'photo', 'other')),
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text,
  file_size bigint,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_source_project_id_fkey,
  DROP CONSTRAINT IF EXISTS products_source_version_id_fkey;

ALTER TABLE products
  ADD CONSTRAINT products_source_project_id_fkey FOREIGN KEY (source_project_id) REFERENCES product_projects(id) ON DELETE SET NULL,
  ADD CONSTRAINT products_source_version_id_fkey FOREIGN KEY (source_version_id) REFERENCES product_project_versions(id) ON DELETE SET NULL;

ALTER TABLE machine_items
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id),
  ADD COLUMN IF NOT EXISTS product_name_uk text,
  ADD COLUMN IF NOT EXISTS product_name_en text,
  ADD COLUMN IF NOT EXISTS product_uktzed text,
  ADD COLUMN IF NOT EXISTS product_drawing_number text,
  ADD COLUMN IF NOT EXISTS product_characteristics text;

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_name_uk_trgm ON products USING gin (name_uk gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_name_en_trgm ON products USING gin (name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_uktzed ON products(uktzed);
CREATE INDEX IF NOT EXISTS idx_product_files_product ON product_files(product_id);
CREATE INDEX IF NOT EXISTS idx_product_projects_status ON product_projects(status);
CREATE INDEX IF NOT EXISTS idx_product_projects_engineer ON product_projects(assigned_engineer_id);
CREATE INDEX IF NOT EXISTS idx_product_project_versions_project ON product_project_versions(project_id);
CREATE INDEX IF NOT EXISTS idx_product_project_files_project ON product_project_files(project_id);
CREATE INDEX IF NOT EXISTS idx_product_project_files_version ON product_project_files(version_id);
CREATE INDEX IF NOT EXISTS idx_machine_items_product ON machine_items(product_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('product-files', 'product-files', false, 52428800)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_project_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_project_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read products" ON products;
DROP POLICY IF EXISTS "Catalog managers insert products" ON products;
DROP POLICY IF EXISTS "Catalog managers update products" ON products;
DROP POLICY IF EXISTS "Authenticated read product files" ON product_files;
DROP POLICY IF EXISTS "Catalog managers insert product files" ON product_files;
DROP POLICY IF EXISTS "Catalog managers delete product files" ON product_files;
DROP POLICY IF EXISTS "Authenticated read product projects" ON product_projects;
DROP POLICY IF EXISTS "Catalog managers insert product projects" ON product_projects;
DROP POLICY IF EXISTS "Catalog managers update product projects" ON product_projects;
DROP POLICY IF EXISTS "Authenticated read product project versions" ON product_project_versions;
DROP POLICY IF EXISTS "Catalog managers insert product project versions" ON product_project_versions;
DROP POLICY IF EXISTS "Catalog managers update product project versions" ON product_project_versions;
DROP POLICY IF EXISTS "Authenticated read product project files" ON product_project_files;
DROP POLICY IF EXISTS "Catalog managers insert product project files" ON product_project_files;
DROP POLICY IF EXISTS "Catalog managers delete product project files" ON product_project_files;

CREATE POLICY "Authenticated read products" ON products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Catalog managers insert products" ON products FOR INSERT TO authenticated WITH CHECK (
  get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager', 'engineer')
);
CREATE POLICY "Catalog managers update products" ON products FOR UPDATE TO authenticated USING (
  get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager', 'engineer')
);

CREATE POLICY "Authenticated read product files" ON product_files FOR SELECT TO authenticated USING (true);
CREATE POLICY "Catalog managers insert product files" ON product_files FOR INSERT TO authenticated WITH CHECK (
  get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager', 'engineer')
);
CREATE POLICY "Catalog managers delete product files" ON product_files FOR DELETE TO authenticated USING (
  get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager', 'engineer')
);

CREATE POLICY "Authenticated read product projects" ON product_projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Catalog managers insert product projects" ON product_projects FOR INSERT TO authenticated WITH CHECK (
  get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager', 'engineer')
);
CREATE POLICY "Catalog managers update product projects" ON product_projects FOR UPDATE TO authenticated USING (
  get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager', 'engineer')
);

CREATE POLICY "Authenticated read product project versions" ON product_project_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Catalog managers insert product project versions" ON product_project_versions FOR INSERT TO authenticated WITH CHECK (
  get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager', 'engineer')
);
CREATE POLICY "Catalog managers update product project versions" ON product_project_versions FOR UPDATE TO authenticated USING (
  get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager', 'engineer')
);

CREATE POLICY "Authenticated read product project files" ON product_project_files FOR SELECT TO authenticated USING (true);
CREATE POLICY "Catalog managers insert product project files" ON product_project_files FOR INSERT TO authenticated WITH CHECK (
  get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager', 'engineer')
);
CREATE POLICY "Catalog managers delete product project files" ON product_project_files FOR DELETE TO authenticated USING (
  get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager', 'engineer')
);

DROP POLICY IF EXISTS "Authenticated read product storage" ON storage.objects;
DROP POLICY IF EXISTS "Catalog managers upload product storage" ON storage.objects;
DROP POLICY IF EXISTS "Catalog managers update product storage" ON storage.objects;
DROP POLICY IF EXISTS "Catalog managers delete product storage" ON storage.objects;

CREATE POLICY "Authenticated read product storage" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'product-files');
CREATE POLICY "Catalog managers upload product storage" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'product-files'
  AND get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager', 'engineer')
);
CREATE POLICY "Catalog managers update product storage" ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'product-files'
  AND get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager', 'engineer')
);
CREATE POLICY "Catalog managers delete product storage" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'product-files'
  AND get_user_role() IN ('planning_director', 'financial_director', 'commercial_director', 'sales_manager', 'engineer')
);
