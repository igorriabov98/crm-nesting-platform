-- A narrow authenticated operation: technologists can classify material without
-- receiving general UPDATE rights on orders or commercial fields.
CREATE FUNCTION public.crm_set_machine_material_type(p_machine_id uuid,p_material_type public.material_type)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE machine public.machines%ROWTYPE;
BEGIN
  IF NOT private.crm_has_permission('technologist_requests','manage') THEN RAISE EXCEPTION 'Недостаточно прав для выбора типа материала' USING ERRCODE='42501'; END IF;
  IF p_material_type IS NULL THEN RAISE EXCEPTION 'Выберите тип материала'; END IF;
  SELECT * INTO machine FROM public.machines WHERE id=p_machine_id FOR UPDATE;
  IF machine.id IS NULL THEN RAISE EXCEPTION 'Машина не найдена'; END IF;
  -- Keep the same order visibility boundary as machines_select.
  IF NOT (private.crm_has_permission('sales_plan','view') OR private.crm_has_permission('production','view') OR
    (private.crm_has_permission('supply_orders','view') AND EXISTS(SELECT 1 FROM public.technologist_requests WHERE machine_id=p_machine_id AND status IN ('submitted_to_supply','completed')))) THEN
    RAISE EXCEPTION 'Нет доступа к заказу' USING ERRCODE='42501';
  END IF;
  IF machine.is_archived IS TRUE THEN RAISE EXCEPTION 'Заказ находится в архиве'; END IF;
  UPDATE public.machines SET material_type=p_material_type,updated_at=now() WHERE id=p_machine_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_set_machine_material_type(uuid,public.material_type) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_set_machine_material_type(uuid,public.material_type) TO authenticated;

ALTER TABLE public.notifications ADD COLUMN related_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;
CREATE INDEX notifications_related_task_idx ON public.notifications(related_task_id) WHERE related_task_id IS NOT NULL;
CREATE FUNCTION private.notify_task_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
  IF NEW.assigned_to IS NULL OR NEW.status::text NOT IN ('pending','in_progress') THEN RETURN NULL; END IF;
  IF TG_OP='UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to AND OLD.status::text IN ('pending','in_progress') THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=NEW.assigned_to AND is_active IS TRUE) THEN RETURN NULL; END IF;
  INSERT INTO public.notifications(user_id,type,title,message,related_task_id,related_machine_id,telegram_notified_at)
  VALUES(NEW.assigned_to,'task_assigned','Вам назначена задача',NEW.title,NEW.id,NEW.machine_id,now());
  -- Telegram task delivery already has its own queue; this row is the CRM inbox.
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.notify_task_assignment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER notify_task_assignment AFTER INSERT OR UPDATE OF assigned_to,status ON public.tasks
FOR EACH ROW EXECUTE FUNCTION private.notify_task_assignment();
-- Do not backfill old tasks: rollout must not generate a flood of past events.
DO $publication$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime' AND NOT puballtables)
    AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END;
$publication$;
