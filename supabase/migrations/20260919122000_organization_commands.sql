BEGIN;

CREATE FUNCTION private.organization_validate_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE supervisor public.department_members%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.organization_revision WHERE singleton FOR UPDATE;
  IF TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.department_id IS DISTINCT FROM OLD.department_id OR NEW.is_department_head THEN
    PERFORM 1 FROM public.users WHERE id=NEW.user_id AND is_active IS TRUE FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Назначить можно только активного пользователя'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.departments WHERE id=NEW.department_id AND is_active IS TRUE) THEN RAISE EXCEPTION 'Отдел неактивен'; END IF;
  END IF;
  IF TG_OP='UPDATE' AND (NEW.department_id IS DISTINCT FROM OLD.department_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) AND EXISTS(SELECT 1 FROM public.department_members m WHERE m.reports_to_membership_id=OLD.id) THEN RAISE EXCEPTION 'Сначала переназначьте подчинённых'; END IF;
  IF NEW.position_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.position_id IS DISTINCT FROM OLD.position_id) AND NOT EXISTS (
    SELECT 1 FROM public.positions WHERE id=NEW.position_id AND is_active IS TRUE
  ) THEN RAISE EXCEPTION 'Должность неактивна'; END IF;
  IF NEW.reports_to_membership_id IS NOT NULL THEN
    SELECT * INTO supervisor FROM public.department_members WHERE id=NEW.reports_to_membership_id;
    IF supervisor.id IS NULL OR supervisor.user_id=NEW.user_id OR supervisor.department_id<>NEW.department_id
      OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=supervisor.user_id AND is_active IS TRUE) THEN
      RAISE EXCEPTION 'Выберите назначение другого активного сотрудника этого отдела';
    END IF;
    IF EXISTS(WITH RECURSIVE chain AS (
      SELECT m.id,m.reports_to_membership_id,ARRAY[m.id] AS seen FROM public.department_members m WHERE m.id=NEW.reports_to_membership_id
      UNION ALL SELECT m.id,m.reports_to_membership_id,c.seen || m.id FROM public.department_members m JOIN chain c ON m.id=c.reports_to_membership_id WHERE NOT m.id=ANY(c.seen)
    ) SELECT 1 FROM chain WHERE id=NEW.id OR reports_to_membership_id=NEW.id) THEN RAISE EXCEPTION 'Цикл подчинения запрещён'; END IF;
    NEW.reports_to_user_id := supervisor.user_id;
  ELSIF TG_OP='INSERT' OR NEW.reports_to_membership_id IS DISTINCT FROM OLD.reports_to_membership_id THEN
    NEW.reports_to_user_id := NULL;
  ELSIF NEW.reports_to_user_id IS DISTINCT FROM OLD.reports_to_user_id THEN
    RAISE EXCEPTION 'Выберите конкретное назначение руководителя';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER organization_validate_member BEFORE INSERT OR UPDATE ON public.department_members
FOR EACH ROW EXECUTE FUNCTION private.organization_validate_member();

CREATE FUNCTION private.organization_sync_head() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_department_id uuid; head_id uuid;
BEGIN
  v_department_id := CASE WHEN TG_OP='DELETE' THEN OLD.department_id ELSE NEW.department_id END;
  IF (SELECT count(DISTINCT m.user_id) FROM public.department_members m WHERE m.department_id=v_department_id AND m.is_department_head) > 1 THEN
    RAISE EXCEPTION 'У отдела может быть только один руководитель';
  END IF;
  SELECT m.user_id INTO head_id FROM public.department_members m WHERE m.department_id=v_department_id AND m.is_department_head ORDER BY m.id LIMIT 1;
  UPDATE public.departments SET head_user_id=head_id WHERE id=v_department_id AND head_user_id IS DISTINCT FROM head_id;
  IF TG_OP='UPDATE' AND OLD.department_id<>NEW.department_id THEN
    UPDATE public.departments d SET head_user_id=(SELECT m.user_id FROM public.department_members m WHERE m.department_id=d.id AND m.is_department_head ORDER BY m.id LIMIT 1) WHERE d.id=OLD.department_id;
  END IF;
  RETURN NULL;
END;
$function$;
CREATE TRIGGER organization_sync_head AFTER INSERT OR UPDATE OR DELETE ON public.department_members
FOR EACH ROW EXECUTE FUNCTION private.organization_sync_head();

CREATE FUNCTION private.organization_validate_department() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE canonical_head uuid;
BEGIN
  PERFORM 1 FROM public.organization_revision WHERE singleton FOR UPDATE;
  SELECT m.user_id INTO canonical_head FROM public.department_members m WHERE m.department_id=NEW.id AND m.is_department_head ORDER BY m.id LIMIT 1;
  IF TG_OP='UPDATE' AND OLD.name IN ('Финансовый отдел','Отдел планирования','Технический отдел','Брокерский','Снабжение') AND NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'Название отдела используется в автоматических процессах и требует отдельного переноса маршрутизации';
  END IF;
  IF NEW.head_user_id IS DISTINCT FROM canonical_head THEN RAISE EXCEPTION 'Руководитель меняется через назначение сотрудника'; END IF;
  IF NEW.parent_id=NEW.id THEN RAISE EXCEPTION 'Цикл отделов запрещён'; END IF;
  IF NEW.parent_id IS NOT NULL AND EXISTS(WITH RECURSIVE parents AS (
    SELECT d.id,d.parent_id,ARRAY[d.id] AS seen FROM public.departments d WHERE d.id=NEW.parent_id
    UNION ALL SELECT d.id,d.parent_id,p.seen || d.id FROM public.departments d JOIN parents p ON d.id=p.parent_id WHERE NOT d.id=ANY(p.seen)
  ) SELECT 1 FROM parents WHERE id=NEW.id OR parent_id=NEW.id) THEN RAISE EXCEPTION 'Цикл отделов запрещён'; END IF;
  IF NEW.is_active IS FALSE AND (EXISTS(SELECT 1 FROM public.department_members m JOIN public.users u ON u.id=m.user_id WHERE m.department_id=NEW.id AND u.is_active IS TRUE)
    OR EXISTS(SELECT 1 FROM public.departments d WHERE d.parent_id=NEW.id AND d.is_active IS TRUE)) THEN
    RAISE EXCEPTION 'Перед архивированием перенесите сотрудников и подотделы';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER organization_validate_department BEFORE INSERT OR UPDATE ON public.departments
FOR EACH ROW EXECUTE FUNCTION private.organization_validate_department();

CREATE FUNCTION private.organization_validate_position() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NEW.is_active IS FALSE AND EXISTS(SELECT 1 FROM public.department_members m JOIN public.users u ON u.id=m.user_id WHERE m.position_id=NEW.id AND u.is_active IS TRUE) THEN
    RAISE EXCEPTION 'Перед архивированием перенесите сотрудников с этой должности';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER organization_validate_position BEFORE UPDATE ON public.positions
FOR EACH ROW EXECUTE FUNCTION private.organization_validate_position();

CREATE FUNCTION private.organization_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE previous jsonb; next_value jsonb; entity_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN previous:=to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN next_value:=to_jsonb(NEW); END IF;
  IF previous IS NOT DISTINCT FROM next_value THEN RETURN NULL; END IF;
  entity_id:=coalesce(next_value->>'id',previous->>'id',next_value->>'user_id',previous->>'user_id')::uuid;
  INSERT INTO public.organization_audit_log(actor_id,entity_type,entity_id,action,before_data,after_data)
  VALUES(auth.uid(),TG_TABLE_NAME,entity_id,TG_OP,previous,next_value);
  RETURN NULL;
END;
$function$;
DO $triggers$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','departments','positions','department_members','user_system_roles'] LOOP
    EXECUTE format('CREATE TRIGGER organization_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.organization_audit()',t);
  END LOOP;
END;
$triggers$;
DROP POLICY organization_audit_read ON public.organization_audit_log;
CREATE POLICY organization_audit_read ON public.organization_audit_log FOR SELECT TO authenticated
USING (private.crm_has_permission('admin_users','view') OR (entity_type IN ('departments','positions','department_members') AND private.crm_has_permission('departments','view')));

CREATE FUNCTION public.crm_change_organization(p_kind text,p_id uuid,p_data jsonb,p_expected_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE result_id uuid; member public.department_members%ROWTYPE; target_user uuid; v_department_id uuid; target_member uuid;
BEGIN
  PERFORM private.organization_assert_version(p_expected_version);
  IF NOT private.crm_has_permission(CASE WHEN p_kind IN ('profile','user') THEN 'admin_users' ELSE 'departments' END,'manage') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE='42501';
  END IF;
  result_id:=coalesce(p_id,gen_random_uuid());
  CASE p_kind
  WHEN 'profile' THEN
    IF p_data ? 'is_active' OR p_data ? 'role' OR p_data ? 'is_admin' THEN RAISE EXCEPTION 'Статус доступа меняется отдельной командой'; END IF;
    IF p_data ? 'full_name' AND coalesce(length(trim(p_data->>'full_name')),0)<2 THEN RAISE EXCEPTION 'Укажите имя'; END IF;
    UPDATE public.users SET full_name=coalesce(p_data->>'full_name',full_name),
      telegram_chat_id=CASE WHEN p_data ? 'telegram_chat_id' THEN nullif(trim(p_data->>'telegram_chat_id'),'') ELSE telegram_chat_id END,
      factory_id=CASE WHEN p_data ? 'factory_id' THEN nullif(p_data->>'factory_id','')::uuid ELSE factory_id END
    WHERE id=p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Пользователь не найден'; END IF;
  WHEN 'user' THEN
    IF coalesce(length(trim(p_data->>'full_name')),0)<2 OR coalesce(p_data->>'email','') !~ '^[^@]+@[^@]+$' THEN RAISE EXCEPTION 'Укажите имя и email'; END IF;
    IF p_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_id) THEN RAISE EXCEPTION 'Аккаунт авторизации не создан'; END IF;
    INSERT INTO public.users(id,email,full_name,role,is_active,factory_id,telegram_chat_id)
    VALUES(p_id,p_data->>'email',p_data->>'full_name','engineer',true,nullif(p_data->>'factory_id','')::uuid,nullif(p_data->>'telegram_chat_id',''));
    IF coalesce((p_data->>'is_department_head')::boolean,false) THEN
      UPDATE public.department_members SET is_department_head=false WHERE department_id=(p_data->>'department_id')::uuid AND is_department_head;
    END IF;
    INSERT INTO public.department_members(user_id,department_id,position_id,is_primary,is_department_head,reports_to_membership_id,created_by)
    VALUES(p_id,(p_data->>'department_id')::uuid,(p_data->>'position_id')::uuid,true,coalesce((p_data->>'is_department_head')::boolean,false),nullif(p_data->>'reports_to_membership_id','')::uuid,auth.uid());
  WHEN 'department' THEN
    IF p_data ? 'head_user_id' THEN RAISE EXCEPTION 'Выберите руководящее назначение'; END IF;
    IF (p_id IS NULL OR p_data ? 'name') AND coalesce(length(trim(p_data->>'name')),0)<2 THEN RAISE EXCEPTION 'Укажите название отдела'; END IF;
    IF p_id IS NULL THEN
      INSERT INTO public.departments(id,name,description,parent_id,factory_id,created_by)
      VALUES(result_id,trim(p_data->>'name'),p_data->>'description',nullif(p_data->>'parent_id','')::uuid,nullif(p_data->>'factory_id','')::uuid,auth.uid());
    ELSE
      UPDATE public.departments SET name=coalesce(trim(p_data->>'name'),name),description=CASE WHEN p_data ? 'description' THEN p_data->>'description' ELSE description END,
        parent_id=CASE WHEN p_data ? 'parent_id' THEN nullif(p_data->>'parent_id','')::uuid ELSE parent_id END,
        factory_id=CASE WHEN p_data ? 'factory_id' THEN nullif(p_data->>'factory_id','')::uuid ELSE factory_id END,
        is_active=coalesce((p_data->>'is_active')::boolean,is_active) WHERE id=p_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Отдел не найден'; END IF;
    END IF;
  WHEN 'position' THEN
    IF (p_id IS NULL OR p_data ? 'name') AND coalesce(length(trim(p_data->>'name')),0)<2 THEN RAISE EXCEPTION 'Укажите название должности'; END IF;
    IF p_id IS NULL THEN
      INSERT INTO public.positions(id,name,description,level,created_by) VALUES(result_id,trim(p_data->>'name'),p_data->>'description',coalesce((p_data->>'level')::int,0),auth.uid());
    ELSE
      UPDATE public.positions SET name=coalesce(trim(p_data->>'name'),name),description=CASE WHEN p_data ? 'description' THEN p_data->>'description' ELSE description END,
        level=coalesce((p_data->>'level')::int,level),is_active=coalesce((p_data->>'is_active')::boolean,is_active) WHERE id=p_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Должность не найдена'; END IF;
    END IF;
  WHEN 'assignment' THEN
    IF p_id IS NOT NULL THEN SELECT * INTO STRICT member FROM public.department_members WHERE id=p_id FOR UPDATE; END IF;
    target_user:=coalesce(member.user_id,(p_data->>'user_id')::uuid);
    v_department_id:=coalesce(nullif(p_data->>'department_id','')::uuid,member.department_id);
    IF coalesce((p_data->>'is_primary')::boolean,false) THEN UPDATE public.department_members SET is_primary=false WHERE user_id=target_user AND is_primary AND id<>result_id; END IF;
    IF coalesce((p_data->>'is_department_head')::boolean,false) THEN UPDATE public.department_members SET is_department_head=false WHERE department_members.department_id=v_department_id AND user_id<>target_user AND is_department_head; END IF;
    IF p_id IS NULL THEN
      INSERT INTO public.department_members(id,user_id,department_id,position_id,is_primary,is_department_head,reports_to_membership_id,created_by)
      VALUES(result_id,target_user,v_department_id,nullif(p_data->>'position_id','')::uuid,coalesce((p_data->>'is_primary')::boolean,false),coalesce((p_data->>'is_department_head')::boolean,false),nullif(p_data->>'reports_to_membership_id','')::uuid,auth.uid());
    ELSE
      UPDATE public.department_members SET department_id=v_department_id,
        position_id=CASE WHEN p_data ? 'position_id' THEN nullif(p_data->>'position_id','')::uuid ELSE position_id END,
        is_primary=coalesce((p_data->>'is_primary')::boolean,is_primary),is_department_head=coalesce((p_data->>'is_department_head')::boolean,is_department_head),
        reports_to_membership_id=CASE WHEN p_data ? 'reports_to_membership_id' THEN nullif(p_data->>'reports_to_membership_id','')::uuid ELSE reports_to_membership_id END WHERE id=p_id;
    END IF;
  WHEN 'remove_assignment' THEN
    SELECT * INTO STRICT member FROM public.department_members WHERE id=p_id FOR UPDATE;
    IF member.is_department_head THEN RAISE EXCEPTION 'Сначала назначьте нового руководителя отдела'; END IF;
    IF EXISTS(SELECT 1 FROM public.department_members WHERE reports_to_membership_id=p_id OR (reports_to_membership_id IS NULL AND reports_to_user_id=member.user_id AND department_id=member.department_id)) THEN RAISE EXCEPTION 'Сначала переназначьте подчинённых'; END IF;
    IF member.is_primary AND EXISTS(SELECT 1 FROM public.department_members WHERE user_id=member.user_id AND id<>p_id) THEN RAISE EXCEPTION 'Сначала выберите основное назначение'; END IF;
    DELETE FROM public.department_members WHERE id=p_id;
  WHEN 'head' THEN
    target_member:=(p_data->>'membership_id')::uuid;
    SELECT * INTO STRICT member FROM public.department_members WHERE id=target_member AND department_members.department_id=p_id;
    UPDATE public.department_members SET is_department_head=false WHERE department_members.department_id=p_id AND user_id<>member.user_id AND is_department_head;
    UPDATE public.department_members SET is_department_head=true WHERE id=target_member;
  ELSE RAISE EXCEPTION 'Неизвестная операция структуры';
  END CASE;
  RETURN jsonb_build_object('id',result_id,'version',(SELECT version::text FROM public.organization_revision WHERE singleton));
END;
$function$;

-- All application writes now go through versioned commands. Authenticated clients
-- cannot bypass validation by updating the organization tables directly.
REVOKE INSERT, UPDATE, DELETE ON public.departments, public.positions, public.department_members, public.users, public.department_access_permissions FROM authenticated;
REVOKE ALL ON FUNCTION private.organization_validate_member(),private.organization_sync_head(),private.organization_validate_department(),private.organization_validate_position(),private.organization_audit() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.crm_change_organization(text,uuid,jsonb,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_change_organization(text,uuid,jsonb,bigint) TO authenticated;
COMMIT;
