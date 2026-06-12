-- Adds planning-director review tasks and production-manager factory notifications.
-- This migration intentionally avoids using the new enum value in index predicates,
-- because Supabase may run the whole editor query in one transaction.

ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'machine_review';

-- Broad enough to protect machine review tasks from duplicates without referencing
-- the newly-added enum value before PostgreSQL commits it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_machine_assigned_type_unique
  ON tasks(machine_id, assigned_to, task_type)
  WHERE machine_id IS NOT NULL;

CREATE OR REPLACE FUNCTION notify_users_by_role_in_factory(
  p_factory_id uuid,
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
  WHERE u.factory_id = p_factory_id
    AND u.role = p_role
    AND u.is_active = true;
END;
$$;

GRANT EXECUTE ON FUNCTION notify_users_by_role_in_factory(uuid, user_role, text, text, text, uuid) TO authenticated;
