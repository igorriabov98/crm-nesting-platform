BEGIN;

DO $$
DECLARE
  v_first_question uuid;
  v_user uuid := '98000000-0000-4000-8000-000000000001';
  v_task uuid := '98000000-0000-4000-8000-000000000002';
  v_template uuid := '98000000-0000-4000-8000-000000000003';
  v_schedule uuid := '98000000-0000-4000-8000-000000000004';
  v_first_meeting uuid := '98000000-0000-4000-8000-000000000005';
  v_second_meeting uuid := '98000000-0000-4000-8000-000000000006';
  v_third_meeting uuid := '98000000-0000-4000-8000-000000000007';
  v_new_schedule uuid;
  v_original_second timestamptz;
  v_reminder_claim uuid;
  v_duplicate_claim uuid;
BEGIN
  IF (SELECT count(*) FROM public.meeting_rules WHERE is_system) <> 10 THEN
    RAISE EXCEPTION 'Expected ten visible system meeting rules';
  END IF;
  IF (SELECT count(*) FROM public.meeting_rules WHERE is_system AND status = 'published') <> 10 THEN
    RAISE EXCEPTION 'System rules must be published for shadow evaluation';
  END IF;
  IF (SELECT value FROM public.app_settings WHERE key = 'meeting_system_v2_mode') <> 'shadow' THEN
    RAISE EXCEPTION 'Meeting rollout must start in shadow mode';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.meeting_rule_events
    WHERE operation = 'reconcile' AND processed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Initial shadow reconciliation was not queued';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meeting_rule_runs'
      AND column_name = 'execution_mode'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meeting_rule_runs'
      AND column_name = 'group_count'
  ) THEN
    RAISE EXCEPTION 'Shadow run metrics are incomplete';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.meeting_questions'::regclass) THEN
    RAISE EXCEPTION 'meeting_questions RLS must be enabled';
  END IF;
  IF has_table_privilege('authenticated', 'public.meeting_rule_events', 'SELECT') THEN
    RAISE EXCEPTION 'Runtime rule queue must not be readable by authenticated clients';
  END IF;
  IF position('SKIP LOCKED' IN upper(pg_get_functiondef('public.claim_meeting_rule_events_v2(integer)'::regprocedure))) = 0 THEN
    RAISE EXCEPTION 'Rule event claim must use SKIP LOCKED';
  END IF;

  BEGIN
    UPDATE public.meeting_rule_versions
    SET dsl = dsl
    WHERE id = '40000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Rule versions must be immutable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Rule versions must be immutable' THEN RAISE; END IF;
  END;

  INSERT INTO public.meeting_questions(
    question_template_id, rule_id, rule_version_id, episode_key, source_type,
    title, category, priority, status
  ) VALUES (
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'sql-test-active-episode', 'tasks', 'SQL test', 'tasks', 'high', 'new'
  ) RETURNING id INTO v_first_question;

  BEGIN
    INSERT INTO public.meeting_questions(
      question_template_id, rule_id, rule_version_id, episode_key, source_type,
      title, category, priority, status
    ) VALUES (
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      'sql-test-active-episode', 'tasks', 'SQL duplicate', 'tasks', 'high', 'assigned'
    );
    RAISE EXCEPTION 'Duplicate active episode was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  UPDATE public.meeting_questions
  SET status = 'auto_closed', condition_active = false, closed_at = now()
  WHERE id = v_first_question;
  INSERT INTO public.meeting_questions(
    question_template_id, rule_id, rule_version_id, episode_key, source_type,
    title, category, priority, status
  ) VALUES (
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'sql-test-active-episode', 'tasks', 'SQL next episode', 'tasks', 'high', 'new'
  );

  INSERT INTO public.users(id, email, full_name, role, is_active)
  VALUES (v_user, 'meeting-v2-sql@example.test', 'Meeting v2 SQL', 'planning_director', true);
  UPDATE public.role_permissions
  SET can_view = true, can_manage = true
  WHERE role = 'planning_director' AND resource_key = 'meeting_rules';
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO public.meeting_templates(id, name, accepted_categories, created_by)
  VALUES (v_template, 'SQL серия совещаний', ARRAY['tasks'], v_user);
  INSERT INTO public.meeting_schedule_versions(
    id, template_id, version_no, recurrence_kind, start_date, start_time,
    duration_minutes, weekdays, occurrence_count, effective_from, created_by
  ) VALUES (
    v_schedule, v_template, 1, 'weekly', CURRENT_DATE + 1, '10:00', 60,
    ARRAY[extract(isodow FROM CURRENT_DATE + 1)::smallint], 4,
    CURRENT_DATE + 1, v_user
  );
  INSERT INTO public.meetings(
    id, title, meeting_date, meeting_time, status, template_id,
    schedule_version_id, starts_at, ends_at, created_by, occurrence_key
  ) VALUES
    (v_first_meeting, 'SQL встреча 1', CURRENT_DATE + 1, '10:00', 'planned', v_template,
     v_schedule, (CURRENT_DATE + 1 + time '10:00') AT TIME ZONE public.meeting_postgres_timezone_v2('Europe/Uzhgorod'),
     ((CURRENT_DATE + 1 + time '10:00') AT TIME ZONE public.meeting_postgres_timezone_v2('Europe/Uzhgorod')) + interval '1 hour',
     v_user, v_schedule::text || ':1'),
    (v_second_meeting, 'SQL встреча 2', CURRENT_DATE + 8, '10:00', 'planned', v_template,
     v_schedule, (CURRENT_DATE + 8 + time '10:00') AT TIME ZONE public.meeting_postgres_timezone_v2('Europe/Uzhgorod'),
     ((CURRENT_DATE + 8 + time '10:00') AT TIME ZONE public.meeting_postgres_timezone_v2('Europe/Uzhgorod')) + interval '1 hour',
     v_user, v_schedule::text || ':2'),
    (v_third_meeting, 'SQL встреча 3', CURRENT_DATE + 15, '10:00', 'planned', v_template,
     v_schedule, (CURRENT_DATE + 15 + time '10:00') AT TIME ZONE public.meeting_postgres_timezone_v2('Europe/Uzhgorod'),
     ((CURRENT_DATE + 15 + time '10:00') AT TIME ZONE public.meeting_postgres_timezone_v2('Europe/Uzhgorod')) + interval '1 hour',
     v_user, v_schedule::text || ':3');

  PERFORM public.reschedule_meeting_v2(
    v_first_meeting,
    'single',
    ((CURRENT_DATE + 1 + time '11:00') AT TIME ZONE public.meeting_postgres_timezone_v2('Europe/Uzhgorod')),
    ((CURRENT_DATE + 1 + time '12:00') AT TIME ZONE public.meeting_postgres_timezone_v2('Europe/Uzhgorod')),
    'SQL встреча 1 перенесена',
    'Проверка единичного исключения'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.meeting_schedule_exceptions
    WHERE meeting_id = v_first_meeting AND exception_type = 'rescheduled'
  ) THEN
    RAISE EXCEPTION 'Single reschedule did not create a schedule exception';
  END IF;
  IF (SELECT id FROM public.meetings WHERE id = v_first_meeting) IS DISTINCT FROM v_first_meeting THEN
    RAISE EXCEPTION 'Single reschedule changed the meeting id';
  END IF;

  SELECT starts_at INTO v_original_second FROM public.meetings WHERE id = v_second_meeting;
  SELECT public.reschedule_meeting_v2(
    v_second_meeting,
    'following',
    v_original_second + interval '1 day',
    v_original_second + interval '1 day 90 minutes',
    NULL,
    'Проверка новой версии серии'
  ) INTO v_new_schedule;
  IF v_new_schedule = v_schedule OR v_new_schedule IS NULL THEN
    RAISE EXCEPTION 'Following reschedule did not create a new schedule version';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.meetings
    WHERE id IN (v_second_meeting, v_third_meeting)
      AND schedule_version_id IS DISTINCT FROM v_new_schedule
  ) THEN
    RAISE EXCEPTION 'Following reschedule did not preserve ids on the new version';
  END IF;
  IF (SELECT starts_at FROM public.meetings WHERE id = v_second_meeting)
      IS DISTINCT FROM v_original_second + interval '1 day' THEN
    RAISE EXCEPTION 'Following reschedule did not shift the selected occurrence';
  END IF;

  PERFORM public.set_meeting_system_v2_mode('active');
  IF (SELECT value FROM public.app_settings WHERE key = 'meeting_system_v2_mode') <> 'active' THEN
    RAISE EXCEPTION 'Meeting system activation did not update the feature flag';
  END IF;
  IF (SELECT count(*) FROM public.meeting_rules WHERE is_system AND status = 'published') <> 10 THEN
    RAISE EXCEPTION 'Activation did not publish all initial system rules';
  END IF;
  PERFORM public.set_meeting_system_v2_mode('shadow');

  SELECT public.claim_meeting_reminder_delivery_v2(
    v_first_meeting, v_user, 'agenda_30_min', 'crm'
  ) INTO v_reminder_claim;
  SELECT public.claim_meeting_reminder_delivery_v2(
    v_first_meeting, v_user, 'agenda_30_min', 'crm'
  ) INTO v_duplicate_claim;
  IF v_reminder_claim IS NULL OR v_duplicate_claim IS NOT NULL THEN
    RAISE EXCEPTION 'Reminder delivery claim is not idempotent';
  END IF;

  INSERT INTO public.tasks(id, assigned_to, task_type, title, status, deadline)
  VALUES (v_task, v_user, 'meeting_action_item', 'Meeting v2 queue test', 'pending', CURRENT_DATE - 1);
  IF NOT EXISTS (
    SELECT 1 FROM public.meeting_rule_events
    WHERE source_key = 'tasks' AND source_id = v_task::text AND operation = 'insert'
  ) THEN
    RAISE EXCEPTION 'Task mutation did not enter the rule queue';
  END IF;
END;
$$;

ROLLBACK;
