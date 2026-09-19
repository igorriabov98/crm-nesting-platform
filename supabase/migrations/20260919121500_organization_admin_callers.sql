-- Preserve business rules while replacing all title-based administrator checks.

CREATE OR REPLACE FUNCTION public.consumables_is_crm_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT public.crm_user_is_admin(auth.uid()); $function$;

CREATE OR REPLACE FUNCTION public.fn_can_process_returned_supply_position(p_actor uuid, p_assigned_to uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.users app_user
    where app_user.id = p_actor
      and coalesce(app_user.is_active, true)
      and (
        app_user.id = p_assigned_to
        or app_user.role::text in ('planning_director', 'financial_director', 'commercial_director')
        or public.crm_user_is_admin(app_user.id)
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.file_archive_manager_user_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT id FROM public.users WHERE private.crm_subject_permission(id, 'file_archive_settings', 'manage'); $function$;

CREATE OR REPLACE FUNCTION public.fn_user_can_manage_client_prices(p_actor uuid, p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users actor
    JOIN public.clients client ON client.id = p_client_id
    WHERE actor.id = p_actor
      AND actor.is_active IS TRUE
      AND (
        public.crm_user_is_admin(actor.id)
        OR (
          EXISTS (
            SELECT 1
            FROM public.department_members sales_member
            JOIN public.department_access_permissions sales_permission
              ON sales_permission.department_id = sales_member.department_id
             AND sales_permission.subject_scope = CASE WHEN sales_member.is_department_head THEN 'head' ELSE 'member' END
            WHERE sales_member.user_id = actor.id
              AND sales_permission.resource_key = 'sales_plan'
              AND sales_permission.can_manage
          )
          AND EXISTS (
            SELECT 1
            FROM public.department_members price_member
            JOIN public.department_access_permissions price_permission
              ON price_permission.department_id = price_member.department_id
             AND price_permission.subject_scope = CASE WHEN price_member.is_department_head THEN 'head' ELSE 'member' END
            WHERE price_member.user_id = actor.id
              AND price_permission.resource_key = 'client_prices'
              AND price_permission.can_manage
              AND (
                price_permission.company_manage_scope = 'all'
                OR client.responsible_user_id = actor.id
              )
          )
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_submit_machine_discount_request(p_machine_id uuid, p_discount_percent numeric, p_reason text, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_machine public.machines%rowtype;
  v_snapshot jsonb;
  v_goods numeric(14,2);
  v_expenses numeric(14,2);
  v_discount numeric(14,2);
  v_revision integer;
  v_request_id uuid;
  v_recipients uuid[];
  v_recipient uuid;
begin
  if p_discount_percent is null or p_discount_percent < 0.01 or p_discount_percent > 50 then raise exception 'Скидка должна быть от 0,01 до 50%%'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Укажите причину скидки'; end if;
  select * into v_machine from public.machines where id = p_machine_id for update;
  if not found or v_machine.client_id is null then raise exception 'Заказ не найден'; end if;
  if not public.fn_user_can_manage_client_prices(p_actor, v_machine.client_id) then raise exception 'Недостаточно прав для запроса скидки'; end if;
  if coalesce(v_machine.is_archived, false) then raise exception 'Заказ находится в архиве'; end if;
  if exists (select 1 from public.invoices invoice where invoice.machine_id = p_machine_id and invoice.cancelled_at is null) then raise exception 'Сначала аннулируйте активный инвойс'; end if;
  if exists (select 1 from public.machine_discount_requests request where request.machine_id = p_machine_id and request.status = 'pending') then raise exception 'Скидка уже ожидает согласования'; end if;

  v_snapshot := public.fn_machine_discount_items_snapshot(p_machine_id);
  if jsonb_array_length(v_snapshot) = 0 then raise exception 'В заказе нет изделий'; end if;
  select round(coalesce(sum(item.price::numeric * item.quantity), 0), 2) into v_goods
  from public.machine_items item where item.machine_id = p_machine_id and not coalesce(item.is_sample, false);
  select round(coalesce(sum(expense.amount::numeric), 0), 2) into v_expenses
  from public.machine_expenses expense where expense.machine_id = p_machine_id;
  v_discount := round(v_goods * p_discount_percent / 100, 2);

  perform public.fn_supersede_machine_discount(p_machine_id, 'Создана новая заявка на скидку');
  select coalesce(max(request.revision_number), 0) + 1 into v_revision
  from public.machine_discount_requests request where request.machine_id = p_machine_id;

  select coalesce(array_agg(app_user.id order by app_user.id), '{}'::uuid[]) into v_recipients
  from public.users app_user where app_user.is_active and app_user.role = 'financial_director';
  if cardinality(v_recipients) = 0 then
    select coalesce(array_agg(distinct app_user.id order by app_user.id), '{}'::uuid[]) into v_recipients
    from public.users app_user where public.crm_user_is_admin(app_user.id);
  end if;
  if cardinality(v_recipients) = 0 then raise exception 'Нет активного финансового директора или администратора CRM'; end if;

  insert into public.machine_discount_requests(
    machine_id, revision_number, status, discount_percent, reason, items_snapshot,
    items_total_before_discount, discount_amount, discounted_items_total, expenses_total,
    total_before_discount, total_after_discount, submitted_by
  ) values (
    p_machine_id, v_revision, 'pending', round(p_discount_percent, 2), btrim(p_reason), v_snapshot,
    v_goods, v_discount, v_goods - v_discount, v_expenses,
    v_goods + v_expenses, v_goods - v_discount + v_expenses, p_actor
  ) returning id into v_request_id;

  foreach v_recipient in array v_recipients loop
    insert into public.tasks(machine_id, assigned_to, task_type, title, description, status, start_date, deadline, machine_discount_request_id)
    values (
      p_machine_id, v_recipient, 'order_discount_approval', 'Согласовать скидку на заказ',
      'Заказ «' || coalesce(v_machine.name, 'Без названия') || '», скидка ' || round(p_discount_percent, 2) || '%',
      'pending', (now() at time zone 'Europe/Kyiv')::date, (now() at time zone 'Europe/Kyiv')::date, v_request_id
    );
  end loop;
  return v_request_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_user_can_decide_machine_discount(p_actor uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users actor
    WHERE actor.id = p_actor
      AND actor.is_active IS TRUE
      AND (
        public.crm_user_is_admin(actor.id)
        OR (
          EXISTS (
            SELECT 1
            FROM public.department_members sales_member
            JOIN public.department_access_permissions sales_permission
              ON sales_permission.department_id = sales_member.department_id
             AND sales_permission.subject_scope = CASE WHEN sales_member.is_department_head THEN 'head' ELSE 'member' END
            WHERE sales_member.user_id = actor.id
              AND sales_permission.resource_key = 'sales_plan'
              AND sales_permission.can_manage
          )
          AND EXISTS (
            SELECT 1
            FROM public.department_members price_member
            JOIN public.department_access_permissions price_permission
              ON price_permission.department_id = price_member.department_id
             AND price_permission.subject_scope = CASE WHEN price_member.is_department_head THEN 'head' ELSE 'member' END
            WHERE price_member.user_id = actor.id
              AND price_permission.resource_key = 'client_prices'
              AND price_permission.can_manage
              AND price_permission.company_manage_scope = 'all'
          )
        )
      )
  );
$function$;
