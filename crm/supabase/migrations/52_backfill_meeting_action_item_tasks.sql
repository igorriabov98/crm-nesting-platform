WITH source_items AS (
  SELECT
    id AS action_item_id,
    meeting_id,
    responsible_user_id,
    title,
    NULLIF(description, title) AS description,
    CASE WHEN status = 'done' THEN 'completed'::task_status ELSE 'pending'::task_status END AS task_status,
    COALESCE(deadline, CURRENT_DATE) AS deadline
  FROM meeting_action_items
  WHERE related_task_id IS NULL
    AND responsible_user_id IS NOT NULL
),
created_tasks AS (
  INSERT INTO tasks (
    related_meeting_id,
    assigned_to,
    task_type,
    title,
    description,
    status,
    deadline
  )
  SELECT
    meeting_id,
    responsible_user_id,
    'meeting_action_item'::task_type,
    title,
    description,
    task_status,
    deadline
  FROM source_items
  RETURNING id, related_meeting_id, assigned_to, title
),
matched_tasks AS (
  SELECT DISTINCT ON (si.action_item_id)
    si.action_item_id,
    ct.id AS task_id
  FROM source_items si
  JOIN created_tasks ct
    ON ct.related_meeting_id = si.meeting_id
   AND ct.assigned_to = si.responsible_user_id
   AND ct.title = si.title
  ORDER BY si.action_item_id, ct.id
)
UPDATE meeting_action_items mai
SET related_task_id = mt.task_id
FROM matched_tasks mt
WHERE mai.id = mt.action_item_id;
