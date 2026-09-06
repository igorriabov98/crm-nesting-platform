-- Product-project mail links, corrections, and version provenance.
-- Keep all ownership checks outside RLS-protected mail tables so the policies
-- cannot recurse through product/request link tables.

ALTER TABLE public.product_projects
  ADD COLUMN IF NOT EXISTS requires_vrb_mesh boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.product_projects.requires_vrb_mesh IS
  'Whether the sample must retain the VRB mesh requirement when promoted to a product.';

CREATE OR REPLACE FUNCTION public.can_view_product_projects()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users AS active_actor
    WHERE active_actor.id = auth.uid()
      AND active_actor.is_active IS DISTINCT FROM false
  )
  AND (
    EXISTS (
      SELECT 1
      FROM public.users AS actor
      JOIN public.role_permissions AS permission ON permission.role = actor.role
      WHERE actor.id = auth.uid()
        AND permission.resource_key = 'product_projects'
        AND (permission.can_view OR permission.can_manage)
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members AS member
      JOIN public.department_access_permissions AS permission
        ON permission.department_id = member.department_id
       AND permission.subject_scope = CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END
      WHERE member.user_id = auth.uid()
        AND permission.resource_key = 'product_projects'
        AND (permission.can_view OR permission.can_manage)
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members AS member
      JOIN public.positions AS position ON position.id = member.position_id
      WHERE member.user_id = auth.uid()
        AND position.name = 'Администратор CRM'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_product_projects()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users AS active_actor
    WHERE active_actor.id = auth.uid()
      AND active_actor.is_active IS DISTINCT FROM false
  )
  AND (
    EXISTS (
      SELECT 1
      FROM public.users AS actor
      JOIN public.role_permissions AS permission ON permission.role = actor.role
      WHERE actor.id = auth.uid()
        AND permission.resource_key = 'product_projects'
        AND permission.can_manage
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members AS member
      JOIN public.department_access_permissions AS permission
        ON permission.department_id = member.department_id
       AND permission.subject_scope = CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END
      WHERE member.user_id = auth.uid()
        AND permission.resource_key = 'product_projects'
        AND permission.can_manage
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members AS member
      JOIN public.positions AS position ON position.id = member.position_id
      WHERE member.user_id = auth.uid()
        AND position.name = 'Администратор CRM'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_owns_mail_thread(p_thread_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.mail_threads AS thread
    JOIN public.mail_accounts AS account ON account.id = thread.account_id
    WHERE thread.id = p_thread_id
      AND account.user_id = auth.uid()
      AND account.disconnected_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_owns_mail_message(p_message_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.mail_messages AS message
    JOIN public.mail_accounts AS account ON account.id = message.account_id
    WHERE message.id = p_message_id
      AND account.user_id = auth.uid()
      AND account.disconnected_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_product_projects() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_product_projects() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_user_owns_mail_thread(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_user_owns_mail_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_product_projects() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_product_projects() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_owns_mail_thread(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_owns_mail_message(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS product_project_mail_links_reader ON public.product_project_mail_threads;
CREATE POLICY product_project_mail_links_reader
  ON public.product_project_mail_threads FOR SELECT TO authenticated
  USING (public.can_view_product_projects());

DROP POLICY IF EXISTS product_project_mail_links_manager_insert ON public.product_project_mail_threads;
CREATE POLICY product_project_mail_links_manager_insert
  ON public.product_project_mail_threads FOR INSERT TO authenticated
  WITH CHECK (
    linked_by = (SELECT auth.uid())
    AND public.can_manage_product_projects()
    AND public.current_user_owns_mail_thread(thread_id)
  );

DROP POLICY IF EXISTS product_project_mail_links_manager_update ON public.product_project_mail_threads;
CREATE POLICY product_project_mail_links_manager_update
  ON public.product_project_mail_threads FOR UPDATE TO authenticated
  USING (public.can_manage_product_projects())
  WITH CHECK (
    public.can_manage_product_projects()
    AND (unlinked_at IS NULL OR unlinked_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS product_project_mail_messages_reader ON public.product_project_mail_messages;
CREATE POLICY product_project_mail_messages_reader
  ON public.product_project_mail_messages FOR SELECT TO authenticated
  USING (public.can_view_product_projects());

DROP POLICY IF EXISTS product_project_mail_messages_manager_insert ON public.product_project_mail_messages;
CREATE POLICY product_project_mail_messages_manager_insert
  ON public.product_project_mail_messages FOR INSERT TO authenticated
  WITH CHECK (
    linked_by = (SELECT auth.uid())
    AND public.can_manage_product_projects()
    AND public.current_user_owns_mail_message(message_id)
  );

DROP POLICY IF EXISTS product_project_mail_messages_manager_update ON public.product_project_mail_messages;
CREATE POLICY product_project_mail_messages_manager_update
  ON public.product_project_mail_messages FOR UPDATE TO authenticated
  USING (public.can_manage_product_projects())
  WITH CHECK (
    public.can_manage_product_projects()
    AND (unlinked_at IS NULL OR unlinked_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS department_request_mail_threads_owner_insert ON public.department_request_mail_threads;
CREATE POLICY department_request_mail_threads_owner_insert
  ON public.department_request_mail_threads FOR INSERT TO authenticated
  WITH CHECK (
    linked_by = (SELECT auth.uid())
    AND public.current_user_owns_mail_thread(thread_id)
    AND EXISTS (
      SELECT 1 FROM public.department_requests AS request
      WHERE request.id = department_request_id
        AND request.created_by = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS department_request_mail_messages_owner_insert ON public.department_request_mail_messages;
CREATE POLICY department_request_mail_messages_owner_insert
  ON public.department_request_mail_messages FOR INSERT TO authenticated
  WITH CHECK (
    linked_by = (SELECT auth.uid())
    AND public.current_user_owns_mail_message(message_id)
    AND EXISTS (
      SELECT 1 FROM public.department_requests AS request
      WHERE request.id = department_request_id
        AND request.created_by = (SELECT auth.uid())
    )
  );

-- Keep request creation atomic while avoiding direct reads through the mail RLS
-- policies. A failed mail ownership check aborts the request in the same call.
CREATE OR REPLACE FUNCTION public.create_department_request_with_mail(
  p_request_id uuid,
  p_target_department text,
  p_title text,
  p_description text,
  p_machine_id uuid DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb,
  p_mail_link jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_link_kind text;
  v_link_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Необходима авторизация';
  END IF;

  IF p_mail_link IS NOT NULL THEN
    v_link_kind := p_mail_link ->> 'kind';
    BEGIN
      v_link_id := (p_mail_link ->> 'id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Некорректная ссылка на письмо';
    END;

    IF v_link_kind = 'thread' AND NOT public.current_user_owns_mail_thread(v_link_id) THEN
      RAISE EXCEPTION 'Переписка не найдена или недоступна';
    ELSIF v_link_kind = 'message' AND NOT public.current_user_owns_mail_message(v_link_id) THEN
      RAISE EXCEPTION 'Письмо не найдено или недоступно';
    ELSIF v_link_kind NOT IN ('thread', 'message') OR v_link_id IS NULL THEN
      RAISE EXCEPTION 'Некорректная ссылка на письмо';
    END IF;
  END IF;

  PERFORM public.create_department_request(
    p_request_id,
    p_target_department,
    p_title,
    p_description,
    p_machine_id,
    p_due_date,
    p_attachments
  );

  IF v_link_kind = 'thread' THEN
    INSERT INTO public.department_request_mail_threads(
      department_request_id, thread_id, linked_by
    ) VALUES (p_request_id, v_link_id, v_actor);
  ELSIF v_link_kind = 'message' THEN
    INSERT INTO public.department_request_mail_messages(
      department_request_id, message_id, linked_by
    ) VALUES (p_request_id, v_link_id, v_actor);
  END IF;

  RETURN p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_department_request_with_mail(
  uuid, text, text, text, uuid, date, jsonb, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_department_request_with_mail(
  uuid, text, text, text, uuid, date, jsonb, jsonb
) TO authenticated, service_role;

ALTER TABLE public.product_project_versions
  ADD COLUMN IF NOT EXISTS correction_note text;

UPDATE public.product_project_versions AS version
SET correction_note = version.client_wishes,
    client_wishes = project.client_wishes
FROM public.product_projects AS project
WHERE version.project_id = project.id
  AND version.version_number > 1
  AND version.correction_note IS NULL
  AND version.client_wishes IS DISTINCT FROM project.client_wishes;

CREATE UNIQUE INDEX IF NOT EXISTS product_project_versions_project_id_id_uidx
  ON public.product_project_versions(project_id, id);

ALTER TABLE public.product_project_mail_threads
  ADD COLUMN IF NOT EXISTS version_id uuid;
ALTER TABLE public.product_project_mail_messages
  ADD COLUMN IF NOT EXISTS version_id uuid;

ALTER TABLE public.product_project_mail_threads
  DROP CONSTRAINT IF EXISTS product_project_mail_threads_product_project_id_thread_id_key,
  DROP CONSTRAINT IF EXISTS product_project_mail_threads_project_version_fkey,
  ADD CONSTRAINT product_project_mail_threads_project_version_fkey
    FOREIGN KEY (product_project_id, version_id)
    REFERENCES public.product_project_versions(project_id, id)
    ON DELETE CASCADE;

ALTER TABLE public.product_project_mail_messages
  DROP CONSTRAINT IF EXISTS product_project_mail_messages_product_project_id_message_id_key,
  DROP CONSTRAINT IF EXISTS product_project_mail_messages_project_version_fkey,
  ADD CONSTRAINT product_project_mail_messages_project_version_fkey
    FOREIGN KEY (product_project_id, version_id)
    REFERENCES public.product_project_versions(project_id, id)
    ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS product_project_mail_threads_project_wide_uidx
  ON public.product_project_mail_threads(product_project_id, thread_id)
  WHERE version_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_project_mail_threads_version_uidx
  ON public.product_project_mail_threads(product_project_id, version_id, thread_id)
  WHERE version_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_project_mail_messages_project_wide_uidx
  ON public.product_project_mail_messages(product_project_id, message_id)
  WHERE version_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_project_mail_messages_version_uidx
  ON public.product_project_mail_messages(product_project_id, version_id, message_id)
  WHERE version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS product_project_mail_threads_version_active_idx
  ON public.product_project_mail_threads(version_id, linked_at DESC)
  WHERE version_id IS NOT NULL AND unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS product_project_mail_messages_version_active_idx
  ON public.product_project_mail_messages(version_id, linked_at DESC)
  WHERE version_id IS NOT NULL AND unlinked_at IS NULL;

CREATE OR REPLACE FUNCTION public.link_mail_to_product_project_v2(
  p_product_project_id uuid,
  p_version_id uuid,
  p_kind text,
  p_mail_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_link_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Необходима авторизация';
  END IF;
  IF NOT public.can_manage_product_projects() THEN
    RAISE EXCEPTION 'Недостаточно прав для изменения проекта';
  END IF;
  IF p_kind NOT IN ('thread', 'message') OR p_mail_id IS NULL THEN
    RAISE EXCEPTION 'Некорректная ссылка на письмо';
  END IF;

  PERFORM 1
  FROM public.product_projects AS project
  WHERE project.id = p_product_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Проект не найден';
  END IF;

  IF p_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_project_versions AS version
    WHERE version.id = p_version_id AND version.project_id = p_product_project_id
  ) THEN
    RAISE EXCEPTION 'Версия проекта не найдена';
  END IF;

  IF p_kind = 'thread' THEN
    IF NOT public.current_user_owns_mail_thread(p_mail_id) THEN
      RAISE EXCEPTION 'Переписка не найдена или недоступна';
    END IF;
    SELECT link.id INTO v_link_id
    FROM public.product_project_mail_threads AS link
    WHERE link.product_project_id = p_product_project_id
      AND link.thread_id = p_mail_id
      AND link.version_id IS NOT DISTINCT FROM p_version_id
    LIMIT 1;
    IF v_link_id IS NULL THEN
      INSERT INTO public.product_project_mail_threads(
        product_project_id, version_id, thread_id, linked_by
      ) VALUES (
        p_product_project_id, p_version_id, p_mail_id, v_actor
      ) RETURNING id INTO v_link_id;
    ELSE
      UPDATE public.product_project_mail_threads
      SET linked_by = v_actor,
          linked_at = now(),
          unlinked_at = NULL,
          unlinked_by = NULL
      WHERE id = v_link_id;
    END IF;
  ELSE
    IF NOT public.current_user_owns_mail_message(p_mail_id) THEN
      RAISE EXCEPTION 'Письмо не найдено или недоступно';
    END IF;
    SELECT link.id INTO v_link_id
    FROM public.product_project_mail_messages AS link
    WHERE link.product_project_id = p_product_project_id
      AND link.message_id = p_mail_id
      AND link.version_id IS NOT DISTINCT FROM p_version_id
    LIMIT 1;
    IF v_link_id IS NULL THEN
      INSERT INTO public.product_project_mail_messages(
        product_project_id, version_id, message_id, linked_by
      ) VALUES (
        p_product_project_id, p_version_id, p_mail_id, v_actor
      ) RETURNING id INTO v_link_id;
    ELSE
      UPDATE public.product_project_mail_messages
      SET linked_by = v_actor,
          linked_at = now(),
          unlinked_at = NULL,
          unlinked_by = NULL
      WHERE id = v_link_id;
    END IF;
  END IF;

  RETURN v_link_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_mail_to_product_project_v2(uuid, uuid, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_mail_to_product_project_v2(uuid, uuid, text, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_product_project_with_mail_v2(
  p_project_id uuid,
  p_version_id uuid,
  p_title text,
  p_client_id uuid,
  p_description text,
  p_characteristics text,
  p_client_wishes text,
  p_assigned_engineer_id uuid,
  p_requires_vrb_mesh boolean DEFAULT false,
  p_initial_file jsonb DEFAULT NULL,
  p_mail_link jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_mail_kind text;
  v_mail_id uuid;
  v_initial_file_size bigint;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Необходима авторизация';
  END IF;
  IF NOT public.can_manage_product_projects() THEN
    RAISE EXCEPTION 'Недостаточно прав для создания проекта';
  END IF;
  IF p_project_id IS NULL OR p_version_id IS NULL OR NULLIF(btrim(p_title), '') IS NULL THEN
    RAISE EXCEPTION 'Заполните название проекта';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.users AS engineer
    JOIN public.department_members AS member ON member.user_id = engineer.id
    JOIN public.departments AS department ON department.id = member.department_id
    WHERE engineer.id = p_assigned_engineer_id
      AND engineer.is_active IS DISTINCT FROM false
      AND (
        lower(replace(department.name, 'ё', 'е')) LIKE '%техническ%'
        OR lower(department.name) LIKE '%technical%'
      )
  ) THEN
    RAISE EXCEPTION 'Выберите инженера';
  END IF;

  IF p_mail_link IS NOT NULL THEN
    v_mail_kind := p_mail_link ->> 'kind';
    BEGIN
      v_mail_id := (p_mail_link ->> 'id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Некорректная ссылка на письмо';
    END;
    IF v_mail_kind = 'thread' AND NOT public.current_user_owns_mail_thread(v_mail_id) THEN
      RAISE EXCEPTION 'Переписка не найдена или недоступна';
    ELSIF v_mail_kind = 'message' AND NOT public.current_user_owns_mail_message(v_mail_id) THEN
      RAISE EXCEPTION 'Письмо не найдено или недоступно';
    ELSIF v_mail_kind NOT IN ('thread', 'message') THEN
      RAISE EXCEPTION 'Некорректная ссылка на письмо';
    END IF;
  END IF;

  INSERT INTO public.product_projects(
    id, title, client_id, description, characteristics, client_wishes,
    assigned_engineer_id, requires_vrb_mesh, status, created_by, updated_by
  ) VALUES (
    p_project_id, btrim(p_title), p_client_id, COALESCE(p_description, ''),
    COALESCE(p_characteristics, ''), COALESCE(p_client_wishes, ''),
    p_assigned_engineer_id, COALESCE(p_requires_vrb_mesh, false), 'new_project', v_actor, v_actor
  );

  INSERT INTO public.product_project_versions(
    id, project_id, version_number, version_label, description,
    characteristics, client_wishes, status, created_by
  ) VALUES (
    p_version_id, p_project_id, 1, '1', COALESCE(p_description, ''),
    COALESCE(p_characteristics, ''), COALESCE(p_client_wishes, ''), 'draft', v_actor
  );

  IF p_initial_file IS NOT NULL THEN
    IF (p_initial_file ->> 'fileKind') IS DISTINCT FROM 'photo'
       OR NULLIF(btrim(p_initial_file ->> 'fileName'), '') IS NULL
       OR length(p_initial_file ->> 'fileName') > 240
       OR NULLIF(p_initial_file ->> 'fileSize', '') IS NULL
       OR NULLIF(p_initial_file ->> 'objectPath', '') IS NULL
       OR (p_initial_file ->> 'objectPath') NOT LIKE ('product-projects/' || p_project_id || '/%')
       OR position('..' IN (p_initial_file ->> 'objectPath')) > 0 THEN
      RAISE EXCEPTION 'Некорректный файл проекта';
    END IF;
    BEGIN
      v_initial_file_size := (p_initial_file ->> 'fileSize')::bigint;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Некорректный файл проекта';
    END;
    IF v_initial_file_size <= 0 OR v_initial_file_size > 52428800 THEN
      RAISE EXCEPTION 'Некорректный файл проекта';
    END IF;
    INSERT INTO public.product_project_files(
      project_id, version_id, file_kind, file_name, file_path,
      mime_type, file_size, uploaded_by
    ) VALUES (
      p_project_id, p_version_id, 'photo', btrim(p_initial_file ->> 'fileName'),
      p_initial_file ->> 'objectPath', NULLIF(p_initial_file ->> 'mimeType', ''),
      v_initial_file_size, v_actor
    );
  END IF;

  INSERT INTO public.tasks(
    machine_id, product_project_id, assigned_to, task_type, title,
    description, status, start_date, deadline
  ) VALUES (
    NULL, p_project_id, p_assigned_engineer_id, 'product_project_engineering',
    'Создать чертеж и фото: ' || btrim(p_title),
    'Загрузите чертеж, фото изделия и укажите вес изделия.',
    'pending', current_date, current_date + 2
  );

  IF p_mail_link IS NOT NULL THEN
    PERFORM public.link_mail_to_product_project_v2(
      p_project_id, p_version_id, v_mail_kind, v_mail_id
    );
  END IF;

  RETURN p_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_product_project_with_mail_v2(
  uuid, uuid, text, uuid, text, text, text, uuid, boolean, jsonb, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_project_with_mail_v2(
  uuid, uuid, text, uuid, text, text, text, uuid, boolean, jsonb, jsonb
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_product_project_correction_v2(
  p_project_id uuid,
  p_version_id uuid,
  p_correction_note text,
  p_files jsonb DEFAULT '[]'::jsonb,
  p_mail_links jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_project public.product_projects%ROWTYPE;
  v_latest public.product_project_versions%ROWTYPE;
  v_file jsonb;
  v_link jsonb;
  v_link_id uuid;
  v_file_size bigint;
  v_task_count integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Необходима авторизация';
  END IF;
  IF NOT public.can_manage_product_projects() THEN
    RAISE EXCEPTION 'Недостаточно прав для изменения проекта';
  END IF;
  IF NULLIF(btrim(p_correction_note), '') IS NULL THEN
    RAISE EXCEPTION 'Опишите замечания клиента';
  END IF;
  IF p_version_id IS NULL THEN
    RAISE EXCEPTION 'Версия проекта не найдена';
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_project_versions WHERE id = p_version_id) THEN
    RAISE EXCEPTION 'Идентификатор версии уже используется';
  END IF;
  IF jsonb_typeof(COALESCE(p_files, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_files, '[]'::jsonb)) > 10 THEN
    RAISE EXCEPTION 'Можно прикрепить не больше 10 файлов';
  END IF;
  IF jsonb_typeof(COALESCE(p_mail_links, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_mail_links, '[]'::jsonb)) > 10 THEN
    RAISE EXCEPTION 'Можно прикрепить не больше 10 переписок';
  END IF;

  SELECT * INTO v_project
  FROM public.product_projects AS project
  WHERE project.id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Проект не найден';
  END IF;
  IF v_project.status IN ('added_to_products', 'cancelled') THEN
    RAISE EXCEPTION 'Для закрытого проекта нельзя создать корректировку';
  END IF;

  SELECT * INTO v_latest
  FROM public.product_project_versions AS version
  WHERE version.project_id = p_project_id
  ORDER BY version.version_number DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Версия проекта не найдена';
  END IF;

  FOR v_file IN SELECT value FROM jsonb_array_elements(COALESCE(p_files, '[]'::jsonb))
  LOOP
    IF (v_file ->> 'fileKind') IS NULL
       OR (v_file ->> 'fileKind') NOT IN ('drawing', 'step', 'pdf', 'photo', 'other')
       OR NULLIF(btrim(v_file ->> 'fileName'), '') IS NULL
       OR length(v_file ->> 'fileName') > 240
       OR NULLIF(v_file ->> 'fileSize', '') IS NULL
       OR NULLIF(v_file ->> 'objectPath', '') IS NULL
       OR (v_file ->> 'objectPath') NOT LIKE (
         'product-projects/' || p_project_id || '/' || p_version_id || '/uploads/' || v_actor || '/%'
       )
       OR position('..' IN (v_file ->> 'objectPath')) > 0 THEN
      RAISE EXCEPTION 'Некорректный файл корректировки';
    END IF;
    BEGIN
      v_file_size := (v_file ->> 'fileSize')::bigint;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Некорректный файл корректировки';
    END;
    IF v_file_size <= 0 OR v_file_size > 52428800 THEN
      RAISE EXCEPTION 'Некорректный файл корректировки';
    END IF;
  END LOOP;

  FOR v_link IN SELECT value FROM jsonb_array_elements(COALESCE(p_mail_links, '[]'::jsonb))
  LOOP
    BEGIN
      v_link_id := (v_link ->> 'id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Некорректная ссылка на письмо';
    END;
    IF v_link ->> 'kind' = 'thread' AND NOT public.current_user_owns_mail_thread(v_link_id) THEN
      RAISE EXCEPTION 'Переписка не найдена или недоступна';
    ELSIF v_link ->> 'kind' = 'message' AND NOT public.current_user_owns_mail_message(v_link_id) THEN
      RAISE EXCEPTION 'Письмо не найдено или недоступно';
    ELSIF (v_link ->> 'kind') IS NULL OR v_link ->> 'kind' NOT IN ('thread', 'message') THEN
      RAISE EXCEPTION 'Некорректная ссылка на письмо';
    END IF;
  END LOOP;

  UPDATE public.product_project_versions
  SET status = 'superseded'
  WHERE id = v_latest.id AND status <> 'superseded';

  INSERT INTO public.product_project_versions(
    id, project_id, version_number, version_label, description,
    characteristics, client_wishes, correction_note, name_uk, name_en,
    uktzed, drawing_number, unit_weight_kg, base_price_eur, status, created_by
  ) VALUES (
    p_version_id, p_project_id, v_latest.version_number + 1,
    (v_latest.version_number + 1)::text, v_latest.description,
    v_latest.characteristics, v_project.client_wishes, btrim(p_correction_note),
    v_latest.name_uk, v_latest.name_en, v_latest.uktzed,
    NULL, NULL, v_latest.base_price_eur,
    'draft', v_actor
  );

  FOR v_file IN SELECT value FROM jsonb_array_elements(COALESCE(p_files, '[]'::jsonb))
  LOOP
    INSERT INTO public.product_project_files(
      project_id, version_id, file_kind, file_name, file_path,
      mime_type, file_size, uploaded_by
    ) VALUES (
      p_project_id, p_version_id, v_file ->> 'fileKind',
      btrim(v_file ->> 'fileName'), v_file ->> 'objectPath',
      NULLIF(v_file ->> 'mimeType', ''), (v_file ->> 'fileSize')::bigint, v_actor
    );
  END LOOP;

  FOR v_link IN SELECT value FROM jsonb_array_elements(COALESCE(p_mail_links, '[]'::jsonb))
  LOOP
    PERFORM public.link_mail_to_product_project_v2(
      p_project_id,
      p_version_id,
      v_link ->> 'kind',
      (v_link ->> 'id')::uuid
    );
  END LOOP;

  UPDATE public.tasks
  SET status = 'cancelled', updated_at = now()
  WHERE product_project_id = p_project_id
    AND task_type = 'product_project_sales_review'
    AND status IN ('pending', 'in_progress');

  UPDATE public.product_projects
  SET status = 'engineering',
      approved_version_id = NULL,
      updated_by = v_actor,
      updated_at = now()
  WHERE id = p_project_id;

  UPDATE public.tasks
  SET assigned_to = v_project.assigned_engineer_id,
      title = 'Корректировка изделия: ' || v_project.title,
      description = btrim(p_correction_note),
      status = 'pending',
      start_date = current_date,
      deadline = current_date + 2,
      completed_at = NULL,
      updated_at = now()
  WHERE product_project_id = p_project_id
    AND task_type = 'product_project_engineering'
    AND status IN ('pending', 'in_progress');
  GET DIAGNOSTICS v_task_count = ROW_COUNT;

  IF v_task_count = 0 THEN
    INSERT INTO public.tasks(
      machine_id, product_project_id, assigned_to, task_type, title,
      description, status, start_date, deadline
    ) VALUES (
      NULL, p_project_id, v_project.assigned_engineer_id,
      'product_project_engineering',
      'Корректировка изделия: ' || v_project.title,
      btrim(p_correction_note), 'pending', current_date, current_date + 2
    );
  END IF;

  RETURN p_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_product_project_correction_v2(
  uuid, uuid, text, jsonb, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_product_project_correction_v2(
  uuid, uuid, text, jsonb, jsonb
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_product_project_version_v2(
  p_project_id uuid,
  p_version_id uuid,
  p_name_uk text,
  p_name_en text,
  p_uktzed text,
  p_base_price_eur numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_project public.product_projects%ROWTYPE;
  v_latest public.product_project_versions%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Необходима авторизация';
  END IF;
  IF NOT public.can_manage_product_projects() THEN
    RAISE EXCEPTION 'Недостаточно прав для изменения проекта';
  END IF;
  IF NULLIF(btrim(p_name_uk), '') IS NULL
     OR NULLIF(btrim(p_name_en), '') IS NULL
     OR NULLIF(btrim(p_uktzed), '') IS NULL
     OR p_base_price_eur IS NULL
     OR p_base_price_eur < 0 THEN
    RAISE EXCEPTION 'Заполните все данные для заказа';
  END IF;

  SELECT * INTO v_project
  FROM public.product_projects AS project
  WHERE project.id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Проект не найден';
  END IF;
  IF v_project.status IN ('added_to_products', 'cancelled') THEN
    RAISE EXCEPTION 'Закрытый проект нельзя подтвердить';
  END IF;

  SELECT * INTO v_latest
  FROM public.product_project_versions AS version
  WHERE version.project_id = p_project_id
  ORDER BY version.version_number DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND OR v_latest.id IS DISTINCT FROM p_version_id THEN
    RAISE EXCEPTION 'Версия проекта изменилась. Обновите страницу и проверьте актуальную версию';
  END IF;
  IF NULLIF(btrim(v_latest.drawing_number), '') IS NULL THEN
    RAISE EXCEPTION 'Инженер еще не загрузил чертеж';
  END IF;
  IF COALESCE(v_latest.unit_weight_kg, 0) <= 0 THEN
    RAISE EXCEPTION 'Инженер еще не указал вес изделия';
  END IF;

  UPDATE public.product_project_versions
  SET name_uk = btrim(p_name_uk),
      name_en = btrim(p_name_en),
      uktzed = btrim(p_uktzed),
      base_price_eur = p_base_price_eur,
      status = 'approved'
  WHERE id = v_latest.id;

  UPDATE public.product_projects
  SET status = 'approved',
      approved_version_id = v_latest.id,
      updated_by = v_actor,
      updated_at = now()
  WHERE id = p_project_id;

  UPDATE public.tasks
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE product_project_id = p_project_id
    AND task_type = 'product_project_sales_review'
    AND status IN ('pending', 'in_progress');

  RETURN v_latest.id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_product_project_version_v2(
  uuid, uuid, text, text, text, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_product_project_version_v2(
  uuid, uuid, text, text, text, numeric
) TO authenticated, service_role;

COMMENT ON COLUMN public.product_project_versions.correction_note IS
  'Manager instructions that caused this version; client_wishes remains the original requirement snapshot';
COMMENT ON COLUMN public.product_project_mail_threads.version_id IS
  'Null for project-wide mail, otherwise the exact product-project version';
COMMENT ON COLUMN public.product_project_mail_messages.version_id IS
  'Null for project-wide mail, otherwise the exact product-project version';
