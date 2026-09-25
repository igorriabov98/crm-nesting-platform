-- Independent procurement demand shares the existing position and approval tables.
-- Its destination is a factory, never a synthetic machine/order.
ALTER TABLE public.technologist_requests
  ADD COLUMN request_kind text NOT NULL DEFAULT 'machine',
  ADD COLUMN factory_id uuid REFERENCES public.factories(id),
  ADD COLUMN title text,
  ADD COLUMN needed_by date,
  ALTER COLUMN machine_id DROP NOT NULL;

ALTER TABLE public.technologist_requests
  ADD CONSTRAINT technologist_request_kind_check CHECK (
    (request_kind = 'machine' AND machine_id IS NOT NULL AND factory_id IS NULL)
    OR (request_kind = 'stock' AND machine_id IS NULL AND factory_id IS NOT NULL
      AND char_length(btrim(coalesce(title, ''))) BETWEEN 1 AND 160)
  );
CREATE INDEX technologist_stock_requests_by_factory
  ON public.technologist_requests(factory_id, created_at DESC) WHERE request_kind = 'stock';

ALTER TABLE private.technologist_number_series ALTER COLUMN machine_id DROP NOT NULL;
CREATE SEQUENCE private.stock_material_request_number_seq;
CREATE UNIQUE INDEX technologist_stock_request_number_unique
  ON private.technologist_number_series(request_number) WHERE machine_id IS NULL;
CREATE OR REPLACE FUNCTION private.assign_technologist_request_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_number integer;
BEGIN
  IF NEW.request_kind = 'stock' THEN
    v_number := nextval('private.stock_material_request_number_seq');
  ELSE
    PERFORM 1 FROM public.machines WHERE id = NEW.machine_id FOR UPDATE;
    SELECT coalesce(max(request_number), 0) + 1 INTO v_number
    FROM private.technologist_number_series WHERE machine_id = NEW.machine_id;
  END IF;
  INSERT INTO private.technologist_number_series(id, machine_id, request_number)
  VALUES (NEW.id, NEW.machine_id, v_number);
  INSERT INTO private.technologist_request_numbers VALUES (NEW.id, NEW.id);
  PERFORM private.reserve_technologist_revision_number(NEW.id, 0);
  RETURN NEW;
END;
$$;

-- Direct API writes must observe the same ownership and factory rules as server actions.
CREATE OR REPLACE FUNCTION private.stock_request_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.request_kind = 'stock' AND NEW.request_kind <> 'stock' THEN
    RAISE EXCEPTION 'Вид заявки нельзя менять';
  END IF;
  IF NEW.request_kind <> 'stock' THEN RETURN NEW; END IF;
  IF current_setting('app.financial_approval_request', true) = NEW.id::text THEN RETURN NEW; END IF;
  IF NEW.created_by IS DISTINCT FROM auth.uid()
     OR NOT private.crm_has_permission('technologist_requests', 'manage')
     OR NOT private.crm_has_factory_permission('technologist_requests', 'manage', NEW.factory_id) THEN
    RAISE EXCEPTION 'Недостаточно прав для заявки или выбранного завода' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.request_kind <> NEW.request_kind
      OR OLD.factory_id IS DISTINCT FROM NEW.factory_id
      OR OLD.machine_id IS DISTINCT FROM NEW.machine_id) THEN
    RAISE EXCEPTION 'Вид и завод заявки нельзя менять';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'Заявка на склад создаётся черновиком';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Статус заявки на склад меняется через согласование';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' AND
    (OLD.title IS DISTINCT FROM NEW.title OR OLD.needed_by IS DISTINCT FROM NEW.needed_by) THEN
    RAISE EXCEPTION 'Название и срок можно менять только в черновике';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_request_write_guard BEFORE INSERT OR UPDATE
ON public.technologist_requests FOR EACH ROW EXECUTE FUNCTION private.stock_request_write_guard();

-- The regular stock-check stage is mandatory only for machine demand.
CREATE OR REPLACE FUNCTION public.fn_guard_regular_stock_stage_submission_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.request_kind = 'machine'
     AND NEW.status = 'submitted_to_supply'
     AND OLD.status IS DISTINCT FROM 'submitted_to_supply'
     AND OLD.status IS DISTINCT FROM 'stock_checked' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = '[REGULAR_STOCK_CHECK_REQUIRED] Перед передачей в снабжение завершите бронь основного склада';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_complete_technologist_request_task_on_request_sent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.request_kind = 'stock' THEN RETURN NEW; END IF;
  IF NEW.status IN ('submitted_to_supply', 'completed') THEN
    PERFORM public.complete_sent_technologist_request_tasks(NEW.machine_id);
  END IF;
  IF NEW.status = 'submitted_to_supply'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.activate_supply_start_task(NEW.machine_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_update_machine_status_on_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.request_kind = 'machine'
     AND NEW.status = 'submitted_to_supply'
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.machines SET status = 'request_ready', updated_at = now()
    WHERE id = NEW.machine_id AND status = 'planned';
  END IF;
  RETURN NEW;
END;
$$;

-- The legacy read policies cover both technologists and supply staff.  Narrow
-- stock demand at the database boundary before financial approval.
CREATE FUNCTION private.stock_request_visible(p_request_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((
    SELECT request.request_kind <> 'stock'
      OR public.crm_user_is_admin(auth.uid())
      OR (
        private.crm_has_permission('technologist_requests', 'view')
        AND private.crm_has_factory_permission('technologist_requests', 'view', request.factory_id)
        AND (request.created_by = auth.uid() OR EXISTS (
          SELECT 1 FROM public.tasks task
          JOIN public.technologist_request_approval_versions version
            ON version.id = task.technologist_request_approval_id
          WHERE version.request_id = request.id
            AND task.task_type = 'technologist_request_revision'
            AND task.assigned_to = auth.uid()
            AND task.status IN ('pending', 'in_progress')
        ))
      )
      OR (
        request.status = 'pending_financial_approval'
        AND private.crm_has_permission('technologist_request_results', 'view')
        AND auth.uid() = public.fn_technologist_approval_department_head('Финансовый отдел')
      )
      OR (
        request.status IN ('submitted_to_supply', 'completed')
        AND private.crm_has_permission('supply_orders', 'view')
        AND private.crm_has_factory_permission('supply_orders', 'view', request.factory_id)
      )
    FROM public.technologist_requests request WHERE request.id = p_request_id
  ), false);
$$;
REVOKE ALL ON FUNCTION private.stock_request_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.stock_request_visible(uuid) TO authenticated;
CREATE POLICY stock_request_select_visibility ON public.technologist_requests
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (private.stock_request_visible(id));
DO $$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['request_sheet_metal','request_round_tube','request_circle',
    'request_pipe','request_knives','request_components','request_paint','request_mesh','request_chain_cord'] LOOP
    EXECUTE format('CREATE POLICY stock_request_select_visibility ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (private.stock_request_visible(request_id))', v_table);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.crm_can_work_technologist_request(
  p_request_id uuid, p_actor uuid, p_inventory_operation text DEFAULT 'manage'
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_actor IS NOT NULL AND p_actor = auth.uid()
    AND p_inventory_operation IN ('view', 'manage')
    AND EXISTS (
      SELECT 1 FROM public.technologist_requests request
      LEFT JOIN public.machines machine ON machine.id = request.machine_id
      JOIN public.users app_user ON app_user.id = p_actor
      WHERE request.id = p_request_id AND app_user.is_active AND app_user.archived_at IS NULL
        AND (request.request_kind = 'stock' OR machine.is_archived IS NOT TRUE)
        AND (public.crm_user_is_admin(p_actor) OR (
          private.crm_has_permission('technologist_requests', 'manage')
          AND (CASE WHEN request.request_kind = 'stock'
            THEN private.crm_has_factory_permission('technologist_requests', 'manage', request.factory_id)
            ELSE private.crm_has_factory_permission('inventory', p_inventory_operation, machine.factory_id) END)
          AND (request.created_by = p_actor OR EXISTS (
            SELECT 1 FROM public.tasks task
            JOIN public.technologist_request_approval_versions version
              ON version.id = task.technologist_request_approval_id
            WHERE version.request_id = request.id
              AND task.task_type = 'technologist_request_revision'
              AND task.assigned_to = p_actor AND task.status IN ('pending', 'in_progress')
          ))
        ))
    );
$$;

-- Stock requests have no production reservation or completion stage.
CREATE OR REPLACE FUNCTION private.reject_stock_request_reservation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request_id uuid; v_kind text;
BEGIN
  EXECUTE format('SELECT request_id FROM public.%I WHERE id = $1', NEW.request_item_table)
    INTO v_request_id USING NEW.request_item_id;
  SELECT request_kind INTO v_kind FROM public.technologist_requests WHERE id = v_request_id;
  IF v_kind = 'stock' THEN RAISE EXCEPTION 'Заявка на склад не резервирует материал'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reject_stock_request_reservation BEFORE INSERT OR UPDATE OF request_item_id, request_item_table
ON public.inventory_reservations FOR EACH ROW EXECUTE FUNCTION private.reject_stock_request_reservation();

CREATE OR REPLACE FUNCTION private.stock_request_item_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request_id uuid; v_request public.technologist_requests%ROWTYPE;
  v_field text; v_row jsonb;
BEGIN
  IF auth.role() = 'service_role' THEN RETURN coalesce(NEW, OLD); END IF;
  v_request_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.request_id ELSE NEW.request_id END;
  SELECT * INTO v_request FROM public.technologist_requests WHERE id = v_request_id;
  IF NOT FOUND OR v_request.request_kind IS DISTINCT FROM 'stock' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_row := to_jsonb(NEW);
    FOR v_field IN SELECT field_name FROM jsonb_object_keys(v_row) AS names(field_name)
      WHERE field_name LIKE 'reserved_from_stock%' OR field_name LIKE 'stock_remainder%' LOOP
      IF coalesce((v_row->>v_field)::numeric, 0) <> 0 THEN
        RAISE EXCEPTION 'Заявка на склад не использует складские остатки и бронь';
      END IF;
    END LOOP;
  END IF;
  IF v_request.status = 'draft' THEN
    IF NOT private.crm_can_work_technologist_request(v_request_id, auth.uid(), 'manage') THEN
      RAISE EXCEPTION 'Недостаточно прав для изменения заявки на склад' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP IN ('INSERT', 'DELETE') THEN
    RAISE EXCEPTION 'Состав заявки на склад зафиксирован';
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;
DO $$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['request_sheet_metal','request_round_tube','request_circle',
    'request_pipe','request_knives','request_components','request_paint','request_mesh','request_chain_cord'] LOOP
    EXECUTE format('CREATE TRIGGER stock_request_item_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.stock_request_item_write_guard()', v_table);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.reject_stock_request_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.technologist_requests
    WHERE id = NEW.request_id AND request_kind = 'stock') THEN
    RAISE EXCEPTION 'Заявка на склад не проходит производственное завершение';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reject_stock_request_completion BEFORE INSERT
ON public.technologist_request_completions FOR EACH ROW
EXECUTE FUNCTION private.reject_stock_request_completion();

CREATE OR REPLACE FUNCTION public.fn_validate_stock_request(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_table text; v_item jsonb; v_count integer := 0; v_request public.technologist_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.technologist_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_request.request_kind <> 'stock' OR v_request.factory_id IS NULL
     OR btrim(coalesce(v_request.title, '')) = '' THEN
    RAISE EXCEPTION 'Заявка на склад не заполнена';
  END IF;
  FOREACH v_table IN ARRAY ARRAY['request_sheet_metal','request_round_tube','request_circle',
    'request_pipe','request_knives','request_components','request_paint','request_mesh','request_chain_cord'] LOOP
    FOR v_item IN EXECUTE format('SELECT to_jsonb(item) FROM public.%I item WHERE request_id = $1 AND coalesce(item.order_status::text, ''pending'') <> ''cancelled''', v_table)
      USING p_request_id LOOP
      v_count := v_count + 1;
      IF nullif(v_item->>'material_id', '') IS NULL
         OR public.fn_supply_item_required_quantity(v_table, v_item) <= 0 THEN
        RAISE EXCEPTION 'Для каждой позиции укажите материал и положительное количество';
      END IF;
    END LOOP;
  END LOOP;
  IF v_count = 0 THEN RAISE EXCEPTION 'Добавьте хотя бы одну позицию'; END IF;
  IF jsonb_array_length(public.fn_technologist_approval_source(p_request_id)->'reservations') > 0 THEN
    RAISE EXCEPTION 'Заявка на склад не может содержать бронь';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_validate_stock_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_validate_stock_request(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_submit_stock_request_for_approval(
  p_request_id uuid, p_actor uuid, p_summary_snapshot jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request public.technologist_requests%ROWTYPE; v_version uuid;
  v_revision integer; v_number integer; v_reviewer uuid;
BEGIN
  IF NOT private.crm_can_work_technologist_request(p_request_id, p_actor, 'manage') THEN
    RAISE EXCEPTION 'Недостаточно прав для заявки или завода' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_request FROM public.technologist_requests WHERE id = p_request_id FOR UPDATE;
  IF v_request.request_kind <> 'stock' OR v_request.status <> 'draft' THEN
    RAISE EXCEPTION 'Отправить можно только черновик заявки на склад';
  END IF;
  PERFORM public.fn_validate_stock_request(p_request_id);
  IF p_summary_snapshot->>'requestId' IS DISTINCT FROM p_request_id::text
     OR p_summary_snapshot->>'orderName' IS DISTINCT FROM v_request.title
     OR p_summary_snapshot->>'factoryId' IS DISTINCT FROM v_request.factory_id::text
     OR p_summary_snapshot->>'neededBy' IS DISTINCT FROM v_request.needed_by::text
     OR p_summary_snapshot->'sourceData' IS DISTINCT FROM public.fn_technologist_approval_source(p_request_id) THEN
    RAISE EXCEPTION 'Данные заявки изменились. Обновите страницу';
  END IF;
  IF EXISTS (SELECT 1 FROM public.technologist_request_approval_versions
    WHERE request_id = p_request_id AND state = 'pending') THEN
    RAISE EXCEPTION 'Заявка уже ожидает согласования';
  END IF;
  v_reviewer := public.fn_technologist_approval_department_head('Финансовый отдел');
  IF v_reviewer IS NULL THEN RAISE EXCEPTION 'Не назначен начальник Финансового отдела'; END IF;
  SELECT coalesce(max(revision_number), -1) + 1 INTO v_revision
  FROM public.technologist_request_approval_versions WHERE request_id = p_request_id;
  SELECT series.request_number INTO v_number FROM private.technologist_request_numbers number
  JOIN private.technologist_number_series series ON series.id = number.series_id
  WHERE number.request_id = p_request_id;
  INSERT INTO public.technologist_request_approval_versions(
    request_id, revision_number, state, completion_payload, summary_snapshot, submitted_by
  ) VALUES (p_request_id, v_revision, 'pending', '{"kind":"stock"}'::jsonb, p_summary_snapshot, p_actor)
  RETURNING id INTO v_version;
  INSERT INTO public.tasks(machine_id, assigned_to, task_type, title, description, status,
    start_date, deadline, technologist_request_approval_id, technologist_request_approval_machine_id)
  VALUES (NULL, v_reviewer, 'technologist_request_approval', 'Проверить и одобрить заявку',
    'СЗ-' || lpad(v_number::text, 6, '0') || ' «' || v_request.title || '»',
    'pending', (now() AT TIME ZONE 'Europe/Kyiv')::date,
    (now() AT TIME ZONE 'Europe/Kyiv')::date, v_version, NULL);
  PERFORM public.fn_technologist_approval_work_item(v_version, 'technologist_approval',
    p_actor, v_reviewer, 'Проверьте заявку на склад СЗ-' || lpad(v_number::text, 6, '0') || ' «' || v_request.title || '».');
  UPDATE public.tasks SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE task_type = 'technologist_request_revision' AND status IN ('pending','in_progress')
    AND technologist_request_approval_id IN
      (SELECT id FROM public.technologist_request_approval_versions WHERE request_id = p_request_id);
  UPDATE public.department_requests SET status = 'done', completed_by = p_actor, completed_at = now()
  WHERE request_kind = 'technologist_revision' AND status IN ('new','in_progress')
    AND technologist_approval_version_id IN
      (SELECT id FROM public.technologist_request_approval_versions WHERE request_id = p_request_id);
  DELETE FROM public.technologist_request_revision_drafts WHERE request_id = p_request_id;
  PERFORM set_config('app.financial_approval_request', p_request_id::text, true);
  UPDATE public.technologist_requests SET status = 'pending_financial_approval', updated_at = now()
  WHERE id = p_request_id;
  PERFORM set_config('app.financial_approval_request', '', true);
  RETURN v_version;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_submit_stock_request_for_approval(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_submit_stock_request_for_approval(uuid,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_approve_stock_request(p_version_id uuid, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request public.technologist_requests%ROWTYPE;
  v_version public.technologist_request_approval_versions%ROWTYPE;
BEGIN
  IF p_actor IS DISTINCT FROM auth.uid() OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_actor AND is_active AND archived_at IS NULL)
    OR (NOT public.crm_user_is_admin(p_actor) AND p_actor IS DISTINCT FROM
      public.fn_technologist_approval_department_head('Финансовый отдел')) THEN
    RAISE EXCEPTION 'Согласование доступно начальнику Финансового отдела или администратору CRM'
      USING ERRCODE = '42501';
  END IF;
  SELECT request.* INTO v_request FROM public.technologist_requests request
  JOIN public.technologist_request_approval_versions version ON version.request_id = request.id
  WHERE version.id = p_version_id FOR UPDATE OF request;
  SELECT * INTO v_version FROM public.technologist_request_approval_versions
  WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND OR v_request.request_kind <> 'stock' OR v_version.state <> 'pending'
     OR v_request.status <> 'pending_financial_approval' THEN
    RAISE EXCEPTION 'Заявка больше не ожидает согласования';
  END IF;
  PERFORM public.fn_validate_stock_request(v_request.id);
  IF v_version.summary_snapshot->>'orderName' IS DISTINCT FROM v_request.title
     OR v_version.summary_snapshot->>'factoryId' IS DISTINCT FROM v_request.factory_id::text
     OR v_version.summary_snapshot->>'neededBy' IS DISTINCT FROM v_request.needed_by::text
     OR v_version.summary_snapshot->'sourceData' IS DISTINCT FROM public.fn_technologist_approval_source(v_request.id) THEN
    RAISE EXCEPTION 'Данные заявки изменились. Верните заявку на доработку';
  END IF;
  PERFORM set_config('app.financial_approval_request', v_request.id::text, true);
  UPDATE public.technologist_requests SET status = 'submitted_to_supply', submitted_at = now(), updated_at = now()
  WHERE id = v_request.id;
  PERFORM set_config('app.financial_approval_request', '', true);
  UPDATE public.technologist_request_approval_versions
  SET state = 'approved', decided_by = p_actor, decided_at = now(), updated_at = now()
  WHERE id = p_version_id;
  UPDATE public.tasks SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE technologist_request_approval_id = p_version_id AND status IN ('pending','in_progress');
  UPDATE public.department_requests SET status = 'done', completed_by = p_actor,
    completed_at = now(), response = 'Заявка одобрена'
  WHERE technologist_approval_version_id = p_version_id AND request_kind = 'technologist_approval'
    AND status IN ('new','in_progress');
  INSERT INTO public.notifications(user_id, type, title, message, related_machine_id)
  SELECT id, 'technologist_request', 'Заявка на склад одобрена',
    'Заявка «' || v_request.title || '» передана снабжению.', NULL
  FROM public.users WHERE is_active AND role IN ('supply_manager','procurement_head');
  RETURN v_request.id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_approve_stock_request(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_approve_stock_request(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_return_stock_request_for_revision(
  p_version_id uuid, p_actor uuid, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request public.technologist_requests%ROWTYPE;
  v_version public.technologist_request_approval_versions%ROWTYPE;
  v_assignee uuid;
BEGIN
  IF p_actor IS DISTINCT FROM auth.uid() OR
    (NOT public.crm_user_is_admin(p_actor) AND p_actor IS DISTINCT FROM
      public.fn_technologist_approval_department_head('Финансовый отдел')) THEN
    RAISE EXCEPTION 'Недостаточно прав для согласования' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Укажите причину возврата'; END IF;
  SELECT request.* INTO v_request FROM public.technologist_requests request
  JOIN public.technologist_request_approval_versions version ON version.request_id = request.id
  WHERE version.id = p_version_id FOR UPDATE OF request;
  SELECT * INTO v_version FROM public.technologist_request_approval_versions
  WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND OR v_request.request_kind <> 'stock' OR v_version.state <> 'pending'
    OR v_request.status <> 'pending_financial_approval' THEN
    RAISE EXCEPTION 'Заявка больше не ожидает согласования';
  END IF;
  UPDATE public.technologist_request_approval_versions
  SET state = 'returned', return_reason = btrim(p_reason), decided_by = p_actor,
    decided_at = now(), updated_at = now() WHERE id = p_version_id;
  UPDATE public.tasks SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE technologist_request_approval_id = p_version_id AND status IN ('pending','in_progress');
  PERFORM set_config('app.financial_approval_request', v_request.id::text, true);
  UPDATE public.technologist_requests SET status = 'draft', submitted_at = NULL, updated_at = now()
  WHERE id = v_request.id;
  PERFORM set_config('app.financial_approval_request', '', true);
  UPDATE public.department_requests SET status = 'rejected', completed_by = p_actor,
    completed_at = now(), response = btrim(p_reason)
  WHERE technologist_approval_version_id = p_version_id AND request_kind = 'technologist_approval'
    AND status IN ('new','in_progress');
  SELECT id INTO v_assignee FROM public.users
  WHERE id = v_request.created_by AND is_active AND archived_at IS NULL;
  IF v_assignee IS NULL THEN
    v_assignee := public.fn_technologist_approval_department_head('Технический отдел');
  END IF;
  IF v_assignee IS NULL THEN RAISE EXCEPTION 'Не назначен ответственный технолог'; END IF;
  PERFORM public.fn_technologist_approval_work_item(
    p_version_id, 'technologist_revision', p_actor, v_assignee,
    'Заявка на склад возвращена. Причина: ' || btrim(p_reason));
  INSERT INTO public.tasks(machine_id, assigned_to, task_type, title, description,
    status, start_date, deadline, technologist_request_approval_id,
    technologist_request_approval_machine_id)
  VALUES (NULL, v_assignee, 'technologist_request_revision', 'Доработать заявку на склад',
    btrim(p_reason), 'pending', (now() AT TIME ZONE 'Europe/Kyiv')::date,
    (now() AT TIME ZONE 'Europe/Kyiv')::date, p_version_id, NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_return_stock_request_for_revision(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_return_stock_request_for_revision(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_begin_stock_request_revision(p_request_id uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request public.technologist_requests%ROWTYPE; v_version uuid; v_next integer;
BEGIN
  IF NOT private.crm_can_work_technologist_request(p_request_id, p_actor, 'manage') THEN
    RAISE EXCEPTION 'Недостаточно прав для редактирования' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_request FROM public.technologist_requests WHERE id = p_request_id FOR UPDATE;
  IF v_request.request_kind <> 'stock' OR v_request.status NOT IN ('draft','pending_financial_approval') THEN
    RAISE EXCEPTION 'Редактирование на этом этапе недоступно';
  END IF;
  IF v_request.status = 'pending_financial_approval' THEN
    SELECT id INTO v_version FROM public.technologist_request_approval_versions
    WHERE request_id = p_request_id AND state = 'pending' FOR UPDATE;
    IF v_version IS NULL THEN RAISE EXCEPTION 'Актуальная версия не найдена'; END IF;
    UPDATE public.technologist_request_approval_versions
    SET state = 'superseded', updated_at = now() WHERE id = v_version;
    UPDATE public.tasks SET status = 'cancelled', completed_at = now(), updated_at = now()
    WHERE technologist_request_approval_id = v_version AND status IN ('pending','in_progress');
    UPDATE public.department_requests SET status = 'cancelled', completed_at = now()
    WHERE technologist_approval_version_id = v_version AND status IN ('new','in_progress');
    PERFORM set_config('app.financial_approval_request', p_request_id::text, true);
    UPDATE public.technologist_requests SET status = 'draft', submitted_at = NULL, updated_at = now()
    WHERE id = p_request_id;
    PERFORM set_config('app.financial_approval_request', '', true);
  END IF;
  SELECT coalesce(max(revision_number), -1) + 1 INTO v_next
  FROM public.technologist_request_approval_versions WHERE request_id = p_request_id;
  IF v_next > 0 THEN
    INSERT INTO public.technologist_request_revision_drafts(request_id, revision_number, editor_id)
    VALUES (p_request_id, v_next, p_actor) ON CONFLICT (request_id) DO NOTHING;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_begin_stock_request_revision(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_begin_stock_request_revision(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.finish_stock_request_if_received()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request public.technologist_requests%ROWTYPE; v_table text; v_item jsonb;
  v_required numeric; v_delivered numeric; v_count integer := 0;
BEGIN
  IF NEW.order_status IS DISTINCT FROM 'delivered' OR
     NEW.order_status IS NOT DISTINCT FROM OLD.order_status THEN RETURN NEW; END IF;
  SELECT * INTO v_request FROM public.technologist_requests WHERE id = NEW.request_id FOR UPDATE;
  IF v_request.request_kind <> 'stock' OR v_request.status <> 'submitted_to_supply' THEN RETURN NEW; END IF;
  FOREACH v_table IN ARRAY ARRAY['request_sheet_metal','request_round_tube','request_circle',
    'request_pipe','request_knives','request_components','request_paint','request_mesh','request_chain_cord'] LOOP
    FOR v_item IN EXECUTE format('SELECT to_jsonb(item) FROM public.%I item WHERE request_id = $1 AND order_status::text <> ''cancelled''', v_table)
      USING v_request.id LOOP
      v_count := v_count + 1;
      v_required := public.fn_supply_item_required_quantity(v_table, v_item);
      SELECT coalesce(sum(coalesce(allocated_quantity, received_quantity, quantity)), 0)
        INTO v_delivered FROM public.supply_order_delivery_schedules
      WHERE request_item_table = v_table AND request_item_id = (v_item->>'id')::uuid AND status = 'delivered';
      IF v_delivered + 0.000001 < v_required THEN RETURN NEW; END IF;
    END LOOP;
  END LOOP;
  IF v_count > 0 THEN
    PERFORM set_config('app.financial_approval_request', v_request.id::text, true);
    UPDATE public.technologist_requests SET status = 'completed', updated_at = now()
      WHERE id = v_request.id;
    PERFORM set_config('app.financial_approval_request', '', true);
  END IF;
  RETURN NEW;
END;
$$;
DO $$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['request_sheet_metal','request_round_tube','request_circle',
    'request_pipe','request_knives','request_components','request_paint','request_mesh','request_chain_cord'] LOOP
    EXECUTE format('CREATE TRIGGER finish_stock_request_if_received AFTER UPDATE OF order_status ON public.%I FOR EACH ROW EXECUTE FUNCTION private.finish_stock_request_if_received()', v_table);
  END LOOP;
END $$;

-- A receipt has one physical inventory increase.  Stock allocations satisfy
-- demand without reserving that increase for a machine.
DO $patch_receipt$
DECLARE
  v_definition text;
  v_source text := $anchor$
  SELECT request.machine_id, machine.name, machine.factory_id
  INTO v_machine_id, v_machine_name, v_factory_id
  FROM public.technologist_requests request
  JOIN public.machines machine ON machine.id = request.machine_id
  WHERE request.id = NULLIF(v_source_item->>'request_id', '')::uuid;
$anchor$;
  v_source_new text := $replacement$
  SELECT request.machine_id, COALESCE(machine.name, request.title),
    CASE WHEN request.request_kind = 'stock' THEN request.factory_id ELSE machine.factory_id END
  INTO v_machine_id, v_machine_name, v_factory_id
  FROM public.technologist_requests request
  LEFT JOIN public.machines machine ON machine.id = request.machine_id
  WHERE request.id = NULLIF(v_source_item->>'request_id', '')::uuid;
$replacement$;
  v_target text := $anchor$
    SELECT request.machine_id, machine.factory_id
    INTO v_target_machine_id, v_target_factory_id
    FROM public.technologist_requests request
    JOIN public.machines machine ON machine.id = request.machine_id
    WHERE request.id = NULLIF(v_target_item->>'request_id', '')::uuid;
$anchor$;
  v_target_new text := $replacement$
    SELECT request.machine_id,
      CASE WHEN request.request_kind = 'stock' THEN request.factory_id ELSE machine.factory_id END
    INTO v_target_machine_id, v_target_factory_id
    FROM public.technologist_requests request
    LEFT JOIN public.machines machine ON machine.id = request.machine_id
    WHERE request.id = NULLIF(v_target_item->>'request_id', '')::uuid;
$replacement$;
BEGIN
  SELECT pg_get_functiondef('public.fn_receive_supply_order_schedule_v2(uuid,uuid,numeric,jsonb,numeric,numeric)'::regprocedure)
    INTO v_definition;
  IF position(v_source IN v_definition) = 0 OR position(v_target IN v_definition) = 0
    OR position('    INSERT INTO public.inventory_reservations (' IN v_definition) = 0
    OR position(E'    IF p_received_piece_count IS NOT NULL THEN\n      PERFORM public.fn_assert_whole_bar_receipt_allocation_v1(' IN v_definition) = 0
    OR position('    v_total_physical := v_total_physical + v_allocation_physical;' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_receive_supply_order_schedule_v2 definition';
  END IF;
  v_definition := replace(v_definition, v_source, v_source_new);
  v_definition := replace(v_definition, v_target, v_target_new);
  v_definition := replace(v_definition,
    E'    IF p_received_piece_count IS NOT NULL THEN\n      PERFORM public.fn_assert_whole_bar_receipt_allocation_v1(',
    E'    IF p_received_piece_count IS NOT NULL AND v_target_machine_id IS NOT NULL THEN\n      PERFORM public.fn_assert_whole_bar_receipt_allocation_v1(');
  v_definition := replace(v_definition,
    '    INSERT INTO public.inventory_reservations (',
    E'    IF v_target_machine_id IS NOT NULL THEN\n    INSERT INTO public.inventory_reservations (');
  v_definition := replace(v_definition,
    '    v_total_physical := v_total_physical + v_allocation_physical;',
    E'    END IF;\n\n    v_total_physical := v_total_physical + v_allocation_physical;');
  EXECUTE v_definition;
END;
$patch_receipt$;

DO $patch_batch$
DECLARE
  v_definition text;
  v_source text := $anchor$
    SELECT request.machine_id, machine.name, machine.factory_id
    INTO v_machine_id, v_machine_name, v_factory_id
    FROM public.technologist_requests AS request
    JOIN public.machines AS machine ON machine.id = request.machine_id
    WHERE request.id = NULLIF(v_item->>'request_id', '')::uuid;
$anchor$;
  v_source_new text := $replacement$
    SELECT request.machine_id, COALESCE(machine.name, request.title),
      CASE WHEN request.request_kind = 'stock' THEN request.factory_id ELSE machine.factory_id END
    INTO v_machine_id, v_machine_name, v_factory_id
    FROM public.technologist_requests AS request
    LEFT JOIN public.machines AS machine ON machine.id = request.machine_id
    WHERE request.id = NULLIF(v_item->>'request_id', '')::uuid;
$replacement$;
  v_notification text := $anchor$
  SELECT request.machine_id, machine.name
  INTO v_machine_id, v_machine_name
  FROM public.technologist_requests AS request
  JOIN public.machines AS machine ON machine.id = request.machine_id
  WHERE request.id = NULLIF(v_first_item->>'request_id', '')::uuid;
$anchor$;
  v_notification_new text := $replacement$
  SELECT request.machine_id, COALESCE(machine.name, request.title)
  INTO v_machine_id, v_machine_name
  FROM public.technologist_requests AS request
  LEFT JOIN public.machines AS machine ON machine.id = request.machine_id
  WHERE request.id = NULLIF(v_first_item->>'request_id', '')::uuid;
$replacement$;
BEGIN
  SELECT pg_get_functiondef('public.fn_receive_supply_order_schedule_batch_v1(jsonb,uuid)'::regprocedure)
    INTO v_definition;
  IF position(v_source IN v_definition) = 0 OR position(v_notification IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_receive_supply_order_schedule_batch_v1 definition';
  END IF;
  EXECUTE replace(replace(v_definition, v_source, v_source_new), v_notification, v_notification_new);
END;
$patch_batch$;

-- The manual quantity reconciliation used by the v3 receipt path also groups
-- demand by factory and need date.  Resolve those directly for stock demand.
DO $patch_manual$
DECLARE
  v_definition text;
  v_source text := $anchor$
    SELECT machine.factory_id, machine.planned_material_date, machine.id, machine.name,
           request.status::text
    INTO v_factory_id, v_material_date, v_machine_id, v_machine_name, v_request_status
    FROM public.technologist_requests AS request
    JOIN public.machines AS machine ON machine.id = request.machine_id
    WHERE request.id = NULLIF(v_item->>'request_id', '')::uuid
      AND COALESCE(machine.is_archived, false) = false;
$anchor$;
  v_source_new text := $replacement$
    SELECT CASE WHEN request.request_kind = 'stock' THEN request.factory_id ELSE machine.factory_id END,
           CASE WHEN request.request_kind = 'stock' THEN request.needed_by ELSE machine.planned_material_date END,
           machine.id, COALESCE(machine.name, request.title), request.status::text
    INTO v_factory_id, v_material_date, v_machine_id, v_machine_name, v_request_status
    FROM public.technologist_requests AS request
    LEFT JOIN public.machines AS machine ON machine.id = request.machine_id
    WHERE request.id = NULLIF(v_item->>'request_id', '')::uuid
      AND COALESCE(machine.is_archived, false) = false;
$replacement$;
  v_other text := $anchor$
      SELECT machine.factory_id, machine.planned_material_date
      INTO v_other_factory_id, v_other_material_date
      FROM public.technologist_requests AS request
      JOIN public.machines AS machine ON machine.id = request.machine_id
      WHERE request.id = NULLIF(v_other_item->>'request_id', '')::uuid;
$anchor$;
  v_other_new text := $replacement$
      SELECT CASE WHEN request.request_kind = 'stock' THEN request.factory_id ELSE machine.factory_id END,
             CASE WHEN request.request_kind = 'stock' THEN request.needed_by ELSE machine.planned_material_date END
      INTO v_other_factory_id, v_other_material_date
      FROM public.technologist_requests AS request
      LEFT JOIN public.machines AS machine ON machine.id = request.machine_id
      WHERE request.id = NULLIF(v_other_item->>'request_id', '')::uuid;
$replacement$;
  v_group text := $anchor$
      SELECT item.id AS item_id, to_jsonb(item) AS item_json,
             machine.id AS machine_id, machine.name AS machine_name
      FROM public.%I AS item
      JOIN public.technologist_requests AS request ON request.id = item.request_id
      JOIN public.machines AS machine ON machine.id = request.machine_id
      WHERE machine.factory_id = $1
        AND machine.planned_material_date IS NOT DISTINCT FROM $2
        AND COALESCE(machine.is_archived, false) = false
$anchor$;
  v_group_new text := $replacement$
      SELECT item.id AS item_id, to_jsonb(item) AS item_json,
             machine.id AS machine_id, COALESCE(machine.name, request.title) AS machine_name
      FROM public.%I AS item
      JOIN public.technologist_requests AS request ON request.id = item.request_id
      LEFT JOIN public.machines AS machine ON machine.id = request.machine_id
      WHERE (CASE WHEN request.request_kind = 'stock' THEN request.factory_id ELSE machine.factory_id END) = $1
        AND (CASE WHEN request.request_kind = 'stock' THEN request.needed_by ELSE machine.planned_material_date END) IS NOT DISTINCT FROM $2
        AND COALESCE(machine.is_archived, false) = false
$replacement$;
BEGIN
  SELECT pg_get_functiondef('public.fn_reconcile_quantity_receipt_schedules_v1(uuid[],jsonb,text,uuid)'::regprocedure)
    INTO v_definition;
  IF position(v_source IN v_definition) = 0 OR position(v_other IN v_definition) = 0
    OR position(v_group IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_reconcile_quantity_receipt_schedules_v1 definition';
  END IF;
  EXECUTE replace(replace(replace(v_definition, v_source, v_source_new), v_other, v_other_new), v_group, v_group_new);
END;
$patch_manual$;
