WITH layout_messages AS (
  SELECT DISTINCT ON (message.machine_id, message.system_event_key)
    message.machine_id,
    message.body,
    message.system_event_key,
    message.created_at
  FROM public.machine_chat_messages message
  WHERE message.message_kind = 'system'
    AND message.system_event_key LIKE 'machine_layout_pdf_uploaded:%'
  ORDER BY message.machine_id, message.system_event_key, message.created_at ASC
)
INSERT INTO public.machine_updates (
  machine_id,
  body,
  created_by,
  updated_by,
  message_kind,
  system_event_key,
  created_at,
  updated_at
)
SELECT
  message.machine_id,
  message.body,
  COALESCE(request.uploaded_by, machine.created_by),
  COALESCE(request.uploaded_by, machine.created_by),
  'system',
  message.system_event_key,
  message.created_at,
  message.created_at
FROM layout_messages message
JOIN public.machines machine ON machine.id = message.machine_id
LEFT JOIN public.machine_layout_requests request
  ON message.system_event_key = 'machine_layout_pdf_uploaded:' || request.id::text
WHERE COALESCE(request.uploaded_by, machine.created_by) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.machine_updates update_row
    WHERE update_row.machine_id = message.machine_id
      AND update_row.system_event_key = message.system_event_key
  );
