-- Consolidate the same open legacy question that was migrated once from the
-- assigned agenda row and once from its source pool row. Legacy rows themselves
-- remain untouched; only the duplicated v2 projection is merged.
DO $$
DECLARE
  pair record;
BEGIN
  FOR pair IN
    SELECT DISTINCT ON (pool_question.id)
      agenda_question.id AS keep_id,
      pool_question.id AS duplicate_id,
      pool_question.legacy_pool_item_id
    FROM public.meeting_questions pool_question
    JOIN public.meeting_questions agenda_question
      ON agenda_question.id <> pool_question.id
     AND agenda_question.legacy_agenda_item_id IS NOT NULL
     AND agenda_question.assigned_meeting_id IS NOT DISTINCT FROM pool_question.assigned_meeting_id
     AND agenda_question.source_id IS NOT DISTINCT FROM pool_question.source_id
     AND agenda_question.title = pool_question.title
     AND coalesce(agenda_question.description, '') = coalesce(pool_question.description, '')
     AND regexp_replace(agenda_question.episode_key, '^pool:', '')
         = regexp_replace(pool_question.episode_key, '^pool:', '')
    WHERE pool_question.legacy_pool_item_id IS NOT NULL
      AND pool_question.status IN ('new', 'assigned', 'in_meeting', 'on_control', 'deferred')
      AND agenda_question.status IN ('new', 'assigned', 'in_meeting', 'on_control', 'deferred')
    ORDER BY pool_question.id, agenda_question.opened_at, agenda_question.id
  LOOP
    DELETE FROM public.meeting_question_members duplicate_member
    WHERE duplicate_member.question_id = pair.duplicate_id
      AND EXISTS (
        SELECT 1
        FROM public.meeting_question_members keep_member
        WHERE keep_member.question_id = pair.keep_id
          AND (
            keep_member.source_key = duplicate_member.source_key
            OR (
              keep_member.source_id IS NOT DISTINCT FROM duplicate_member.source_id
              AND keep_member.title = duplicate_member.title
            )
          )
      );
    UPDATE public.meeting_question_members
    SET question_id = pair.keep_id
    WHERE question_id = pair.duplicate_id;

    DELETE FROM public.meeting_question_task_links duplicate_link
    WHERE duplicate_link.question_id = pair.duplicate_id
      AND EXISTS (
        SELECT 1
        FROM public.meeting_question_task_links keep_link
        WHERE keep_link.question_id = pair.keep_id
          AND keep_link.task_id = duplicate_link.task_id
      );
    UPDATE public.meeting_question_task_links
    SET question_id = pair.keep_id
    WHERE question_id = pair.duplicate_id;

    UPDATE public.meeting_question_outcomes
    SET question_id = pair.keep_id
    WHERE question_id = pair.duplicate_id;
    UPDATE public.meeting_question_events
    SET question_id = pair.keep_id
    WHERE question_id = pair.duplicate_id;

    DELETE FROM public.meeting_question_meeting_history duplicate_history
    WHERE duplicate_history.question_id = pair.duplicate_id
      AND EXISTS (
        SELECT 1
        FROM public.meeting_question_meeting_history keep_history
        WHERE keep_history.question_id = pair.keep_id
          AND keep_history.meeting_id = duplicate_history.meeting_id
      );
    UPDATE public.meeting_question_meeting_history
    SET question_id = pair.keep_id
    WHERE question_id = pair.duplicate_id;

    UPDATE public.meeting_questions
    SET legacy_pool_item_id = NULL
    WHERE id = pair.duplicate_id;
    UPDATE public.meeting_questions
    SET legacy_pool_item_id = pair.legacy_pool_item_id,
        opened_at = LEAST(opened_at, (
          SELECT opened_at
          FROM public.meeting_questions
          WHERE id = pair.duplicate_id
        ))
    WHERE id = pair.keep_id;

    INSERT INTO public.meeting_question_events(
      question_id, event_type, meeting_id, details
    )
    SELECT pair.keep_id, 'legacy_duplicate_merged', assigned_meeting_id,
           jsonb_build_object('duplicateQuestionId', pair.duplicate_id)
    FROM public.meeting_questions
    WHERE id = pair.keep_id;

    DELETE FROM public.meeting_questions WHERE id = pair.duplicate_id;
  END LOOP;
END;
$$;

-- Adopt compatible legacy questions into their visible system-rule episode so
-- the first active reconciliation refreshes the same question instead of
-- creating another copy.
UPDATE public.meeting_questions
SET question_template_id = '20000000-0000-4000-8000-000000000006',
    rule_id = '30000000-0000-4000-8000-000000000006',
    rule_version_id = '40000000-0000-4000-8000-000000000006',
    episode_key = 'machines:' || source_id,
    group_key = 'machines:' || source_id,
    source_type = 'machines',
    category = 'planning',
    priority = 'high',
    condition_snapshot = condition_snapshot || jsonb_build_object(
      'adoptedFromLegacyRule', 'machine_without_factory'
    )
WHERE rule_id IS NULL
  AND source_type = 'machine_without_factory'
  AND source_id IS NOT NULL
  AND status IN ('new', 'assigned', 'in_meeting', 'on_control', 'deferred');

UPDATE public.meeting_questions
SET question_template_id = '20000000-0000-4000-8000-000000000007',
    rule_id = '30000000-0000-4000-8000-000000000007',
    rule_version_id = '40000000-0000-4000-8000-000000000007',
    episode_key = 'machines:' || source_id,
    group_key = 'machines:' || source_id,
    source_type = 'machines',
    category = 'materials',
    priority = 'high',
    condition_snapshot = condition_snapshot || jsonb_build_object(
      'adoptedFromLegacyRule', 'material_undefined'
    )
WHERE rule_id IS NULL
  AND source_type = 'material_undefined'
  AND source_id IS NOT NULL
  AND status IN ('new', 'assigned', 'in_meeting', 'on_control', 'deferred');
