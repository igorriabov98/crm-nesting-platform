-- Explicit supervisor clearing, duplicate-aware transfers, reversible account removal.
-- Existing users, assignments and matrix grants are not rewritten.
ALTER TABLE public.users ADD COLUMN archived_at timestamptz;
ALTER TABLE public.users ADD CONSTRAINT archived_user_inactive CHECK (archived_at IS NULL OR is_active IS NOT TRUE);
ALTER TABLE public.user_auth_sync ADD COLUMN desired_email text;
CREATE OR REPLACE FUNCTION private.organization_validate_member() RETURNS trigger
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
  ELSIF NEW.reports_to_user_id IS DISTINCT FROM OLD.reports_to_user_id AND NEW.reports_to_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Выберите конкретное назначение руководителя';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_change_organization(p_kind text,p_id uuid,p_data jsonb,p_expected_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE result_id uuid; member public.department_members%ROWTYPE; target_user uuid; v_department_id uuid; target_member uuid; duplicate_id uuid; target_position uuid;
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
    IF p_data ? 'email' THEN
      IF EXISTS(SELECT 1 FROM public.user_system_roles WHERE user_id=p_id) AND NOT public.crm_user_is_admin(auth.uid()) THEN RAISE EXCEPTION 'Email администратора меняет только администратор CRM'; END IF;
      IF coalesce(trim(p_data->>'email'),'') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'Укажите корректный email'; END IF;
      IF EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=lower(trim(p_data->>'email')) AND id<>p_id)
        OR EXISTS(SELECT 1 FROM public.users WHERE lower(email)=lower(trim(p_data->>'email')) AND id<>p_id) THEN RAISE EXCEPTION 'Этот email уже используется другим пользователем'; END IF;
      UPDATE public.users SET email=lower(trim(p_data->>'email')) WHERE id=p_id AND email IS DISTINCT FROM lower(trim(p_data->>'email'));
    END IF;
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
    target_position:=CASE WHEN p_data ? 'position_id' THEN nullif(p_data->>'position_id','')::uuid ELSE member.position_id END;
    SELECT id INTO duplicate_id FROM public.department_members WHERE user_id=target_user AND department_id=v_department_id
      AND position_id IS NOT DISTINCT FROM target_position AND id<>result_id;
    IF duplicate_id IS NOT NULL THEN RAISE EXCEPTION 'Такое назначение уже есть в выбранном отделе. Объедините назначения или выберите другую должность.'; END IF;
    IF coalesce((p_data->>'is_primary')::boolean,false) THEN UPDATE public.department_members SET is_primary=false WHERE user_id=target_user AND is_primary AND id<>result_id; END IF;
    IF coalesce((p_data->>'is_department_head')::boolean,false) THEN UPDATE public.department_members SET is_department_head=false WHERE department_members.department_id=v_department_id AND user_id<>target_user AND is_department_head; END IF;
    IF p_id IS NULL THEN
      INSERT INTO public.department_members(id,user_id,department_id,position_id,is_primary,is_department_head,reports_to_membership_id,created_by)
      VALUES(result_id,target_user,v_department_id,nullif(p_data->>'position_id','')::uuid,coalesce((p_data->>'is_primary')::boolean,false),coalesce((p_data->>'is_department_head')::boolean,false),nullif(p_data->>'reports_to_membership_id','')::uuid,auth.uid());
    ELSE
      UPDATE public.department_members SET department_id=v_department_id,
        position_id=CASE WHEN p_data ? 'position_id' THEN nullif(p_data->>'position_id','')::uuid ELSE position_id END,
        is_primary=coalesce((p_data->>'is_primary')::boolean,is_primary),is_department_head=coalesce((p_data->>'is_department_head')::boolean,is_department_head),
        reports_to_user_id=CASE WHEN p_data ? 'reports_to_membership_id' AND nullif(p_data->>'reports_to_membership_id','') IS NULL THEN NULL ELSE reports_to_user_id END,
        reports_to_membership_id=CASE WHEN p_data ? 'reports_to_membership_id' THEN nullif(p_data->>'reports_to_membership_id','')::uuid ELSE reports_to_membership_id END WHERE id=p_id;
    END IF;
  WHEN 'consolidate_assignment' THEN
    SELECT * INTO STRICT member FROM public.department_members WHERE id=p_id FOR UPDATE;
    SELECT id INTO target_member FROM public.department_members WHERE id=(p_data->>'target_membership_id')::uuid AND user_id=member.user_id AND id<>p_id FOR UPDATE;
    IF target_member IS NULL THEN RAISE EXCEPTION 'Выберите существующее назначение этого пользователя'; END IF;
    IF member.is_department_head THEN RAISE EXCEPTION 'Сначала назначьте нового руководителя исходного отдела'; END IF;
    IF EXISTS(SELECT 1 FROM public.department_members WHERE reports_to_membership_id=p_id OR (reports_to_membership_id IS NULL AND reports_to_user_id=member.user_id)) THEN RAISE EXCEPTION 'Сначала уточните и переназначьте подчинённых'; END IF;
    DELETE FROM public.department_members WHERE id=p_id;
    IF member.is_primary THEN UPDATE public.department_members SET is_primary=true WHERE id=target_member; END IF;
    result_id:=target_member;
  WHEN 'remove_assignment' THEN
    SELECT * INTO STRICT member FROM public.department_members WHERE id=p_id FOR UPDATE;
    IF member.is_department_head THEN RAISE EXCEPTION 'Сначала назначьте нового руководителя отдела'; END IF;
    IF EXISTS(SELECT 1 FROM public.department_members WHERE reports_to_membership_id=p_id OR (reports_to_membership_id IS NULL AND reports_to_user_id=member.user_id)) THEN RAISE EXCEPTION 'Сначала переназначьте подчинённых'; END IF;
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

CREATE OR REPLACE FUNCTION private.organization_guard_user_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  PERFORM 1 FROM public.organization_revision WHERE singleton FOR UPDATE;
  IF NEW.is_active IS TRUE THEN NEW.archived_at:=NULL; END IF;
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

CREATE OR REPLACE FUNCTION private.organization_queue_auth_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF TG_OP='UPDATE' AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active AND NEW.email IS NOT DISTINCT FROM OLD.email THEN RETURN NULL; END IF;
  INSERT INTO public.user_auth_sync(user_id,desired_active,desired_email) VALUES(NEW.id,NEW.is_active IS TRUE,NEW.email)
  ON CONFLICT(user_id) DO UPDATE SET desired_active=EXCLUDED.desired_active,desired_email=EXCLUDED.desired_email,generation=gen_random_uuid(),attempts=0,last_error=NULL,requested_at=now(),synced_at=NULL;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_organization_snapshot() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE can_users boolean; can_departments boolean;
BEGIN
  can_users:=private.crm_has_permission('admin_users','view');
  can_departments:=private.crm_has_permission('departments','view');
  IF NOT can_users AND NOT can_departments THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'version',(SELECT version::text FROM public.organization_revision WHERE singleton),
    'users',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'full_name',u.full_name,'email',CASE WHEN can_users THEN u.email ELSE NULL END,
      'factory_id',u.factory_id,'telegram_chat_id',CASE WHEN can_users THEN u.telegram_chat_id ELSE NULL END,'is_active',u.is_active,'archived_at',u.archived_at,
      'is_admin',EXISTS(SELECT 1 FROM public.user_system_roles WHERE user_id=u.id),
      'auth_sync_pending',EXISTS(SELECT 1 FROM public.user_auth_sync WHERE user_id=u.id AND synced_at IS NULL)) ORDER BY u.full_name),'[]'::jsonb) FROM public.users u),
    'departments',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.sort_order,d.name),'[]'::jsonb) FROM public.departments d),
    'positions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.level DESC,p.name),'[]'::jsonb) FROM public.positions p),
    'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.joined_at,m.id),'[]'::jsonb) FROM public.department_members m),
    'factories',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) ORDER BY f.name),'[]'::jsonb) FROM public.factories f)
  );
END;
$function$;


CREATE FUNCTION private.organization_guard_archive() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
  IF NEW.archived_at IS NOT NULL THEN
    PERFORM 1 FROM public.organization_revision WHERE singleton FOR UPDATE;
    IF NOT private.crm_has_permission('admin_users','manage') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE='42501'; END IF;
    IF auth.uid()=NEW.id THEN RAISE EXCEPTION 'Нельзя удалить собственный аккаунт'; END IF;
    IF EXISTS(SELECT 1 FROM public.user_system_roles WHERE user_id=NEW.id) AND NOT public.crm_user_is_admin(auth.uid()) THEN RAISE EXCEPTION 'Состояние администратора меняет другой администратор'; END IF;
    IF NEW.is_active OR jsonb_array_length(private.organization_obligations(NEW.id))>0 THEN RAISE EXCEPTION 'Сначала передайте обязанности и заблокируйте аккаунт'; END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER organization_guard_archive BEFORE INSERT OR UPDATE OF archived_at ON public.users FOR EACH ROW EXECUTE FUNCTION private.organization_guard_archive();
CREATE FUNCTION public.crm_archive_user(p_user_id uuid,p_expected_version bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
  PERFORM private.organization_assert_version(p_expected_version);
  IF NOT private.crm_has_permission('admin_users','manage') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE='42501'; END IF;
  UPDATE public.users SET is_active=false,archived_at=coalesce(archived_at,now()) WHERE id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Пользователь не найден'; END IF;
END;
$function$;
REVOKE ALL ON FUNCTION private.organization_guard_archive() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.crm_archive_user(uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_archive_user(uuid,bigint) TO authenticated;

DROP TRIGGER organization_queue_auth_sync ON public.users;
CREATE TRIGGER organization_queue_auth_sync AFTER INSERT OR UPDATE OF is_active,email ON public.users FOR EACH ROW EXECUTE FUNCTION private.organization_queue_auth_sync();
