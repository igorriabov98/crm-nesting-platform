BEGIN TRANSACTION READ ONLY;

SELECT jsonb_build_object(
  'report', 'meeting-system-v2-shadow',
  'mode', COALESCE((
    SELECT value
    FROM public.app_settings
    WHERE key = 'meeting_system_v2_mode'
  ), 'missing'),
  'snapshotAt', now(),
  'timezone', 'Europe/Uzhgorod',
  'readiness', jsonb_build_object(
    'futurePlannedMeetingsWithoutTemplate', (
      SELECT count(*)
      FROM public.meetings meeting
      WHERE meeting.status::text = 'planned'
        AND meeting.meeting_date >= CURRENT_DATE
        AND meeting.template_id IS NULL
    ),
    'systemRulesWithoutVersion', (
      SELECT count(*)
      FROM public.meeting_rules rule
      WHERE rule.is_system
        AND rule.current_version_id IS NULL
    ),
    'duplicateActiveEpisodes', (
      SELECT count(*)
      FROM (
        SELECT question.rule_id, question.episode_key
        FROM public.meeting_questions question
        WHERE question.rule_id IS NOT NULL
          AND question.status IN ('new', 'assigned', 'in_meeting', 'on_control', 'deferred')
        GROUP BY question.rule_id, question.episode_key
        HAVING count(*) > 1
      ) duplicates
    ),
    'failedRunsLast24Hours', (
      SELECT count(*)
      FROM public.meeting_rule_runs run
      WHERE run.status = 'failed'
        AND run.started_at >= now() - interval '24 hours'
    ),
    'pendingEvents', (
      SELECT count(*)
      FROM public.meeting_rule_events event
      WHERE event.processed_at IS NULL
    ),
    'stalePendingEvents', (
      SELECT count(*)
      FROM public.meeting_rule_events event
      WHERE event.processed_at IS NULL
        AND event.created_at < now() - interval '15 minutes'
    )
  ),
  'catalog', jsonb_build_object(
    'meetingTemplates', (SELECT count(*) FROM public.meeting_templates WHERE is_active),
    'questionTemplates', (SELECT count(*) FROM public.meeting_question_templates WHERE is_active),
    'rulesByStatus', COALESCE((
      SELECT jsonb_object_agg(status, item_count)
      FROM (
        SELECT status, count(*) AS item_count
        FROM public.meeting_rules
        GROUP BY status
      ) grouped_rules
    ), '{}'::jsonb),
    'systemRules', (SELECT count(*) FROM public.meeting_rules WHERE is_system)
  ),
  'questions', jsonb_build_object(
    'v2ByStatus', COALESCE((
      SELECT jsonb_object_agg(status, item_count)
      FROM (
        SELECT status, count(*) AS item_count
        FROM public.meeting_questions
        GROUP BY status
      ) grouped_questions
    ), '{}'::jsonb),
    'legacyOpenAgendaItems', (
      SELECT count(*) FROM public.meeting_agenda_items WHERE resolved_at IS NULL
    ),
    'legacyPoolItems', (
      SELECT count(*) FROM public.meeting_agenda_pool_items
    ),
    'withoutMatchingMeeting', (
      SELECT count(*)
      FROM public.meeting_questions question
      WHERE question.status = 'new'
        AND question.assigned_meeting_id IS NULL
    )
  ),
  'recentRuns', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'ruleId', run.rule_id,
      'type', run.run_type,
      'mode', run.execution_mode,
      'status', run.status,
      'matched', run.matched_count,
      'groups', run.group_count,
      'created', run.created_count,
      'closed', run.closed_count,
      'startedAt', run.started_at,
      'completedAt', run.completed_at,
      'error', run.error_text
    ) ORDER BY run.started_at DESC)
    FROM (
      SELECT *
      FROM public.meeting_rule_runs
      ORDER BY started_at DESC
      LIMIT 20
    ) run
  ), '[]'::jsonb)
);

ROLLBACK;
