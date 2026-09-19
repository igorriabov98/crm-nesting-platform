-- Organization cutover. Run scripts/organization-preflight.ts before release.
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtextextended('crm:organization', 0));

CREATE TABLE public.organization_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version bigint NOT NULL DEFAULT 1
);
INSERT INTO public.organization_revision DEFAULT VALUES;
REVOKE ALL ON public.organization_revision FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organization_revision TO authenticated;
GRANT ALL ON public.organization_revision TO service_role;

CREATE TABLE public.user_system_roles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id),
  role text NOT NULL CHECK (role = 'crm_admin'),
  granted_by uuid REFERENCES public.users(id),
  granted_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.user_system_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_system_roles TO authenticated;
GRANT ALL ON public.user_system_roles TO service_role;
INSERT INTO public.user_system_roles(user_id, role)
-- Preserve only accounts whose full authority is confirmed by the existing DB evaluator.
SELECT u.id, 'crm_admin' FROM public.users u WHERE public.crm_user_is_admin(u.id);

CREATE TABLE public.organization_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES public.users(id),
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.organization_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organization_audit_log TO authenticated;
GRANT ALL ON public.organization_audit_log TO service_role;

ALTER TABLE public.department_members
  ADD COLUMN is_primary boolean NOT NULL DEFAULT false,
  ADD COLUMN reports_to_membership_id uuid REFERENCES public.department_members(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX department_members_one_primary ON public.department_members(user_id) WHERE is_primary;
UPDATE public.department_members m SET is_primary = true
WHERE (SELECT count(*) FROM public.department_members x WHERE x.user_id = m.user_id) = 1;
UPDATE public.department_members m SET reports_to_membership_id = (
  SELECT x.id FROM public.department_members x
  WHERE x.user_id = m.reports_to_user_id AND x.department_id = m.department_id
)
WHERE m.reports_to_user_id IS NOT NULL AND (
  SELECT count(*) FROM public.department_members x
  WHERE x.user_id = m.reports_to_user_id AND x.department_id = m.department_id
) = 1;

-- Do not guess a leader or silently change an existing head/member union.
DO $preflight$
BEGIN
  IF EXISTS(SELECT 1 FROM public.users WHERE is_active) AND NOT EXISTS(SELECT 1 FROM public.user_system_roles r JOIN public.users u ON u.id=r.user_id WHERE u.is_active) THEN RAISE EXCEPTION 'Нет подтвержденного активного администратора. Согласуйте полномочия до переноса.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.head_user_id IS DISTINCT FROM (
      SELECT m.user_id FROM public.department_members m
      WHERE m.department_id = d.id AND m.is_department_head ORDER BY m.id LIMIT 1
    ) OR (SELECT count(DISTINCT m.user_id) FROM public.department_members m
          WHERE m.department_id = d.id AND m.is_department_head) > 1
  ) THEN
    RAISE EXCEPTION 'Конфликт руководителей. Сначала согласуйте отчет organization-preflight; назначения не изменены.';
  END IF;
  IF EXISTS(WITH RECURSIVE chain AS (
    SELECT d.id,d.parent_id,ARRAY[d.id] seen FROM public.departments d
    UNION ALL SELECT d.id,d.parent_id,c.seen||d.id FROM public.departments d JOIN chain c ON d.id=c.parent_id WHERE NOT d.id=ANY(c.seen)
  ) SELECT 1 FROM chain WHERE parent_id=ANY(seen)) OR EXISTS(WITH RECURSIVE chain AS (
    SELECT m.id,m.reports_to_membership_id,ARRAY[m.id] seen FROM public.department_members m
    UNION ALL SELECT m.id,m.reports_to_membership_id,c.seen||m.id FROM public.department_members m JOIN chain c ON m.id=c.reports_to_membership_id WHERE NOT m.id=ANY(c.seen)
  ) SELECT 1 FROM chain WHERE reports_to_membership_id=ANY(seen)) THEN
    RAISE EXCEPTION 'Обнаружен цикл структуры или подчинения. Согласуйте исправление перед переносом.';
  END IF;
  -- A head with multiple assignments used to have every assignment coerced to
  -- head by one evaluator. Do not silently widen/reduce the effective union.
  IF EXISTS (
    WITH grants AS (
      SELECT m.user_id,p.resource_key,
        bool_or((p.can_view OR p.can_manage) AND p.subject_scope=CASE WHEN m.is_department_head OR d.head_user_id=m.user_id THEN 'head' ELSE 'member' END) old_view,
        bool_or(p.can_manage AND p.subject_scope=CASE WHEN m.is_department_head OR d.head_user_id=m.user_id THEN 'head' ELSE 'member' END) old_manage,
        bool_or((p.can_view OR p.can_manage) AND p.subject_scope=CASE WHEN m.is_department_head THEN 'head' ELSE 'member' END) new_view,
        bool_or(p.can_manage AND p.subject_scope=CASE WHEN m.is_department_head THEN 'head' ELSE 'member' END) new_manage
      FROM public.department_members m JOIN public.departments d ON d.id=m.department_id AND d.is_active
      JOIN public.users u ON u.id=m.user_id AND u.is_active
      JOIN public.department_access_permissions p ON p.department_id=d.id
      WHERE NOT EXISTS(SELECT 1 FROM public.user_system_roles a WHERE a.user_id=u.id)
      GROUP BY m.user_id,p.resource_key
    ) SELECT 1 FROM grants WHERE old_view IS DISTINCT FROM new_view OR old_manage IS DISTINCT FROM new_manage
  ) THEN RAISE EXCEPTION 'Обнаружено изменение фактических прав. Согласуйте назначения по отчету organization-preflight.'; END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.crm_user_is_admin(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.users u JOIN public.user_system_roles r ON r.user_id = u.id
    WHERE u.id = p_user_id AND u.is_active IS TRUE AND r.role = 'crm_admin'
  );
$function$;

CREATE OR REPLACE FUNCTION private.organization_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  UPDATE public.organization_revision SET version = version + 1 WHERE singleton;
  RETURN NULL;
END;
$function$;
DO $triggers$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','departments','positions','department_members','department_access_permissions','user_system_roles'] LOOP
    EXECUTE format('CREATE TRIGGER organization_revision_changed AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION private.organization_changed()', t);
  END LOOP;
END;
$triggers$;

CREATE OR REPLACE FUNCTION private.organization_assert_version(p_expected bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE current_version bigint;
BEGIN
  SELECT version INTO current_version FROM public.organization_revision WHERE singleton FOR UPDATE;
  IF p_expected IS NULL OR current_version <> p_expected THEN
    RAISE EXCEPTION 'Структура изменилась. Обновите данные и проверьте изменения.' USING ERRCODE = '40001';
  END IF;
END;
$function$;

ALTER TABLE public.department_access_permissions ADD COLUMN revision bigint NOT NULL DEFAULT 1;
CREATE FUNCTION private.matrix_revision_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER matrix_revision_changed BEFORE UPDATE ON public.department_access_permissions
FOR EACH ROW EXECUTE FUNCTION private.matrix_revision_changed();

CREATE FUNCTION public.crm_set_administrator(p_user_id uuid, p_enabled boolean, p_expected_version bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE old_value jsonb;
BEGIN
  PERFORM private.organization_assert_version(p_expected_version);
  IF NOT public.crm_user_is_admin(auth.uid()) OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Статус меняет другой администратор CRM' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id AND is_active IS TRUE) THEN
    RAISE EXCEPTION 'Пользователь неактивен или не найден';
  END IF;
  SELECT to_jsonb(r) INTO old_value FROM public.user_system_roles r WHERE user_id = p_user_id;
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'Укажите состояние полномочий'; END IF;
  IF p_enabled THEN
    INSERT INTO public.user_system_roles(user_id, role, granted_by) VALUES(p_user_id, 'crm_admin', auth.uid())
    ON CONFLICT(user_id) DO NOTHING;
  ELSE
    DELETE FROM public.user_system_roles WHERE user_id = p_user_id;
  END IF;
  INSERT INTO public.organization_audit_log(actor_id, entity_type, entity_id, action, before_data, after_data)
  VALUES(auth.uid(), 'user', p_user_id, 'administrator', old_value, jsonb_build_object('enabled', p_enabled));
END;
$function$;

-- The activity guard also applies to direct SQL / alternate administrative APIs.
CREATE FUNCTION private.protect_last_administrator() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE target_id uuid;
BEGIN
  PERFORM 1 FROM public.organization_revision WHERE singleton FOR UPDATE;
  IF TG_TABLE_NAME = 'users' THEN target_id := OLD.id; ELSE target_id := OLD.user_id; END IF;
  IF TG_TABLE_NAME = 'users' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.is_active IS TRUE THEN RETURN NEW; END IF;
    END IF;
  END IF;
  IF public.crm_user_is_admin(target_id) AND NOT EXISTS (
    SELECT 1 FROM public.user_system_roles r JOIN public.users u ON u.id = r.user_id
    WHERE u.id <> target_id AND u.is_active IS TRUE
  ) THEN RAISE EXCEPTION 'Нельзя отключить последнего активного администратора CRM'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER protect_last_administrator BEFORE UPDATE OF is_active OR DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION private.protect_last_administrator();
CREATE TRIGGER protect_last_administrator BEFORE UPDATE OR DELETE ON public.user_system_roles
FOR EACH ROW EXECUTE FUNCTION private.protect_last_administrator();

ALTER TABLE public.user_system_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_roles_read ON public.user_system_roles FOR SELECT TO authenticated
USING(user_id = auth.uid() OR private.crm_has_permission('access_settings','view') OR private.crm_has_permission('admin_users','view'));
ALTER TABLE public.organization_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_audit_read ON public.organization_audit_log FOR SELECT TO authenticated
USING(private.crm_has_permission('admin_users','view') OR private.crm_has_permission('departments','view'));

REVOKE ALL ON FUNCTION private.organization_changed(), private.matrix_revision_changed(), private.organization_assert_version(bigint), private.protect_last_administrator() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_set_administrator(uuid,boolean,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_set_administrator(uuid,boolean,bigint) TO authenticated;

COMMIT;
