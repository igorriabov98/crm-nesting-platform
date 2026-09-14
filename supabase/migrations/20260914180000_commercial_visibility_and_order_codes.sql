-- Company identity, order prices and annual order-code privacy boundary.

CREATE OR REPLACE FUNCTION public.client_public_alias(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    NULLIF(string_agg(upper(left(part[1], 3)), '.' ORDER BY ordinality), ''),
    'КЛИЕНТ'
  )
  FROM regexp_matches(normalize(COALESCE(p_name, ''), NFKC), '([[:alnum:]]+)', 'g') WITH ORDINALITY AS match(part, ordinality);
$$;

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS public_alias text;
UPDATE public.clients SET public_alias = public.client_public_alias(name)
WHERE public_alias IS NULL OR public_alias IS DISTINCT FROM public.client_public_alias(name);
ALTER TABLE public.clients ALTER COLUMN public_alias SET NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_client_public_alias()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.public_alias := public.client_public_alias(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_client_public_alias ON public.clients;
CREATE TRIGGER trg_sync_client_public_alias
BEFORE INSERT OR UPDATE OF name ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.sync_client_public_alias();

CREATE OR REPLACE FUNCTION public.crm_user_is_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users app_user
    JOIN public.department_members member ON member.user_id = app_user.id
    JOIN public.positions position ON position.id = member.position_id
    WHERE app_user.id = p_user_id
      AND app_user.is_active
      AND position.is_active
      AND position.name = 'Администратор CRM'
  );
$$;

REVOKE ALL ON FUNCTION public.crm_user_is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_user_is_admin(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_user_is_active(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users app_user WHERE app_user.id = p_user_id AND app_user.is_active);
$$;

REVOKE ALL ON FUNCTION public.crm_user_is_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_user_is_active(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "clients_select" ON public.clients;
DROP POLICY IF EXISTS "clients_insert_sales" ON public.clients;
DROP POLICY IF EXISTS "clients_update_sales" ON public.clients;
DROP POLICY IF EXISTS "clients_commercial_select" ON public.clients;
DROP POLICY IF EXISTS "clients_commercial_insert" ON public.clients;
DROP POLICY IF EXISTS "clients_commercial_update" ON public.clients;

CREATE POLICY "clients_commercial_select" ON public.clients
FOR SELECT TO authenticated
USING (
  (responsible_user_id = auth.uid() AND public.crm_user_is_active(auth.uid()))
  OR public.crm_user_is_admin(auth.uid())
);

CREATE POLICY "clients_commercial_insert" ON public.clients
FOR INSERT TO authenticated
WITH CHECK (
  (responsible_user_id = auth.uid() AND public.crm_user_is_active(auth.uid()))
  OR public.crm_user_is_admin(auth.uid())
);

CREATE POLICY "clients_commercial_update" ON public.clients
FOR UPDATE TO authenticated
USING (
  (responsible_user_id = auth.uid() AND public.crm_user_is_active(auth.uid()))
  OR public.crm_user_is_admin(auth.uid())
)
WITH CHECK (
  (responsible_user_id = auth.uid() AND public.crm_user_is_active(auth.uid()))
  OR public.crm_user_is_admin(auth.uid())
);

DROP POLICY IF EXISTS "client_contacts_select" ON public.client_contacts;
DROP POLICY IF EXISTS "client_contacts_modify_sales" ON public.client_contacts;
DROP POLICY IF EXISTS "client_contacts_commercial_select" ON public.client_contacts;
DROP POLICY IF EXISTS "client_contacts_commercial_modify" ON public.client_contacts;

CREATE POLICY "client_contacts_commercial_select" ON public.client_contacts
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.clients client
  WHERE client.id = client_contacts.client_id
    AND (
      (client.responsible_user_id = auth.uid() AND public.crm_user_is_active(auth.uid()))
      OR public.crm_user_is_admin(auth.uid())
    )
));

CREATE POLICY "client_contacts_commercial_modify" ON public.client_contacts
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.clients client
  WHERE client.id = client_contacts.client_id
    AND (
      (client.responsible_user_id = auth.uid() AND public.crm_user_is_active(auth.uid()))
      OR public.crm_user_is_admin(auth.uid())
    )
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.clients client
  WHERE client.id = client_contacts.client_id
    AND (
      (client.responsible_user_id = auth.uid() AND public.crm_user_is_active(auth.uid()))
      OR public.crm_user_is_admin(auth.uid())
    )
));

CREATE OR REPLACE FUNCTION public.get_client_identity_projection()
RETURNS TABLE(client_id uuid, display_name text, is_name_masked boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH actor AS (
    SELECT app_user.id, public.crm_user_is_admin(app_user.id) AS is_admin
    FROM public.users app_user
    WHERE app_user.id = auth.uid() AND app_user.is_active
  )
  SELECT
    client.id,
    CASE WHEN
      actor.is_admin
      OR client.responsible_user_id = actor.id
      OR EXISTS (
        SELECT 1
        FROM public.department_members member
        JOIN public.department_access_permissions permission
          ON permission.department_id = member.department_id
         AND permission.subject_scope = CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END
        WHERE member.user_id = actor.id
          AND permission.resource_key = 'client_identity'
          AND (permission.can_view OR permission.can_manage)
          AND (permission.company_view_scope = 'all' OR client.responsible_user_id = actor.id)
      )
    THEN client.name ELSE client.public_alias END,
    NOT (
      actor.is_admin
      OR client.responsible_user_id = actor.id
      OR EXISTS (
        SELECT 1
        FROM public.department_members member
        JOIN public.department_access_permissions permission
          ON permission.department_id = member.department_id
         AND permission.subject_scope = CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END
        WHERE member.user_id = actor.id
          AND permission.resource_key = 'client_identity'
          AND (permission.can_view OR permission.can_manage)
          AND (permission.company_view_scope = 'all' OR client.responsible_user_id = actor.id)
      )
    )
  FROM public.clients client
  CROSS JOIN actor;
$$;

REVOKE ALL ON FUNCTION public.get_client_identity_projection() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_identity_projection() TO authenticated, service_role;

INSERT INTO public.role_permissions(role, resource_key, can_view, can_manage)
SELECT DISTINCT permission.role, resource.resource_key, false, false
FROM public.role_permissions permission
CROSS JOIN (VALUES ('client_identity'), ('client_prices')) resource(resource_key)
ON CONFLICT (role, resource_key) DO UPDATE SET can_view = false, can_manage = false;

INSERT INTO public.department_access_permissions(
  department_id, subject_scope, resource_key, can_view, can_manage,
  factory_scope, company_view_scope, company_manage_scope
)
SELECT department.id, scope.subject_scope, resource.resource_key, false, false, 'own', 'own', 'own'
FROM public.departments department
CROSS JOIN (VALUES ('head'), ('member')) scope(subject_scope)
CROSS JOIN (VALUES ('client_identity'), ('client_prices')) resource(resource_key)
ON CONFLICT (department_id, subject_scope, resource_key) DO UPDATE SET
  can_view = false,
  can_manage = false,
  company_view_scope = 'own',
  company_manage_scope = 'own';

DROP POLICY IF EXISTS client_product_prices_select ON public.client_product_prices;
REVOKE ALL ON public.client_product_prices FROM authenticated;
GRANT ALL ON public.client_product_prices TO service_role;

CREATE TABLE IF NOT EXISTS public.order_annual_counters (
  creation_year integer PRIMARY KEY,
  last_number bigint NOT NULL CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.order_annual_counters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.order_annual_counters TO service_role;

ALTER TABLE public.machines
  ADD COLUMN IF NOT EXISTS creation_year integer,
  ADD COLUMN IF NOT EXISTS annual_order_number bigint;

CREATE UNIQUE INDEX IF NOT EXISTS machines_annual_order_number_unique
ON public.machines(creation_year, annual_order_number)
WHERE creation_year IS NOT NULL AND annual_order_number IS NOT NULL;

INSERT INTO public.order_annual_counters(creation_year, last_number)
SELECT
  EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Uzhgorod')::integer,
  COUNT(*)::bigint
FROM public.machines
WHERE EXTRACT(YEAR FROM created_at AT TIME ZONE 'Europe/Uzhgorod')::integer
  = EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Uzhgorod')::integer
ON CONFLICT (creation_year) DO UPDATE
SET last_number = GREATEST(public.order_annual_counters.last_number, EXCLUDED.last_number), updated_at = now();

CREATE OR REPLACE FUNCTION public.assign_machine_annual_order_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_alias text;
  v_actor uuid := COALESCE(auth.uid(), NEW.created_by);
BEGIN
  SELECT client.public_alias INTO v_alias
  FROM public.clients client
  WHERE client.id = NEW.client_id;
  IF v_alias IS NULL THEN RAISE EXCEPTION 'Клиент не найден'; END IF;

  IF NOT public.crm_user_is_active(v_actor) THEN
    RAISE EXCEPTION 'Пользователь неактивен' USING ERRCODE = '42501';
  END IF;

  IF NOT public.crm_user_is_admin(v_actor) AND NOT EXISTS (
    SELECT 1 FROM public.clients client
    WHERE client.id = NEW.client_id AND client.responsible_user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'Нельзя создать заказ чужой компании' USING ERRCODE = '42501';
  END IF;

  NEW.creation_year := EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Uzhgorod')::integer;
  INSERT INTO public.order_annual_counters(creation_year, last_number)
  VALUES (NEW.creation_year, 1)
  ON CONFLICT (creation_year) DO UPDATE
  SET last_number = public.order_annual_counters.last_number + 1, updated_at = now()
  RETURNING last_number INTO NEW.annual_order_number;

  NEW.name := v_alias || '-' || NEW.annual_order_number::text || '-' || NEW.creation_year::text;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_machine_annual_order_code ON public.machines;
CREATE TRIGGER trg_assign_machine_annual_order_code
BEFORE INSERT ON public.machines
FOR EACH ROW EXECUTE FUNCTION public.assign_machine_annual_order_code();

CREATE OR REPLACE FUNCTION public.refresh_machine_order_code_client_prefix()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_alias text;
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.annual_order_number IS NULL OR NEW.creation_year IS NULL THEN RETURN NEW; END IF;

  IF v_actor IS NOT NULL
     AND NOT public.crm_user_is_admin(v_actor)
     AND NOT (
       EXISTS (SELECT 1 FROM public.clients client WHERE client.id = OLD.client_id AND client.responsible_user_id = v_actor)
       AND EXISTS (SELECT 1 FROM public.clients client WHERE client.id = NEW.client_id AND client.responsible_user_id = v_actor)
     ) THEN
    RAISE EXCEPTION 'Нельзя перенести заказ в чужую компанию' USING ERRCODE = '42501';
  END IF;

  SELECT client.public_alias INTO STRICT v_alias FROM public.clients client WHERE client.id = NEW.client_id;
  NEW.name := v_alias || '-' || NEW.annual_order_number::text || '-' || NEW.creation_year::text;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_machine_order_code_client_prefix ON public.machines;
CREATE TRIGGER trg_refresh_machine_order_code_client_prefix
BEFORE UPDATE OF client_id ON public.machines
FOR EACH ROW WHEN (OLD.client_id IS DISTINCT FROM NEW.client_id)
EXECUTE FUNCTION public.refresh_machine_order_code_client_prefix();

DO $$
DECLARE v_columns text;
BEGIN
  REVOKE SELECT ON public.machines_with_totals FROM authenticated;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'machines_with_totals'
    AND column_name <> ALL (ARRAY['freight_cost', 'total_items_cost', 'total_expenses', 'total_cost']);
  EXECUTE format('GRANT SELECT (%s) ON public.machines_with_totals TO authenticated', v_columns);
  GRANT SELECT ON public.machines_with_totals TO service_role;

  REVOKE SELECT ON public.machine_items FROM authenticated;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'machine_items' AND column_name <> 'price';
  EXECUTE format('GRANT SELECT (%s) ON public.machine_items TO authenticated', v_columns);

  REVOKE INSERT, UPDATE ON public.machine_items FROM authenticated;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'machine_items' AND column_name <> 'price';
  EXECUTE format('GRANT INSERT (%s), UPDATE (%s) ON public.machine_items TO authenticated', v_columns, v_columns);

  REVOKE SELECT ON public.machine_expenses FROM authenticated;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'machine_expenses' AND column_name <> 'amount';
  EXECUTE format('GRANT SELECT (%s) ON public.machine_expenses TO authenticated', v_columns);

  REVOKE INSERT, UPDATE ON public.machine_expenses FROM authenticated;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'machine_expenses' AND column_name <> 'amount';
  EXECUTE format('GRANT INSERT (%s), UPDATE (%s) ON public.machine_expenses TO authenticated', v_columns, v_columns);
END;
$$;

COMMENT ON COLUMN public.clients.public_alias IS 'Safe Unicode abbreviation used when the viewer cannot see the full company name.';
COMMENT ON COLUMN public.machines.creation_year IS 'Europe/Uzhgorod calendar year assigned to newly created orders.';
COMMENT ON COLUMN public.machines.annual_order_number IS 'Organization-wide annual order sequence; values are never reused.';
