CREATE OR REPLACE FUNCTION public.transport_need_current_date(p_source text, p_need_id uuid)
RETURNS date
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_date date;
BEGIN
  IF p_source = 'outsourcing' THEN
    SELECT needed_date
      INTO v_date
      FROM public.machine_outsourcing_transport_needs
     WHERE id = p_need_id;
  ELSIF p_source = 'detailing_transfer' THEN
    SELECT COALESCE(
      transfer.expected_arrival_date,
      (
        SELECT task.deadline
          FROM public.tasks task
         WHERE task.detailing_transfer_id = p_need_id
           AND task.task_type = 'detailing_transfer'
         ORDER BY
           CASE WHEN task.status IN ('pending', 'in_progress') THEN 0 ELSE 1 END,
           task.created_at DESC
         LIMIT 1
      )
    )
      INTO v_date
      FROM public.detailing_transfers transfer
     WHERE transfer.id = p_need_id;
  ELSIF p_source = 'inventory_transfer' THEN
    SELECT COALESCE(
      transfer.expected_arrival_date,
      (
        SELECT task.deadline
          FROM public.tasks task
         WHERE task.inventory_transfer_id = p_need_id
           AND task.task_type = 'inventory_transfer'
         ORDER BY
           CASE WHEN task.status IN ('pending', 'in_progress') THEN 0 ELSE 1 END,
           task.created_at DESC
         LIMIT 1
      )
    )
      INTO v_date
      FROM public.inventory_transfers transfer
     WHERE transfer.id = p_need_id;
  ELSIF p_source = 'supply_schedule' THEN
    SELECT delivery_date
      INTO v_date
      FROM public.supply_order_delivery_schedules
     WHERE id = p_need_id;
  ELSE
    RAISE EXCEPTION 'Неизвестный источник транспортной потребности';
  END IF;

  RETURN v_date;
END;
$$;

COMMENT ON FUNCTION public.transport_need_current_date(text, uuid) IS
  'Returns the date shown in transport workspace; transfer task deadline is the fallback until an explicit arrival date is set.';

REVOKE ALL ON FUNCTION public.transport_need_current_date(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transport_need_current_date(text, uuid) TO service_role;
