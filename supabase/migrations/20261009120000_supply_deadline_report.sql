-- Factory-scoped supply deadline reporting. All report reads are performed by
-- authenticated server code after checking these grants; writes use the RPCs.
BEGIN;

CREATE TABLE public.supply_deadline_factory_grants (
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  subject_scope text NOT NULL CHECK (subject_scope IN ('head', 'member')),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE RESTRICT,
  can_view boolean NOT NULL DEFAULT false,
  can_manage boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, subject_scope, factory_id),
  CHECK (NOT can_manage OR can_view)
);

CREATE TABLE public.supply_deadline_factory_grant_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id),
  subject_scope text NOT NULL,
  factory_id uuid NOT NULL REFERENCES public.factories(id),
  old_can_view boolean NOT NULL,
  old_can_manage boolean NOT NULL,
  new_can_view boolean NOT NULL,
  new_can_manage boolean NOT NULL,
  changed_by uuid NOT NULL REFERENCES public.users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supply_deadline_factory_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supply_deadline_factory_grant_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supply_deadline_factory_grants, public.supply_deadline_factory_grant_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.supply_deadline_factory_grants, public.supply_deadline_factory_grant_events TO service_role;

CREATE OR REPLACE FUNCTION private.crm_has_supply_deadline_factory_permission(
  p_operation text, p_factory_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_factory_id IS NOT NULL
    AND p_operation IN ('view', 'manage')
    AND private.crm_has_permission('supply_deadline_report', p_operation)
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.is_active IS TRUE
        AND (
          public.crm_user_is_admin(u.id)
          OR EXISTS (
            SELECT 1 FROM public.department_members m
            JOIN public.supply_deadline_factory_grants g
              ON g.department_id = m.department_id
             AND g.subject_scope = CASE WHEN m.is_department_head THEN 'head' ELSE 'member' END
            WHERE m.user_id = u.id AND g.factory_id = p_factory_id
              AND CASE p_operation WHEN 'manage' THEN g.can_manage ELSE g.can_view END
          )
        )
    );
$$;
REVOKE ALL ON FUNCTION private.crm_has_supply_deadline_factory_permission(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.crm_has_supply_deadline_factory_permission(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_set_supply_deadline_factory_grants(
  p_department_id uuid, p_subject_scope text, p_view_factory_ids uuid[], p_manage_factory_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_factory record;
  v_before public.supply_deadline_factory_grants%ROWTYPE;
  v_view boolean;
  v_manage boolean;
BEGIN
  IF NOT private.crm_has_permission('access_settings', 'manage') THEN
    RAISE EXCEPTION 'Недостаточно прав для настройки отчёта' USING ERRCODE = '42501';
  END IF;
  IF p_subject_scope IS NULL OR p_subject_scope NOT IN ('head', 'member')
     OR p_department_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.departments WHERE id = p_department_id AND is_active IS TRUE)
     OR p_view_factory_ids IS NULL OR p_manage_factory_ids IS NULL
     OR EXISTS (SELECT 1 FROM unnest(p_manage_factory_ids) AS selected(factory_id)
                WHERE NOT selected.factory_id = ANY(p_view_factory_ids))
     OR EXISTS (SELECT 1 FROM unnest(p_view_factory_ids || p_manage_factory_ids) AS selected(factory_id)
                WHERE NOT EXISTS (SELECT 1 FROM public.factories f WHERE f.id = selected.factory_id)) THEN
    RAISE EXCEPTION 'Некорректные заводы или область доступа' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_department_id::text || ':' || p_subject_scope || ':supply-deadlines', 0));
  FOR v_factory IN SELECT id FROM public.factories ORDER BY id LOOP
    v_view := v_factory.id = ANY(p_view_factory_ids);
    v_manage := v_factory.id = ANY(p_manage_factory_ids);
    SELECT * INTO v_before FROM public.supply_deadline_factory_grants
      WHERE department_id = p_department_id AND subject_scope = p_subject_scope
        AND factory_id = v_factory.id FOR UPDATE;
    IF COALESCE(v_before.can_view, false) IS NOT DISTINCT FROM v_view
       AND COALESCE(v_before.can_manage, false) IS NOT DISTINCT FROM v_manage THEN CONTINUE; END IF;
    INSERT INTO public.supply_deadline_factory_grants
      (department_id, subject_scope, factory_id, can_view, can_manage, updated_by)
    VALUES (p_department_id, p_subject_scope, v_factory.id, v_view, v_manage, auth.uid())
    ON CONFLICT (department_id, subject_scope, factory_id) DO UPDATE SET
      can_view = EXCLUDED.can_view, can_manage = EXCLUDED.can_manage,
      updated_by = EXCLUDED.updated_by, updated_at = now();
    INSERT INTO public.supply_deadline_factory_grant_events
      (department_id, subject_scope, factory_id, old_can_view, old_can_manage,
       new_can_view, new_can_manage, changed_by)
    VALUES (p_department_id, p_subject_scope, v_factory.id,
      COALESCE(v_before.can_view, false), COALESCE(v_before.can_manage, false),
      v_view, v_manage, auth.uid());
  END LOOP;
  RETURN jsonb_build_object('viewFactoryIds', p_view_factory_ids, 'manageFactoryIds', p_manage_factory_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_set_supply_deadline_factory_grants(uuid, text, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_supply_deadline_factory_grants(uuid, text, uuid[], uuid[]) TO authenticated;

CREATE TABLE public.supply_deadline_receipt_snapshots (
  schedule_id uuid PRIMARY KEY REFERENCES public.supply_order_delivery_schedules(id) ON DELETE RESTRICT,
  factory_id uuid NOT NULL REFERENCES public.factories(id),
  request_item_table text NOT NULL,
  request_item_id uuid NOT NULL,
  material_deadline date,
  cutting_start date,
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.supply_deadline_receipt_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supply_deadline_receipt_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.supply_deadline_receipt_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.trg_capture_supply_deadline_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_request_id uuid;
  v_factory_id uuid;
  v_deadline date;
  v_cutting_start date;
  v_machine_id uuid;
BEGIN
  IF NEW.status <> 'delivered' OR NEW.delivered_at IS NULL THEN RETURN NEW; END IF;
  IF NEW.request_item_table NOT IN (
    'request_sheet_metal', 'request_round_tube', 'request_circle', 'request_pipe',
    'request_knives', 'request_components', 'request_paint', 'request_mesh', 'request_chain_cord'
  ) THEN RAISE EXCEPTION 'Некорректный тип позиции поставки'; END IF;
  EXECUTE format('SELECT request_id FROM public.%I WHERE id = $1', NEW.request_item_table)
    INTO v_request_id USING NEW.request_item_id;
  IF v_request_id IS NULL THEN RAISE EXCEPTION 'Позиция принятой поставки не найдена'; END IF;
  SELECT CASE WHEN r.request_kind = 'stock' THEN r.factory_id ELSE m.factory_id END,
         CASE WHEN r.request_kind = 'stock' THEN r.needed_by ELSE m.planned_material_date END,
         CASE WHEN r.request_kind = 'stock' THEN NULL ELSE m.id END
    INTO v_factory_id, v_deadline, v_machine_id
  FROM public.technologist_requests r
  LEFT JOIN public.machines m ON m.id = r.machine_id
  WHERE r.id = v_request_id;
  IF v_factory_id IS NULL THEN RAISE EXCEPTION 'Завод принятой поставки не определён'; END IF;
  IF v_machine_id IS NOT NULL THEN
    SELECT min(COALESCE(i.date_start, s.date_start)) INTO v_cutting_start
    FROM public.production_stages s
    LEFT JOIN public.production_stage_intervals i ON i.production_stage_id = s.id
    WHERE s.machine_id = v_machine_id AND s.stage_type = 'cutting' AND s.is_skipped IS NOT TRUE;
  END IF;
  INSERT INTO public.supply_deadline_receipt_snapshots
    (schedule_id, factory_id, request_item_table, request_item_id, material_deadline, cutting_start)
  VALUES (NEW.id, v_factory_id, NEW.request_item_table, NEW.request_item_id, v_deadline, v_cutting_start)
  ON CONFLICT (schedule_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER capture_supply_deadline_receipt
  AFTER INSERT OR UPDATE OF status, delivered_at ON public.supply_order_delivery_schedules
  FOR EACH ROW EXECUTE FUNCTION public.trg_capture_supply_deadline_receipt();

CREATE TABLE public.supply_deadline_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id),
  target_kind text NOT NULL CHECK (target_kind IN ('item', 'schedule')),
  request_item_table text NOT NULL,
  request_item_id uuid NOT NULL,
  schedule_id uuid REFERENCES public.supply_order_delivery_schedules(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 2000),
  changed_by uuid NOT NULL REFERENCES public.users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((target_kind = 'schedule') = (schedule_id IS NOT NULL))
);
CREATE UNIQUE INDEX supply_deadline_exclusions_item_unique ON public.supply_deadline_exclusions
  (request_item_table, request_item_id) WHERE target_kind = 'item';
CREATE UNIQUE INDEX supply_deadline_exclusions_schedule_unique ON public.supply_deadline_exclusions
  (schedule_id) WHERE target_kind = 'schedule';
CREATE TABLE public.supply_deadline_exclusion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exclusion_id uuid NOT NULL REFERENCES public.supply_deadline_exclusions(id) ON DELETE RESTRICT,
  active boolean NOT NULL,
  reason text NOT NULL,
  changed_by uuid NOT NULL REFERENCES public.users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.supply_deadline_exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supply_deadline_exclusion_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supply_deadline_exclusions, public.supply_deadline_exclusion_events FROM PUBLIC, anon;
GRANT SELECT ON public.supply_deadline_exclusions, public.supply_deadline_exclusion_events TO authenticated;
GRANT SELECT ON public.supply_deadline_exclusions, public.supply_deadline_exclusion_events TO service_role;
CREATE POLICY supply_deadline_exclusions_view ON public.supply_deadline_exclusions FOR SELECT TO authenticated
  USING (private.crm_has_supply_deadline_factory_permission('view', factory_id));
CREATE POLICY supply_deadline_exclusion_events_view ON public.supply_deadline_exclusion_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.supply_deadline_exclusions e WHERE e.id = exclusion_id
                AND private.crm_has_supply_deadline_factory_permission('view', e.factory_id)));

CREATE OR REPLACE FUNCTION public.fn_set_supply_deadline_exclusion(
  p_target_kind text, p_request_item_table text, p_request_item_id uuid,
  p_schedule_id uuid, p_active boolean, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_request_id uuid;
  v_factory_id uuid;
  v_old public.supply_deadline_exclusions%ROWTYPE;
  v_id uuid;
  v_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  IF p_target_kind IS NULL OR p_target_kind NOT IN ('item', 'schedule') OR p_active IS NULL
     OR (p_target_kind = 'schedule') IS DISTINCT FROM (p_schedule_id IS NOT NULL)
     OR char_length(v_reason) NOT BETWEEN 3 AND 2000
     OR p_request_item_table IS NULL OR p_request_item_id IS NULL
     OR p_request_item_table NOT IN (
       'request_sheet_metal', 'request_round_tube', 'request_circle', 'request_pipe',
       'request_knives', 'request_components', 'request_paint', 'request_mesh', 'request_chain_cord'
     ) THEN RAISE EXCEPTION 'Некорректные данные исключения' USING ERRCODE = '22023'; END IF;
  EXECUTE format('SELECT request_id FROM public.%I WHERE id = $1', p_request_item_table)
    INTO v_request_id USING p_request_item_id;
  IF v_request_id IS NULL THEN RAISE EXCEPTION 'Позиция заявки не найдена'; END IF;
  SELECT CASE WHEN r.request_kind = 'stock' THEN r.factory_id ELSE m.factory_id END
    INTO v_factory_id FROM public.technologist_requests r
    LEFT JOIN public.machines m ON m.id = r.machine_id WHERE r.id = v_request_id;
  IF v_factory_id IS NULL OR NOT private.crm_has_supply_deadline_factory_permission('manage', v_factory_id) THEN
    RAISE EXCEPTION 'Недостаточно прав для выбранного завода' USING ERRCODE = '42501';
  END IF;
  IF p_schedule_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.supply_order_delivery_schedules s WHERE s.id = p_schedule_id
      AND s.request_item_table = p_request_item_table AND s.request_item_id = p_request_item_id
  ) THEN RAISE EXCEPTION 'Поставка не относится к позиции заявки'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_target_kind || ':' || p_request_item_table || ':' || p_request_item_id::text
      || ':' || COALESCE(p_schedule_id::text, ''), 0));
  SELECT * INTO v_old FROM public.supply_deadline_exclusions e
    WHERE (p_target_kind = 'item' AND e.target_kind = 'item'
           AND e.request_item_table = p_request_item_table AND e.request_item_id = p_request_item_id)
       OR (p_target_kind = 'schedule' AND e.target_kind = 'schedule' AND e.schedule_id = p_schedule_id)
    FOR UPDATE;
  IF FOUND AND v_old.active IS NOT DISTINCT FROM p_active THEN
    RETURN jsonb_build_object('id', v_old.id, 'active', v_old.active);
  END IF;
  IF v_old.id IS NULL AND NOT p_active THEN RAISE EXCEPTION 'Исключение ещё не создано'; END IF;
  IF v_old.id IS NULL THEN
    INSERT INTO public.supply_deadline_exclusions
      (factory_id, target_kind, request_item_table, request_item_id, schedule_id,
       active, reason, changed_by)
    VALUES (v_factory_id, p_target_kind, p_request_item_table, p_request_item_id,
      p_schedule_id, p_active, v_reason, auth.uid()) RETURNING id INTO v_id;
  ELSE
    UPDATE public.supply_deadline_exclusions SET active = p_active, reason = v_reason,
      changed_by = auth.uid(), changed_at = now() WHERE id = v_old.id RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.supply_deadline_exclusion_events
    (exclusion_id, active, reason, changed_by)
  VALUES (v_id, p_active, v_reason, auth.uid());
  RETURN jsonb_build_object('id', v_id, 'active', p_active);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_set_supply_deadline_exclusion(text, text, uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_supply_deadline_exclusion(text, text, uuid, uuid, boolean, text) TO authenticated;

-- The administrator position has full access through the existing matrix evaluator.
-- The supply department starts with view access to both factories.
INSERT INTO public.department_access_permissions
  (department_id, subject_scope, resource_key, can_view, can_manage, factory_scope)
SELECT d.id, scope.subject_scope, 'supply_deadline_report', true, false, 'own'
FROM public.departments d CROSS JOIN (VALUES ('head'), ('member')) scope(subject_scope)
WHERE d.name = 'Снабжение' AND d.is_active IS TRUE
ON CONFLICT (department_id, subject_scope, resource_key) DO NOTHING;
INSERT INTO public.supply_deadline_factory_grants
  (department_id, subject_scope, factory_id, can_view, can_manage)
SELECT d.id, scope.subject_scope, f.id, true, false
FROM public.departments d CROSS JOIN (VALUES ('head'), ('member')) scope(subject_scope)
CROSS JOIN public.factories f
WHERE d.name = 'Снабжение' AND d.is_active IS TRUE
ON CONFLICT (department_id, subject_scope, factory_id) DO NOTHING;

COMMIT;
