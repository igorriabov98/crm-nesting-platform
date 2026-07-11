DO $$
DECLARE
  v_technologist_id uuid;
BEGIN
  SELECT auto_task_technologist_user_id
  INTO v_technologist_id
  FROM public.company_settings
  WHERE id = '00000000-0000-0000-0000-000000000001';

  IF v_technologist_id IS NULL THEN
    RAISE NOTICE 'Configured technologist was not found; material task history was not changed.';
    RETURN;
  END IF;

  UPDATE public.tasks task
  SET status = 'completed',
      completed_at = COALESCE(
        task.completed_at,
        (
          SELECT max(history.completed_at)
          FROM public.tasks history
          WHERE history.machine_id = task.machine_id
            AND history.task_type = 'material_type_selection'
        ),
        now()
      ),
      updated_at = now()
  FROM public.machines machine
  WHERE task.machine_id = machine.id
    AND task.assigned_to = v_technologist_id
    AND task.task_type = 'material_type_selection'
    AND task.status = 'cancelled'
    AND COALESCE(machine.is_confirmed, false)
    AND NOT COALESCE(machine.is_archived, false)
    AND machine.material_type IS NOT NULL
    AND machine.material_type::text <> 'undefined';
END;
$$;

SELECT public.fn_sync_material_type_selection_task(id)
FROM public.machines
WHERE NOT COALESCE(is_archived, false);
