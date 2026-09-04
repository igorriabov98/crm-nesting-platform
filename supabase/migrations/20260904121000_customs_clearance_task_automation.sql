-- Customs-clearance task lifecycle and server-side upload finalization.

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_customs_clearance_active_machine
  ON public.tasks (machine_id)
  WHERE task_type = 'customs_clearance'
    AND status IN ('pending', 'in_progress');

CREATE OR REPLACE FUNCTION public.fn_sync_customs_clearance_task(p_machine_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_machine record;
  v_shipping_date date;
  v_deadline date;
  v_head_user_id uuid;
  v_task_id uuid;
  v_current_assignee uuid;
  v_assignee_is_valid_delegate boolean := false;
  v_has_document boolean := false;
BEGIN
  SELECT id, name, is_archived
  INTO v_machine
  FROM public.machines
  WHERE id = p_machine_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(stage.date_end, stage.planned_date_end)::date
  INTO v_shipping_date
  FROM public.production_stages stage
  WHERE stage.machine_id = p_machine_id
    AND stage.stage_type = 'shipping'
  ORDER BY stage.created_at DESC, stage.id DESC
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM public.machine_customs_documents document
    WHERE document.machine_id = p_machine_id
  ) INTO v_has_document;

  SELECT candidate.user_id
  INTO v_head_user_id
  FROM public.departments department
  CROSS JOIN LATERAL (
    SELECT department.head_user_id AS user_id, 0 AS priority
    WHERE department.head_user_id IS NOT NULL
    UNION ALL
    SELECT member.user_id, 1 AS priority
    FROM public.department_members member
    WHERE member.department_id = department.id
      AND member.is_department_head = true
  ) candidate
  JOIN public.users broker_head ON broker_head.id = candidate.user_id
  WHERE lower(btrim(department.name)) = lower('Брокерский')
    AND department.is_active = true
    AND COALESCE(broker_head.is_active, true) = true
    AND COALESCE(broker_head.is_service_account, false) = false
  ORDER BY candidate.priority, department.created_at, candidate.user_id
  LIMIT 1;

  SELECT task.id, task.assigned_to
  INTO v_task_id, v_current_assignee
  FROM public.tasks task
  WHERE task.machine_id = p_machine_id
    AND task.task_type = 'customs_clearance'
    AND task.status IN ('pending', 'in_progress')
  ORDER BY task.created_at, task.id
  LIMIT 1
  FOR UPDATE;

  IF v_has_document THEN
    PERFORM set_config('app.customs_task_sync', 'on', true);
    UPDATE public.tasks
    SET status = 'completed',
        completed_at = now(),
        updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'customs_clearance'
      AND status IN ('pending', 'in_progress');

    UPDATE public.task_delegations delegation
    SET status = 'cancelled', responded_at = now()
    FROM public.tasks task
    WHERE delegation.task_id = task.id
      AND task.machine_id = p_machine_id
      AND task.task_type = 'customs_clearance'
      AND delegation.status = 'pending';
    PERFORM set_config('app.customs_task_sync', 'off', true);
    RETURN;
  END IF;

  IF COALESCE(v_machine.is_archived, false)
     OR v_shipping_date IS NULL
     OR CURRENT_DATE < v_shipping_date - 2
     OR v_head_user_id IS NULL THEN
    PERFORM set_config('app.customs_task_sync', 'on', true);
    UPDATE public.tasks
    SET status = 'cancelled', completed_at = NULL, updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'customs_clearance'
      AND status IN ('pending', 'in_progress');

    UPDATE public.task_delegations delegation
    SET status = 'cancelled', responded_at = now()
    FROM public.tasks task
    WHERE delegation.task_id = task.id
      AND task.machine_id = p_machine_id
      AND task.task_type = 'customs_clearance'
      AND delegation.status = 'pending';
    PERFORM set_config('app.customs_task_sync', 'off', true);
    RETURN;
  END IF;

  v_deadline := v_shipping_date - 2;

  IF v_current_assignee IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.department_members member
      JOIN public.departments department ON department.id = member.department_id
      JOIN public.users broker ON broker.id = member.user_id
      JOIN public.task_delegations delegation
        ON delegation.task_id = v_task_id
       AND delegation.delegated_to = member.user_id
       AND delegation.status = 'accepted'
      WHERE member.user_id = v_current_assignee
        AND lower(btrim(department.name)) = lower('Брокерский')
        AND department.is_active = true
        AND COALESCE(broker.is_active, true) = true
        AND COALESCE(broker.is_service_account, false) = false
    ) INTO v_assignee_is_valid_delegate;
  END IF;

  IF v_task_id IS NOT NULL THEN
    UPDATE public.tasks
    SET assigned_to = CASE WHEN v_assignee_is_valid_delegate THEN v_current_assignee ELSE v_head_user_id END,
        title = 'Затаможить заказ: ' || COALESCE(v_machine.name, 'Машина'),
        description = 'Необходимо затаможить заказ и прикрепить документ. Готовность к погрузке: '
          || to_char(v_shipping_date, 'DD.MM.YYYY') || '.',
        start_date = v_deadline,
        deadline = v_deadline,
        completed_at = NULL,
        updated_at = now()
    WHERE id = v_task_id;
    RETURN;
  END IF;

  INSERT INTO public.tasks (
    machine_id,
    assigned_to,
    task_type,
    title,
    description,
    status,
    start_date,
    deadline
  ) VALUES (
    p_machine_id,
    v_head_user_id,
    'customs_clearance',
    'Затаможить заказ: ' || COALESCE(v_machine.name, 'Машина'),
    'Необходимо затаможить заказ и прикрепить документ. Готовность к погрузке: '
      || to_char(v_shipping_date, 'DD.MM.YYYY') || '.',
    'pending',
    v_deadline,
    v_deadline
  )
  ON CONFLICT (machine_id)
    WHERE task_type = 'customs_clearance'
      AND status IN ('pending', 'in_progress')
  DO UPDATE SET
    assigned_to = EXCLUDED.assigned_to,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    start_date = EXCLUDED.start_date,
    deadline = EXCLUDED.deadline,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sync_customs_clearance_task(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_customs_clearance_task(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_sync_due_customs_clearance_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_machine_id uuid;
  v_count integer := 0;
BEGIN
  FOR v_machine_id IN
    SELECT DISTINCT candidate.machine_id
    FROM (
      SELECT stage.machine_id
      FROM public.production_stages stage
      WHERE stage.stage_type = 'shipping'
        AND COALESCE(stage.date_end, stage.planned_date_end)::date <= CURRENT_DATE + 2
      UNION
      SELECT task.machine_id
      FROM public.tasks task
      WHERE task.task_type = 'customs_clearance'
        AND task.status IN ('pending', 'in_progress')
        AND task.machine_id IS NOT NULL
    ) candidate
  LOOP
    PERFORM public.fn_sync_customs_clearance_task(v_machine_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sync_due_customs_clearance_tasks()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_due_customs_clearance_tasks() TO service_role;

CREATE OR REPLACE FUNCTION public.fn_finalize_customs_clearance_documents(
  p_machine_id uuid,
  p_user_id uuid,
  p_document_kind text,
  p_documents jsonb
)
RETURNS SETOF public.machine_customs_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_document jsonb;
  v_path text;
  v_file_name text;
  v_mime_type text;
  v_expected_mime text;
  v_extension text;
  v_file_size bigint;
  v_storage_size_text text;
  v_storage_mime text;
  v_prefix text := 'customs-clearance/' || p_machine_id::text || '/' || p_user_id::text || '/';
  v_created public.machine_customs_documents%rowtype;
BEGIN
  IF p_document_kind NOT IN ('invoice', 'specification', 'packing_list', 'other') THEN
    RAISE EXCEPTION 'Некорректный тип документа';
  END IF;
  IF p_documents IS NULL OR jsonb_typeof(p_documents) <> 'array'
     OR jsonb_array_length(p_documents) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'Можно прикрепить от 1 до 10 файлов';
  END IF;

  FOR v_document IN SELECT value FROM jsonb_array_elements(p_documents)
  LOOP
    v_path := btrim(COALESCE(v_document->>'objectPath', ''));
    v_file_name := btrim(COALESCE(v_document->>'fileName', ''));
    v_mime_type := lower(btrim(COALESCE(v_document->>'mimeType', '')));
    v_file_size := NULLIF(v_document->>'fileSize', '')::bigint;
    v_extension := lower(substring(v_file_name FROM '(\.[A-Za-z0-9]+)$'));

    v_expected_mime := CASE v_extension
      WHEN '.pdf' THEN 'application/pdf'
      WHEN '.doc' THEN 'application/msword'
      WHEN '.docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      WHEN '.xls' THEN 'application/vnd.ms-excel'
      WHEN '.xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      WHEN '.jpg' THEN 'image/jpeg'
      WHEN '.jpeg' THEN 'image/jpeg'
      WHEN '.png' THEN 'image/png'
      ELSE NULL
    END;

    IF v_path = '' OR v_path NOT LIKE v_prefix || '%' OR v_path LIKE '%..%'
       OR char_length(v_file_name) NOT BETWEEN 1 AND 240
       OR v_file_size IS NULL OR v_file_size <= 0 OR v_file_size > 26214400
       OR v_expected_mime IS NULL OR v_mime_type <> v_expected_mime
       OR lower(substring(v_path FROM '(\.[A-Za-z0-9]+)$')) <> v_extension THEN
      RAISE EXCEPTION 'Некорректные данные документа';
    END IF;

    SELECT object.metadata->>'size', lower(COALESCE(object.metadata->>'mimetype', ''))
    INTO v_storage_size_text, v_storage_mime
    FROM storage.objects object
    WHERE object.bucket_id = 'customs-clearance-files'
      AND object.name = v_path;

    IF NOT FOUND OR v_storage_size_text !~ '^[0-9]+$'
       OR v_storage_size_text::bigint <> v_file_size
       OR v_storage_mime <> v_expected_mime THEN
      RAISE EXCEPTION 'Загруженный файл не прошёл серверную проверку';
    END IF;

    INSERT INTO public.machine_customs_documents (
      machine_id, document_kind, file_name, mime_type, file_size, storage_path, uploaded_by
    ) VALUES (
      p_machine_id, p_document_kind, v_file_name, v_expected_mime, v_file_size, v_path, p_user_id
    )
    RETURNING * INTO v_created;

    RETURN NEXT v_created;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_finalize_customs_clearance_documents(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_finalize_customs_clearance_documents(uuid, uuid, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.trg_sync_customs_clearance_from_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.fn_sync_customs_clearance_task(COALESCE(NEW.machine_id, OLD.machine_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_machine_customs_documents_sync ON public.machine_customs_documents;
CREATE TRIGGER trg_machine_customs_documents_sync
  AFTER INSERT OR DELETE ON public.machine_customs_documents
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_customs_clearance_from_document();

CREATE OR REPLACE FUNCTION public.trg_sync_customs_clearance_from_shipping_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(NEW.stage_type, OLD.stage_type)::text = 'shipping' THEN
    PERFORM public.fn_sync_customs_clearance_task(COALESCE(NEW.machine_id, OLD.machine_id));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_production_stages_customs_sync ON public.production_stages;
CREATE TRIGGER trg_production_stages_customs_sync
  AFTER INSERT OR UPDATE OF date_end, planned_date_end OR DELETE ON public.production_stages
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_customs_clearance_from_shipping_stage();

CREATE OR REPLACE FUNCTION public.trg_sync_customs_clearance_from_machine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.fn_sync_customs_clearance_task(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_machines_customs_sync ON public.machines;
CREATE TRIGGER trg_machines_customs_sync
  AFTER UPDATE OF is_archived ON public.machines
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_customs_clearance_from_machine();

CREATE OR REPLACE FUNCTION public.trg_sync_customs_clearance_department()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_department_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'department_members' THEN
    v_department_id := COALESCE(NEW.department_id, OLD.department_id);
    IF NOT EXISTS (
       SELECT 1
       FROM public.departments department
       WHERE department.id = v_department_id
         AND lower(btrim(department.name)) = lower('Брокерский')
    ) THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
  END IF;
  PERFORM public.fn_sync_due_customs_clearance_tasks();
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_departments_customs_sync ON public.departments;
CREATE TRIGGER trg_departments_customs_sync
  AFTER UPDATE OF head_user_id, is_active ON public.departments
  FOR EACH ROW
  WHEN (lower(btrim(COALESCE(NEW.name, OLD.name))) = lower('Брокерский'))
  EXECUTE FUNCTION public.trg_sync_customs_clearance_department();

DROP TRIGGER IF EXISTS trg_department_members_customs_sync ON public.department_members;
CREATE TRIGGER trg_department_members_customs_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.department_members
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_customs_clearance_department();

CREATE OR REPLACE FUNCTION public.trg_guard_customs_clearance_task_terminal_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.task_type = 'customs_clearance'
     AND OLD.status IN ('pending', 'in_progress')
     AND NEW.status IN ('completed', 'cancelled')
     AND COALESCE(current_setting('app.customs_task_sync', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Задача затамаживания закрывается автоматически после загрузки документа';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_guard_customs_terminal_status ON public.tasks;
CREATE TRIGGER trg_tasks_guard_customs_terminal_status
  BEFORE UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_customs_clearance_task_terminal_status();

REVOKE ALL ON FUNCTION public.trg_sync_customs_clearance_from_document() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_customs_clearance_from_shipping_stage() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_customs_clearance_from_machine() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_customs_clearance_department() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_guard_customs_clearance_task_terminal_status() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-customs-clearance-tasks') THEN
    PERFORM cron.unschedule('daily-customs-clearance-tasks');
  END IF;
END;
$$;

SELECT cron.schedule(
  'daily-customs-clearance-tasks',
  '20 6 * * *',
  $$ SELECT public.fn_sync_due_customs_clearance_tasks(); $$
);

SELECT public.fn_sync_due_customs_clearance_tasks();
SELECT pg_notify('pgrst', 'reload schema');
