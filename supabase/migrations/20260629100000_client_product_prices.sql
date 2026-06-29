CREATE TABLE IF NOT EXISTS public.client_product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  coating public.coating_type NOT NULL,
  price_eur numeric NOT NULL CHECK (price_eur >= 0),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_product_prices_unique UNIQUE (client_id, product_id, coating)
);

CREATE INDEX IF NOT EXISTS idx_client_product_prices_client
  ON public.client_product_prices(client_id);

CREATE INDEX IF NOT EXISTS idx_client_product_prices_product
  ON public.client_product_prices(product_id);

CREATE OR REPLACE FUNCTION public.touch_client_product_prices_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_product_prices_touch_updated_at ON public.client_product_prices;
CREATE TRIGGER client_product_prices_touch_updated_at
  BEFORE UPDATE ON public.client_product_prices
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_client_product_prices_updated_at();

ALTER TABLE public.client_product_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_product_prices_select ON public.client_product_prices;
CREATE POLICY client_product_prices_select
  ON public.client_product_prices
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS client_product_prices_service_role_modify ON public.client_product_prices;
CREATE POLICY client_product_prices_service_role_modify
  ON public.client_product_prices
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.client_product_prices TO authenticated;

WITH ranked_prices AS (
  SELECT
    m.client_id,
    mi.product_id,
    mi.coating,
    mi.price AS price_eur,
    COALESCE(mi.created_at, m.updated_at, m.created_at, now()) AS source_created_at,
    ROW_NUMBER() OVER (
      PARTITION BY m.client_id, mi.product_id, mi.coating
      ORDER BY COALESCE(mi.updated_at, mi.created_at, m.updated_at, m.created_at, now()) DESC
    ) AS rn
  FROM public.machine_items mi
  JOIN public.machines m ON m.id = mi.machine_id
  WHERE m.client_id IS NOT NULL
    AND mi.product_id IS NOT NULL
    AND mi.price IS NOT NULL
    AND mi.price >= 0
)
INSERT INTO public.client_product_prices (
  client_id,
  product_id,
  coating,
  price_eur,
  created_at,
  updated_at
)
SELECT
  client_id,
  product_id,
  coating,
  price_eur,
  source_created_at,
  now()
FROM ranked_prices
WHERE rn = 1
ON CONFLICT (client_id, product_id, coating) DO UPDATE
SET price_eur = EXCLUDED.price_eur,
    updated_at = now();

INSERT INTO public.role_permissions(role, resource_key, can_view, can_manage)
SELECT role, 'client_prices', can_view, can_manage
FROM (
  VALUES
    ('financial_director'::user_role, true, true),
    ('commercial_director'::user_role, true, true),
    ('planning_director'::user_role, true, true),
    ('sales_manager'::user_role, false, false),
    ('engineer'::user_role, false, false),
    ('technologist'::user_role, false, false),
    ('supply_manager'::user_role, false, false),
    ('production_manager'::user_role, false, false),
    ('procurement_head'::user_role, false, false),
    ('painting_head'::user_role, false, false)
) AS defaults(role, can_view, can_manage)
ON CONFLICT (role, resource_key) DO NOTHING;

WITH current_roles AS (
  SELECT DISTINCT
    dm.department_id,
    CASE WHEN dm.is_department_head THEN 'head' ELSE 'member' END AS subject_scope,
    u.role
  FROM public.department_members dm
  JOIN public.users u ON u.id = dm.user_id
),
new_resource AS (
  SELECT *
  FROM public.role_permissions
  WHERE resource_key = 'client_prices'
),
seed AS (
  SELECT
    cr.department_id,
    cr.subject_scope,
    nr.resource_key,
    bool_or(nr.can_view) AS can_view,
    bool_or(nr.can_manage) AS can_manage
  FROM current_roles cr
  JOIN new_resource nr ON nr.role = cr.role
  GROUP BY cr.department_id, cr.subject_scope, nr.resource_key
)
INSERT INTO public.department_access_permissions(
  department_id,
  subject_scope,
  resource_key,
  can_view,
  can_manage
)
SELECT department_id, subject_scope, resource_key, can_view OR can_manage, can_manage
FROM seed
ON CONFLICT (department_id, subject_scope, resource_key) DO NOTHING;
