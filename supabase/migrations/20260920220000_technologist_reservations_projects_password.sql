-- Factory-scoped warehouse management, atomic engineering completion, precise
-- approved-layout coverage, and auditable password recovery initiation.

ALTER TABLE public.department_access_permissions
  DROP CONSTRAINT department_access_permissions_factory_scope_check;
ALTER TABLE public.department_access_permissions
  ADD CONSTRAINT department_access_permissions_factory_scope_check CHECK (
    factory_scope IN ('own','all') AND (
      factory_scope='own' OR resource_key IN (
        'production_reports','customs_clearance','production_fact',
        'production_cutting_area','inventory'
      )
    )
  );

CREATE TABLE public.user_password_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  failure_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX user_password_reset_requests_user_time_idx
  ON public.user_password_reset_requests(user_id, requested_at DESC);
ALTER TABLE public.user_password_reset_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_password_reset_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.user_password_reset_requests TO service_role;

CREATE FUNCTION public.crm_prepare_password_reset(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  actor uuid:=auth.uid(); target public.users%ROWTYPE; request_id uuid;
BEGIN
  IF actor IS NULL OR NOT private.crm_has_permission('admin_users','manage') THEN
    RAISE EXCEPTION 'Недостаточно прав для сброса пароля' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
  SELECT * INTO target FROM public.users WHERE id=p_user_id FOR SHARE;
  IF target.id IS NULL THEN RAISE EXCEPTION 'Пользователь не найден'; END IF;
  IF NOT target.is_active OR target.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Сброс пароля доступен только активному пользователю';
  END IF;
  IF EXISTS(SELECT 1 FROM public.user_auth_sync WHERE user_id=p_user_id AND synced_at IS NULL) THEN
    RAISE EXCEPTION 'Сначала завершите синхронизацию email с сервисом входа';
  END IF;
  IF public.crm_user_is_admin(p_user_id) AND NOT public.crm_user_is_admin(actor) THEN
    RAISE EXCEPTION 'Сброс пароля администратора CRM доступен только администратору CRM' USING ERRCODE='42501';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.user_password_reset_requests
    WHERE user_id=p_user_id AND status IN ('pending','sent')
      AND requested_at > now()-interval '60 seconds'
  ) THEN RAISE EXCEPTION 'Письмо уже отправлялось. Повторите через минуту'; END IF;
  INSERT INTO public.user_password_reset_requests(user_id,requested_by,email)
  VALUES(p_user_id,actor,target.email) RETURNING id INTO request_id;
  INSERT INTO public.organization_audit_log(actor_id,entity_type,entity_id,action,before_data,after_data)
  VALUES(actor,'user',p_user_id,'password_reset_requested',NULL,jsonb_build_object('request_id',request_id,'email',target.email));
  RETURN jsonb_build_object('request_id',request_id,'email',target.email);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_prepare_password_reset(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_prepare_password_reset(uuid) TO authenticated;

CREATE FUNCTION public.crm_finish_password_reset_request(p_request_id uuid,p_sent boolean,p_error text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
  IF coalesce(auth.jwt()->>'role','') <> 'service_role' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE='42501';
  END IF;
  UPDATE public.user_password_reset_requests
  SET status=CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
      failure_reason=CASE WHEN p_sent THEN NULL ELSE left(coalesce(p_error,'Ошибка отправки'),500) END,
      completed_at=now()
  WHERE id=p_request_id AND status='pending';
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_finish_password_reset_request(uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_finish_password_reset_request(uuid,boolean,text) TO service_role;

CREATE FUNCTION public.crm_complete_product_project_engineering_task(p_task_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  actor uuid:=auth.uid(); task_row public.tasks%ROWTYPE; project_row public.product_projects%ROWTYPE;
  version_row public.product_project_versions%ROWTYPE; missing text[]:='{}'; drawing_name text; sales_task_id uuid;
BEGIN
  IF actor IS NULL OR NOT private.crm_account_is_active() OR NOT private.crm_has_permission('tasks','manage') THEN
    RAISE EXCEPTION 'Недостаточно прав для завершения задачи' USING ERRCODE='42501';
  END IF;
  SELECT * INTO task_row FROM public.tasks WHERE id=p_task_id FOR UPDATE;
  IF task_row.id IS NULL THEN RAISE EXCEPTION 'Задача не найдена'; END IF;
  IF task_row.task_type::text <> 'product_project_engineering' THEN RAISE EXCEPTION 'Задача не относится к проекту изделия'; END IF;
  IF task_row.assigned_to <> actor AND NOT public.crm_user_is_admin(actor) THEN
    RAISE EXCEPTION 'Задача назначена другому сотруднику' USING ERRCODE='42501';
  END IF;
  IF task_row.product_project_id IS NULL THEN RAISE EXCEPTION 'Задача не привязана к проекту изделия'; END IF;
  IF NOT private.crm_has_permission('product_projects','manage') THEN
    RAISE EXCEPTION 'Для завершения задачи нужен доступ к разделу «Проекты изделий»' USING ERRCODE='42501';
  END IF;
  SELECT * INTO project_row FROM public.product_projects WHERE id=task_row.product_project_id FOR UPDATE;
  IF project_row.id IS NULL THEN RAISE EXCEPTION 'Связанный проект изделия не найден'; END IF;
  SELECT * INTO version_row FROM public.product_project_versions
  WHERE project_id=project_row.id ORDER BY version_number DESC LIMIT 1 FOR UPDATE;
  IF version_row.id IS NULL THEN RAISE EXCEPTION 'У проекта нет версии для завершения'; END IF;
  SELECT file_name INTO drawing_name FROM public.product_project_files
  WHERE project_id=project_row.id AND file_kind='drawing' AND (version_id IS NULL OR version_id=version_row.id)
  ORDER BY created_at DESC LIMIT 1;
  IF drawing_name IS NULL THEN missing:=array_append(missing,'чертеж'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.product_project_files WHERE project_id=project_row.id AND file_kind='photo' AND (version_id IS NULL OR version_id=version_row.id)) THEN missing:=array_append(missing,'фото изделия'); END IF;
  IF nullif(btrim(version_row.description),'') IS NULL THEN missing:=array_append(missing,'описание инженера'); END IF;
  IF coalesce(version_row.unit_weight_kg,0)<=0 THEN missing:=array_append(missing,'вес изделия'); END IF;
  IF cardinality(missing)>0 THEN RAISE EXCEPTION 'Нельзя завершить задачу: заполните %.',array_to_string(missing,', '); END IF;
  IF nullif(btrim(version_row.drawing_number),'') IS NULL THEN
    UPDATE public.product_project_versions SET drawing_number=regexp_replace(drawing_name,'\.[^.]+$','') WHERE id=version_row.id;
  END IF;
  UPDATE public.product_project_versions SET status='client_review' WHERE id=version_row.id;
  UPDATE public.product_projects SET status='client_review',updated_at=now() WHERE id=project_row.id;
  SELECT id INTO sales_task_id FROM public.tasks WHERE product_project_id=project_row.id
    AND task_type::text='product_project_sales_review' AND status::text <> 'cancelled'
    ORDER BY created_at LIMIT 1;
  IF sales_task_id IS NULL THEN
    INSERT INTO public.tasks(machine_id,product_project_id,assigned_to,task_type,title,description,status,start_date,deadline)
    VALUES(NULL,project_row.id,coalesce(project_row.created_by,actor),'product_project_sales_review',
      'Согласовать изделие с клиентом: '||project_row.title,
      'Заполните цену, украинское и английское название, УКТЗЕД и утвердите модель с клиентом.',
      'pending',current_date,current_date+1) RETURNING id INTO sales_task_id;
  END IF;
  UPDATE public.tasks SET status='completed',completed_at=now(),updated_at=now() WHERE id=task_row.id;
  RETURN jsonb_build_object('project_id',project_row.id,'version_id',version_row.id,'sales_task_id',sales_task_id,
    'sales_assigned_to',coalesce(project_row.created_by,actor));
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_complete_product_project_engineering_task(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_complete_product_project_engineering_task(uuid) TO authenticated;

CREATE FUNCTION public.crm_supply_request_layout_coverage(p_request_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' STABLE AS $function$
  WITH allowed AS (
    SELECT 1 WHERE private.crm_account_is_active() AND (
      private.crm_has_permission('technologist_requests','view') OR private.crm_has_permission('supply','view')
      OR private.crm_has_permission('business_scrap_reservations','view')
    )
  ), items AS (
    SELECT item.id AS plan_item_id,item.request_item_table,item.request_item_id,item.plan_id,plan.plan_number
    FROM public.long_stock_cutting_plan_items item
    JOIN public.long_stock_cutting_plans plan ON plan.id=item.plan_id
    JOIN allowed ON true WHERE item.request_id=p_request_id
  ), chosen AS (
    SELECT items.*,version.id AS version_id,version.status AS version_status,version.version_number,
      candidate.id AS candidate_id
    FROM items
    LEFT JOIN LATERAL (
      SELECT v.* FROM public.long_stock_cutting_plan_versions v WHERE v.plan_id=items.plan_id
      ORDER BY v.version_number DESC LIMIT 1
    ) version ON true
    LEFT JOIN public.long_stock_cutting_candidates candidate
      ON candidate.version_id=version.id AND candidate.candidate_number=version.selected_candidate_number
  ), allocated AS (
    SELECT chosen.request_item_table,chosen.request_item_id,chosen.plan_id,chosen.plan_number,
      chosen.version_id,chosen.version_status,chosen.version_number,chosen.candidate_id,
      coalesce(sum(cut.cut_length_mm) FILTER(WHERE bar.source_type='warehouse_stock'),0) AS warehouse_mm,
      coalesce(sum(cut.cut_length_mm) FILTER(WHERE bar.source_type IN ('business_remnant','future_business_remnant')),0) AS business_scrap_mm,
      coalesce(sum(cut.cut_length_mm) FILTER(WHERE bar.source_type='new_stock'),0) AS purchase_covered_mm
    FROM chosen
    LEFT JOIN public.long_stock_cutting_segments segment ON segment.version_id=chosen.version_id AND segment.plan_item_id=chosen.plan_item_id
    LEFT JOIN public.long_stock_cutting_bar_cuts cut ON cut.segment_id=segment.id AND cut.version_id=chosen.version_id
    LEFT JOIN public.long_stock_cutting_candidate_bars bar ON bar.id=cut.bar_id AND bar.candidate_id=chosen.candidate_id
    GROUP BY chosen.request_item_table,chosen.request_item_id,chosen.plan_id,chosen.plan_number,
      chosen.version_id,chosen.version_status,chosen.version_number,chosen.candidate_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'request_item_table',allocated.request_item_table,'request_item_id',allocated.request_item_id,
    'plan_id',allocated.plan_id,'plan_number',allocated.plan_number,'version_id',allocated.version_id,
    'version_number',allocated.version_number,
    'status',CASE WHEN allocated.version_status='approved' THEN 'approved' WHEN allocated.version_status='invalid' THEN 'needs_recalculation' ELSE 'not_approved' END,
    'warehouse_mm',allocated.warehouse_mm,'business_scrap_mm',allocated.business_scrap_mm,
    'purchase_covered_mm',allocated.purchase_covered_mm,
    'purchase_total_mm',coalesce((SELECT sum(bar.stock_length_mm) FROM public.long_stock_cutting_candidate_bars bar
      WHERE bar.version_id=allocated.version_id AND bar.candidate_id=allocated.candidate_id AND bar.source_type='new_stock'),0),
    'purchase_bars',coalesce((SELECT jsonb_agg(jsonb_build_object('length_mm',bars.stock_length_mm,'quantity',bars.quantity) ORDER BY bars.stock_length_mm)
      FROM (SELECT bar.stock_length_mm,count(*) AS quantity FROM public.long_stock_cutting_candidate_bars bar
        JOIN public.long_stock_cutting_plan_versions version ON version.id=bar.version_id
        WHERE version.id=allocated.version_id AND bar.candidate_id=allocated.candidate_id AND bar.source_type='new_stock'
        GROUP BY bar.stock_length_mm) bars),'[]'::jsonb),
    'source_factories',coalesce((SELECT jsonb_agg(DISTINCT factory.name) FROM public.long_stock_cutting_candidate_bars bar
      JOIN public.inventory inventory ON inventory.id=bar.source_inventory_id
      LEFT JOIN public.factories factory ON factory.id=inventory.factory_id
      WHERE bar.version_id=allocated.version_id AND bar.candidate_id=allocated.candidate_id),'[]'::jsonb),
    'warehouse_factories',coalesce((SELECT jsonb_agg(DISTINCT factory.name) FROM public.long_stock_cutting_candidate_bars bar
      JOIN public.inventory inventory ON inventory.id=bar.source_inventory_id
      LEFT JOIN public.factories factory ON factory.id=inventory.factory_id
      WHERE bar.version_id=allocated.version_id AND bar.candidate_id=allocated.candidate_id
        AND bar.source_type='warehouse_stock'),'[]'::jsonb),
    'business_scrap_factories',coalesce((SELECT jsonb_agg(DISTINCT factory.name) FROM public.long_stock_cutting_candidate_bars bar
      JOIN public.inventory inventory ON inventory.id=bar.source_inventory_id
      LEFT JOIN public.factories factory ON factory.id=inventory.factory_id
      WHERE bar.version_id=allocated.version_id AND bar.candidate_id=allocated.candidate_id
        AND bar.source_type IN ('business_remnant','future_business_remnant')),'[]'::jsonb)
  ) ORDER BY allocated.plan_number,allocated.request_item_table,allocated.request_item_id),'[]'::jsonb) FROM allocated;
$function$;
REVOKE ALL ON FUNCTION public.crm_supply_request_layout_coverage(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_supply_request_layout_coverage(uuid) TO authenticated;
