CREATE OR REPLACE FUNCTION public.accept_task_delegation(
  p_delegation_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  task_id UUID,
  machine_id UUID,
  product_project_id UUID,
  delegated_by UUID,
  delegated_to UUID,
  task_title TEXT
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_delegation task_delegations%ROWTYPE;
  v_task tasks%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT *
    INTO v_delegation
  FROM task_delegations
  WHERE id = p_delegation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Делегирование не найдено';
  END IF;

  IF v_delegation.status <> 'pending' THEN
    RAISE EXCEPTION 'Делегирование уже обработано';
  END IF;

  IF v_delegation.delegated_to <> p_user_id THEN
    RAISE EXCEPTION 'Принять можно только задачу, делегированную вам';
  END IF;

  SELECT *
    INTO v_task
  FROM tasks
  WHERE id = v_delegation.task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Задача не найдена';
  END IF;

  IF v_task.status NOT IN ('pending', 'in_progress') THEN
    RAISE EXCEPTION 'Задача уже завершена или отменена';
  END IF;

  IF v_task.assigned_to <> v_delegation.delegated_from THEN
    RAISE EXCEPTION 'Ответственный по задаче уже изменился';
  END IF;

  UPDATE tasks
  SET
    assigned_to = p_user_id,
    status = 'pending',
    completed_at = NULL,
    notified_at = NULL,
    telegram_error = NULL,
    updated_at = v_now
  WHERE id = v_task.id;

  UPDATE task_delegations
  SET
    status = 'accepted',
    responded_at = v_now
  WHERE id = v_delegation.id;

  RETURN QUERY SELECT
    v_task.id,
    v_task.machine_id,
    v_task.product_project_id,
    v_delegation.delegated_by,
    v_delegation.delegated_to,
    v_task.title;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_task_delegation(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_task_delegation(UUID, UUID) TO service_role;
