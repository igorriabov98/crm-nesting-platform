-- Migration runner wraps this file in one transaction. Freeze numbering inputs
-- until the backfill and all allocation triggers are installed together.
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.technologist_requests, public.technologist_request_approval_versions,
  public.technologist_request_revision_drafts, public.supply_position_revisions
  IN SHARE ROW EXCLUSIVE MODE;

-- Keep viewing read-only. The same decision/signature rule gates every mutation.
CREATE OR REPLACE FUNCTION public.fn_detailing_request_check_state(
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine_id uuid;
  v_signature text;
  v_check public.detailing_request_checks%ROWTYPE;
  v_has_matches boolean;
  v_has_active_reservations boolean;
BEGIN
  SELECT machine_id INTO v_machine_id
  FROM public.technologist_requests
  WHERE id = p_request_id;
  IF v_machine_id IS NULL THEN RAISE EXCEPTION 'Заявка технолога не найдена'; END IF;

  v_signature := public.detailing_machine_item_signature(v_machine_id);
  SELECT * INTO v_check
  FROM public.detailing_request_checks
  WHERE request_id = p_request_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.detailing_reservations dr
    JOIN public.detailing_reservation_allocations dra ON dra.reservation_id = dr.id
    WHERE dr.request_id = p_request_id
      AND dr.status IN ('active', 'partially_consumed')
      AND dra.quantity > 0
  ) INTO v_has_active_reservations;

  v_has_matches := public.detailing_request_has_available_matches(p_request_id)
    OR v_has_active_reservations;

  IF NOT v_has_matches THEN
    RETURN jsonb_build_object(
      'ready', true,
      'has_matches', false,
      'decision', 'auto_no_matches'
    );
  END IF;

  IF v_check.request_id IS NOT NULL
     AND v_check.machine_item_signature = v_signature
     AND (
       v_check.decision = 'declined'
       OR (v_check.decision = 'reserved' AND v_has_active_reservations)
     ) THEN
    RETURN jsonb_build_object(
      'ready', true,
      'has_matches', true,
      'decision', v_check.decision::text
    );
  END IF;

  RETURN jsonb_build_object(
    'ready', false,
    'has_matches', true,
    'decision', NULL,
    'message', 'Проверьте подходящую деталировку: забронируйте детали или выберите «Не использовать деталировку».'
  );
END;
$$;


REVOKE ALL ON FUNCTION public.fn_detailing_request_check_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_detailing_request_check_state(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_validate_detailing_request_check(p_request_id uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state jsonb; v_machine uuid;
BEGIN
  PERFORM public.detailing_assert_actor(p_actor,
    ARRAY['technologist','planning_director','financial_director','commercial_director']::public.user_role[]);
  v_state := public.fn_detailing_request_check_state(p_request_id);
  IF v_state->>'decision' = 'auto_no_matches' THEN
    SELECT machine_id INTO v_machine FROM public.technologist_requests WHERE id = p_request_id;
    INSERT INTO public.detailing_request_checks(request_id,machine_id,machine_item_signature,decision,decided_by,decided_at)
    VALUES(p_request_id,v_machine,public.detailing_machine_item_signature(v_machine),'auto_no_matches',p_actor,now())
    ON CONFLICT(request_id) DO UPDATE SET machine_item_signature=EXCLUDED.machine_item_signature,
      decision=EXCLUDED.decision,decided_by=EXCLUDED.decided_by,decided_at=EXCLUDED.decided_at;
  END IF;
  RETURN v_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_complete_business_scrap_stage_v1(
  p_request_id uuid,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_request public.technologist_requests%ROWTYPE;
  v_detailing_check jsonb;
  v_is_revision boolean;
BEGIN
  IF NOT private.crm_can_work_technologist_request(p_request_id, p_actor, 'manage') THEN
    RAISE EXCEPTION 'Недостаточно прав для заявки или выбранного завода' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_request
  FROM public.technologist_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'Заявка технолога не найдена'; END IF;
  IF v_request.status <> 'pending_stock_check' THEN
    RAISE EXCEPTION 'Этап делового остатка уже завершён или ещё не открыт';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.supply_position_revisions revision
    WHERE revision.replacement_request_id = p_request_id
  ) INTO v_is_revision;

  v_detailing_check := public.fn_validate_detailing_request_check(p_request_id, p_actor);
  IF NOT COALESCE((v_detailing_check->>'ready')::boolean, false) THEN
    RAISE EXCEPTION '%', COALESCE(
      v_detailing_check->>'message',
      'Проверьте подходящую деталировку перед переходом к основному складу'
    );
  END IF;

  UPDATE public.technologist_requests
  SET status = 'stock_checked', updated_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'status', 'stock_checked',
    'is_revision', v_is_revision
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_complete_business_scrap_stage_v1(uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_complete_business_scrap_stage_v1(uuid,uuid)
  TO authenticated, service_role;


-- Public request/version IDs and internal revision indexes remain unchanged.
-- Existing requests retain their current ordinal; only future supply corrections
-- inherit their source's display series. Private counters cannot be client-edited.
CREATE TABLE private.technologist_number_series (
  id uuid PRIMARY KEY,
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  request_number integer NOT NULL CHECK(request_number > 0),
  next_revision integer NOT NULL DEFAULT 0 CHECK(next_revision >= 0),
  UNIQUE(machine_id, request_number)
);
CREATE TABLE private.technologist_request_numbers (
  request_id uuid PRIMARY KEY REFERENCES public.technologist_requests(id) ON DELETE CASCADE,
  series_id uuid NOT NULL REFERENCES private.technologist_number_series(id) ON DELETE CASCADE
);
CREATE INDEX technologist_request_numbers_series_idx ON private.technologist_request_numbers(series_id);
CREATE TABLE private.technologist_revision_numbers (
  request_id uuid NOT NULL REFERENCES public.technologist_requests(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK(revision_number >= 0),
  series_id uuid NOT NULL REFERENCES private.technologist_number_series(id) ON DELETE CASCADE,
  display_revision integer NOT NULL CHECK(display_revision >= 0),
  PRIMARY KEY(request_id,revision_number),
  UNIQUE(series_id,display_revision)
);
REVOKE ALL ON private.technologist_number_series, private.technologist_request_numbers,
  private.technologist_revision_numbers FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO private.technologist_number_series(id,machine_id,request_number)
SELECT id,machine_id,row_number() OVER(PARTITION BY machine_id ORDER BY created_at,id)::integer
FROM public.technologist_requests;
INSERT INTO private.technologist_request_numbers SELECT id,id FROM public.technologist_requests;
INSERT INTO private.technologist_revision_numbers(request_id,revision_number,series_id,display_revision)
SELECT request_id,revision_number,request_id,revision_number FROM (
  SELECT id AS request_id,0 AS revision_number FROM public.technologist_requests
  UNION SELECT request_id,revision_number FROM public.technologist_request_approval_versions
  UNION SELECT request_id,revision_number FROM public.technologist_request_revision_drafts
) existing;
UPDATE private.technologist_number_series s SET next_revision = (
  SELECT max(n.display_revision)+1 FROM private.technologist_revision_numbers n WHERE n.series_id=s.id
);

CREATE FUNCTION private.reserve_technologist_revision_number(p_request uuid,p_revision integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_series uuid; v_display integer;
BEGIN
  SELECT series_id INTO STRICT v_series FROM private.technologist_request_numbers WHERE request_id=p_request;
  PERFORM 1 FROM private.technologist_number_series WHERE id=v_series FOR UPDATE;
  SELECT display_revision INTO v_display FROM private.technologist_revision_numbers
  WHERE request_id=p_request AND revision_number=p_revision;
  IF FOUND THEN RETURN v_display; END IF;
  UPDATE private.technologist_number_series SET next_revision=next_revision+1
  WHERE id=v_series RETURNING next_revision-1 INTO v_display;
  INSERT INTO private.technologist_revision_numbers VALUES(p_request,p_revision,v_series,v_display);
  RETURN v_display;
END;
$$;

CREATE FUNCTION private.assign_technologist_request_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_number integer;
BEGIN
  PERFORM 1 FROM public.machines WHERE id=NEW.machine_id FOR UPDATE;
  SELECT COALESCE(max(request_number),0)+1 INTO v_number
  FROM private.technologist_number_series WHERE machine_id=NEW.machine_id;
  INSERT INTO private.technologist_number_series(id,machine_id,request_number) VALUES(NEW.id,NEW.machine_id,v_number);
  INSERT INTO private.technologist_request_numbers VALUES(NEW.id,NEW.id);
  PERFORM private.reserve_technologist_revision_number(NEW.id,0);
  RETURN NEW;
END;
$$;
CREATE TRIGGER assign_technologist_request_number AFTER INSERT ON public.technologist_requests
FOR EACH ROW EXECUTE FUNCTION private.assign_technologist_request_number();

CREATE FUNCTION private.inherit_supply_revision_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_series uuid; v_temporary_series uuid;
BEGIN
  IF NEW.replacement_request_id IS NULL OR NEW.replacement_request_id IS NOT DISTINCT FROM OLD.replacement_request_id THEN RETURN NEW; END IF;
  SELECT series_id INTO STRICT v_series FROM private.technologist_request_numbers WHERE request_id=NEW.source_request_id;
  SELECT series_id INTO STRICT v_temporary_series FROM private.technologist_request_numbers WHERE request_id=NEW.replacement_request_id;
  IF EXISTS(SELECT 1 FROM public.technologist_request_approval_versions WHERE request_id=NEW.replacement_request_id) THEN
    RAISE EXCEPTION 'Нельзя менять номер заявки с историей согласования';
  END IF;
  IF (SELECT machine_id FROM private.technologist_number_series WHERE id=v_series)
     IS DISTINCT FROM (SELECT machine_id FROM private.technologist_number_series WHERE id=v_temporary_series) THEN
    RAISE EXCEPTION 'Корректировка относится к другому заказу';
  END IF;
  DELETE FROM private.technologist_revision_numbers WHERE request_id=NEW.replacement_request_id;
  UPDATE private.technologist_request_numbers SET series_id=v_series WHERE request_id=NEW.replacement_request_id;
  DELETE FROM private.technologist_number_series WHERE id=v_temporary_series
    AND NOT EXISTS(SELECT 1 FROM private.technologist_request_numbers WHERE series_id=v_temporary_series);
  PERFORM private.reserve_technologist_revision_number(NEW.replacement_request_id,0);
  RETURN NEW;
END;
$$;
CREATE TRIGGER inherit_supply_revision_number AFTER UPDATE OF replacement_request_id ON public.supply_position_revisions
FOR EACH ROW EXECUTE FUNCTION private.inherit_supply_revision_number();

CREATE FUNCTION private.assign_technologist_revision_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM private.reserve_technologist_revision_number(NEW.request_id,NEW.revision_number);
  RETURN NEW;
END;
$$;
CREATE TRIGGER assign_technologist_approval_number AFTER INSERT ON public.technologist_request_approval_versions
FOR EACH ROW EXECUTE FUNCTION private.assign_technologist_revision_number();
CREATE TRIGGER assign_technologist_draft_number AFTER INSERT ON public.technologist_request_revision_drafts
FOR EACH ROW EXECUTE FUNCTION private.assign_technologist_revision_number();
REVOKE ALL ON FUNCTION private.reserve_technologist_revision_number(uuid,integer),
  private.assign_technologist_request_number(),private.inherit_supply_revision_number(),
  private.assign_technologist_revision_number() FROM PUBLIC, anon, authenticated, service_role;

-- Server calls only after checking access to the requested IDs. No public enumeration.
CREATE FUNCTION public.fn_technologist_request_numbers(p_request_ids uuid[])
RETURNS TABLE(request_id uuid,request_number integer,revision_numbers jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT n.request_id,s.request_number,
    (SELECT jsonb_object_agg(v.revision_number::text,v.display_revision)
     FROM private.technologist_revision_numbers v WHERE v.request_id=n.request_id)
  FROM private.technologist_request_numbers n
  JOIN private.technologist_number_series s ON s.id=n.series_id
  WHERE n.request_id=ANY(p_request_ids);
$$;
REVOKE ALL ON FUNCTION public.fn_technologist_request_numbers(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_technologist_request_numbers(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_submit_technologist_request_for_approval(
  p_request_id uuid,
  p_actor uuid,
  p_completion_payload jsonb,
  p_summary_snapshot jsonb,
  p_archives jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.technologist_requests%ROWTYPE;
  v_machine_name text;
  v_version_id uuid;
  v_pending_version public.technologist_request_approval_versions%ROWTYPE;
  v_revision integer;
  v_request_number integer;
  v_recipients uuid[];
  v_recipient uuid;
  v_archive jsonb;
  v_storage storage.objects%ROWTYPE;
  v_path_prefix text;
  v_has_sheet_metal boolean;
  v_input_archives jsonb;
  v_saved_archives jsonb;
  v_detailing_check jsonb;
BEGIN
  IF NOT private.crm_can_work_technologist_request(p_request_id, p_actor, 'manage') THEN
    RAISE EXCEPTION 'Недостаточно прав для заявки или выбранного завода' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_completion_payload) <> 'object' OR jsonb_typeof(p_summary_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'Некорректный снимок заявки';
  END IF;
  IF jsonb_typeof(COALESCE(p_archives, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_archives, '[]'::jsonb)) > 20 THEN
    RAISE EXCEPTION 'Можно прикрепить не более 20 архивов';
  END IF;
  IF COALESCE(p_completion_payload->'archives', '[]'::jsonb)
     IS DISTINCT FROM COALESCE(p_archives, '[]'::jsonb) THEN
    RAISE EXCEPTION 'Список программ порезки не совпадает со снимком заявки';
  END IF;

  SELECT request.* INTO v_request
  FROM public.technologist_requests request
  WHERE request.id = p_request_id
  FOR UPDATE OF request;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявка недоступна'; END IF;

  SELECT machine.name INTO v_machine_name
  FROM public.machines machine
  WHERE machine.id = v_request.machine_id AND NOT machine.is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ находится в архиве'; END IF;

  IF p_summary_snapshot->'sourceData' IS DISTINCT FROM public.fn_technologist_approval_source(p_request_id) THEN
    RAISE EXCEPTION 'Данные заявки изменились. Обновите итоговый мастер';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.technologist_request_completions completion
    WHERE completion.request_id = p_request_id
  ) THEN
    RAISE EXCEPTION 'Производственные последствия уже зафиксированы';
  END IF;

  SELECT * INTO v_pending_version
  FROM public.technologist_request_approval_versions version
  WHERE version.request_id = p_request_id AND version.state = 'pending'
  ORDER BY version.revision_number DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'requestId', p_request_id,
      'completionId', NULL,
      'objectPath', archive.object_path,
      'fileName', archive.file_name,
      'mimeType', archive.mime_type,
      'fileSize', archive.file_size
    ) ORDER BY archive.object_path), '[]'::jsonb)
    INTO v_saved_archives
    FROM public.technologist_request_approval_archives archive
    WHERE archive.approval_version_id = v_pending_version.id;
    SELECT COALESCE(jsonb_agg(value ORDER BY value->>'objectPath'), '[]'::jsonb)
    INTO v_input_archives
    FROM jsonb_array_elements(COALESCE(p_archives, '[]'::jsonb));
    IF v_pending_version.completion_payload = p_completion_payload
       AND v_pending_version.summary_snapshot = p_summary_snapshot
       AND v_saved_archives = v_input_archives THEN
      RETURN v_pending_version.id;
    END IF;
    RAISE EXCEPTION 'Заявка уже ожидает согласования с другими данными' USING ERRCODE = '40001';
  END IF;

  IF v_request.status <> 'stock_checked' THEN RAISE EXCEPTION 'Заявка не готова к согласованию'; END IF;
  v_detailing_check := public.fn_validate_detailing_request_check(p_request_id,p_actor);
  IF NOT COALESCE((v_detailing_check->>'ready')::boolean,false) THEN
    RAISE EXCEPTION '%', v_detailing_check->>'message';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.request_sheet_metal sheet WHERE sheet.request_id = p_request_id
  ) INTO v_has_sheet_metal;
  IF v_has_sheet_metal AND jsonb_array_length(COALESCE(p_archives, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Для заявки с листовым металлом загрузите программу порезки';
  END IF;
  IF NOT v_has_sheet_metal AND jsonb_array_length(COALESCE(p_archives, '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'Программа порезки доступна только для заявки с листовым металлом';
  END IF;

  v_path_prefix := 'machine-cutting/' || v_request.machine_id || '/' || p_request_id || '/';
  FOR v_archive IN SELECT * FROM jsonb_array_elements(COALESCE(p_archives, '[]'::jsonb)) LOOP
    IF v_archive->>'requestId' IS DISTINCT FROM p_request_id::text
       OR NULLIF(v_archive->>'completionId', '') IS NOT NULL
       OR btrim(COALESCE(v_archive->>'fileName', '')) = ''
       OR (v_archive->>'fileSize')::bigint <= 0
       OR (v_archive->>'fileSize')::bigint > 524288000
       OR lower(v_archive->>'fileName') !~ '\.(zip|rar|7z)$'
       OR v_archive->>'objectPath' NOT LIKE v_path_prefix || '%'
       OR v_archive->>'objectPath' LIKE '%..%'
       OR lower(v_archive->>'objectPath') !~ '/[0-9]+-[0-9a-f-]{36}\.(zip|rar|7z)$' THEN
      RAISE EXCEPTION 'Некорректный архив порезки';
    END IF;
    SELECT * INTO v_storage
    FROM storage.objects
    WHERE bucket_id = 'nesting-files' AND name = v_archive->>'objectPath';
    IF NOT FOUND OR COALESCE((v_storage.metadata->>'size')::bigint, -1) <> (v_archive->>'fileSize')::bigint THEN
      RAISE EXCEPTION 'Загруженный архив не найден или его размер не совпадает';
    END IF;
  END LOOP;

  v_recipients := ARRAY[public.fn_technologist_approval_department_head('Финансовый отдел')];
  IF v_recipients[1] IS NULL THEN
    RAISE EXCEPTION 'Не назначен действующий начальник Финансового отдела';
  END IF;

  SELECT COALESCE(max(version.revision_number), -1) + 1 INTO v_revision
  FROM public.technologist_request_approval_versions version
  WHERE version.request_id = p_request_id;
  SELECT s.request_number INTO STRICT v_request_number
  FROM private.technologist_request_numbers n
  JOIN private.technologist_number_series s ON s.id=n.series_id
  WHERE n.request_id=p_request_id;

  INSERT INTO public.technologist_request_approval_versions(
    request_id, revision_number, state, completion_payload, summary_snapshot, submitted_by
  ) VALUES (
    p_request_id, v_revision, 'pending', p_completion_payload, p_summary_snapshot, p_actor
  ) RETURNING id INTO v_version_id;

  FOR v_archive IN SELECT * FROM jsonb_array_elements(COALESCE(p_archives, '[]'::jsonb)) LOOP
    INSERT INTO public.technologist_request_approval_archives(
      approval_version_id, object_path, file_name, mime_type, file_size
    ) VALUES (
      v_version_id, v_archive->>'objectPath', btrim(v_archive->>'fileName'),
      NULLIF(v_archive->>'mimeType', ''), (v_archive->>'fileSize')::bigint
    );
  END LOOP;

  FOREACH v_recipient IN ARRAY v_recipients LOOP
    INSERT INTO public.tasks(
      machine_id, assigned_to, task_type, title, description, status,
      start_date, deadline, technologist_request_approval_id, technologist_request_approval_machine_id
    ) VALUES (
      NULL, v_recipient, 'technologist_request_approval',
      'Проверить и одобрить заявку',
      'Заявка №' || v_request_number || ' для заказа «' || COALESCE(v_machine_name, 'Без названия') || '»',
      'pending', (now() AT TIME ZONE 'Europe/Kyiv')::date,
      (now() AT TIME ZONE 'Europe/Kyiv')::date, v_version_id, v_request.machine_id
    );
  END LOOP;

  PERFORM public.fn_technologist_approval_work_item(
    v_version_id, 'technologist_approval', p_actor, v_recipients[1],
    'Проверьте заявку №' || v_request_number || ' для заказа «' || COALESCE(v_machine_name, 'Без названия') || '» сегодня.'
  );
  UPDATE public.department_requests request
  SET status = 'done', completed_by = p_actor, completed_at = now()
  WHERE request.request_kind = 'technologist_revision'
    AND request.status IN ('new', 'in_progress')
    AND request.technologist_approval_version_id IN (
      SELECT id FROM public.technologist_request_approval_versions WHERE request_id = p_request_id
    );
  UPDATE public.tasks
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE task_type = 'technologist_request_revision'
    AND status IN ('pending', 'in_progress')
    AND technologist_request_approval_id IN (
      SELECT id FROM public.technologist_request_approval_versions WHERE request_id = p_request_id
    );
  DELETE FROM public.technologist_request_revision_drafts WHERE request_id = p_request_id;
  PERFORM set_config('app.financial_approval_request', p_request_id::text, true);
  UPDATE public.technologist_requests
  SET status = 'pending_financial_approval', submitted_at = NULL, updated_at = now()
  WHERE id = p_request_id;
  PERFORM set_config('app.financial_approval_request', '', true);
  RETURN v_version_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_submit_technologist_request_for_approval(uuid,uuid,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_submit_technologist_request_for_approval(uuid,uuid,jsonb,jsonb,jsonb)
  TO authenticated, service_role;
