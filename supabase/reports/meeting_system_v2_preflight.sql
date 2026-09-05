BEGIN TRANSACTION READ ONLY;

SELECT jsonb_build_object(
  'report', 'meeting-system-v2-pre-migration',
  'mode', 'read-only',
  'snapshotAt', now(),
  'timezone', 'Europe/Uzhgorod',
  'meetingTypes', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'key', meeting_type.key,
      'label', meeting_type.label,
      'active', meeting_type.is_active,
      'meetings', (SELECT count(*) FROM public.meetings meeting WHERE meeting.meeting_type = meeting_type.key)
    ) ORDER BY meeting_type.label)
    FROM public.meeting_types meeting_type
  ), '[]'::jsonb),
  'recurrenceSeries', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', recurrence.id,
      'meetingType', recurrence.meeting_type,
      'active', recurrence.is_active,
      'startDate', recurrence.start_date,
      'endDate', recurrence.end_date,
      'occurrenceCount', recurrence.occurrence_count,
      'weekdays', recurrence.weekdays
    ) ORDER BY recurrence.created_at)
    FROM public.meeting_recurrence_rules recurrence
  ), '[]'::jsonb),
  'counts', jsonb_build_object(
    'futurePlannedMeetings', (
      SELECT count(*) FROM public.meetings
      WHERE meeting_date >= CURRENT_DATE AND status::text = 'planned'
    ),
    'pastCompletedOrCancelledMeetings', (
      SELECT count(*) FROM public.meetings
      WHERE meeting_date < CURRENT_DATE AND status::text IN ('completed', 'cancelled')
    ),
    'openAgendaItems', (
      SELECT count(*) FROM public.meeting_agenda_items WHERE resolved_at IS NULL
    ),
    'decisions', (SELECT count(*) FROM public.meeting_decisions),
    'actionItems', (SELECT count(*) FROM public.meeting_action_items),
    'linkedGeneralTasks', (
      SELECT count(*) FROM public.meeting_action_items WHERE related_task_id IS NOT NULL
    ),
    'agendaPoolByStatus', COALESCE((
      SELECT jsonb_object_agg(status, item_count)
      FROM (
        SELECT status, count(*) AS item_count
        FROM public.meeting_agenda_pool_items
        GROUP BY status
      ) grouped_pool
    ), '{}'::jsonb)
  )
);

ROLLBACK;
