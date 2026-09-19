CREATE TABLE private.organization_obligation_sources (
  key text PRIMARY KEY, table_name text NOT NULL, id_column text NOT NULL DEFAULT 'id',
  owner_column text NOT NULL, active_where text NOT NULL, title_column text,
  label text NOT NULL, resource_key text NOT NULL, href text NOT NULL, transfer_kind text NOT NULL
);
REVOKE ALL ON private.organization_obligation_sources FROM PUBLIC,anon,authenticated;
INSERT INTO private.organization_obligation_sources(key,table_name,owner_column,active_where,title_column,label,resource_key,href,transfer_kind) VALUES
('tasks','tasks','assigned_to',$q$r.status::text IN ('pending','in_progress')$q$,'title','Задача','tasks','/tasks','task'),
('clients','clients','responsible_user_id','true','name','Ответственный за клиента','clients','/clients','owner'),
('requests','department_requests','assigned_to',$q$r.status IN ('new','in_progress')$q$,'title','Запрос отдела','department_requests','/requests','request'),
('finance_expenses','finance_expenses','responsible_user_id',$q$r.status::text NOT IN ('paid','rejected')$q$,'title','Финансовое обязательство','finance_calendar','/finance/calendar','owner'),
('finance_series','finance_expense_series','responsible_user_id','r.is_active IS TRUE','title','Регулярное обязательство','finance_calendar','/finance/calendar','owner'),
('meeting_actions','meeting_action_items','responsible_user_id',$q$r.status='open'$q$,'title','Поручение совещания','meetings','/meetings','meeting_action'),
('meeting_questions','meeting_questions','responsible_user_id',$q$r.status NOT IN ('resolved','auto_closed','dismissed')$q$,'title','Вопрос совещания','meetings','/meetings','owner'),
('meeting_templates','meeting_templates','facilitator_user_id','r.is_active IS TRUE','name','Ведущий регулярного совещания','meeting_templates','/admin/settings/meetings','owner'),
('question_templates','meeting_question_templates','default_responsible_user_id','r.is_active IS TRUE','name','Ответственный в шаблоне вопроса','meeting_question_templates','/admin/settings/meetings','owner'),
('meeting_participants','meeting_template_participants','user_id','EXISTS(SELECT 1 FROM public.meeting_templates t WHERE t.id=r.template_id AND t.is_active IS TRUE)',NULL,'Участник регулярного совещания','meeting_templates','/admin/settings/meetings','owner'),
('meetings','meetings','facilitator_user_id',$q$r.status::text IN ('planned','in_progress')$q$,'title','Ведущий совещания','meetings','/meetings','owner'),
('projects','product_projects','assigned_engineer_id',$q$r.status NOT IN ('approved','added_to_products','cancelled')$q$,'title','Разработка изделия','product_projects','/product-projects','project'),
('layouts','machine_layout_requests','assigned_to',$q$r.status='requested'$q$,NULL,'Расстановка заявки','department_requests','/requests','blocked'),
('supply_revisions','supply_position_revisions','assigned_to',$q$r.status IN ('requested','editing','stock_check')$q$,'reason','Переработка позиции снабжения','technologist_request_results','/technologist/request-results','blocked'),
('delegations_to','task_delegations','delegated_to',$q$r.status::text='pending'$q$,NULL,'Ожидает принятия делегирования','tasks','/tasks','blocked'),
('delegations_from','task_delegations','delegated_from',$q$r.status::text='pending'$q$,NULL,'Ожидает передачи задачи','tasks','/tasks','blocked'),
('delegations_by','task_delegations','delegated_by',$q$r.status::text='pending'$q$,NULL,'Ожидает решения по делегированию','tasks','/tasks','blocked');
INSERT INTO private.organization_obligation_sources(key,table_name,id_column,owner_column,active_where,label,resource_key,href,transfer_kind)
VALUES('revision_drafts','technologist_request_revision_drafts','request_id','editor_id','true','Черновик переработки заявки','technologist_request_results','/technologist/request-results','blocked');

CREATE FUNCTION private.organization_obligations(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE source private.organization_obligation_sources%ROWTYPE; record_data jsonb; result jsonb:='[]'; can_transfer boolean; reason text; row_id text;
BEGIN
  FOR source IN SELECT * FROM private.organization_obligation_sources ORDER BY key LOOP
    FOR record_data IN EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE r.%I=$1 AND (%s) ORDER BY r.%I',source.table_name,source.owner_column,source.active_where,source.id_column) USING p_user_id LOOP
      can_transfer:=source.transfer_kind <> 'blocked';
      reason:=CASE WHEN can_transfer THEN NULL ELSE 'Завершите или передайте через штатный процесс' END;
      IF source.transfer_kind='task' THEN
        can_transfer := record_data->>'task_type' IN ('agenda_pool_distribution','meeting_unresolved_agenda');
        IF NOT can_transfer THEN reason:='Передайте связанный объект или завершите задачу в её штатном процессе'; END IF;
      ELSIF source.transfer_kind='request' THEN
        can_transfer:=record_data->>'request_kind'='manual';
        IF NOT can_transfer THEN reason:='Согласование или специальный запрос передаётся через штатный процесс'; END IF;
      END IF;
      IF NOT private.crm_has_permission(source.resource_key,'manage') THEN can_transfer:=false; reason:='Для передачи требуется право управления этим разделом'; END IF;
      IF source.key='clients' AND NOT public.crm_user_is_admin(auth.uid()) THEN
        can_transfer:=false; reason:='Ответственного за компанию меняет администратор CRM';
      END IF;
      row_id:=record_data->>source.id_column;
      result:=result || jsonb_build_array(jsonb_build_object('key',source.key||':'||row_id,'source',source.key,'id',row_id,
        'label',source.label,'title',CASE WHEN private.crm_has_permission(source.resource_key,'view') AND (source.key<>'clients' OR private.crm_has_company_permission('client_identity','view',(record_data->>'id')::uuid)) THEN coalesce(record_data->>source.title_column,source.label) ELSE source.label END,
        'href',source.href,'transferable',can_transfer,'reason',reason,'fingerprint',md5(record_data::text),'resourceKey',source.resource_key));
    END LOOP;
  END LOOP;
  FOR record_data IN SELECT to_jsonb(m) || jsonb_build_object('name',d.name) FROM public.department_members m JOIN public.departments d ON d.id=m.department_id WHERE m.user_id=p_user_id AND m.is_department_head LOOP
    result:=result || jsonb_build_array(jsonb_build_object('key','head:'||(record_data->>'id'),'source','head','id',record_data->>'id','label','Руководитель отдела','title',record_data->>'name',
      'href','/admin/organization?tab=departments','transferable',private.crm_has_permission('departments','manage'),'fingerprint',md5(record_data::text),'resourceKey','departments'));
  END LOOP;
  FOR record_data IN SELECT to_jsonb(m) || jsonb_build_object('name',u.full_name) FROM public.department_members m JOIN public.users u ON u.id=m.user_id
    WHERE m.reports_to_user_id=p_user_id AND u.is_active IS TRUE LOOP
    result:=result || jsonb_build_array(jsonb_build_object('key','supervisor:'||(record_data->>'id'),'source','supervisor','id',record_data->>'id','label','Непосредственный руководитель','title',record_data->>'name',
      'href','/admin/organization?tab=users','transferable',private.crm_has_permission('departments','manage'),'fingerprint',md5(record_data::text),'resourceKey','departments'));
  END LOOP;
  RETURN result;
END;
$function$;
CREATE FUNCTION public.crm_preview_offboarding(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NOT private.crm_has_permission('admin_users','manage') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user_id) THEN RAISE EXCEPTION 'Пользователь не найден'; END IF;
  RETURN jsonb_build_object('userId',p_user_id,'version',(SELECT version::text FROM public.organization_revision WHERE singleton),'obligations',private.organization_obligations(p_user_id));
END;
$function$;

-- Serialize assignment writes with the final offboarding check, including
-- changes made by automatic task generators and service-role callers.
CREATE FUNCTION private.organization_active_assignee() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE source private.organization_obligation_sources%ROWTYPE; target_id uuid; active_row boolean;
BEGIN
  PERFORM 1 FROM public.organization_revision WHERE singleton FOR UPDATE;
  SELECT * INTO STRICT source FROM private.organization_obligation_sources WHERE key=TG_ARGV[0];
  target_id:=(to_jsonb(NEW)->>source.owner_column)::uuid;
  IF target_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT (%s) FROM jsonb_populate_record(NULL::public.%I,$1) r',source.active_where,source.table_name) INTO active_row USING to_jsonb(NEW);
  IF active_row THEN
    PERFORM 1 FROM public.users WHERE id=target_id AND is_active IS TRUE FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Нельзя назначить действующую обязанность заблокированному пользователю'; END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DO $triggers$
DECLARE source private.organization_obligation_sources%ROWTYPE;
BEGIN
  FOR source IN SELECT * FROM private.organization_obligation_sources LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.organization_active_assignee(%L)','organization_assignee_'||source.key,source.table_name,source.key);
  END LOOP;
END;
$triggers$;

CREATE TABLE public.organization_handoffs (
  operation_id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES public.users(id),
  user_id uuid NOT NULL REFERENCES public.users(id), target_user_id uuid NOT NULL REFERENCES public.users(id),
  obligation_key text NOT NULL, target_membership_id uuid, fingerprint text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.organization_handoffs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.organization_handoffs TO service_role;
CREATE FUNCTION public.crm_handoff_obligation(p_operation_id uuid,p_user_id uuid,p_target_user_id uuid,p_key text,p_fingerprint text,p_target_membership_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE previous public.organization_handoffs%ROWTYPE; obligation jsonb; source private.organization_obligation_sources%ROWTYPE; row_id uuid; record_data jsonb; member public.department_members%ROWTYPE; target public.department_members%ROWTYPE; outcome jsonb;
BEGIN
  PERFORM 1 FROM public.organization_revision WHERE singleton FOR UPDATE;
  IF NOT private.crm_has_permission('admin_users','manage') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE='42501'; END IF;
  SELECT * INTO previous FROM public.organization_handoffs WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF previous.actor_id<>auth.uid() OR previous.user_id<>p_user_id OR previous.target_user_id<>p_target_user_id OR previous.obligation_key<>p_key OR previous.target_membership_id IS DISTINCT FROM p_target_membership_id OR previous.fingerprint IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'Идентификатор операции уже использован'; END IF;
    RETURN previous.result;
  END IF;
  IF p_target_user_id=p_user_id OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_target_user_id AND is_active IS TRUE) THEN RAISE EXCEPTION 'Выберите другого активного пользователя'; END IF;
  SELECT value INTO obligation FROM jsonb_array_elements(private.organization_obligations(p_user_id)) WHERE value->>'key'=p_key;
  IF obligation IS NULL OR obligation->>'fingerprint' IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'Обязанность изменилась. Обновите список.' USING ERRCODE='40001'; END IF;
  IF NOT (obligation->>'transferable')::boolean THEN RAISE EXCEPTION '%',coalesce(obligation->>'reason','Передача недоступна'); END IF;
  IF NOT private.crm_subject_permission(p_target_user_id,obligation->>'resourceKey','manage') AND obligation->>'source' NOT IN ('head','supervisor') THEN
    RAISE EXCEPTION 'У преемника нет необходимых прав управления';
  END IF;
  row_id:=(obligation->>'id')::uuid;
  IF obligation->>'source' IN ('head','supervisor') THEN
    SELECT * INTO STRICT member FROM public.department_members WHERE id=row_id;
    SELECT * INTO STRICT target FROM public.department_members WHERE id=p_target_membership_id AND user_id=p_target_user_id AND department_id=member.department_id;
    IF obligation->>'source'='head' THEN
      UPDATE public.department_members SET is_department_head=false WHERE department_id=member.department_id AND is_department_head AND user_id<>target.user_id;
      UPDATE public.department_members SET is_department_head=true WHERE id=target.id;
    ELSE UPDATE public.department_members SET reports_to_membership_id=target.id WHERE id=member.id;
    END IF;
  ELSE
    SELECT * INTO STRICT source FROM private.organization_obligation_sources WHERE key=obligation->>'source';
    EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE %I=$1 FOR UPDATE',source.table_name,source.id_column) INTO record_data USING row_id;
    IF source.key='clients' AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_target_user_id AND role='sales_manager' AND is_active) THEN RAISE EXCEPTION 'Ответственным за компанию может стать активный менеджер Sales'; END IF;
    IF record_data IS NULL OR md5(record_data::text) IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'Обязанность изменилась. Обновите список.' USING ERRCODE='40001'; END IF;
    IF source.transfer_kind IN ('meeting_action','request','project') AND NOT private.crm_subject_permission(p_target_user_id,'tasks','manage') THEN RAISE EXCEPTION 'У преемника нет прав управления задачами'; END IF;
    IF EXISTS(SELECT 1 FROM public.task_delegations d JOIN public.tasks t ON t.id=d.task_id WHERE d.status::text='pending' AND (t.assigned_to=p_user_id OR d.delegated_from=p_user_id OR d.delegated_to=p_user_id)) THEN
      RAISE EXCEPTION 'Сначала завершите ожидающие делегирования задач пользователя';
    END IF;
    IF source.transfer_kind='task' AND NOT private.crm_subject_permission(p_target_user_id,'meetings','manage') THEN RAISE EXCEPTION 'У преемника нет прав на совещания'; END IF;
    EXECUTE format('UPDATE public.%I SET %I=$1 WHERE %I=$2 AND %I=$3',source.table_name,source.owner_column,source.id_column,source.owner_column) USING p_target_user_id,row_id,p_user_id;
    IF source.transfer_kind='meeting_action' THEN
      UPDATE public.tasks SET assigned_to=p_target_user_id WHERE id=(record_data->>'related_task_id')::uuid AND assigned_to=p_user_id AND status::text IN ('pending','in_progress') AND task_type::text='meeting_action_item';
    ELSIF source.transfer_kind='request' THEN
      UPDATE public.tasks SET assigned_to=p_target_user_id WHERE department_request_id=row_id AND assigned_to=p_user_id AND status::text IN ('pending','in_progress') AND task_type::text='department_request';
    ELSIF source.transfer_kind='project' THEN
      UPDATE public.tasks SET assigned_to=p_target_user_id WHERE product_project_id=row_id AND assigned_to=p_user_id AND status::text IN ('pending','in_progress') AND task_type::text='product_project_engineering';
    END IF;
  END IF;
  outcome:=jsonb_build_object('success',true,'key',p_key);
  INSERT INTO public.organization_handoffs(operation_id,actor_id,user_id,target_user_id,obligation_key,target_membership_id,fingerprint,result) VALUES(p_operation_id,auth.uid(),p_user_id,p_target_user_id,p_key,p_target_membership_id,p_fingerprint,outcome);
  INSERT INTO public.organization_audit_log(actor_id,entity_type,entity_id,action,before_data,after_data)
  VALUES(auth.uid(),'user',p_user_id,'handoff',obligation,jsonb_build_object('targetUserId',p_target_user_id,'targetMembershipId',p_target_membership_id,'operationId',p_operation_id));
  RETURN outcome;
END;
$function$;

CREATE TABLE public.user_auth_sync (
  user_id uuid PRIMARY KEY REFERENCES public.users(id), desired_active boolean NOT NULL,
  generation uuid NOT NULL DEFAULT gen_random_uuid(), attempts integer NOT NULL DEFAULT 0,
  last_error text, requested_at timestamptz NOT NULL DEFAULT now(), synced_at timestamptz
);
REVOKE ALL ON public.user_auth_sync FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.user_auth_sync TO service_role;
CREATE FUNCTION private.organization_guard_user_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  PERFORM 1 FROM public.organization_revision WHERE singleton FOR UPDATE;
  IF NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN RETURN NEW; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT private.crm_has_permission('admin_users','manage') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE='42501'; END IF;
  IF auth.uid()=OLD.id THEN RAISE EXCEPTION 'Нельзя изменить состояние собственного аккаунта'; END IF;
  IF EXISTS(SELECT 1 FROM public.user_system_roles WHERE user_id=OLD.id) AND auth.role() IS DISTINCT FROM 'service_role' AND NOT public.crm_user_is_admin(auth.uid()) THEN RAISE EXCEPTION 'Состояние администратора меняет другой администратор'; END IF;
  IF NEW.is_active IS NOT TRUE AND jsonb_array_length(private.organization_obligations(OLD.id))>0 THEN
    RAISE EXCEPTION 'Сначала передайте все действующие обязанности пользователя';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER organization_guard_user_status BEFORE UPDATE OF is_active ON public.users FOR EACH ROW EXECUTE FUNCTION private.organization_guard_user_status();
CREATE FUNCTION private.organization_queue_auth_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF TG_OP='UPDATE' AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN RETURN NULL; END IF;
  INSERT INTO public.user_auth_sync(user_id,desired_active) VALUES(NEW.id,NEW.is_active IS TRUE)
  ON CONFLICT(user_id) DO UPDATE SET desired_active=EXCLUDED.desired_active,generation=gen_random_uuid(),attempts=0,last_error=NULL,requested_at=now(),synced_at=NULL;
  RETURN NULL;
END;
$function$;
CREATE TRIGGER organization_queue_auth_sync AFTER INSERT OR UPDATE OF is_active ON public.users FOR EACH ROW EXECUTE FUNCTION private.organization_queue_auth_sync();
CREATE FUNCTION public.crm_change_user_status(p_user_id uuid,p_active boolean,p_expected_version bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  PERFORM private.organization_assert_version(p_expected_version);
  IF NOT private.crm_has_permission('admin_users','manage') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE='42501'; END IF;
  IF p_active IS NULL THEN RAISE EXCEPTION 'Укажите состояние аккаунта'; END IF;
  UPDATE public.users SET is_active=p_active WHERE id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Пользователь не найден'; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.organization_obligations(uuid),private.organization_active_assignee(),private.organization_guard_user_status(),private.organization_queue_auth_sync() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.crm_preview_offboarding(uuid),public.crm_handoff_obligation(uuid,uuid,uuid,text,text,uuid),public.crm_change_user_status(uuid,boolean,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_preview_offboarding(uuid),public.crm_handoff_obligation(uuid,uuid,uuid,text,text,uuid),public.crm_change_user_status(uuid,boolean,bigint) TO authenticated;
