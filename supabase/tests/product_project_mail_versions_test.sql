SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);

-- Direct authenticated writes exercise the repaired RLS policies.
INSERT INTO public.product_project_mail_threads(
  product_project_id, version_id, thread_id, linked_by
) VALUES (
  '20000000-0000-0000-0000-000000000001', NULL,
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001'
);
INSERT INTO public.product_project_mail_messages(
  product_project_id, version_id, message_id, linked_by
) VALUES (
  '20000000-0000-0000-0000-000000000001', NULL,
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001'
);

DO $assertions$
DECLARE
  v_first uuid;
  v_second uuid;
BEGIN
  BEGIN
    INSERT INTO public.product_project_mail_threads(
      product_project_id, version_id, thread_id, linked_by
    ) VALUES (
      '20000000-0000-0000-0000-000000000002', NULL,
      '40000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000001'
    );
    RAISE EXCEPTION 'foreign thread link unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.product_project_mail_messages(
      product_project_id, version_id, message_id, linked_by
    ) VALUES (
      '20000000-0000-0000-0000-000000000002', NULL,
      '50000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000001'
    );
    RAISE EXCEPTION 'foreign message link unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.link_mail_to_product_project_v2(
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      'thread',
      '40000000-0000-0000-0000-000000000001'
    );
    RAISE EXCEPTION 'cross-project version link unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-project version link unexpectedly succeeded' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Версия проекта не найдена%' THEN RAISE; END IF;
  END;

  v_first := public.link_mail_to_product_project_v2(
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'thread',
    '40000000-0000-0000-0000-000000000001'
  );
  v_second := public.link_mail_to_product_project_v2(
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'thread',
    '40000000-0000-0000-0000-000000000001'
  );
  IF v_first IS DISTINCT FROM v_second THEN
    RAISE EXCEPTION 'version mail link is not idempotent';
  END IF;
  PERFORM public.link_mail_to_product_project_v2(
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000003',
    'thread',
    '40000000-0000-0000-0000-000000000001'
  );
END;
$assertions$;

SELECT public.create_product_project_with_mail_v2(
  '20000000-0000-0000-0000-000000000010',
  '30000000-0000-0000-0000-000000000010',
  'Проект из цепочки', NULL, 'Описание', 'Характеристики', 'Пожелания',
  '10000000-0000-0000-0000-000000000003', NULL,
  '{"kind":"thread","id":"40000000-0000-0000-0000-000000000001"}'::jsonb
);
SELECT public.create_product_project_with_mail_v2(
  '20000000-0000-0000-0000-000000000011',
  '30000000-0000-0000-0000-000000000011',
  'Проект из письма', NULL, '', '', '',
  '10000000-0000-0000-0000-000000000003', NULL,
  '{"kind":"message","id":"50000000-0000-0000-0000-000000000001"}'::jsonb
);

SELECT public.create_department_request_with_mail(
  '60000000-0000-0000-0000-000000000001', 'engineering',
  'Запрос из цепочки', 'Описание', NULL, NULL, '[]'::jsonb,
  '{"kind":"thread","id":"40000000-0000-0000-0000-000000000001"}'::jsonb
);
SELECT public.create_department_request_with_mail(
  '60000000-0000-0000-0000-000000000002', 'engineering',
  'Запрос из письма', 'Описание', NULL, NULL, '[]'::jsonb,
  '{"kind":"message","id":"50000000-0000-0000-0000-000000000001"}'::jsonb
);

DO $atomic_failures$
BEGIN
  BEGIN
    PERFORM public.create_product_project_with_mail_v2(
      '20000000-0000-0000-0000-000000000012',
      '30000000-0000-0000-0000-000000000012',
      'Не должен остаться', NULL, '', '', '',
      '10000000-0000-0000-0000-000000000003', NULL,
      '{"kind":"thread","id":"40000000-0000-0000-0000-000000000002"}'::jsonb
    );
    RAISE EXCEPTION 'project with foreign mail unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'project with foreign mail unexpectedly succeeded' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.create_department_request_with_mail(
      '60000000-0000-0000-0000-000000000003', 'engineering',
      'Не должен остаться', '', NULL, NULL, '[]'::jsonb,
      '{"kind":"message","id":"50000000-0000-0000-0000-000000000002"}'::jsonb
    );
    RAISE EXCEPTION 'request with foreign mail unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'request with foreign mail unexpectedly succeeded' THEN RAISE; END IF;
  END;
END;
$atomic_failures$;

SELECT public.request_product_project_correction_v2(
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000020',
  'Добавить ребро и уточнить цвет',
  '[{"objectPath":"product-projects/20000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000020/uploads/10000000-0000-0000-0000-000000000001/change.dxf","fileKind":"drawing","fileName":"change.dxf","mimeType":"application/dxf","fileSize":1024}]'::jsonb,
  '[{"kind":"thread","id":"40000000-0000-0000-0000-000000000001"},{"kind":"message","id":"50000000-0000-0000-0000-000000000001"}]'::jsonb
);

RESET ROLE;

DO $assertions$
BEGIN
  IF (SELECT correction_note FROM public.product_project_versions WHERE id = '30000000-0000-0000-0000-000000000003') IS DISTINCT FROM 'Старое замечание' THEN
    RAISE EXCEPTION 'historical correction note was not backfilled';
  END IF;
  IF (SELECT client_wishes FROM public.product_project_versions WHERE id = '30000000-0000-0000-0000-000000000003') IS DISTINCT FROM 'Исходные пожелания' THEN
    RAISE EXCEPTION 'historical client wishes were not restored';
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_projects WHERE id = '20000000-0000-0000-0000-000000000012') THEN
    RAISE EXCEPTION 'failed mail link left a project behind';
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_project_versions WHERE id = '30000000-0000-0000-0000-000000000012') THEN
    RAISE EXCEPTION 'failed mail link left a project version behind';
  END IF;
  IF EXISTS (SELECT 1 FROM public.department_requests WHERE id = '60000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION 'failed mail link left a department request behind';
  END IF;
  IF (SELECT count(*) FROM public.product_project_mail_threads WHERE product_project_id = '20000000-0000-0000-0000-000000000001' AND thread_id = '40000000-0000-0000-0000-000000000001') <> 4 THEN
    RAISE EXCEPTION 'same thread was not retained at project and each version scope';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_project_mail_threads
    WHERE product_project_id = '20000000-0000-0000-0000-000000000010'
      AND version_id = '30000000-0000-0000-0000-000000000010'
  ) THEN RAISE EXCEPTION 'new project thread was not linked to version 1'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_project_mail_messages
    WHERE product_project_id = '20000000-0000-0000-0000-000000000011'
      AND version_id = '30000000-0000-0000-0000-000000000011'
  ) THEN RAISE EXCEPTION 'new project message was not linked to version 1'; END IF;
  IF (SELECT count(*) FROM public.department_requests WHERE id IN ('60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002')) <> 2 THEN
    RAISE EXCEPTION 'thread/message request creation failed';
  END IF;
  IF (SELECT status FROM public.product_project_versions WHERE id = '30000000-0000-0000-0000-000000000003') <> 'superseded' THEN
    RAISE EXCEPTION 'previous version was not superseded';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_project_versions
    WHERE id = '30000000-0000-0000-0000-000000000020'
      AND version_number = 3
      AND correction_note = 'Добавить ребро и уточнить цвет'
      AND client_wishes = 'Исходные пожелания'
      AND drawing_number IS NULL
      AND unit_weight_kg IS NULL
  ) THEN RAISE EXCEPTION 'correction version data is incomplete'; END IF;
  IF (SELECT approved_version_id FROM public.product_projects WHERE id = '20000000-0000-0000-0000-000000000001') IS NOT NULL THEN
    RAISE EXCEPTION 'correction did not reset approval';
  END IF;
  IF (SELECT status FROM public.product_projects WHERE id = '20000000-0000-0000-0000-000000000001') <> 'engineering' THEN
    RAISE EXCEPTION 'correction did not return project to engineering';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_project_files
    WHERE version_id = '30000000-0000-0000-0000-000000000020'
      AND file_name = 'change.dxf'
  ) THEN RAISE EXCEPTION 'correction file was not registered'; END IF;
  IF (SELECT count(*) FROM public.product_project_mail_threads WHERE version_id = '30000000-0000-0000-0000-000000000020') <> 1
     OR (SELECT count(*) FROM public.product_project_mail_messages WHERE version_id = '30000000-0000-0000-0000-000000000020') <> 1 THEN
    RAISE EXCEPTION 'correction mail links were not registered';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE product_project_id = '20000000-0000-0000-0000-000000000001'
      AND task_type = 'product_project_engineering'
      AND status = 'pending'
      AND description = 'Добавить ребро и уточнить цвет'
  ) THEN RAISE EXCEPTION 'engineering correction task is missing'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE product_project_id = '20000000-0000-0000-0000-000000000001'
      AND task_type = 'product_project_sales_review'
      AND status IN ('pending', 'in_progress')
  ) THEN RAISE EXCEPTION 'sales review task remained active'; END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'current_user_owns_mail_thread', 'current_user_owns_mail_message',
        'create_department_request_with_mail', 'create_product_project_with_mail_v2',
        'request_product_project_correction_v2', 'approve_product_project_version_v2'
      )
      AND (
        procedure.prosecdef IS DISTINCT FROM true
        OR NOT (COALESCE(procedure.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""']::text[])
      )
  ) THEN RAISE EXCEPTION 'a protected mail function is not locked down'; END IF;
  IF has_function_privilege('anon', 'public.current_user_owns_mail_thread(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_product_project_with_mail_v2(uuid,uuid,text,uuid,text,text,text,uuid,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon retained execute access to protected mail functions';
  END IF;
END;
$assertions$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
DO $stale_approval$
BEGIN
  BEGIN
    PERFORM public.approve_product_project_version_v2(
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000003',
      'Название UA', 'Name EN', '1234', 120
    );
    RAISE EXCEPTION 'stale project version approval unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'stale project version approval unexpectedly succeeded' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Версия проекта изменилась%' THEN RAISE; END IF;
  END;
END;
$stale_approval$;
DO $premature_approval$
BEGIN
  BEGIN
    PERFORM public.approve_product_project_version_v2(
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000020',
      'Название UA 3', 'Name EN 3', '1234', 120
    );
    RAISE EXCEPTION 'version without fresh engineering data unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'version without fresh engineering data unexpectedly succeeded' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Инженер еще не загрузил чертеж%' THEN RAISE; END IF;
  END;
END;
$premature_approval$;
RESET ROLE;
UPDATE public.product_project_versions
SET drawing_number = 'DRAW-3', unit_weight_kg = 13
WHERE id = '30000000-0000-0000-0000-000000000020';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
SELECT public.approve_product_project_version_v2(
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000020',
  'Название UA 3', 'Name EN 3', '1234', 120
);
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.product_projects
    WHERE id = '20000000-0000-0000-0000-000000000001'
      AND status = 'approved'
      AND approved_version_id = '30000000-0000-0000-0000-000000000020'
  ) THEN RAISE EXCEPTION 'exact current version was not approved'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_project_versions
    WHERE id = '30000000-0000-0000-0000-000000000020'
      AND status = 'approved'
      AND name_uk = 'Название UA 3'
  ) THEN RAISE EXCEPTION 'approved version data was not saved'; END IF;
END;
$$;

-- Closed projects must reject corrections without creating a version.
UPDATE public.product_projects
SET status = 'added_to_products'
WHERE id = '20000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
DO $closed_project$
BEGIN
  BEGIN
    PERFORM public.request_product_project_correction_v2(
      '20000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000021',
      'Нельзя создавать', '[]'::jsonb, '[]'::jsonb
    );
    RAISE EXCEPTION 'closed project correction unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'closed project correction unexpectedly succeeded' THEN RAISE; END IF;
  END;
END;
$closed_project$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.product_project_versions WHERE id = '30000000-0000-0000-0000-000000000021') THEN
    RAISE EXCEPTION 'closed project correction left a version behind';
  END IF;
END;
$$;
