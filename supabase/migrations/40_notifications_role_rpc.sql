-- System notifications sent from server actions must not depend on the caller
-- being allowed to insert rows for other users under notifications RLS.
CREATE OR REPLACE FUNCTION notify_users_by_role(
  p_role user_role,
  p_type text,
  p_title text,
  p_message text,
  p_machine_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications (user_id, type, title, message, related_machine_id)
  SELECT u.id, p_type, p_title, p_message, p_machine_id
  FROM users u
  WHERE u.role = p_role
    AND u.is_active = true;
END;
$$;

GRANT EXECUTE ON FUNCTION notify_users_by_role(user_role, text, text, text, uuid) TO authenticated;
