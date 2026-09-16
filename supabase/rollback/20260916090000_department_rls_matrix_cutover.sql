-- Operator-confirmed rollback for 20260916090000 only.
-- policy-snapshot-sha256: cecf8e44145872742dd3ec36921d2aec2530af4d5649031b62daa27fd2cd1726
-- function-snapshot-sha256: 3450479ca00b74472a075f439b11ab75efa7f0aa268dd514410a67af23c460f8
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SELECT pg_advisory_xact_lock(hashtextextended('crm:department-rls-matrix-cutover:v1', 0));

DO $locks$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'app_settings',
    'business_scrap_correction_holds',
    'business_scrap_correction_items',
    'business_scrap_correction_requests',
    'consumable_balances',
    'consumable_categories',
    'consumable_movements',
    'consumable_request_events',
    'consumable_request_receipts',
    'consumable_requests',
    'consumables',
    'contracts',
    'department_request_attachments',
    'department_request_events',
    'department_request_mail_messages',
    'department_request_mail_threads',
    'department_requests',
    'detailing_balances',
    'detailing_consumption_events',
    'detailing_consumption_items',
    'detailing_movements',
    'detailing_part_product_versions',
    'detailing_part_products',
    'detailing_parts',
    'detailing_request_checks',
    'detailing_reservation_allocations',
    'detailing_reservations',
    'detailing_transfer_items',
    'detailing_transfers',
    'employee_assignments',
    'employee_rates',
    'employee_vacations',
    'employees',
    'factory_zinc_outsourcing_defaults',
    'finance_budget_limits',
    'finance_event_actions',
    'finance_expense_series',
    'finance_expenses',
    'finance_settings',
    'finance_telegram_dialog_states',
    'finance_telegram_notifications',
    'finance_telegram_recipients',
    'inventory',
    'inventory_reservations',
    'inventory_transactions',
    'inventory_transfer_items',
    'inventory_transfers',
    'invoices',
    'machine_chat_mentions',
    'machine_chat_messages',
    'machine_expenses',
    'machine_item_nesting_runs',
    'machine_items',
    'machine_layout_requests',
    'machine_outsourcing_operation_items',
    'machine_outsourcing_operations',
    'machine_outsourcing_transport_needs',
    'machine_outsourcing_transport_orders',
    'machine_outsourcing_vrb_items',
    'machine_outsourcing_vrb_receipts',
    'machine_packing_groups',
    'machine_updates',
    'machines',
    'mail_messages',
    'mail_threads',
    'material_variants',
    'materials',
    'meeting_action_items',
    'meeting_agenda_items',
    'meeting_agenda_pool_items',
    'meeting_attendees',
    'meeting_decisions',
    'meeting_external_attendees',
    'meeting_question_events',
    'meeting_question_meeting_history',
    'meeting_question_members',
    'meeting_question_outcomes',
    'meeting_question_task_links',
    'meeting_question_templates',
    'meeting_questions',
    'meeting_recurrence_rules',
    'meeting_rule_versions',
    'meeting_rules',
    'meeting_schedule_exceptions',
    'meeting_schedule_versions',
    'meeting_system_rollout_events',
    'meeting_telegram_reminders',
    'meeting_template_participants',
    'meeting_template_questions',
    'meeting_templates',
    'meeting_types',
    'meetings',
    'nesting_batch_items',
    'nesting_batches',
    'nesting_precut_parts',
    'product_files',
    'product_project_files',
    'product_project_mail_messages',
    'product_project_mail_threads',
    'product_project_versions',
    'product_projects',
    'product_versions',
    'production_fact_sections',
    'production_machine_facts',
    'production_machine_item_facts',
    'production_month_plans',
    'production_plan_date_change_request_items',
    'production_plan_date_change_requests',
    'production_stage_intervals',
    'production_stages',
    'production_tonnage_facts',
    'products',
    'request_chain_cord',
    'request_circle',
    'request_components',
    'request_knives',
    'request_mesh',
    'request_paint',
    'request_pipe',
    'request_round_tube',
    'request_sheet_metal',
    'role_permission_audit_log',
    'role_permissions',
    'steel_types',
    'supplier_delivery_days',
    'supplier_material_categories',
    'suppliers',
    'supply_items',
    'supply_order_delivery_schedule_changes',
    'supply_order_delivery_schedules',
    'supply_position_revisions',
    'task_delegations',
    'tasks',
    'technologist_request_approval_versions',
    'technologist_requests',
    'transport_trip_date_change_items',
    'transport_trip_date_change_requests',
    'transport_trip_need_links',
    'transport_trip_stops',
    'users'
  ] LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', v_table);
  END LOOP;
END;
$locks$;

CREATE OR REPLACE FUNCTION public.can_claim_machine_layout_request(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.users app_user
    where app_user.id = p_user_id
      and coalesce(app_user.is_active, true)
      and lower(concat_ws(' ', app_user.full_name, app_user.email)) !~
        '(^|[[:space:]])(ci[[:space:]]+)?smoke([[:space:]]|$)|smoke[-_.+@]'
      and (
        app_user.role in ('technologist', 'engineer')
        or exists (
          select 1
          from public.department_members member
          join public.departments department on department.id = member.department_id
          left join public.positions position on position.id = member.position_id
          where member.user_id = app_user.id
            and department.is_active
            and concat_ws(' ', department.name, position.name) ~ '(Т|т)ехнолог|[Tt]echnolog'
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_department_request_target(p_target_department text, p_factory_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with current_access as (
    select
      public.get_user_role()::text as role_name,
      public.get_user_factory_id() as factory_id
  )
  select
    case
      when access.role_name in ('financial_director', 'commercial_director', 'planning_director')
        then true
      when p_target_department = 'technologist'
        and access.role_name in ('engineer', 'technologist')
        then true
      when p_target_department = 'supply'
        and access.role_name in ('supply_manager', 'procurement_head')
        then true
      when p_target_department = 'production'
        and access.role_name in ('production_manager', 'painting_head')
        and (p_factory_id is null or p_factory_id = access.factory_id)
        then true
      when p_target_department = 'planning'
        and access.role_name = 'planning_director'
        then true
      else exists (
        select 1
        from public.department_members member
        join public.departments department on department.id = member.department_id
        where member.user_id = (select auth.uid())
          and department.is_active
          and (
            (p_target_department = 'technologist'
              and (lower(department.name) like '%техническ%' or lower(department.name) like '%технолог%'))
            or (p_target_department = 'supply'
              and (lower(department.name) like '%снабжен%' or lower(department.name) like '%закуп%'))
            or (p_target_department = 'production'
              and (lower(department.name) like '%производств%' or lower(department.name) like '%цех%')
              and (
                p_factory_id is null
                or department.factory_id is null
                or department.factory_id = access.factory_id
              ))
            or (p_target_department = 'planning'
              and (lower(department.name) like '%планирован%' or lower(department.name) like '%planning%'))
          )
      )
    end
  from current_access access;
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_meeting_resource(p_resource_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM public.users u
      JOIN public.role_permissions rp ON rp.role = u.role
      WHERE u.id = auth.uid()
        AND u.is_active IS DISTINCT FROM false
        AND rp.resource_key = p_resource_key
        AND rp.can_manage
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members dm
      JOIN public.department_access_permissions dap
        ON dap.department_id = dm.department_id
       AND dap.subject_scope = CASE WHEN dm.is_department_head THEN 'head' ELSE 'member' END
      WHERE dm.user_id = auth.uid()
        AND dap.resource_key = p_resource_key
        AND dap.can_manage
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members dm
      JOIN public.positions p ON p.id = dm.position_id
      WHERE dm.user_id = auth.uid() AND p.name = 'Администратор CRM'
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_product_projects()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users AS active_actor
    WHERE active_actor.id = auth.uid()
      AND active_actor.is_active IS DISTINCT FROM false
  )
  AND (
    EXISTS (
      SELECT 1
      FROM public.users AS actor
      JOIN public.role_permissions AS permission ON permission.role = actor.role
      WHERE actor.id = auth.uid()
        AND permission.resource_key = 'product_projects'
        AND permission.can_manage
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members AS member
      JOIN public.department_access_permissions AS permission
        ON permission.department_id = member.department_id
       AND permission.subject_scope = CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END
      WHERE member.user_id = auth.uid()
        AND permission.resource_key = 'product_projects'
        AND permission.can_manage
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members AS member
      JOIN public.positions AS position ON position.id = member.position_id
      WHERE member.user_id = auth.uid()
        AND position.name = 'Администратор CRM'
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_view_meeting_resource(p_resource_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM public.users u
      JOIN public.role_permissions rp ON rp.role = u.role
      WHERE u.id = auth.uid()
        AND u.is_active IS DISTINCT FROM false
        AND rp.resource_key = p_resource_key
        AND (rp.can_view OR rp.can_manage)
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members dm
      JOIN public.department_access_permissions dap
        ON dap.department_id = dm.department_id
       AND dap.subject_scope = CASE WHEN dm.is_department_head THEN 'head' ELSE 'member' END
      WHERE dm.user_id = auth.uid()
        AND dap.resource_key = p_resource_key
        AND (dap.can_view OR dap.can_manage)
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members dm
      JOIN public.positions p ON p.id = dm.position_id
      WHERE dm.user_id = auth.uid() AND p.name = 'Администратор CRM'
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_view_product_projects()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users AS active_actor
    WHERE active_actor.id = auth.uid()
      AND active_actor.is_active IS DISTINCT FROM false
  )
  AND (
    EXISTS (
      SELECT 1
      FROM public.users AS actor
      JOIN public.role_permissions AS permission ON permission.role = actor.role
      WHERE actor.id = auth.uid()
        AND permission.resource_key = 'product_projects'
        AND (permission.can_view OR permission.can_manage)
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members AS member
      JOIN public.department_access_permissions AS permission
        ON permission.department_id = member.department_id
       AND permission.subject_scope = CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END
      WHERE member.user_id = auth.uid()
        AND permission.resource_key = 'product_projects'
        AND (permission.can_view OR permission.can_manage)
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members AS member
      JOIN public.positions AS position ON position.id = member.position_id
      WHERE member.user_id = auth.uid()
        AND position.name = 'Администратор CRM'
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.check_supply_items_column_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();

  -- Директора могут менять всё, проверка не требуется
  IF v_role IN ('planning_director', 'financial_director', 'commercial_director') THEN
    RETURN NEW;
  END IF;
  -- ИНЖЕНЕР может менять только engineer_confirmation
  IF v_role = 'engineer' THEN
    IF NEW.nomenclature IS DISTINCT FROM OLD.nomenclature OR
       NEW.unit IS DISTINCT FROM OLD.unit OR
       NEW.quantity IS DISTINCT FROM OLD.quantity OR
       NEW.supplier IS DISTINCT FROM OLD.supplier OR
       NEW.price_per_unit IS DISTINCT FROM OLD.price_per_unit OR
       NEW.status IS DISTINCT FROM OLD.status OR
       NEW.comment IS DISTINCT FROM OLD.comment OR
       NEW.planned_delivery_date IS DISTINCT FROM OLD.planned_delivery_date THEN
      RAISE EXCEPTION 'Инженер имеет право редактировать только поле подтверждения (engineer_confirmation).';
    END IF;
  END IF;
  -- ТЕХНОЛОГ может менять только номенклатуру (nomenclature, unit, quantity)
  IF v_role = 'technologist' THEN
    IF NEW.engineer_confirmation IS DISTINCT FROM OLD.engineer_confirmation OR
       NEW.supplier IS DISTINCT FROM OLD.supplier OR
       NEW.price_per_unit IS DISTINCT FROM OLD.price_per_unit OR
       NEW.status IS DISTINCT FROM OLD.status OR
       NEW.comment IS DISTINCT FROM OLD.comment OR
       NEW.planned_delivery_date IS DISTINCT FROM OLD.planned_delivery_date THEN
      RAISE EXCEPTION 'Технолог имеет право редактировать только номенклатуру, единицы измерения и количество.';
    END IF;
  END IF;
  -- СНАБЖЕНИЕ может менять поставщика, цены и статусы
  IF v_role = 'supply_manager' THEN
    IF NEW.engineer_confirmation IS DISTINCT FROM OLD.engineer_confirmation OR
       NEW.nomenclature IS DISTINCT FROM OLD.nomenclature OR
       NEW.unit IS DISTINCT FROM OLD.unit OR
       NEW.quantity IS DISTINCT FROM OLD.quantity THEN
      RAISE EXCEPTION 'Снабжение не может редактировать номенклатуру инженера/технолога.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consumables_can_adjust_stock()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.is_active = true
      AND (
        u.role::text = 'planning_director'
        OR EXISTS (
          SELECT 1
          FROM public.department_members dm
          JOIN public.departments d ON d.id = dm.department_id
          LEFT JOIN public.positions p ON p.id = dm.position_id
          WHERE dm.user_id = u.id
            AND dm.is_department_head = true
            AND (
              lower(replace(COALESCE(d.name, ''), 'ё', 'е')) LIKE '%планирован%'
              OR lower(replace(COALESCE(p.name, ''), 'ё', 'е')) LIKE '%планирован%'
            )
        )
        OR (
          EXISTS (
            SELECT 1
            FROM public.department_members dm
            JOIN public.positions p ON p.id = dm.position_id
            WHERE dm.user_id = u.id
              AND p.is_active = true
              AND p.name = 'Администратор CRM'
          )
          AND (
            lower(regexp_replace(replace(COALESCE(u.full_name, ''), 'ё', 'е'), '\s+', ' ', 'g')) IN (
              'игорь рябов',
              'игор рябов',
              'igor riabov',
              'ihor riabov'
            )
            OR lower(COALESCE(u.email, '')) LIKE '%igorriabov%'
          )
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.consumables_can_manage_factory(p_factory_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.consumables_is_crm_admin()
    OR CASE public.get_user_role()
      WHEN 'production_manager' THEN public.get_user_factory_id() = p_factory_id
      WHEN 'planning_director' THEN true
      WHEN 'financial_director' THEN true
      WHEN 'commercial_director' THEN true
      ELSE false
    END;
$function$;

CREATE OR REPLACE FUNCTION public.consumables_can_supply_requests()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.consumables_is_crm_admin()
    OR public.get_user_role() IN (
      'supply_manager',
      'procurement_head',
      'planning_director',
      'financial_director',
      'commercial_director'
    );
$function$;

CREATE OR REPLACE FUNCTION public.consumables_can_view_factory(p_factory_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.consumables_is_crm_admin()
    OR CASE public.get_user_role()
      WHEN 'production_manager' THEN public.get_user_factory_id() = p_factory_id
      WHEN 'supply_manager' THEN true
      WHEN 'procurement_head' THEN true
      WHEN 'planning_director' THEN true
      WHEN 'financial_director' THEN true
      WHEN 'commercial_director' THEN true
      ELSE false
    END;
$function$;

CREATE OR REPLACE FUNCTION public.consumables_notify_production(p_factory_id uuid, p_request_id uuid, p_type text, p_title text, p_message text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO notifications(user_id, type, title, message, consumable_request_id)
  SELECT DISTINCT u.id, p_type, p_title, p_message, p_request_id
  FROM users u
  WHERE u.is_active = true
    AND u.factory_id = p_factory_id
    AND u.role = 'production_manager';
$function$;

CREATE OR REPLACE FUNCTION public.consumables_notify_supply(p_request_id uuid, p_type text, p_title text, p_message text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO notifications(user_id, type, title, message, consumable_request_id)
  SELECT u.id, p_type, p_title, p_message, p_request_id
  FROM users u
  WHERE u.is_active = true
    AND u.role IN ('supply_manager', 'procurement_head');
$function$;

CREATE OR REPLACE FUNCTION public.crm_user_has_resource_permission(p_actor uuid, p_resource_key text, p_manage boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH actor AS (
    SELECT app_user.id, app_user.role
    FROM public.users app_user
    WHERE app_user.id = p_actor
      AND app_user.is_active
      AND auth.uid() = p_actor
  ), department_rows AS (
    SELECT permission.resource_key, permission.can_view, permission.can_manage
    FROM actor
    JOIN public.department_members member ON member.user_id = actor.id
    JOIN public.department_access_permissions permission
      ON permission.department_id = member.department_id
     AND permission.subject_scope = CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END
  )
  SELECT EXISTS (
    SELECT 1
    FROM actor
    WHERE public.crm_user_is_admin(actor.id)
      OR EXISTS (
        SELECT 1
        FROM department_rows permission
        WHERE permission.resource_key = p_resource_key
          AND CASE WHEN p_manage
            THEN permission.can_manage
            ELSE permission.can_view OR permission.can_manage
          END
      )
      OR (
        NOT EXISTS (SELECT 1 FROM department_rows)
        AND EXISTS (
          SELECT 1
          FROM public.role_permissions permission
          WHERE permission.role = actor.role
            AND permission.resource_key = p_resource_key
            AND CASE WHEN p_manage
              THEN permission.can_manage
              ELSE permission.can_view OR permission.can_manage
            END
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.detailing_role_allowed(p_roles user_role[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(public.get_user_role() = ANY(p_roles), false);
$function$;

CREATE OR REPLACE FUNCTION public.extend_meeting_schedule_horizon_v2(p_horizon_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inserted integer := 0;
BEGIN
  IF p_horizon_days < 1 OR p_horizon_days > 180 THEN
    RAISE EXCEPTION 'Горизонт должен быть от 1 до 180 дней';
  END IF;

  WITH possible_dates AS (
    SELECT schedule.*, template.name AS template_name,
           template.legacy_type_key, template.facilitator_user_id,
           candidate_date::date AS meeting_date
    FROM public.meeting_schedule_versions schedule
    JOIN public.meeting_templates template ON template.id = schedule.template_id
    CROSS JOIN LATERAL generate_series(
      schedule.start_date::timestamp,
      (CURRENT_DATE + p_horizon_days)::timestamp,
      interval '1 day'
    ) candidate_date
    WHERE schedule.is_active AND template.is_active
      AND candidate_date::date >= schedule.effective_from
      AND (schedule.effective_to IS NULL OR candidate_date::date <= schedule.effective_to)
      AND (schedule.end_date IS NULL OR candidate_date::date <= schedule.end_date)
      AND (
        (schedule.recurrence_kind = 'one_time' AND candidate_date::date = schedule.start_date)
        OR (schedule.recurrence_kind = 'weekly' AND extract(isodow FROM candidate_date)::smallint = ANY(schedule.weekdays))
        OR (schedule.recurrence_kind = 'monthly' AND extract(day FROM candidate_date)::integer = LEAST(
          schedule.month_day,
          extract(day FROM (date_trunc('month', candidate_date) + interval '1 month - 1 day'))::integer
        ))
        OR (schedule.recurrence_kind = 'interval' AND (candidate_date::date - schedule.start_date) % schedule.interval_days = 0)
      )
  ), ranked AS (
    SELECT possible_dates.*,
           row_number() OVER (PARTITION BY id ORDER BY meeting_date) AS occurrence_no
    FROM possible_dates
  ), inserted AS (
    INSERT INTO public.meetings(
      meeting_type, title, meeting_date, meeting_time, status, created_by,
      duration_minutes, template_id, schedule_version_id, facilitator_user_id,
      starts_at, ends_at, occurrence_key
    )
    SELECT legacy_type_key, template_name, meeting_date, start_time, 'planned',
           created_by, duration_minutes, template_id, id, facilitator_user_id,
           (meeting_date + start_time) AT TIME ZONE public.meeting_postgres_timezone_v2(timezone),
           ((meeting_date + start_time) AT TIME ZONE public.meeting_postgres_timezone_v2(timezone)) + make_interval(mins => duration_minutes),
           id::text || ':' || meeting_date::text || ':' || start_time::text
    FROM ranked
    WHERE meeting_date >= CURRENT_DATE
      AND (occurrence_count IS NULL OR occurrence_no <= occurrence_count)
    ON CONFLICT (occurrence_key) DO NOTHING
    RETURNING id, template_id
  ), direct_attendees AS (
    INSERT INTO public.meeting_attendees(meeting_id, user_id)
    SELECT inserted.id, participant.user_id
    FROM inserted
    JOIN public.meeting_template_participants participant
      ON participant.template_id = inserted.template_id
     AND participant.participant_type = 'user'
    ON CONFLICT (meeting_id, user_id) DO NOTHING
  ), role_attendees AS (
    INSERT INTO public.meeting_attendees(meeting_id, user_id)
    SELECT DISTINCT inserted.id, app_user.id
    FROM inserted
    JOIN public.meeting_template_participants participant
      ON participant.template_id = inserted.template_id
     AND participant.participant_type = 'role'
    JOIN public.users app_user ON app_user.role = participant.role AND app_user.is_active
    ON CONFLICT (meeting_id, user_id) DO NOTHING
  ), department_attendees AS (
    INSERT INTO public.meeting_attendees(meeting_id, user_id)
    SELECT DISTINCT inserted.id, member.user_id
    FROM inserted
    JOIN public.meeting_template_participants participant
      ON participant.template_id = inserted.template_id
     AND participant.participant_type = 'department'
    JOIN public.department_members member ON member.department_id = participant.department_id
    ON CONFLICT (meeting_id, user_id) DO NOTHING
  ), external_attendees AS (
    INSERT INTO public.meeting_external_attendees(
      meeting_id, full_name, role_description, email, phone
    )
    SELECT inserted.id, participant.external_name, participant.external_role,
           participant.external_email, participant.external_phone
    FROM inserted
    JOIN public.meeting_template_participants participant
      ON participant.template_id = inserted.template_id
     AND participant.participant_type = 'external'
  ), fixed_questions AS (
    INSERT INTO public.meeting_questions(
      question_template_id, assigned_meeting_id, episode_key, source_type,
      title, description, category, priority, status, condition_active, created_by
    )
    SELECT question_template.id, inserted.id,
           'fixed:' || question_template.id::text || ':' || inserted.id::text,
           'fixed', question_template.title_template, question_template.description_template,
           question_template.category, question_template.priority, 'assigned', true, NULL
    FROM inserted
    JOIN public.meeting_template_questions template_question
      ON template_question.template_id = inserted.template_id
    JOIN public.meeting_question_templates question_template
      ON question_template.id = template_question.question_template_id
     AND question_template.is_active
  )
  SELECT count(*) INTO v_inserted FROM inserted;
  RETURN v_inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.file_archive_manager_user_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select app_user.id
  from public.users app_user
  where coalesce(app_user.is_active, true)
    and (
      exists (
        select 1 from public.department_members member
        join public.positions position on position.id = member.position_id
        where member.user_id = app_user.id and position.name = 'Администратор CRM'
      )
      or exists (
        select 1 from public.department_members member
        join public.department_access_permissions permission
          on permission.department_id = member.department_id
         and permission.subject_scope = case when member.is_department_head then 'head' else 'member' end
        where member.user_id = app_user.id
          and permission.resource_key = 'file_archive_settings'
          and permission.can_manage
      )
      or (
        not exists (
          select 1 from public.department_members member
          join public.department_access_permissions permission
            on permission.department_id = member.department_id
           and permission.subject_scope = case when member.is_department_head then 'head' else 'member' end
          where member.user_id = app_user.id
        )
        and exists (
          select 1 from public.role_permissions permission
          where permission.role = app_user.role
            and permission.resource_key = 'file_archive_settings'
            and permission.can_manage
        )
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.fn_approve_technologist_request(p_approval_version_id uuid, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare
  v_version public.technologist_request_approval_versions%rowtype;
  v_request public.technologist_requests%rowtype;
  v_completion uuid;
  v_original_sub text;
begin
  if p_actor is null then raise exception 'Недостаточно прав'; end if;
  if not exists (select 1 from public.users u where u.id = p_actor and u.is_active and u.role = 'financial_director')
     and not exists (
       select 1 from public.users u join public.department_members dm on dm.user_id = u.id
       join public.positions p on p.id = dm.position_id
       where u.id = p_actor and u.is_active and p.is_active and p.name = 'Администратор CRM'
     ) then raise exception 'Одобрить заявку может финансовый директор или администратор CRM'; end if;
  perform 1 from public.machines m join public.technologist_requests r on r.machine_id = m.id
    join public.technologist_request_approval_versions v on v.request_id = r.id
    where v.id = p_approval_version_id for update of m;
  select r.* into v_request from public.technologist_requests r
    join public.technologist_request_approval_versions v on v.request_id = r.id
    where v.id = p_approval_version_id for update of r;
  select * into v_version from public.technologist_request_approval_versions where id = p_approval_version_id for update;
  if not found or v_version.state <> 'pending' then raise exception 'Решение по версии уже принято'; end if;
  if v_request.status <> 'pending_financial_approval' then raise exception 'Заявка больше не ожидает согласования'; end if;
  if exists (select 1 from public.machines where id = v_request.machine_id and is_archived) then raise exception 'Заказ находится в архиве'; end if;
  if v_version.summary_snapshot->'sourceData' is distinct from public.fn_technologist_approval_source(v_request.id) then
    raise exception 'Данные заявки изменились. Верните заявку на доработку';
  end if;

  -- The legacy finalizer is owner-bound. Keep its validations and side effects,
  -- but invoke it atomically as the immutable version's submitting technologist.
  perform set_config('app.financial_approval_request', v_request.id::text, true);
  update public.technologist_requests set status = 'stock_checked', updated_at = now() where id = v_request.id;
  v_original_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claim.sub', v_request.created_by::text, true);
  v_completion := public.fn_finalize_technologist_request_with_archives(
    v_request.id,
    v_request.created_by,
    v_version.completion_payload->>'decision',
    coalesce((v_version.completion_payload->>'enteredPlasmaMinutes')::integer, 0),
    coalesce(v_version.completion_payload->'wasteItems', '[]'::jsonb),
    coalesce(v_version.completion_payload->'futureItems', '[]'::jsonb),
    coalesce(v_version.completion_payload->'archives', '[]'::jsonb)
  );
  perform set_config('request.jwt.claim.sub', coalesce(v_original_sub, p_actor::text), true);
  if exists (select 1 from public.supply_position_revisions where replacement_request_id = v_request.id) then
    perform public.fn_submit_supply_position_revision_v1(v_request.id, v_request.created_by);
  end if;
  perform set_config('app.financial_approval_request', '', true);

  update public.technologist_request_approval_versions
    set state = 'approved', decided_by = p_actor, decided_at = now(), updated_at = now()
    where id = v_version.id;
  update public.tasks set status = 'completed', completed_at = now(), updated_at = now()
    where technologist_request_approval_id = v_version.id and status in ('pending', 'in_progress');
  insert into public.notifications(user_id, type, title, message, related_machine_id)
  select u.id, 'technologist_request', 'Заявка одобрена и готова для снабжения',
    'Итоговая версия заявки одобрена финансовым директором или администратором CRM.', v_request.machine_id
  from public.users u where u.is_active and u.role in ('supply_manager','procurement_head');
  return v_completion;
end;
$function$;

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
        or exists (
          select 1
          from public.department_members member
          join public.positions position on position.id = member.position_id
          where member.user_id = app_user.id and position.name = 'Администратор CRM'
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_delete_production_machine_fact_atomic_v1(p_fact_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_fact public.production_machine_facts%rowtype;
  v_machine_id uuid;
  v_machine_name text;
  v_machine_factory_id uuid;
  v_effective_stage public.stage_type;
  v_assigned_to uuid;
  v_task_id uuid;
  v_today date := (now() at time zone 'Europe/Chisinau')::date;
  v_title text;
  v_description text;
begin
  if p_actor is null then
    raise exception 'Не указан автор удаления факта';
  end if;

  select machine_id
  into v_machine_id
  from public.production_machine_facts
  where id = p_fact_id;
  if not found then
    raise exception 'Запись факта не найдена';
  end if;

  perform public.fn_lock_production_cutting_machine_v1(v_machine_id);

  select fact.*
  into v_fact
  from public.production_machine_facts fact
  where fact.id = p_fact_id
  for update of fact;
  if not found then
    raise exception 'Запись факта не найдена';
  end if;
  if v_fact.machine_id is distinct from v_machine_id then
    raise exception 'Машина факта изменилась во время удаления';
  end if;

  select coalesce(section.production_stage_type, parent.production_stage_type)
  into v_effective_stage
  from public.production_fact_sections section
  left join public.production_fact_sections parent on parent.id = section.parent_id
  where section.id = v_fact.section_id;

  delete from public.production_machine_facts
  where id = v_fact.id;

  if v_effective_stage is distinct from 'cutting'::public.stage_type
    or exists (
      select 1
      from public.production_machine_facts remaining_fact
      join public.production_fact_sections section on section.id = remaining_fact.section_id
      left join public.production_fact_sections parent on parent.id = section.parent_id
      where remaining_fact.machine_id = v_machine_id
        and coalesce(section.production_stage_type, parent.production_stage_type)
          = 'cutting'::public.stage_type
    ) then
    return jsonb_build_object(
      'machine_id', v_machine_id,
      'task_id', null,
      'assigned_to', null
    );
  end if;

  select machine.name, machine.factory_id
  into v_machine_name, v_machine_factory_id
  from public.machines machine
  where machine.id = v_machine_id;
  v_machine_name := coalesce(v_machine_name, 'машина');

  select app_user.id
  into v_assigned_to
  from public.company_settings settings
  join public.users app_user
    on app_user.id = settings.auto_task_technologist_user_id
   and app_user.role = 'technologist'::public.user_role
   and app_user.is_active = true
  limit 1;

  if v_assigned_to is null then
    select app_user.id
    into v_assigned_to
    from public.users app_user
    where app_user.role = 'technologist'::public.user_role
      and app_user.is_active = true
    order by
      case when v_machine_factory_id is not null
        and app_user.factory_id = v_machine_factory_id then 0 else 1 end,
      app_user.full_name,
      app_user.id
    limit 1;
  end if;
  v_assigned_to := coalesce(v_assigned_to, p_actor);

  v_title := 'Проверить откат заготовки: ' || v_machine_name;
  v_description := concat_ws(E'\n',
    'Последний факт заготовки по машине удален или перенесен.',
    'Склад автоматически не откатывался.',
    'Откройте задачу, чтобы посмотреть preview и выбрать автоматический откат или оставить списание как есть.',
    'Причина: Факт заготовки удален'
  );

  select task.id
  into v_task_id
  from public.tasks task
  where task.machine_id = v_machine_id
    and task.task_type = 'production_cutting_rollback_review'::public.task_type
    and task.status in ('pending'::public.task_status, 'in_progress'::public.task_status)
  order by task.created_at, task.id
  limit 1
  for update;

  if v_task_id is null then
    insert into public.tasks(
      machine_id, assigned_to, task_type, title, description,
      status, start_date, deadline
    ) values (
      v_machine_id,
      v_assigned_to,
      'production_cutting_rollback_review'::public.task_type,
      v_title,
      v_description,
      'pending'::public.task_status,
      v_today,
      v_today
    )
    returning id into v_task_id;
  else
    update public.tasks
    set assigned_to = v_assigned_to,
        title = v_title,
        description = v_description,
        status = 'pending'::public.task_status,
        start_date = v_today,
        deadline = v_today,
        completed_at = null,
        updated_at = now()
    where id = v_task_id;
  end if;

  update public.production_fact_cutting_events
  set rollback_task_id = v_task_id
  where machine_id = v_machine_id
    and status = 'applied';

  insert into public.notifications(
    user_id, type, title, message, related_machine_id
  ) values (
    v_assigned_to,
    'task_created',
    'Нужен review отката заготовки',
    'По машине "' || v_machine_name
      || '" удален или перенесен последний факт заготовки. Откройте задачу для preview автоматического отката.',
    v_machine_id
  );

  return jsonb_build_object(
    'machine_id', v_machine_id,
    'task_id', v_task_id,
    'assigned_to', v_assigned_to
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_financial_supply_visibility(p_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (select 1 from public.technologist_requests r where r.id = p_request_id and r.status in ('submitted_to_supply','completed'))
    or (not exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('supply_manager','procurement_head')) and (
      exists (select 1 from public.technologist_requests r where r.id = p_request_id and r.created_by = auth.uid())
      or exists (select 1 from public.technologist_requests r join public.tasks t on t.machine_id = r.machine_id
        where r.id = p_request_id and t.assigned_to = auth.uid() and t.task_type = 'technologist_request' and t.status in ('pending','in_progress','completed'))
      or exists (select 1 from public.users u where u.id = auth.uid() and u.is_active and u.role in ('planning_director','financial_director','commercial_director'))
      or exists (select 1 from public.users u join public.department_members dm on dm.user_id = u.id join public.positions p on p.id = dm.position_id
        where u.id = auth.uid() and u.is_active and p.is_active and p.name = 'Администратор CRM')
    ));
$function$;

CREATE OR REPLACE FUNCTION public.fn_is_production_manager_for_factory(p_user_id uuid, p_factory_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users employee
    WHERE employee.id = p_user_id
      AND COALESCE(employee.is_active, true)
      AND (
        (
          employee.role = 'production_manager'
          AND employee.factory_id = p_factory_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.department_members member
          JOIN public.departments department
            ON department.id = member.department_id
           AND department.factory_id = p_factory_id
           AND COALESCE(department.is_active, true)
          LEFT JOIN public.positions position ON position.id = member.position_id
          WHERE member.user_id = employee.id
            AND lower(concat_ws(' ', department.name, position.name)) ~ '(производ|production|вироб)'
            AND (
              COALESCE(member.is_department_head, false)
              OR department.head_user_id = employee.id
              OR lower(COALESCE(position.name, '')) ~ '(начальник|керівник|manager|head)'
            )
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_notify_confirmation_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_title text;
  v_message text;
  v_type text;
BEGIN
  IF OLD.is_confirmed != NEW.is_confirmed THEN
    IF NEW.is_confirmed THEN
      v_title := 'Машина подтверждена';
      v_message := 'Машина "' || NEW.name || '" подтверждена.';
      v_type := 'machine_confirmed';
    ELSE
      v_title := 'Подтверждение снято';
      v_message := 'С машины "' || NEW.name || '" снято подтверждение.';
      v_type := 'machine_unconfirmed';
    END IF;

    INSERT INTO notifications (user_id, type, title, message, related_machine_id)
    SELECT u.id, v_type, v_title, v_message, NEW.id
    FROM users u
    WHERE u.role IN ('financial_director', 'commercial_director', 'planning_director')
      AND u.is_active = true;

    PERFORM notify_production_managers_for_machine(NEW.factory_id, v_type, v_title, v_message, NEW.id);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_notify_new_machine()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_title text;
  v_message text;
  v_type text;
BEGIN
  IF NEW.is_confirmed THEN
    v_title := 'Новая машина (подтверждена)';
    v_message := 'Машина "' || NEW.name || '" создана и подтверждена.';
    v_type := 'new_machine_confirmed';
  ELSE
    v_title := 'Новая машина (не подтверждена)';
    v_message := 'Машина "' || NEW.name || '" создана, но не подтверждена.';
    v_type := 'new_machine_unconfirmed';
  END IF;

  INSERT INTO notifications (user_id, type, title, message, related_machine_id)
  SELECT u.id, v_type, v_title, v_message, NEW.id
  FROM users u
  WHERE u.role IN ('financial_director', 'commercial_director', 'planning_director')
    AND u.is_active = true;

  PERFORM notify_production_managers_for_machine(NEW.factory_id, v_type, v_title, v_message, NEW.id);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_people_cancel_employee_day(p_employee_id uuid, p_work_date date)
 RETURNS SETOF employee_assignments
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role public.user_role;
  v_actor_factory uuid;
  v_employee_factory uuid;
BEGIN
  v_role := public.get_user_role();
  v_actor_factory := public.get_user_factory_id();

  IF v_role IS NULL OR v_role NOT IN (
    'financial_director'::public.user_role,
    'commercial_director'::public.user_role,
    'planning_director'::public.user_role,
    'production_manager'::public.user_role
  ) THEN
    RAISE EXCEPTION 'People planning access denied';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('people-employee-day:' || p_employee_id::text || ':' || p_work_date::text, 0)
  );

  SELECT factory_id
    INTO v_employee_factory
    FROM public.employees
    WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
  IF v_role = 'production_manager'::public.user_role
     AND v_employee_factory IS DISTINCT FROM v_actor_factory THEN
    RAISE EXCEPTION 'Production manager can clear only own factory';
  END IF;

  RETURN QUERY
    UPDATE public.employee_assignments assignment
    SET cancelled_at = now(),
        updated_by = auth.uid()
    WHERE assignment.employee_id = p_employee_id
      AND assignment.work_date = p_work_date
      AND assignment.cancelled_at IS NULL
    RETURNING assignment.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_people_confirm_assignment(p_assignment_id uuid)
 RETURNS employee_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role public.user_role;
  v_actor_factory uuid;
  v_factory uuid;
  v_result public.employee_assignments;
BEGIN
  v_role := public.get_user_role();
  v_actor_factory := public.get_user_factory_id();
  IF v_role IS NULL OR v_role NOT IN (
    'financial_director'::public.user_role,
    'commercial_director'::public.user_role,
    'planning_director'::public.user_role,
    'production_manager'::public.user_role
  ) THEN
    RAISE EXCEPTION 'People planning access denied';
  END IF;

  SELECT e.factory_id INTO v_factory
    FROM public.employee_assignments a
    JOIN public.employees e ON e.id = a.employee_id
    WHERE a.id = p_assignment_id
    FOR UPDATE OF a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;
  IF v_role = 'production_manager'::public.user_role
     AND v_factory IS DISTINCT FROM v_actor_factory THEN
    RAISE EXCEPTION 'Production manager can confirm only own factory';
  END IF;

  UPDATE public.employee_assignments
    SET status = 'confirmed'::public.employee_assignment_status,
        updated_by = auth.uid()
    WHERE id = p_assignment_id
    RETURNING * INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_people_copy_previous_day(p_employee_id uuid, p_target_date date)
 RETURNS SETOF employee_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role public.user_role;
  v_actor_factory uuid;
  v_employee_factory uuid;
  v_source_count integer;
BEGIN
  v_role := public.get_user_role();
  v_actor_factory := public.get_user_factory_id();
  IF v_role IS NULL OR v_role NOT IN (
    'financial_director'::public.user_role,
    'commercial_director'::public.user_role,
    'planning_director'::public.user_role,
    'production_manager'::public.user_role
  ) THEN
    RAISE EXCEPTION 'People planning access denied';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('people-employee:' || p_employee_id::text, 0));
  SELECT factory_id
    INTO v_employee_factory
    FROM public.employees
    WHERE id = p_employee_id
      AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active employee not found';
  END IF;
  IF v_role = 'production_manager'::public.user_role
     AND v_employee_factory IS DISTINCT FROM v_actor_factory THEN
    RAISE EXCEPTION 'Production manager can copy only own factory';
  END IF;

  SELECT count(*)
    INTO v_source_count
    FROM public.employee_assignments
    WHERE employee_id = p_employee_id
      AND work_date = p_target_date - 1
      AND cancelled_at IS NULL;
  IF v_source_count <> 2 THEN
    RAISE EXCEPTION 'Previous day must contain both half-day assignments';
  END IF;

  INSERT INTO public.employee_assignments (
    employee_id,
    machine_id,
    section_id,
    work_date,
    half,
    status,
    kg_planned,
    created_by,
    updated_by,
    cancelled_at
  )
  SELECT
    source.employee_id,
    source.machine_id,
    source.section_id,
    p_target_date,
    source.half,
    source.status,
    source.kg_planned,
    auth.uid(),
    auth.uid(),
    NULL
  FROM public.employee_assignments source
  WHERE source.employee_id = p_employee_id
    AND source.work_date = p_target_date - 1
    AND source.cancelled_at IS NULL
  ORDER BY source.half
  ON CONFLICT ON CONSTRAINT employee_assignments_employee_slot_unique
  DO UPDATE SET
    machine_id = EXCLUDED.machine_id,
    section_id = EXCLUDED.section_id,
    status = EXCLUDED.status,
    kg_planned = EXCLUDED.kg_planned,
    cancelled_at = NULL,
    updated_by = auth.uid();

  RETURN QUERY
    SELECT assignment.*
    FROM public.employee_assignments assignment
    WHERE assignment.employee_id = p_employee_id
      AND assignment.work_date = p_target_date
      AND assignment.cancelled_at IS NULL
    ORDER BY assignment.half;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_people_planning_period(p_factory_id uuid, p_start_date date, p_end_date date)
 RETURNS SETOF employee_assignments
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role public.user_role;
  v_actor_factory uuid;
BEGIN
  v_role := public.get_user_role();
  v_actor_factory := public.get_user_factory_id();

  IF v_role IS NULL OR v_role NOT IN (
    'financial_director'::public.user_role,
    'commercial_director'::public.user_role,
    'planning_director'::public.user_role,
    'production_manager'::public.user_role
  ) THEN
    RAISE EXCEPTION 'People planning access denied';
  END IF;
  IF p_start_date IS NULL
     OR p_end_date IS NULL
     OR p_end_date < p_start_date
     OR p_end_date - p_start_date > 6 THEN
    RAISE EXCEPTION 'People planning period must contain from 1 to 7 days';
  END IF;
  IF v_role = 'production_manager'::public.user_role
     AND p_factory_id IS DISTINCT FROM v_actor_factory THEN
    RAISE EXCEPTION 'Production manager can view only own factory';
  END IF;

  RETURN QUERY
    SELECT assignment.*
    FROM public.employee_assignments assignment
    JOIN public.employees employee ON employee.id = assignment.employee_id
    WHERE employee.factory_id = p_factory_id
      AND assignment.work_date BETWEEN p_start_date AND p_end_date
      AND assignment.cancelled_at IS NULL
    ORDER BY assignment.work_date, assignment.half, employee.full_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_people_schedule_assignment(p_employee_id uuid, p_machine_id uuid, p_section_id uuid, p_start_date date, p_start_half smallint DEFAULT 1)
 RETURNS SETOF employee_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role public.user_role;
  v_actor_factory uuid;
  v_factory uuid;
  v_rate numeric(12, 3);
  v_total_kg numeric;
  v_confirmed_kg numeric;
  v_remaining_kg numeric;
  v_employee_slot_lock bigint;
  v_machine_section_lock bigint;
  v_assignment_id uuid;
  v_existing public.employee_assignments%ROWTYPE;
BEGIN
  v_role := public.get_user_role();
  v_actor_factory := public.get_user_factory_id();
  IF v_role IS NULL OR v_role NOT IN (
    'financial_director'::public.user_role,
    'commercial_director'::public.user_role,
    'planning_director'::public.user_role,
    'production_manager'::public.user_role
  ) THEN
    RAISE EXCEPTION 'People planning access denied';
  END IF;
  IF p_start_half NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Half must be 1 or 2';
  END IF;

  v_employee_slot_lock := hashtextextended(
    'people-employee-slot:' || p_employee_id::text || ':' || p_start_date::text || ':' || p_start_half::text,
    0
  );
  v_machine_section_lock := hashtextextended(
    'people-machine-section:' || p_machine_id::text || ':' || p_section_id::text,
    0
  );
  PERFORM pg_advisory_xact_lock(least(v_employee_slot_lock, v_machine_section_lock));
  IF v_employee_slot_lock <> v_machine_section_lock THEN
    PERFORM pg_advisory_xact_lock(greatest(v_employee_slot_lock, v_machine_section_lock));
  END IF;

  SELECT e.factory_id, r.kg_per_day
    INTO v_factory, v_rate
    FROM public.employees e
    JOIN public.employee_rates r
      ON r.employee_id = e.id
     AND r.section_id = p_section_id
     AND r.active
    WHERE e.id = p_employee_id
      AND e.active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active employee rate not found';
  END IF;
  IF v_role = 'production_manager'::public.user_role
     AND v_factory IS DISTINCT FROM v_actor_factory THEN
    RAISE EXCEPTION 'Production manager can plan only own factory';
  END IF;

  SELECT total_weight * 1000
    INTO v_total_kg
    FROM public.machines_with_totals
    WHERE id = p_machine_id
      AND factory_id = v_factory;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Machine must belong to the employee factory';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.production_fact_sections s
    WHERE s.id = p_section_id
      AND s.factory_id = v_factory
      AND s.parent_id IS NOT NULL
      AND s.is_active
      AND s.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Section must be an active leaf in the employee factory';
  END IF;

  SELECT COALESCE(sum(kg_planned), 0)
    INTO v_confirmed_kg
    FROM public.employee_assignments
    WHERE machine_id = p_machine_id
      AND section_id = p_section_id
      AND status = 'confirmed'::public.employee_assignment_status
      AND cancelled_at IS NULL;
  v_remaining_kg := greatest(COALESCE(v_total_kg, 0) - v_confirmed_kg, 0);
  IF v_remaining_kg <= 0 THEN
    RAISE EXCEPTION 'Machine section has no remaining weight to plan';
  END IF;

  SELECT assignment.*
    INTO v_existing
    FROM public.employee_assignments assignment
    WHERE assignment.employee_id = p_employee_id
      AND assignment.work_date = p_start_date
      AND assignment.half = p_start_half
    FOR UPDATE;

  IF FOUND THEN
    IF v_existing.cancelled_at IS NULL THEN
      RAISE EXCEPTION 'Employee already assigned in selected half-day';
    END IF;

    UPDATE public.employee_assignments
    SET machine_id = p_machine_id,
        section_id = p_section_id,
        status = 'confirmed'::public.employee_assignment_status,
        kg_planned = round(v_rate / 2, 3),
        cancelled_at = NULL,
        updated_by = auth.uid()
    WHERE id = v_existing.id
    RETURNING id INTO v_assignment_id;
  ELSE
    INSERT INTO public.employee_assignments (
      employee_id,
      machine_id,
      section_id,
      work_date,
      half,
      status,
      kg_planned,
      created_by,
      updated_by
    ) VALUES (
      p_employee_id,
      p_machine_id,
      p_section_id,
      p_start_date,
      p_start_half,
      'confirmed'::public.employee_assignment_status,
      round(v_rate / 2, 3),
      auth.uid(),
      auth.uid()
    )
    RETURNING id INTO v_assignment_id;
  END IF;

  RETURN QUERY
    SELECT assignment.*
    FROM public.employee_assignments assignment
    WHERE assignment.id = v_assignment_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_people_vacations_period(p_factory_id uuid, p_start_date date, p_end_date date)
 RETURNS SETOF employee_vacations
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role public.user_role;
  v_actor_factory uuid;
BEGIN
  v_role := public.get_user_role();
  v_actor_factory := public.get_user_factory_id();

  IF v_role IS NULL OR v_role NOT IN (
    'financial_director'::public.user_role,
    'commercial_director'::public.user_role,
    'planning_director'::public.user_role,
    'production_manager'::public.user_role
  ) THEN
    RAISE EXCEPTION 'People planning access denied';
  END IF;
  IF p_start_date IS NULL
     OR p_end_date IS NULL
     OR p_end_date < p_start_date
     OR p_end_date - p_start_date > 6 THEN
    RAISE EXCEPTION 'People planning period must contain from 1 to 7 days';
  END IF;
  IF v_role = 'production_manager'::public.user_role
     AND p_factory_id IS DISTINCT FROM v_actor_factory THEN
    RAISE EXCEPTION 'Production manager can view only own factory';
  END IF;

  RETURN QUERY
    SELECT vacation.*
    FROM public.employee_vacations vacation
    JOIN public.employees employee ON employee.id = vacation.employee_id
    WHERE employee.factory_id = p_factory_id
      AND vacation.cancelled_at IS NULL
      AND vacation.start_date <= p_end_date
      AND vacation.end_date >= p_start_date
    ORDER BY vacation.start_date, employee.full_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_receive_supply_order_schedule_batch_v1(p_receipts jsonb, p_performed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_schedule public.supply_order_delivery_schedules%ROWTYPE;
  v_receipt jsonb;
  v_result jsonb;
  v_item jsonb;
  v_first_item jsonb;
  v_identity jsonb;
  v_expected_identity jsonb;
  v_expected_table text;
  v_expected_unit text;
  v_expected_date date;
  v_expected_piece_length numeric;
  v_expected_factory_id uuid;
  v_factory_id uuid;
  v_machine_id uuid;
  v_machine_name text;
  v_anchor_schedule_id uuid;
  v_schedule_id uuid;
  v_received_quantity numeric;
  v_received_piece_length numeric;
  v_received_piece_count numeric;
  v_total_plan numeric := 0;
  v_total_received numeric := 0;
  v_total_allocated numeric := 0;
  v_total_excess numeric := 0;
  v_active_batch_count integer := 0;
  v_unlinked_supplier_mismatch boolean := false;
  v_source_key text;
  v_item_name text;
  v_title text;
  v_description text;
  v_today date;
  v_has_procurement_head boolean;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF p_receipts IS NULL OR jsonb_typeof(p_receipts) <> 'array'
    OR jsonb_array_length(p_receipts) = 0 THEN
    RAISE EXCEPTION 'Пакет приёмки пуст';
  END IF;
  IF p_performed_by IS NULL THEN RAISE EXCEPTION 'Не указан исполнитель приёмки'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_receipts) AS receipt(value)
    WHERE NULLIF(receipt.value->>'schedule_id', '') IS NULL
      OR COALESCE(NULLIF(receipt.value->>'received_quantity', '')::numeric, -1) < 0
  ) THEN
    RAISE EXCEPTION 'Некорректная строка пакетной приёмки';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_receipts) AS receipt(value)
    GROUP BY receipt.value->>'schedule_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Строка графика указана в пакете несколько раз';
  END IF;

  -- Lock every source schedule in deterministic order before any mutation.
  FOR v_schedule IN
    SELECT schedule.*
    FROM public.supply_order_delivery_schedules AS schedule
    JOIN (
      SELECT (receipt.value->>'schedule_id')::uuid AS id
      FROM jsonb_array_elements(p_receipts) AS receipt(value)
    ) AS input ON input.id = schedule.id
    ORDER BY schedule.id
    FOR UPDATE OF schedule
  LOOP
    IF v_schedule.status = 'delivered' THEN RAISE EXCEPTION 'Поставка уже принята'; END IF;
    IF v_schedule.status = 'cancelled' THEN RAISE EXCEPTION 'Поставка отменена'; END IF;
    IF v_schedule.status <> 'planned' THEN RAISE EXCEPTION 'Поставка недоступна для приёмки'; END IF;

    EXECUTE format(
      'SELECT to_jsonb(item) FROM public.%I item WHERE item.id = $1 FOR UPDATE',
      v_schedule.request_item_table
    ) INTO v_item USING v_schedule.request_item_id;
    IF v_item IS NULL THEN RAISE EXCEPTION 'Позиция закупки не найдена'; END IF;
    IF COALESCE(v_item->>'order_status', '') NOT IN ('ordered', 'delivered') THEN
      RAISE EXCEPTION 'Поставку можно принять только после отметки позиции "Заказано"';
    END IF;

    SELECT request.machine_id, machine.name, machine.factory_id
    INTO v_machine_id, v_machine_name, v_factory_id
    FROM public.technologist_requests AS request
    JOIN public.machines AS machine ON machine.id = request.machine_id
    WHERE request.id = NULLIF(v_item->>'request_id', '')::uuid;
    IF v_factory_id IS NULL THEN RAISE EXCEPTION 'Для приёмки не определён завод машины'; END IF;

    v_identity := public.fn_receiving_material_identity_v1(v_schedule.request_item_table, v_item);
    IF v_expected_identity IS NULL THEN
      v_anchor_schedule_id := v_schedule.id;
      v_expected_identity := v_identity;
      v_expected_table := v_schedule.request_item_table;
      v_expected_unit := v_schedule.unit;
      v_expected_date := v_schedule.delivery_date;
      v_expected_piece_length := v_schedule.planned_piece_length_mm;
      v_expected_factory_id := v_factory_id;
      v_first_item := v_item;
    ELSIF v_identity IS DISTINCT FROM v_expected_identity
      OR v_schedule.request_item_table IS DISTINCT FROM v_expected_table
      OR v_schedule.unit IS DISTINCT FROM v_expected_unit
      OR v_schedule.delivery_date IS DISTINCT FROM v_expected_date
      OR v_schedule.planned_piece_length_mm IS DISTINCT FROM v_expected_piece_length
      OR v_factory_id IS DISTINCT FROM v_expected_factory_id THEN
      RAISE EXCEPTION 'В одну приёмку попали разные материалы, даты, длины или заводы';
    END IF;
    v_total_plan := v_total_plan + v_schedule.quantity;
  END LOOP;

  IF (SELECT count(*) FROM jsonb_array_elements(p_receipts)) <> (
    SELECT count(*)
    FROM public.supply_order_delivery_schedules AS schedule
    JOIN (
      SELECT (receipt.value->>'schedule_id')::uuid AS id
      FROM jsonb_array_elements(p_receipts) AS receipt(value)
    ) AS input ON input.id = schedule.id
  ) THEN
    RAISE EXCEPTION 'Одна из строк поставки не найдена';
  END IF;

  SELECT schedule.* INTO STRICT v_schedule
  FROM public.supply_order_delivery_schedules AS schedule
  WHERE schedule.id IN (
    SELECT (receipt.value->>'schedule_id')::uuid
    FROM jsonb_array_elements(p_receipts) AS receipt(value)
  )
  ORDER BY schedule.created_at, schedule.id
  LIMIT 1;
  v_anchor_schedule_id := v_schedule.id;
  EXECUTE format(
    'SELECT to_jsonb(item) FROM public.%I item WHERE item.id = $1',
    v_schedule.request_item_table
  ) INTO v_first_item USING v_schedule.request_item_id;
  SELECT request.machine_id, machine.name
  INTO v_machine_id, v_machine_name
  FROM public.technologist_requests AS request
  JOIN public.machines AS machine ON machine.id = request.machine_id
  WHERE request.id = NULLIF(v_first_item->>'request_id', '')::uuid;

  SELECT count(DISTINCT (link.transport_order_id::text || ':' || COALESCE(link.delivery_stop_id::text, 'no-stop')))
  INTO v_active_batch_count
  FROM public.transport_trip_need_links AS link
  JOIN public.machine_outsourcing_transport_orders AS trip ON trip.id = link.transport_order_id
  WHERE link.need_source = 'supply_schedule'
    AND link.released_at IS NULL
    AND trip.status <> 'cancelled'
    AND link.need_id IN (
      SELECT (receipt.value->>'schedule_id')::uuid
      FROM jsonb_array_elements(p_receipts) AS receipt(value)
    );
  IF v_active_batch_count > 1 THEN
    RAISE EXCEPTION 'В одну приёмку попали поставки из разных рейсов или точек разгрузки';
  END IF;

  IF v_active_batch_count = 0 AND (
    SELECT count(DISTINCT COALESCE(schedule.supplier_id::text, 'no-supplier'))
    FROM public.supply_order_delivery_schedules AS schedule
    WHERE schedule.id IN (
      SELECT (receipt.value->>'schedule_id')::uuid
      FROM jsonb_array_elements(p_receipts) AS receipt(value)
    )
  ) > 1 THEN
    RAISE EXCEPTION 'Поставки без рейса должны относиться к одному поставщику';
  END IF;

  IF v_active_batch_count = 1 THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.supply_order_delivery_schedules AS schedule
      WHERE schedule.id IN (
        SELECT (receipt.value->>'schedule_id')::uuid
        FROM jsonb_array_elements(p_receipts) AS receipt(value)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.transport_trip_need_links AS own_link
        JOIN public.machine_outsourcing_transport_orders AS own_trip
          ON own_trip.id = own_link.transport_order_id AND own_trip.status <> 'cancelled'
        WHERE own_link.need_source = 'supply_schedule'
          AND own_link.need_id = schedule.id
          AND own_link.released_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.supply_order_delivery_schedules AS linked_schedule
        JOIN public.transport_trip_need_links AS linked
          ON linked.need_source = 'supply_schedule'
          AND linked.need_id = linked_schedule.id
          AND linked.released_at IS NULL
        JOIN public.machine_outsourcing_transport_orders AS linked_trip
          ON linked_trip.id = linked.transport_order_id AND linked_trip.status <> 'cancelled'
        WHERE linked_schedule.id IN (
          SELECT (receipt.value->>'schedule_id')::uuid
          FROM jsonb_array_elements(p_receipts) AS receipt(value)
        )
          AND linked_schedule.supplier_id IS NOT DISTINCT FROM schedule.supplier_id
      )
    ) INTO v_unlinked_supplier_mismatch;
    IF v_unlinked_supplier_mismatch THEN
      RAISE EXCEPTION 'Техническая строка без рейса не соответствует поставщику физической партии';
    END IF;
  END IF;

  SELECT COALESCE(sum((receipt.value->>'received_quantity')::numeric), 0)
  INTO v_total_received
  FROM jsonb_array_elements(p_receipts) AS receipt(value);
  IF v_total_received <= 0 THEN RAISE EXCEPTION 'Фактическое количество прихода должно быть больше 0'; END IF;

  PERFORM set_config('app.receiving_batch_mode', 'on', true);
  FOR v_receipt IN
    SELECT receipt.value
    FROM jsonb_array_elements(p_receipts) WITH ORDINALITY AS receipt(value, ordinal)
    ORDER BY receipt.ordinal
  LOOP
    v_schedule_id := (v_receipt->>'schedule_id')::uuid;
    v_received_quantity := COALESCE(NULLIF(v_receipt->>'received_quantity', '')::numeric, 0);
    v_received_piece_length := NULLIF(v_receipt->>'received_piece_length_mm', '')::numeric;
    v_received_piece_count := NULLIF(v_receipt->>'received_piece_count', '')::numeric;

    IF v_received_quantity <= 0 THEN
      UPDATE public.supply_order_delivery_schedules
      SET status = 'cancelled',
          received_quantity = 0,
          allocated_quantity = 0,
          allocated_physical_quantity = 0,
          excess_quantity = 0,
          change_reason = concat_ws('. ', NULLIF(change_reason, ''), 'Не получено при пакетной приёмке'),
          updated_by = p_performed_by,
          updated_at = now()
      WHERE id = v_schedule_id;
      CONTINUE;
    END IF;

    SELECT public.fn_receive_supply_order_schedule_v2(
      v_schedule_id,
      p_performed_by,
      v_received_quantity,
      COALESCE(v_receipt->'allocations', '[]'::jsonb),
      v_received_piece_length,
      v_received_piece_count
    ) INTO v_result;
    v_total_allocated := v_total_allocated + COALESCE((v_result->>'allocated_physical_quantity')::numeric, 0);
    v_total_excess := v_total_excess + COALESCE((v_result->>'excess_quantity')::numeric, 0);
    v_results := v_results || jsonb_build_array(v_result || jsonb_build_object('schedule_id', v_schedule_id));
  END LOOP;
  PERFORM set_config('app.receiving_batch_mode', 'off', true);

  v_item_name := CASE v_expected_table
    WHEN 'request_sheet_metal' THEN COALESCE(NULLIF(v_first_item->>'material_name', ''), 'Листовой металл')
    WHEN 'request_round_tube' THEN COALESCE(NULLIF(v_first_item->>'material_name', ''), 'Круг / Труба')
    WHEN 'request_circle' THEN COALESCE(NULLIF(v_first_item->>'steel_grade', ''), 'Круг')
    WHEN 'request_pipe' THEN COALESCE(NULLIF(v_first_item->>'size', ''), 'Труба')
    WHEN 'request_knives' THEN COALESCE(NULLIF(v_first_item->>'knife_type', ''), 'Ножи')
    WHEN 'request_components' THEN COALESCE(NULLIF(v_first_item->>'component_name', ''), 'Комплектация')
    WHEN 'request_paint' THEN COALESCE(NULLIF(v_first_item->>'paint_type', ''), NULLIF(v_first_item->>'ral_code', ''), 'Краска')
    WHEN 'request_mesh' THEN COALESCE(NULLIF(v_first_item->>'description', ''), 'Сетка')
    WHEN 'request_chain_cord' THEN COALESCE(NULLIF(v_first_item->>'parameters', ''), 'Цепь / Шнур')
    ELSE 'Материал'
  END;

  IF v_total_received < v_total_plan OR v_total_received >= v_total_plan * 1.3 THEN
    v_source_key := 'material_receipt_batch_variance:' || md5(
      (SELECT string_agg(receipt.value->>'schedule_id', ',' ORDER BY receipt.value->>'schedule_id')
       FROM jsonb_array_elements(p_receipts) AS receipt(value))
    );
    v_title := CASE
      WHEN v_total_received < v_total_plan THEN 'Недовес при приёмке материала'
      ELSE 'Перепоставка материала +30%'
    END;
    v_description := concat(
      v_item_name,
      CASE WHEN v_machine_name IS NOT NULL THEN ' для машины ' || v_machine_name ELSE '' END,
      '. Дата снабжения: ', to_char(v_expected_date, 'DD.MM.YYYY'),
      '. План партии: ', v_total_plan::text, ' ', v_expected_unit,
      '. Факт партии: ', v_total_received::text, ' ', v_expected_unit,
      '. На потребности распределено: ', v_total_allocated::text, ' ', v_expected_unit,
      '. Свободный излишек на складе: ', v_total_excess::text, ' ', v_expected_unit, '.'
    );

    INSERT INTO public.meeting_agenda_pool_items (
      source_key, source_type, machine_id, title, description, status, updated_at
    ) VALUES (
      v_source_key, 'material_receipt_variance', v_machine_id,
      v_title, v_description, 'new', now()
    )
    ON CONFLICT (source_key) DO UPDATE
    SET title = EXCLUDED.title,
        description = EXCLUDED.description,
        machine_id = EXCLUDED.machine_id,
        updated_at = now()
    WHERE meeting_agenda_pool_items.status = 'new';

    INSERT INTO public.notifications (user_id, type, title, message, related_machine_id)
    SELECT id, 'material_receipt_variance', v_title, v_description, v_machine_id
    FROM public.users
    WHERE role = 'planning_director' AND is_active = true;
  END IF;

  IF v_total_received < v_total_plan THEN
    v_today := (now() AT TIME ZONE 'Europe/Chisinau')::date;
    SELECT EXISTS (
      SELECT 1 FROM public.users WHERE role = 'procurement_head' AND is_active = true
    ) INTO v_has_procurement_head;

    INSERT INTO public.tasks (
      machine_id, supply_order_schedule_id, assigned_to, task_type,
      title, description, status, start_date, deadline
    )
    SELECT v_machine_id, v_anchor_schedule_id, user_row.id,
      'supply_material_receipt_shortage'::public.task_type,
      'Разобрать недовес по поставке', v_description, 'pending', v_today, v_today
    FROM public.users AS user_row
    WHERE user_row.is_active = true
      AND ((v_has_procurement_head AND user_row.role = 'procurement_head')
        OR (NOT v_has_procurement_head AND user_row.role = 'supply_manager'))
    ON CONFLICT (supply_order_schedule_id, assigned_to, task_type)
      WHERE supply_order_schedule_id IS NOT NULL
        AND status IN ('pending', 'in_progress')
    DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'schedule_ids', (SELECT jsonb_agg(receipt.value->>'schedule_id') FROM jsonb_array_elements(p_receipts) AS receipt(value)),
    'planned_quantity', v_total_plan,
    'received_quantity', v_total_received,
    'allocated_physical_quantity', v_total_allocated,
    'excess_quantity', v_total_excess,
    'receipts', v_results
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_receive_supply_order_schedule_v2(p_schedule_id uuid, p_performed_by uuid, p_received_quantity numeric, p_allocations jsonb, p_received_piece_length_mm numeric DEFAULT NULL::numeric, p_received_piece_count numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_schedule public.supply_order_delivery_schedules%ROWTYPE;
  v_source_item jsonb;
  v_target_item jsonb;
  v_material_id uuid;
  v_material_variant_id uuid;
  v_target_material_id uuid;
  v_target_material_variant_id uuid;
  v_supplier_id uuid;
  v_factory_id uuid;
  v_machine_id uuid;
  v_machine_name text;
  v_target_machine_id uuid;
  v_target_factory_id uuid;
  v_inventory_id uuid;
  v_secondary_quantity numeric;
  v_secondary_unit text;
  v_allocation jsonb;
  v_allocation_table text;
  v_allocation_id uuid;
  v_allocation_quantity numeric;
  v_allocation_physical numeric;
  v_allocation_pieces numeric;
  v_allocation_schedule_id uuid;
  v_source_allocated numeric := 0;
  v_source_physical numeric := 0;
  v_source_pieces numeric := 0;
  v_total_physical numeric := 0;
  v_delivered_total numeric;
  v_required numeric;
  v_item_name text;
  v_title text;
  v_description text;
  v_source_key text;
  v_today date;
  v_has_procurement_head boolean;
BEGIN
  IF COALESCE(p_received_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'Фактическое количество прихода должно быть больше 0';
  END IF;
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'Некорректное распределение поставки';
  END IF;
  IF jsonb_array_length(p_allocations) = 0
    AND current_setting('app.receiving_batch_mode', true) IS DISTINCT FROM 'on'
    AND current_setting('app.manual_quantity_receipt_v3', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Распределите материал хотя бы на одну машину';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_allocations) AS allocation(value)
    GROUP BY allocation.value->>'table', allocation.value->>'id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Одна потребность указана в распределении несколько раз';
  END IF;

  SELECT * INTO v_schedule
  FROM public.supply_order_delivery_schedules
  WHERE id = p_schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Дата поставки не найдена'; END IF;
  IF v_schedule.status = 'delivered' THEN RAISE EXCEPTION 'Поставка уже принята'; END IF;
  IF v_schedule.status = 'cancelled' THEN RAISE EXCEPTION 'Поставка отменена'; END IF;

  IF v_schedule.request_item_table NOT IN (
    'request_sheet_metal', 'request_round_tube', 'request_circle',
    'request_pipe', 'request_knives', 'request_components',
    'request_paint', 'request_mesh', 'request_chain_cord'
  ) THEN
    RAISE EXCEPTION 'Некорректная таблица позиции закупки';
  END IF;

  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1 FOR UPDATE', v_schedule.request_item_table)
    INTO v_source_item USING v_schedule.request_item_id;
  IF v_source_item IS NULL THEN RAISE EXCEPTION 'Позиция закупки не найдена'; END IF;
  IF (
    v_schedule.request_item_table NOT IN ('request_knives', 'request_circle')
    AND NOT (
      v_schedule.request_item_table = 'request_pipe'
      AND COALESCE(v_source_item->>'pipe_type', '') <> 'wire'
    )
  ) AND current_setting('app.manual_quantity_receipt_v3', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Обычные материалы принимаются только через окно ручного распределения';
  END IF;
  IF COALESCE(v_source_item->>'order_status', '') <> 'ordered'
    AND NOT (
      (
        current_setting('app.receiving_batch_mode', true) IS NOT DISTINCT FROM 'on'
        OR current_setting('app.manual_quantity_receipt_v3', true) IS NOT DISTINCT FROM 'on'
      )
      AND COALESCE(v_source_item->>'order_status', '') = 'delivered'
    ) THEN
    RAISE EXCEPTION 'Поставку можно принять только после отметки позиции "Заказано"';
  END IF;

  v_material_id := NULLIF(v_source_item->>'material_id', '')::uuid;
  v_material_variant_id := NULLIF(v_source_item->>'material_variant_id', '')::uuid;
  v_supplier_id := COALESCE(v_schedule.supplier_id, NULLIF(v_source_item->>'supplier_id', '')::uuid);
  IF v_material_id IS NULL THEN RAISE EXCEPTION 'Позиция не привязана к материалу'; END IF;
  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'Назначьте поставщика для поставки'; END IF;

  SELECT request.machine_id, machine.name, machine.factory_id
  INTO v_machine_id, v_machine_name, v_factory_id
  FROM public.technologist_requests request
  JOIN public.machines machine ON machine.id = request.machine_id
  WHERE request.id = NULLIF(v_source_item->>'request_id', '')::uuid;
  IF v_factory_id IS NULL THEN RAISE EXCEPTION 'Для приемки не определен завод машины'; END IF;

  IF (v_schedule.request_item_table IN ('request_knives', 'request_circle') OR (v_schedule.request_item_table = 'request_pipe' AND COALESCE(v_source_item->>'pipe_type', '') <> 'wire')) THEN
    IF COALESCE(p_received_piece_length_mm, 0) <= 0
      OR COALESCE(p_received_piece_count, 0) <= 0
      OR trunc(p_received_piece_count) <> p_received_piece_count THEN
      RAISE EXCEPTION 'Для ножей, круга и трубы укажите длину бруска и целое количество брусков';
    END IF;
    IF abs(p_received_quantity - p_received_piece_length_mm * p_received_piece_count) > 0.000001 THEN
      RAISE EXCEPTION 'Общая длина брусков должна равняться длине бруска, умноженной на количество';
    END IF;
    v_secondary_quantity := p_received_piece_count;
    v_secondary_unit := 'шт';
  ELSE
    IF p_received_piece_length_mm IS NOT NULL OR p_received_piece_count IS NOT NULL THEN
      RAISE EXCEPTION 'Параметры бруска допустимы только для ножей, круга и трубы';
    END IF;
    v_secondary_quantity := NULL;
    v_secondary_unit := NULL;
  END IF;

  v_inventory_id := public.fn_add_inventory_receipt(
    p_material_id := v_material_id,
    p_quantity := p_received_quantity,
    p_unit := v_schedule.unit,
    p_performed_by := p_performed_by,
    p_comment := 'Приход по графику поставки: ' || v_schedule.delivery_date::text
      || '. План: ' || v_schedule.quantity::text || ', факт: ' || p_received_quantity::text,
    p_secondary_quantity := v_secondary_quantity,
    p_secondary_unit := v_secondary_unit,
    p_supplier_id := v_supplier_id,
    p_material_variant_id := v_material_variant_id,
    p_piece_length_mm := p_received_piece_length_mm,
    p_factory_id := v_factory_id
  );

  FOR v_allocation IN SELECT value FROM jsonb_array_elements(p_allocations)
  LOOP
    v_allocation_table := NULLIF(v_allocation->>'table', '');
    v_allocation_id := NULLIF(v_allocation->>'id', '')::uuid;
    v_allocation_quantity := COALESCE(NULLIF(v_allocation->>'quantity', '')::numeric, 0);
    v_allocation_physical := COALESCE(NULLIF(v_allocation->>'physical_quantity', '')::numeric, v_allocation_quantity);
    v_allocation_pieces := NULLIF(v_allocation->>'piece_count', '')::numeric;

    IF v_allocation_table IS DISTINCT FROM v_schedule.request_item_table
      OR v_allocation_id IS NULL
      OR v_allocation_quantity <= 0
      OR v_allocation_physical <= 0
      OR v_allocation_quantity > v_allocation_physical + 0.000001 THEN
      RAISE EXCEPTION 'Некорректная строка распределения поставки';
    END IF;
    IF (v_schedule.request_item_table IN ('request_knives', 'request_circle') OR (v_schedule.request_item_table = 'request_pipe' AND COALESCE(v_source_item->>'pipe_type', '') <> 'wire')) AND (
      COALESCE(v_allocation_pieces, 0) <= 0
      OR trunc(v_allocation_pieces) <> v_allocation_pieces
      OR abs(v_allocation_physical - v_allocation_pieces * p_received_piece_length_mm) > 0.000001
    ) THEN
      RAISE EXCEPTION 'Некорректное распределение брусков';
    END IF;

    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1 FOR UPDATE', v_allocation_table)
      INTO v_target_item USING v_allocation_id;
    IF v_target_item IS NULL THEN RAISE EXCEPTION 'Позиция распределения не найдена'; END IF;
    IF COALESCE(v_target_item->>'order_status', '') NOT IN ('pending', 'ordered') THEN
      RAISE EXCEPTION 'Потребность уже закрыта или недоступна для распределения';
    END IF;

    v_target_material_id := NULLIF(v_target_item->>'material_id', '')::uuid;
    v_target_material_variant_id := NULLIF(v_target_item->>'material_variant_id', '')::uuid;
    IF v_target_material_id IS DISTINCT FROM v_material_id
      OR v_target_material_variant_id IS DISTINCT FROM v_material_variant_id THEN
      RAISE EXCEPTION 'Нельзя распределить приход на другой материал или вариант';
    END IF;

    SELECT request.machine_id, machine.factory_id
    INTO v_target_machine_id, v_target_factory_id
    FROM public.technologist_requests request
    JOIN public.machines machine ON machine.id = request.machine_id
    WHERE request.id = NULLIF(v_target_item->>'request_id', '')::uuid;
    IF v_target_factory_id IS DISTINCT FROM v_factory_id THEN
      RAISE EXCEPTION 'Нельзя распределить приход между разными заводами';
    END IF;

    SELECT COALESCE(sum(COALESCE(allocated_quantity, received_quantity, quantity)), 0)
    INTO v_delivered_total
    FROM public.supply_order_delivery_schedules
    WHERE request_item_table = v_allocation_table
      AND request_item_id = v_allocation_id
      AND status = 'delivered';

    v_required := public.fn_supply_item_required_quantity(v_allocation_table, v_target_item);
    IF v_allocation_quantity > GREATEST(v_required - v_delivered_total, 0) + 0.000001 THEN
      RAISE EXCEPTION 'Распределение превышает актуальный остаток потребности';
    END IF;

    IF v_allocation_id = v_schedule.request_item_id THEN
      v_allocation_schedule_id := p_schedule_id;
      v_source_allocated := v_source_allocated + v_allocation_quantity;
      v_source_physical := v_source_physical + v_allocation_physical;
      v_source_pieces := v_source_pieces + COALESCE(v_allocation_pieces, 0);
      UPDATE public.supply_order_delivery_schedules
      SET status = 'delivered',
          allocated_quantity = v_source_allocated,
          allocated_physical_quantity = v_source_physical,
          allocated_piece_count = CASE
            WHEN p_received_piece_count IS NULL THEN NULL ELSE v_source_pieces
          END,
          updated_by = p_performed_by,
          updated_at = now()
      WHERE id = p_schedule_id;
    ELSE
      INSERT INTO public.supply_order_delivery_schedules (
        request_item_table, request_item_id, delivery_date, quantity, unit,
        supplier_id, status, received_quantity, allocated_quantity,
        allocated_physical_quantity, received_piece_length_mm,
        allocated_piece_count, delivered_at, received_by, created_by,
        updated_by, receipt_inventory_id, receipt_parent_schedule_id
      ) VALUES (
        v_allocation_table, v_allocation_id, v_schedule.delivery_date,
        v_allocation_quantity, v_schedule.unit, v_supplier_id, 'delivered', 0,
        v_allocation_quantity, v_allocation_physical,
        p_received_piece_length_mm, v_allocation_pieces, now(), p_performed_by,
        p_performed_by, p_performed_by, v_inventory_id, p_schedule_id
      ) RETURNING id INTO v_allocation_schedule_id;
    END IF;

    INSERT INTO public.inventory_reservations (
      inventory_id, material_id, material_variant_id, machine_id,
      request_item_table, request_item_id, reserved_quantity,
      reserved_secondary_quantity, reserved_by, original_piece_length_mm,
      is_cut_reservation, reservation_source, supply_order_schedule_id
    ) VALUES (
      v_inventory_id, v_material_id, v_material_variant_id, v_target_machine_id,
      v_allocation_table, v_allocation_id, v_allocation_physical,
      v_allocation_pieces, p_performed_by, p_received_piece_length_mm,
      false, 'supply_receipt', v_allocation_schedule_id
    );

    UPDATE public.inventory
    SET reserved_quantity = reserved_quantity + v_allocation_physical,
        reserved_secondary_quantity = CASE
          WHEN v_allocation_pieces IS NULL THEN reserved_secondary_quantity
          ELSE COALESCE(reserved_secondary_quantity, 0) + v_allocation_pieces
        END,
        last_updated_by = p_performed_by,
        updated_at = now()
    WHERE id = v_inventory_id;

    INSERT INTO public.inventory_transactions (
      factory_id, inventory_id, material_id, material_variant_id,
      transaction_type, quantity, secondary_quantity, machine_id,
      request_item_table, request_item_id, performed_by, comment
    ) VALUES (
      v_factory_id, v_inventory_id, v_material_id, v_material_variant_id,
      'reserve'::public.inventory_transaction_type, v_allocation_physical,
      v_allocation_pieces, v_target_machine_id, v_allocation_table,
      v_allocation_id, p_performed_by,
      'Распределено из принятой поставки по ближайшей дате заготовки'
    );

    v_total_physical := v_total_physical + v_allocation_physical;

    SELECT COALESCE(sum(COALESCE(allocated_quantity, received_quantity, quantity)), 0)
    INTO v_delivered_total
    FROM public.supply_order_delivery_schedules
    WHERE request_item_table = v_allocation_table
      AND request_item_id = v_allocation_id
      AND status = 'delivered';

    v_required := public.fn_supply_item_required_quantity(v_allocation_table, v_target_item);
    IF v_delivered_total >= v_required - 0.000001 THEN
      EXECUTE format(
        'UPDATE public.%I SET order_status = $1, delivered_at = now(), supplier_id = COALESCE(supplier_id, $2) WHERE id = $3',
        v_allocation_table
      ) USING 'delivered'::public.order_item_status, v_supplier_id, v_allocation_id;
    ELSIF COALESCE(v_target_item->>'order_status', '') = 'pending' THEN
      EXECUTE format(
        'UPDATE public.%I SET order_status = $1, ordered_at = COALESCE(ordered_at, now()), supplier_id = COALESCE(supplier_id, $2) WHERE id = $3',
        v_allocation_table
      ) USING 'ordered'::public.order_item_status, v_supplier_id, v_allocation_id;
    END IF;
  END LOOP;

  IF v_total_physical > p_received_quantity + 0.000001 THEN
    RAISE EXCEPTION 'Распределение превышает фактически принятый объем';
  END IF;

  UPDATE public.supply_order_delivery_schedules
  SET status = 'delivered',
      received_quantity = p_received_quantity,
      allocated_quantity = v_source_allocated,
      allocated_physical_quantity = v_source_physical,
      received_piece_length_mm = p_received_piece_length_mm,
      received_piece_count = p_received_piece_count,
      allocated_piece_count = CASE WHEN p_received_piece_count IS NULL THEN NULL ELSE v_source_pieces END,
      excess_quantity = GREATEST(p_received_quantity - v_total_physical, 0),
      receipt_inventory_id = v_inventory_id,
      delivered_at = now(),
      received_by = p_performed_by,
      updated_by = p_performed_by,
      updated_at = now()
  WHERE id = p_schedule_id;

  v_item_name := CASE v_schedule.request_item_table
    WHEN 'request_sheet_metal' THEN COALESCE(NULLIF(v_source_item->>'material_name', ''), 'Листовой металл')
    WHEN 'request_round_tube' THEN COALESCE(NULLIF(v_source_item->>'material_name', ''), 'Круг / Труба')
    WHEN 'request_circle' THEN COALESCE(NULLIF(v_source_item->>'steel_grade', ''), 'Круг')
    WHEN 'request_pipe' THEN COALESCE(NULLIF(v_source_item->>'size', ''), 'Труба')
    WHEN 'request_knives' THEN COALESCE(NULLIF(v_source_item->>'knife_type', ''), 'Ножи')
    WHEN 'request_components' THEN COALESCE(NULLIF(v_source_item->>'component_name', ''), 'Комплектация')
    WHEN 'request_paint' THEN COALESCE(NULLIF(v_source_item->>'paint_type', ''), NULLIF(v_source_item->>'ral_code', ''), 'Краска')
    WHEN 'request_mesh' THEN COALESCE(NULLIF(v_source_item->>'description', ''), 'Сетка')
    WHEN 'request_chain_cord' THEN COALESCE(NULLIF(v_source_item->>'parameters', ''), 'Цепь / Шнур')
    ELSE 'Материал'
  END;

  IF current_setting('app.receiving_batch_mode', true) IS DISTINCT FROM 'on' AND (p_received_quantity < v_schedule.quantity OR p_received_quantity >= v_schedule.quantity * 1.3) THEN
    v_source_key := 'material_receipt_variance:' || p_schedule_id::text;
    v_title := CASE
      WHEN p_received_quantity < v_schedule.quantity THEN 'Недовес при приемке материала'
      ELSE 'Перепоставка материала +30%'
    END;
    v_description := concat(
      v_item_name,
      CASE WHEN v_machine_name IS NOT NULL THEN ' для машины ' || v_machine_name ELSE '' END,
      '. Дата снабжения: ', to_char(v_schedule.delivery_date, 'DD.MM.YYYY'),
      '. План: ', v_schedule.quantity::text, ' ', v_schedule.unit,
      '. Факт: ', p_received_quantity::text, ' ', v_schedule.unit,
      '. На потребности распределено: ', v_total_physical::text, ' ', v_schedule.unit,
      '. Свободный излишек на складе: ', GREATEST(p_received_quantity - v_total_physical, 0)::text, ' ', v_schedule.unit, '.'
    );

    INSERT INTO public.meeting_agenda_pool_items (
      source_key, source_type, machine_id, title, description, status, updated_at
    ) VALUES (
      v_source_key, 'material_receipt_variance', v_machine_id,
      v_title, v_description, 'new', now()
    )
    ON CONFLICT (source_key) DO UPDATE
    SET title = EXCLUDED.title,
        description = EXCLUDED.description,
        machine_id = EXCLUDED.machine_id,
        updated_at = now()
    WHERE meeting_agenda_pool_items.status = 'new';

    INSERT INTO public.notifications (user_id, type, title, message, related_machine_id)
    SELECT id, 'material_receipt_variance', v_title, v_description, v_machine_id
    FROM public.users
    WHERE role = 'planning_director' AND is_active = true;
  END IF;

  IF current_setting('app.receiving_batch_mode', true) IS DISTINCT FROM 'on' AND p_received_quantity < v_schedule.quantity THEN
    v_today := (now() AT TIME ZONE 'Europe/Chisinau')::date;
    SELECT EXISTS (
      SELECT 1 FROM public.users WHERE role = 'procurement_head' AND is_active = true
    ) INTO v_has_procurement_head;

    INSERT INTO public.tasks (
      machine_id, supply_order_schedule_id, assigned_to, task_type,
      title, description, status, start_date, deadline
    )
    SELECT v_machine_id, p_schedule_id, user_row.id,
      'supply_material_receipt_shortage'::public.task_type,
      'Разобрать недовес по поставке', v_description, 'pending', v_today, v_today
    FROM public.users user_row
    WHERE user_row.is_active = true
      AND ((v_has_procurement_head AND user_row.role = 'procurement_head')
        OR (NOT v_has_procurement_head AND user_row.role = 'supply_manager'))
    ON CONFLICT (supply_order_schedule_id, assigned_to, task_type)
      WHERE supply_order_schedule_id IS NOT NULL
        AND status IN ('pending', 'in_progress')
    DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'inventory_id', v_inventory_id,
    'received_quantity', p_received_quantity,
    'allocated_physical_quantity', v_total_physical,
    'excess_quantity', GREATEST(p_received_quantity - v_total_physical, 0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_replace_supply_order_delivery_schedules_v1(p_delete_ids uuid[], p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_delete_count integer := 0;
  v_existing_count integer := 0;
begin
  if v_actor is null or not public.security_can_manage_supply() then
    raise exception 'Недостаточно прав для изменения графика поставки';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Некорректный состав графика поставки';
  end if;

  select count(*) into v_delete_count
  from (select distinct value from unnest(coalesce(p_delete_ids, '{}'::uuid[])) value) ids;
  if v_delete_count <> cardinality(coalesce(p_delete_ids, '{}'::uuid[])) then
    raise exception 'Строки графика для замены не должны повторяться';
  end if;

  perform 1
  from public.supply_order_delivery_schedules schedule
  where schedule.id = any(coalesce(p_delete_ids, '{}'::uuid[]))
  for update;

  select count(*) into v_existing_count
  from public.supply_order_delivery_schedules schedule
  where schedule.id = any(coalesce(p_delete_ids, '{}'::uuid[]))
    and schedule.status = 'planned';
  if v_existing_count <> v_delete_count then
    raise exception 'Заменять можно только существующие плановые строки графика';
  end if;

  delete from public.supply_order_delivery_schedules schedule
  where schedule.id = any(coalesce(p_delete_ids, '{}'::uuid[]));

  insert into public.supply_order_delivery_schedules (
    request_item_table,
    request_item_id,
    delivery_date,
    quantity,
    unit,
    supplier_id,
    planned_piece_length_mm,
    planned_piece_count,
    created_by,
    updated_by
  )
  select
    row.request_item_table,
    row.request_item_id,
    row.delivery_date,
    row.quantity,
    row.unit,
    row.supplier_id,
    row.planned_piece_length_mm,
    row.planned_piece_count,
    v_actor,
    v_actor
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row(
    request_item_table text,
    request_item_id uuid,
    delivery_date date,
    quantity numeric,
    unit text,
    supplier_id uuid,
    planned_piece_length_mm numeric,
    planned_piece_count numeric
  )
  where row.request_item_table in (
    'request_sheet_metal',
    'request_round_tube',
    'request_circle',
    'request_pipe',
    'request_knives',
    'request_components',
    'request_paint',
    'request_mesh',
    'request_chain_cord'
  );

  if (select count(*) from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)))
    <> (select count(*) from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row(
      request_item_table text,
      request_item_id uuid,
      delivery_date date,
      quantity numeric,
      unit text,
      supplier_id uuid,
      planned_piece_length_mm numeric,
      planned_piece_count numeric
    ) where row.request_item_table in (
      'request_sheet_metal', 'request_round_tube', 'request_circle', 'request_pipe',
      'request_knives', 'request_components', 'request_paint', 'request_mesh', 'request_chain_cord'
    )) then
    raise exception 'Некорректная таблица позиции графика поставки';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_return_technologist_request_for_revision(p_approval_version_id uuid, p_actor uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_version public.technologist_request_approval_versions%rowtype; v_request public.technologist_requests%rowtype;
begin
  if p_actor is null then raise exception 'Недостаточно прав'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Укажите причину возврата'; end if;
  if not exists (select 1 from public.users u where u.id = p_actor and u.is_active and u.role = 'financial_director')
     and not exists (
       select 1 from public.users u join public.department_members dm on dm.user_id = u.id
       join public.positions p on p.id = dm.position_id
       where u.id = p_actor and u.is_active and p.is_active and p.name = 'Администратор CRM'
     ) then raise exception 'Вернуть заявку может финансовый директор или администратор CRM'; end if;
  select r.* into v_request from public.technologist_requests r
    join public.technologist_request_approval_versions v on v.request_id = r.id
    where v.id = p_approval_version_id for update of r;
  select * into v_version from public.technologist_request_approval_versions where id = p_approval_version_id for update;
  if not found or v_version.state <> 'pending' then raise exception 'Решение по версии уже принято'; end if;
  if v_request.status <> 'pending_financial_approval' then raise exception 'Заявка больше не ожидает согласования'; end if;
  update public.technologist_request_approval_versions
    set state = 'returned', return_reason = btrim(p_reason), decided_by = p_actor, decided_at = now(), updated_at = now()
    where id = v_version.id;
  update public.tasks set status = 'completed', completed_at = now(), updated_at = now()
    where technologist_request_approval_id = v_version.id and status in ('pending', 'in_progress');
  perform set_config('app.financial_approval_request', v_request.id::text, true);
  update public.technologist_requests set status = 'pending_stock_check', submitted_at = null, updated_at = now()
    where id = v_request.id;
  perform set_config('app.financial_approval_request', '', true);
  insert into public.notifications(user_id, type, title, message, related_machine_id)
  values (v_request.created_by, 'technologist_request_approval', 'Заявка возвращена на доработку', btrim(p_reason), v_request.machine_id);
end;
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
    from public.users app_user
    join public.department_members member on member.user_id = app_user.id
    join public.positions position on position.id = member.position_id
    where app_user.is_active and position.is_active and position.name = 'Администратор CRM';
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

CREATE OR REPLACE FUNCTION public.fn_submit_technologist_request_for_approval(p_request_id uuid, p_actor uuid, p_completion_payload jsonb, p_summary_snapshot jsonb, p_archives jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare
  v_request public.technologist_requests%rowtype;
  v_machine_name text;
  v_version_id uuid;
  v_revision integer;
  v_request_number integer;
  v_recipients uuid[];
  v_recipient uuid;
  v_archive jsonb;
  v_storage storage.objects%rowtype;
  v_path_prefix text;
begin
  if not exists (select 1 from public.users where id = p_actor and is_active) then raise exception 'Недостаточно прав'; end if;
  if jsonb_typeof(p_completion_payload) <> 'object' or jsonb_typeof(p_summary_snapshot) <> 'object' then
    raise exception 'Некорректный снимок заявки';
  end if;
  if jsonb_typeof(coalesce(p_archives, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_archives, '[]'::jsonb)) > 20 then
    raise exception 'Можно прикрепить не более 20 архивов';
  end if;

  select r.* into v_request
  from public.technologist_requests r
  where r.id = p_request_id
  for update of r;
  if not found or v_request.created_by <> p_actor then raise exception 'Заявка недоступна'; end if;
  if not exists (select 1 from public.users where id = p_actor and is_active) then raise exception 'Недостаточно прав'; end if;
  select m.name into v_machine_name from public.machines m where m.id = v_request.machine_id and not m.is_archived;
  if not found then raise exception 'Заказ находится в архиве'; end if;
  if v_request.status <> 'stock_checked' then raise exception 'Заявка не готова к согласованию'; end if;
  if p_summary_snapshot->'sourceData' is distinct from public.fn_technologist_approval_source(p_request_id) then
    raise exception 'Данные заявки изменились. Обновите итоговый мастер';
  end if;
  if exists (select 1 from public.technologist_request_completions c where c.request_id = p_request_id) then
    raise exception 'Производственные последствия уже зафиксированы';
  end if;
  if exists (select 1 from public.technologist_request_approval_versions v where v.request_id = p_request_id and v.state = 'pending') then
    raise exception 'Заявка уже ожидает согласования';
  end if;
  v_path_prefix := 'machine-cutting/' || v_request.machine_id || '/' || p_request_id || '/';
  for v_archive in select * from jsonb_array_elements(coalesce(p_archives, '[]'::jsonb)) loop
    if v_archive->>'requestId' is distinct from p_request_id::text
       or nullif(v_archive->>'completionId', '') is not null
       or btrim(coalesce(v_archive->>'fileName', '')) = ''
       or (v_archive->>'fileSize')::bigint <= 0
       or (v_archive->>'fileSize')::bigint > 524288000
       or lower(v_archive->>'fileName') !~ '\.(zip|rar|7z)$'
       or v_archive->>'objectPath' not like v_path_prefix || '%'
       or v_archive->>'objectPath' like '%..%' then
      raise exception 'Некорректный архив порезки';
    end if;
    select * into v_storage from storage.objects
    where bucket_id = 'nesting-files' and name = v_archive->>'objectPath';
    if not found or coalesce((v_storage.metadata->>'size')::bigint, -1) <> (v_archive->>'fileSize')::bigint then
      raise exception 'Загруженный архив не найден или его размер не совпадает';
    end if;
  end loop;

  select coalesce(array_agg(u.id order by u.id), '{}'::uuid[]) into v_recipients
  from public.users u where u.is_active and u.role = 'financial_director';
  if cardinality(v_recipients) = 0 then
    select coalesce(array_agg(distinct u.id order by u.id), '{}'::uuid[]) into v_recipients
    from public.users u
    join public.department_members dm on dm.user_id = u.id
    join public.positions p on p.id = dm.position_id
    where u.is_active and p.is_active and p.name = 'Администратор CRM';
  end if;
  if cardinality(v_recipients) = 0 then
    raise exception 'Нет активного финансового директора или администратора CRM';
  end if;

  select coalesce(max(v.revision_number), -1) + 1 into v_revision
  from public.technologist_request_approval_versions v where v.request_id = p_request_id;
  select count(*) into v_request_number
  from public.technologist_requests numbered
  where numbered.machine_id = v_request.machine_id
    and (numbered.created_at, numbered.id) <= (v_request.created_at, v_request.id);
  insert into public.technologist_request_approval_versions(
    request_id, revision_number, state, completion_payload, summary_snapshot, submitted_by
  ) values (p_request_id, v_revision, 'pending', p_completion_payload, p_summary_snapshot, p_actor)
  returning id into v_version_id;

  for v_archive in select * from jsonb_array_elements(coalesce(p_archives, '[]'::jsonb)) loop
    insert into public.technologist_request_approval_archives(
      approval_version_id, object_path, file_name, mime_type, file_size
    ) values (
      v_version_id, v_archive->>'objectPath', btrim(v_archive->>'fileName'),
      nullif(v_archive->>'mimeType', ''), (v_archive->>'fileSize')::bigint
    );
  end loop;

  foreach v_recipient in array v_recipients loop
    insert into public.tasks(
      machine_id, assigned_to, task_type, title, description, status,
      start_date, deadline, technologist_request_approval_id, technologist_request_approval_machine_id
    ) values (
      null, v_recipient, 'technologist_request_approval',
      'Проверить и одобрить заявку',
      'Заявка №' || v_request_number || ' для заказа «' || coalesce(v_machine_name, 'Без названия') || '»',
      'pending', (now() at time zone 'Europe/Kyiv')::date,
      (now() at time zone 'Europe/Kyiv')::date, v_version_id, v_request.machine_id
    );
  end loop;

  perform set_config('app.financial_approval_request', p_request_id::text, true);
  update public.technologist_requests
  set status = 'pending_financial_approval', submitted_at = null, updated_at = now()
  where id = p_request_id;
  perform set_config('app.financial_approval_request', '', true);
  return v_version_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sync_client_delivery_date_task(p_machine_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_machine record;
  v_shipping_date date;
  v_calculated_delivery_date date;
  v_deadline date;
  v_today date := (now() AT TIME ZONE 'Europe/Kyiv')::date;
  v_manager_is_valid boolean := false;
  v_task_id uuid;
  v_current_assignee uuid;
BEGIN
  SELECT
    machine.id,
    machine.name,
    machine.client_id,
    machine.is_archived,
    machine.desired_shipping_date,
    machine.actual_shipping_date,
    machine.delivery_to_client_date,
    client.responsible_user_id,
    COALESCE(client.estimated_delivery_days, 7) AS estimated_delivery_days
  INTO v_machine
  FROM public.machines machine
  LEFT JOIN public.clients client ON client.id = machine.client_id
  WHERE machine.id = p_machine_id
  FOR UPDATE OF machine;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_shipping_date := COALESCE(v_machine.actual_shipping_date, v_machine.desired_shipping_date)::date;
  IF v_shipping_date IS NOT NULL THEN
    v_calculated_delivery_date := v_shipping_date + v_machine.estimated_delivery_days::integer;
    v_deadline := v_calculated_delivery_date - 3;
  END IF;

  IF v_machine.responsible_user_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.users manager
      WHERE manager.id = v_machine.responsible_user_id
        AND manager.role = 'sales_manager'::public.user_role
        AND manager.is_active = true
        AND COALESCE(manager.is_service_account, false) = false
    ) INTO v_manager_is_valid;
  END IF;

  SELECT task.id, task.assigned_to
  INTO v_task_id, v_current_assignee
  FROM public.tasks task
  WHERE task.machine_id = p_machine_id
    AND task.task_type = 'client_delivery_date'
    AND task.status IN ('pending', 'in_progress')
  ORDER BY task.created_at, task.id
  LIMIT 1
  FOR UPDATE;

  IF COALESCE(v_machine.is_archived, false) THEN
    PERFORM set_config('app.client_delivery_task_sync', 'on', true);
    UPDATE public.tasks
    SET status = 'cancelled', completed_at = NULL, updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'client_delivery_date'
      AND status IN ('pending', 'in_progress');

    UPDATE public.task_delegations delegation
    SET status = 'cancelled', responded_at = now()
    FROM public.tasks task
    WHERE delegation.task_id = task.id
      AND task.machine_id = p_machine_id
      AND task.task_type = 'client_delivery_date'
      AND delegation.status = 'pending';
    PERFORM set_config('app.client_delivery_task_sync', 'off', true);
    RETURN;
  END IF;

  IF v_machine.delivery_to_client_date IS NOT NULL THEN
    PERFORM set_config('app.client_delivery_task_sync', 'on', true);
    UPDATE public.tasks
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'client_delivery_date'
      AND status IN ('pending', 'in_progress');

    UPDATE public.task_delegations delegation
    SET status = 'cancelled', responded_at = now()
    FROM public.tasks task
    WHERE delegation.task_id = task.id
      AND task.machine_id = p_machine_id
      AND task.task_type = 'client_delivery_date'
      AND delegation.status = 'pending';
    PERFORM set_config('app.client_delivery_task_sync', 'off', true);
    RETURN;
  END IF;

  IF v_machine.client_id IS NULL
     OR v_shipping_date IS NULL
     OR v_deadline IS NULL
     OR v_machine.responsible_user_id IS NULL
     OR NOT v_manager_is_valid
     OR v_today < v_deadline THEN
    PERFORM set_config('app.client_delivery_task_sync', 'on', true);
    UPDATE public.tasks
    SET status = 'cancelled', completed_at = NULL, updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'client_delivery_date'
      AND status IN ('pending', 'in_progress');

    UPDATE public.task_delegations delegation
    SET status = 'cancelled', responded_at = now()
    FROM public.tasks task
    WHERE delegation.task_id = task.id
      AND task.machine_id = p_machine_id
      AND task.task_type = 'client_delivery_date'
      AND delegation.status = 'pending';
    PERFORM set_config('app.client_delivery_task_sync', 'off', true);
    RETURN;
  END IF;

  IF v_task_id IS NOT NULL AND v_current_assignee IS DISTINCT FROM v_machine.responsible_user_id THEN
    PERFORM set_config('app.client_delivery_task_sync', 'on', true);
    UPDATE public.tasks
    SET status = 'cancelled', completed_at = NULL, updated_at = now()
    WHERE id = v_task_id;

    UPDATE public.task_delegations
    SET status = 'cancelled', responded_at = now()
    WHERE task_id = v_task_id
      AND status = 'pending';
    PERFORM set_config('app.client_delivery_task_sync', 'off', true);
    v_task_id := NULL;
  END IF;

  IF v_task_id IS NOT NULL THEN
    UPDATE public.tasks
    SET title = 'Внести дату доставки клиенту: ' || COALESCE(v_machine.name, 'Машина'),
        description = 'Внесите фактическую дату доставки клиенту. Расчётная дата доставки: '
          || to_char(v_calculated_delivery_date, 'DD.MM.YYYY') || ' ('
          || CASE
               WHEN v_machine.actual_shipping_date IS NOT NULL THEN 'фактическая дата отгрузки '
               ELSE 'плановая дата отгрузки '
             END
          || to_char(v_shipping_date, 'DD.MM.YYYY') || ' + '
          || v_machine.estimated_delivery_days::text || ' календ. дн.).',
        start_date = v_deadline,
        deadline = v_deadline,
        completed_at = NULL,
        updated_at = now()
    WHERE id = v_task_id;
    RETURN;
  END IF;

  INSERT INTO public.tasks (
    machine_id,
    assigned_to,
    task_type,
    title,
    description,
    status,
    start_date,
    deadline
  ) VALUES (
    p_machine_id,
    v_machine.responsible_user_id,
    'client_delivery_date',
    'Внести дату доставки клиенту: ' || COALESCE(v_machine.name, 'Машина'),
    'Внесите фактическую дату доставки клиенту. Расчётная дата доставки: '
      || to_char(v_calculated_delivery_date, 'DD.MM.YYYY') || ' ('
      || CASE
           WHEN v_machine.actual_shipping_date IS NOT NULL THEN 'фактическая дата отгрузки '
           ELSE 'плановая дата отгрузки '
         END
      || to_char(v_shipping_date, 'DD.MM.YYYY') || ' + '
      || v_machine.estimated_delivery_days::text || ' календ. дн.).',
    'pending',
    v_deadline,
    v_deadline
  )
  ON CONFLICT (machine_id)
    WHERE task_type = 'client_delivery_date'
      AND status IN ('pending', 'in_progress')
  DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    start_date = EXCLUDED.start_date,
    deadline = EXCLUDED.deadline,
    updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sync_production_plan_preparation_task(p_machine_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_machine record;
  v_plan_status text;
  v_deadline date;
  v_manager record;
BEGIN
  SELECT id, name, factory_id, production_month, is_confirmed, is_archived
  INTO v_machine
  FROM public.machines
  WHERE id = p_machine_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(v_machine.is_archived, false)
     OR NOT COALESCE(v_machine.is_confirmed, false)
     OR v_machine.factory_id IS NULL
     OR v_machine.production_month IS NULL THEN
    UPDATE public.tasks
    SET status = 'cancelled', updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'production_plan_preparation'
      AND status IN ('pending', 'in_progress');
    RETURN;
  END IF;

  SELECT status::text
  INTO v_plan_status
  FROM public.production_month_plans
  WHERE factory_id = v_machine.factory_id
    AND production_month = date_trunc('month', v_machine.production_month)::date
  LIMIT 1;

  IF v_plan_status IN ('preliminary_ready', 'confirmed') THEN
    UPDATE public.tasks
    SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'production_plan_preparation'
      AND status IN ('pending', 'in_progress');
    RETURN;
  END IF;

  v_deadline := (
    date_trunc('month', v_machine.production_month)::date
    - interval '1 month'
    + interval '9 days'
  )::date;

  UPDATE public.tasks t
  SET status = 'cancelled', updated_at = now()
  WHERE t.machine_id = p_machine_id
    AND t.task_type = 'production_plan_preparation'
    AND t.status IN ('pending', 'in_progress')
    AND NOT EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = t.assigned_to
        AND u.role = 'production_manager'
        AND u.factory_id = v_machine.factory_id
        AND COALESCE(u.is_active, true)
    );

  FOR v_manager IN
    SELECT id
    FROM public.users
    WHERE role = 'production_manager'
      AND factory_id = v_machine.factory_id
      AND COALESCE(is_active, true)
    ORDER BY full_name, created_at, id
  LOOP
    INSERT INTO public.tasks (
      machine_id,
      assigned_to,
      task_type,
      title,
      description,
      status,
      start_date,
      deadline,
      completed_at,
      notified_at,
      telegram_error,
      updated_at
    ) VALUES (
      p_machine_id,
      v_manager.id,
      'production_plan_preparation',
      'Подготовить предварительный план: ' || COALESCE(v_machine.name, 'машина'),
      'Составьте предварительный план производства машины до 10 числа месяца, предшествующего месяцу производства. Месяц производства: '
        || to_char(v_machine.production_month, 'MM.YYYY') || '.',
      'pending',
      CURRENT_DATE,
      v_deadline,
      NULL,
      NULL,
      NULL,
      now()
    )
    ON CONFLICT (machine_id, assigned_to, task_type) WHERE machine_id IS NOT NULL AND status IN ('pending','in_progress')
    DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      status = CASE
        WHEN tasks.status = 'in_progress' THEN 'in_progress'::public.task_status
        ELSE 'pending'::public.task_status
      END,
      start_date = EXCLUDED.start_date,
      deadline = EXCLUDED.deadline,
      completed_at = NULL,
      notified_at = CASE
        WHEN tasks.status IN ('completed', 'cancelled') THEN NULL
        ELSE tasks.notified_at
      END,
      telegram_error = NULL,
      updated_at = now();
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_user_can_decide_machine_discount(p_actor uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.users app_user
    where app_user.id = p_actor and app_user.is_active and app_user.role = 'financial_director'
  ) or public.crm_user_is_admin(p_actor);
$function$;

CREATE OR REPLACE FUNCTION public.fn_user_can_manage_client_prices(p_actor uuid, p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.users app_user
    join public.clients client on client.id = p_client_id
    where app_user.id = p_actor
      and app_user.is_active
      and (
        client.responsible_user_id = app_user.id
        or public.crm_user_is_admin(app_user.id)
        or (
          app_user.role <> 'sales_manager'
          and exists (
            select 1 from public.department_members sales_member
            join public.department_access_permissions sales_permission
              on sales_permission.department_id = sales_member.department_id
             and sales_permission.subject_scope = case when sales_member.is_department_head then 'head' else 'member' end
            where sales_member.user_id = app_user.id
              and sales_permission.resource_key = 'sales_plan'
              and sales_permission.can_manage
          )
          and exists (
            select 1 from public.department_members price_member
            join public.department_access_permissions price_permission
              on price_permission.department_id = price_member.department_id
             and price_permission.subject_scope = case when price_member.is_department_head then 'head' else 'member' end
            where price_member.user_id = app_user.id
              and price_permission.resource_key = 'client_prices'
              and price_permission.can_manage
              and (price_permission.company_manage_scope = 'all' or client.responsible_user_id = app_user.id)
          )
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_user_role()
 RETURNS user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT role FROM users WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.inventory_transfer_role_allowed(p_roles user_role[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS app_user
    WHERE app_user.id = auth.uid()
      AND app_user.role = ANY(p_roles)
      AND COALESCE(app_user.is_active, true)
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_director()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT role IN ('planning_director', 'financial_director', 'commercial_director')
  FROM users WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.notify_department_request_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  author_name text;
  actor_name text;
  target_label text;
  status_message text;
begin
  target_label := case new.target_department
    when 'technologist' then 'технологу'
    when 'supply' then 'снабжению'
    else 'производству'
  end;

  if tg_op = 'INSERT' then
    select coalesce(full_name, 'Сотрудник') into author_name
    from public.users
    where id = new.created_by;

    if new.request_kind = 'long_stock_recalculation' then
      insert into public.notifications (
        user_id, type, title, message, related_machine_id,
        related_department_request_id
      )
      select
        new.assigned_to,
        'department_request_new_technologist',
        'Позиция возвращена на пересчёт',
        new.request_item_label || ' · ' || new.description,
        new.machine_id,
        new.id
      where new.assigned_to is not null;
    else
      insert into public.notifications (
        user_id, type, title, message, related_department_request_id
      )
      select distinct
        recipient.user_id,
        'department_request_new_' || new.target_department,
        'Новый запрос: ' || new.title,
        coalesce(author_name, 'Сотрудник') || ' отправил запрос ' || target_label,
        new.id
      from (
        select member.user_id
        from public.department_members member
        join public.departments department on department.id = member.department_id
        where department.is_active
          and (
            (new.target_department = 'technologist'
              and (lower(department.name) like '%техническ%' or lower(department.name) like '%технолог%'))
            or (new.target_department = 'supply'
              and (lower(department.name) like '%снабжен%' or lower(department.name) like '%закуп%'))
            or (new.target_department = 'production'
              and (lower(department.name) like '%производств%' or lower(department.name) like '%цех%')
              and (
                new.factory_id is null
                or department.factory_id is null
                or department.factory_id = new.factory_id
              ))
          )

        union

        select app_user.id
        from public.users app_user
        where app_user.is_active
          and (
            (new.target_department = 'technologist' and app_user.role::text in ('engineer', 'technologist'))
            or (new.target_department = 'supply' and app_user.role::text in ('supply_manager', 'procurement_head'))
            or (
              new.target_department = 'production'
              and app_user.role::text in ('production_manager', 'painting_head')
              and (new.factory_id is null or app_user.factory_id = new.factory_id)
            )
          )
      ) recipient
      where recipient.user_id <> new.created_by;
    end if;
  elsif new.status is distinct from old.status then
    select coalesce(full_name, 'Сотрудник')
      into actor_name
    from public.users
    where id = case
      when new.status = 'in_progress' then new.assigned_to
      when new.status in ('done', 'rejected') then new.completed_by
      else new.created_by
    end;

    status_message := new.title || ': ' || case new.status
      when 'in_progress' then 'в работе · ' || coalesce(actor_name, 'исполнитель назначен')
      when 'done' then 'решён · ' || coalesce(actor_name, 'отдел')
      when 'rejected' then 'отклонён · ' || coalesce(actor_name, 'отдел')
      when 'cancelled' then 'отменён'
      else 'новый'
    end;

    insert into public.notifications (
      user_id, type, title, message, related_machine_id,
      related_department_request_id
    )
    values (
      new.created_by,
      'department_request_status_' || new.target_department,
      'Статус запроса изменён',
      status_message,
      new.machine_id,
      new.id
    );
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_production_managers_for_machine(p_factory_id uuid, p_type text, p_title text, p_message text, p_machine_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO notifications (user_id, type, title, message, related_machine_id)
  SELECT u.id, p_type, p_title, p_message, p_machine_id
  FROM users u
  WHERE u.role = 'production_manager'
    AND u.is_active = true
    AND (p_factory_id IS NULL OR u.factory_id = p_factory_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_users_by_role(p_role user_role, p_type text, p_title text, p_message text, p_machine_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO notifications (user_id, type, title, message, related_machine_id)
  SELECT u.id, p_type, p_title, p_message, p_machine_id
  FROM users u
  WHERE u.role = p_role
    AND u.is_active = true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_users_by_role_in_factory(p_factory_id uuid, p_role user_role, p_type text, p_title text, p_message text, p_machine_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO notifications (user_id, type, title, message, related_machine_id)
  SELECT u.id, p_type, p_title, p_message, p_machine_id
  FROM users u
  WHERE u.factory_id = p_factory_id
    AND u.role = p_role
    AND u.is_active = true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_client_responsible_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN
      IF public.get_user_role() = 'sales_manager'::public.user_role THEN
        NEW.responsible_user_id := auth.uid();
      ELSE
        NEW.responsible_user_id := NULL;
      END IF;
    ELSIF NEW.responsible_user_id IS DISTINCT FROM OLD.responsible_user_id THEN
      RAISE EXCEPTION 'Client responsible manager can be changed only through the protected server action';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reorder_machine_production_queue(p_machine_id uuid, p_target_factory_id uuid, p_target_workshop smallint, p_target_queue_number integer, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_machine_name text;
  v_production_month date;
  v_source_factory_id uuid;
  v_source_factory_name text;
  v_source_workshop smallint;
  v_source_queue integer;
  v_target_factory_name text;
  v_target_queue integer;
  v_target_count integer;
  v_actor_name text;
  v_message text;
BEGIN
  IF p_target_queue_number < 1 THEN
    RAISE EXCEPTION 'Номер очереди должен быть больше нуля';
  END IF;

  -- Queue edits are infrequent; a single transaction lock prevents cross-column
  -- moves from deadlocking while they lock the same two groups in reverse order.
  PERFORM pg_advisory_xact_lock(hashtextextended('machine-production-queue', 0));

  SELECT m.name, m.production_month, m.factory_id, f.name,
         m.production_workshop, m.production_queue_number
    INTO v_machine_name, v_production_month, v_source_factory_id, v_source_factory_name,
         v_source_workshop, v_source_queue
  FROM public.machines m
  LEFT JOIN public.factories f ON f.id = m.factory_id
  WHERE m.id = p_machine_id
    AND COALESCE(m.is_archived, false) = false
  FOR UPDATE OF m;

  IF v_machine_name IS NULL THEN
    RAISE EXCEPTION 'Машина не найдена';
  END IF;
  IF v_production_month IS NULL OR v_source_factory_id IS NULL
     OR v_source_workshop IS NULL OR v_source_queue IS NULL THEN
    RAISE EXCEPTION 'Сначала назначьте машине месяц, завод, цех и очередь';
  END IF;

  SELECT name INTO v_target_factory_name
  FROM public.factories
  WHERE id = p_target_factory_id;

  IF v_target_factory_name IS NULL THEN
    RAISE EXCEPTION 'Целевой завод не найден';
  END IF;

  IF lower(v_target_factory_name) LIKE '%берегово%' THEN
    IF p_target_workshop NOT IN (1, 2) THEN
      RAISE EXCEPTION 'Для Берегово доступны только цеха 1 и 2';
    END IF;
  ELSIF p_target_workshop <> 1 THEN
    RAISE EXCEPTION 'Для этого завода доступен только цех 1';
  END IF;

  -- Serialize changes in both affected groups.
  PERFORM 1
  FROM public.machines m
  WHERE m.production_month = v_production_month
    AND (
      (m.factory_id = v_source_factory_id AND m.production_workshop = v_source_workshop)
      OR
      (m.factory_id = p_target_factory_id AND m.production_workshop = p_target_workshop)
    )
  ORDER BY m.id
  FOR UPDATE;

  -- Close any historical gaps before calculating the requested position.
  WITH ranked AS (
    SELECT m.id,
           row_number() OVER (
             PARTITION BY m.production_month, m.factory_id, m.production_workshop
             ORDER BY m.production_queue_number NULLS LAST, m.created_at, m.id
           )::integer AS queue_number
    FROM public.machines m
    WHERE m.production_month = v_production_month
      AND COALESCE(m.is_archived, false) = false
      AND (
        (m.factory_id = v_source_factory_id AND m.production_workshop = v_source_workshop)
        OR
        (m.factory_id = p_target_factory_id AND m.production_workshop = p_target_workshop)
      )
  )
  UPDATE public.machines m
  SET production_queue_number = ranked.queue_number
  FROM ranked
  WHERE m.id = ranked.id;

  SELECT production_queue_number INTO v_source_queue
  FROM public.machines
  WHERE id = p_machine_id;

  SELECT count(*) INTO v_target_count
  FROM public.machines m
  WHERE m.production_month = v_production_month
    AND m.factory_id = p_target_factory_id
    AND m.production_workshop = p_target_workshop
    AND m.id <> p_machine_id
    AND COALESCE(m.is_archived, false) = false;

  v_target_queue := LEAST(p_target_queue_number, v_target_count + 1);

  IF v_source_factory_id = p_target_factory_id AND v_source_workshop = p_target_workshop THEN
    IF v_target_queue < v_source_queue THEN
      UPDATE public.machines
      SET production_queue_number = production_queue_number + 1
      WHERE production_month = v_production_month
        AND factory_id = v_source_factory_id
        AND production_workshop = v_source_workshop
        AND id <> p_machine_id
        AND production_queue_number >= v_target_queue
        AND production_queue_number < v_source_queue;
    ELSIF v_target_queue > v_source_queue THEN
      UPDATE public.machines
      SET production_queue_number = production_queue_number - 1
      WHERE production_month = v_production_month
        AND factory_id = v_source_factory_id
        AND production_workshop = v_source_workshop
        AND id <> p_machine_id
        AND production_queue_number > v_source_queue
        AND production_queue_number <= v_target_queue;
    END IF;
  ELSE
    UPDATE public.machines
    SET production_queue_number = production_queue_number - 1
    WHERE production_month = v_production_month
      AND factory_id = v_source_factory_id
      AND production_workshop = v_source_workshop
      AND id <> p_machine_id
      AND production_queue_number > v_source_queue;

    UPDATE public.machines
    SET production_queue_number = production_queue_number + 1
    WHERE production_month = v_production_month
      AND factory_id = p_target_factory_id
      AND production_workshop = p_target_workshop
      AND id <> p_machine_id
      AND production_queue_number >= v_target_queue;
  END IF;

  UPDATE public.machines
  SET factory_id = p_target_factory_id,
      production_workshop = p_target_workshop,
      production_queue_number = v_target_queue,
      updated_at = now()
  WHERE id = p_machine_id;

  SELECT full_name INTO v_actor_name FROM public.users WHERE id = p_changed_by;
  v_actor_name := COALESCE(v_actor_name, 'Пользователь CRM');
  v_message := format(
    'Очередь производства изменена. Было: %s · Цех %s · Очередь %s. Стало: %s · Цех %s · Очередь %s. Изменил: %s.',
    COALESCE(v_source_factory_name, 'Без завода'), v_source_workshop, v_source_queue,
    v_target_factory_name, p_target_workshop, v_target_queue, v_actor_name
  );

  INSERT INTO public.machine_updates (
    machine_id, body, created_by, updated_by, message_kind, system_event_key
  ) VALUES (
    p_machine_id, v_message, p_changed_by, p_changed_by, 'system',
    'production_queue_changed:' || gen_random_uuid()::text
  );

  INSERT INTO public.notifications (user_id, type, title, message, related_machine_id)
  SELECT DISTINCT u.id, 'production_queue_changed',
         'Изменена очередь производства', v_message, p_machine_id
  FROM public.users u
  WHERE u.is_active = true
    AND (
      u.role IN (
        'financial_director'::public.user_role,
        'engineer'::public.user_role,
        'technologist'::public.user_role,
        'supply_manager'::public.user_role,
        'production_manager'::public.user_role
      )
      OR EXISTS (
        SELECT 1
        FROM public.department_members dm
        JOIN public.departments d ON d.id = dm.department_id AND d.is_active = true
        LEFT JOIN public.departments parent ON parent.id = d.parent_id AND parent.is_active = true
        LEFT JOIN public.positions pos ON pos.id = dm.position_id
        WHERE dm.user_id = u.id
          AND lower(concat_ws(' ', d.name, parent.name, pos.name)) ~
            '(снаб|закуп|постач|supply|procurement|purchase|инженер|конструкт|engineer|технолог|technolog|производ|production)'
      )
    );

  RETURN jsonb_build_object(
    'machineId', p_machine_id,
    'machineName', v_machine_name,
    'productionMonth', v_production_month,
    'before', jsonb_build_object(
      'factoryId', v_source_factory_id,
      'factoryName', v_source_factory_name,
      'workshop', v_source_workshop,
      'queueNumber', v_source_queue
    ),
    'after', jsonb_build_object(
      'factoryId', p_target_factory_id,
      'factoryName', v_target_factory_name,
      'workshop', p_target_workshop,
      'queueNumber', v_target_queue
    ),
    'message', v_message
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_machine_supply_task_assignee(p_factory_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_department_id uuid;
  v_assignee uuid;
BEGIN
  SELECT d.id
  INTO v_department_id
  FROM public.departments d
  WHERE d.is_active = true
    AND lower(btrim(d.name)) IN ('снабжение', 'отдел снабжения')
    AND (
      p_factory_id IS NULL
      OR d.factory_id IS NULL
      OR d.factory_id = p_factory_id
    )
  ORDER BY
    CASE WHEN p_factory_id IS NOT NULL AND d.factory_id = p_factory_id THEN 0 ELSE 1 END,
    d.sort_order ASC,
    d.created_at ASC
  LIMIT 1;

  IF v_department_id IS NOT NULL THEN
    SELECT d.head_user_id
    INTO v_assignee
    FROM public.departments d
    JOIN public.users u ON u.id = d.head_user_id
    WHERE d.id = v_department_id
      AND COALESCE(u.is_active, true) = true
    LIMIT 1;

    IF v_assignee IS NULL THEN
      SELECT dm.user_id
      INTO v_assignee
      FROM public.department_members dm
      JOIN public.users u ON u.id = dm.user_id
      WHERE dm.department_id = v_department_id
        AND dm.is_department_head = true
        AND COALESCE(u.is_active, true) = true
      ORDER BY dm.joined_at ASC
      LIMIT 1;
    END IF;

    IF v_assignee IS NULL THEN
      SELECT dm.user_id
      INTO v_assignee
      FROM public.department_members dm
      JOIN public.users u ON u.id = dm.user_id
      WHERE dm.department_id = v_department_id
        AND COALESCE(u.is_active, true) = true
      ORDER BY dm.is_department_head DESC, dm.joined_at ASC
      LIMIT 1;
    END IF;
  END IF;

  IF v_assignee IS NULL THEN
    SELECT u.id
    INTO v_assignee
    FROM public.users u
    WHERE u.role IN ('procurement_head', 'supply_manager')
      AND COALESCE(u.is_active, true) = true
    ORDER BY
      CASE u.role WHEN 'procurement_head' THEN 0 ELSE 1 END,
      u.created_at ASC
    LIMIT 1;
  END IF;

  RETURN v_assignee;
END;
$function$;

CREATE OR REPLACE FUNCTION public.security_can_manage_catalog()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.security_has_role(ARRAY[
    'planning_director',
    'financial_director',
    'commercial_director',
    'supply_manager'
  ]);
$function$;

CREATE OR REPLACE FUNCTION public.security_can_manage_nesting_catalog()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.security_has_role(ARRAY[
    'planning_director',
    'financial_director',
    'commercial_director',
    'technologist'
  ]);
$function$;

CREATE OR REPLACE FUNCTION public.security_can_manage_request_materials()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.security_has_role(ARRAY[
    'planning_director',
    'financial_director',
    'commercial_director',
    'engineer',
    'technologist',
    'supply_manager'
  ]);
$function$;

CREATE OR REPLACE FUNCTION public.security_can_manage_supply()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.security_has_role(ARRAY[
    'planning_director',
    'financial_director',
    'commercial_director',
    'supply_manager'
  ]);
$function$;

CREATE OR REPLACE FUNCTION public.security_can_view_request_materials()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.security_has_role(ARRAY[
    'planning_director',
    'financial_director',
    'commercial_director',
    'engineer',
    'technologist',
    'supply_manager'
  ]);
$function$;

CREATE OR REPLACE FUNCTION public.security_has_role(p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.get_user_role()::text = ANY(p_roles);
$function$;

DROP POLICY IF EXISTS "Directors delete settings" ON public."app_settings";
CREATE POLICY "Directors delete settings" ON public."app_settings"
FOR DELETE TO authenticated
USING (is_director());

DROP POLICY IF EXISTS "Directors insert settings" ON public."app_settings";
CREATE POLICY "Directors insert settings" ON public."app_settings"
FOR INSERT TO authenticated
WITH CHECK (is_director());

DROP POLICY IF EXISTS "Directors read settings" ON public."app_settings";
CREATE POLICY "Directors read settings" ON public."app_settings"
FOR SELECT TO authenticated
USING (is_director());

DROP POLICY IF EXISTS "Directors update settings" ON public."app_settings";
CREATE POLICY "Directors update settings" ON public."app_settings"
FOR UPDATE TO authenticated
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "business_scrap_correction_holds_select" ON public."business_scrap_correction_holds";
CREATE POLICY "business_scrap_correction_holds_select" ON public."business_scrap_correction_holds"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM business_scrap_correction_requests request
  WHERE ((request.id = business_scrap_correction_holds.correction_request_id) AND ((request.requested_by = ( SELECT auth.uid() AS uid)) OR (request.approver_id = ( SELECT auth.uid() AS uid)) OR is_director())))));

DROP POLICY IF EXISTS "business_scrap_correction_items_select" ON public."business_scrap_correction_items";
CREATE POLICY "business_scrap_correction_items_select" ON public."business_scrap_correction_items"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM business_scrap_correction_requests request
  WHERE ((request.id = business_scrap_correction_items.correction_request_id) AND ((request.requested_by = ( SELECT auth.uid() AS uid)) OR (request.approver_id = ( SELECT auth.uid() AS uid)) OR is_director())))));

DROP POLICY IF EXISTS "business_scrap_correction_requests_select" ON public."business_scrap_correction_requests";
CREATE POLICY "business_scrap_correction_requests_select" ON public."business_scrap_correction_requests"
FOR SELECT TO authenticated
USING (((( SELECT auth.uid() AS uid) = requested_by) OR (( SELECT auth.uid() AS uid) = approver_id) OR is_director()));

DROP POLICY IF EXISTS "consumable_balances_select" ON public."consumable_balances";
CREATE POLICY "consumable_balances_select" ON public."consumable_balances"
FOR SELECT TO authenticated
USING (consumables_can_view_factory(factory_id));

DROP POLICY IF EXISTS "consumable_balances_service_write" ON public."consumable_balances";
CREATE POLICY "consumable_balances_service_write" ON public."consumable_balances"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "consumable_categories_select" ON public."consumable_categories";
CREATE POLICY "consumable_categories_select" ON public."consumable_categories"
FOR SELECT TO authenticated
USING (consumables_can_view_factory(factory_id));

DROP POLICY IF EXISTS "consumable_categories_service_write" ON public."consumable_categories";
CREATE POLICY "consumable_categories_service_write" ON public."consumable_categories"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "consumable_movements_select" ON public."consumable_movements";
CREATE POLICY "consumable_movements_select" ON public."consumable_movements"
FOR SELECT TO authenticated
USING (consumables_can_view_factory(factory_id));

DROP POLICY IF EXISTS "consumable_movements_service_write" ON public."consumable_movements";
CREATE POLICY "consumable_movements_service_write" ON public."consumable_movements"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "consumable_request_events_select" ON public."consumable_request_events";
CREATE POLICY "consumable_request_events_select" ON public."consumable_request_events"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM consumable_requests cr
  WHERE ((cr.id = consumable_request_events.request_id) AND consumables_can_view_factory(cr.factory_id)))));

DROP POLICY IF EXISTS "consumable_request_events_service_write" ON public."consumable_request_events";
CREATE POLICY "consumable_request_events_service_write" ON public."consumable_request_events"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "consumable_request_receipts_select" ON public."consumable_request_receipts";
CREATE POLICY "consumable_request_receipts_select" ON public."consumable_request_receipts"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM consumable_requests cr
  WHERE ((cr.id = consumable_request_receipts.request_id) AND consumables_can_view_factory(cr.factory_id)))));

DROP POLICY IF EXISTS "consumable_request_receipts_service_write" ON public."consumable_request_receipts";
CREATE POLICY "consumable_request_receipts_service_write" ON public."consumable_request_receipts"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "consumable_requests_select" ON public."consumable_requests";
CREATE POLICY "consumable_requests_select" ON public."consumable_requests"
FOR SELECT TO authenticated
USING (consumables_can_view_factory(factory_id));

DROP POLICY IF EXISTS "consumable_requests_service_write" ON public."consumable_requests";
CREATE POLICY "consumable_requests_service_write" ON public."consumable_requests"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "consumables_select" ON public."consumables";
CREATE POLICY "consumables_select" ON public."consumables"
FOR SELECT TO authenticated
USING (consumables_can_view_factory(factory_id));

DROP POLICY IF EXISTS "consumables_service_write" ON public."consumables";
CREATE POLICY "consumables_service_write" ON public."consumables"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "contracts_delete_sales" ON public."contracts";
CREATE POLICY "contracts_delete_sales" ON public."contracts"
FOR DELETE TO authenticated
USING ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])));

DROP POLICY IF EXISTS "contracts_insert_sales" ON public."contracts";
CREATE POLICY "contracts_insert_sales" ON public."contracts"
FOR INSERT TO authenticated
WITH CHECK ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])));

DROP POLICY IF EXISTS "contracts_select" ON public."contracts";
CREATE POLICY "contracts_select" ON public."contracts"
FOR SELECT TO authenticated
USING ((auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "contracts_update_sales" ON public."contracts";
CREATE POLICY "contracts_update_sales" ON public."contracts"
FOR UPDATE TO authenticated
USING ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])))
WITH CHECK ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])));

DROP POLICY IF EXISTS "department_request_attachments_select" ON public."department_request_attachments";
CREATE POLICY "department_request_attachments_select" ON public."department_request_attachments"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_attachments.request_id) AND ((request.created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(request.target_department, request.factory_id))))));

DROP POLICY IF EXISTS "department_request_events_select" ON public."department_request_events";
CREATE POLICY "department_request_events_select" ON public."department_request_events"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_events.request_id) AND ((request.created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(request.target_department, request.factory_id))))));

DROP POLICY IF EXISTS "department_request_mail_messages_owner_insert" ON public."department_request_mail_messages";
CREATE POLICY "department_request_mail_messages_owner_insert" ON public."department_request_mail_messages"
FOR INSERT TO authenticated
WITH CHECK (((linked_by = ( SELECT auth.uid() AS uid)) AND current_user_owns_mail_message(message_id) AND (EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_mail_messages.department_request_id) AND (request.created_by = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "department_request_mail_messages_reader" ON public."department_request_mail_messages";
CREATE POLICY "department_request_mail_messages_reader" ON public."department_request_mail_messages"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_mail_messages.department_request_id) AND ((request.created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(request.target_department, request.factory_id))))));

DROP POLICY IF EXISTS "department_request_mail_messages_unlink" ON public."department_request_mail_messages";
CREATE POLICY "department_request_mail_messages_unlink" ON public."department_request_mail_messages"
FOR UPDATE TO authenticated
USING ((EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_mail_messages.department_request_id) AND ((request.created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(request.target_department, request.factory_id))))))
WITH CHECK (((unlinked_at IS NOT NULL) AND (unlinked_by = ( SELECT auth.uid() AS uid))));

DROP POLICY IF EXISTS "department_request_mail_threads_owner_insert" ON public."department_request_mail_threads";
CREATE POLICY "department_request_mail_threads_owner_insert" ON public."department_request_mail_threads"
FOR INSERT TO authenticated
WITH CHECK (((linked_by = ( SELECT auth.uid() AS uid)) AND current_user_owns_mail_thread(thread_id) AND (EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_mail_threads.department_request_id) AND (request.created_by = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "department_request_mail_threads_reader" ON public."department_request_mail_threads";
CREATE POLICY "department_request_mail_threads_reader" ON public."department_request_mail_threads"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_mail_threads.department_request_id) AND ((request.created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(request.target_department, request.factory_id))))));

DROP POLICY IF EXISTS "department_request_mail_threads_unlink" ON public."department_request_mail_threads";
CREATE POLICY "department_request_mail_threads_unlink" ON public."department_request_mail_threads"
FOR UPDATE TO authenticated
USING ((EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_mail_threads.department_request_id) AND ((request.created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(request.target_department, request.factory_id))))))
WITH CHECK (((unlinked_at IS NOT NULL) AND (unlinked_by = ( SELECT auth.uid() AS uid))));

DROP POLICY IF EXISTS "department_requests_select" ON public."department_requests";
CREATE POLICY "department_requests_select" ON public."department_requests"
FOR SELECT TO authenticated
USING (((created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(target_department, factory_id)));

DROP POLICY IF EXISTS "detailing_balances_read" ON public."detailing_balances";
CREATE POLICY "detailing_balances_read" ON public."detailing_balances"
FOR SELECT TO authenticated
USING (detailing_role_allowed(ARRAY['technologist'::user_role, 'procurement_head'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role]));

DROP POLICY IF EXISTS "detailing_consumption_events_read" ON public."detailing_consumption_events";
CREATE POLICY "detailing_consumption_events_read" ON public."detailing_consumption_events"
FOR SELECT TO authenticated
USING (detailing_role_allowed(ARRAY['technologist'::user_role, 'procurement_head'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role]));

DROP POLICY IF EXISTS "detailing_consumption_items_read" ON public."detailing_consumption_items";
CREATE POLICY "detailing_consumption_items_read" ON public."detailing_consumption_items"
FOR SELECT TO authenticated
USING (detailing_role_allowed(ARRAY['technologist'::user_role, 'procurement_head'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role]));

DROP POLICY IF EXISTS "detailing_movements_read" ON public."detailing_movements";
CREATE POLICY "detailing_movements_read" ON public."detailing_movements"
FOR SELECT TO authenticated
USING (detailing_role_allowed(ARRAY['technologist'::user_role, 'procurement_head'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role]));

DROP POLICY IF EXISTS "detailing_part_versions_read" ON public."detailing_part_product_versions";
CREATE POLICY "detailing_part_versions_read" ON public."detailing_part_product_versions"
FOR SELECT TO authenticated
USING (detailing_role_allowed(ARRAY['technologist'::user_role, 'procurement_head'::user_role, 'supply_manager'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role]));

DROP POLICY IF EXISTS "detailing_part_products_read" ON public."detailing_part_products";
CREATE POLICY "detailing_part_products_read" ON public."detailing_part_products"
FOR SELECT TO authenticated
USING (detailing_role_allowed(ARRAY['technologist'::user_role, 'procurement_head'::user_role, 'supply_manager'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role]));

DROP POLICY IF EXISTS "detailing_catalogue_read" ON public."detailing_parts";
CREATE POLICY "detailing_catalogue_read" ON public."detailing_parts"
FOR SELECT TO authenticated
USING (detailing_role_allowed(ARRAY['technologist'::user_role, 'procurement_head'::user_role, 'supply_manager'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role]));

DROP POLICY IF EXISTS "detailing_checks_read" ON public."detailing_request_checks";
CREATE POLICY "detailing_checks_read" ON public."detailing_request_checks"
FOR SELECT TO authenticated
USING (detailing_role_allowed(ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role]));

DROP POLICY IF EXISTS "detailing_allocations_read" ON public."detailing_reservation_allocations";
CREATE POLICY "detailing_allocations_read" ON public."detailing_reservation_allocations"
FOR SELECT TO authenticated
USING (detailing_role_allowed(ARRAY['technologist'::user_role, 'procurement_head'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role]));

DROP POLICY IF EXISTS "detailing_reservations_read" ON public."detailing_reservations";
CREATE POLICY "detailing_reservations_read" ON public."detailing_reservations"
FOR SELECT TO authenticated
USING (detailing_role_allowed(ARRAY['technologist'::user_role, 'procurement_head'::user_role, 'supply_manager'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role]));

DROP POLICY IF EXISTS "detailing_transfer_items_read" ON public."detailing_transfer_items";
CREATE POLICY "detailing_transfer_items_read" ON public."detailing_transfer_items"
FOR SELECT TO authenticated
USING (detailing_role_allowed(ARRAY['technologist'::user_role, 'supply_manager'::user_role, 'procurement_head'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role]));

DROP POLICY IF EXISTS "detailing_transfers_read" ON public."detailing_transfers";
CREATE POLICY "detailing_transfers_read" ON public."detailing_transfers"
FOR SELECT TO authenticated
USING (detailing_role_allowed(ARRAY['technologist'::user_role, 'supply_manager'::user_role, 'procurement_head'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role]));

DROP POLICY IF EXISTS "employee_assignments_insert" ON public."employee_assignments";
CREATE POLICY "employee_assignments_insert" ON public."employee_assignments"
FOR INSERT TO authenticated
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_assignments.employee_id) AND (( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id))))))));

DROP POLICY IF EXISTS "employee_assignments_select" ON public."employee_assignments";
CREATE POLICY "employee_assignments_select" ON public."employee_assignments"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_assignments.employee_id) AND (( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id))))))));

DROP POLICY IF EXISTS "employee_assignments_update" ON public."employee_assignments";
CREATE POLICY "employee_assignments_update" ON public."employee_assignments"
FOR UPDATE TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_assignments.employee_id) AND (( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id))))))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_assignments.employee_id) AND (( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id))))))));

DROP POLICY IF EXISTS "employee_rates_insert" ON public."employee_rates";
CREATE POLICY "employee_rates_insert" ON public."employee_rates"
FOR INSERT TO authenticated
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_rates.employee_id) AND (( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id))))))));

DROP POLICY IF EXISTS "employee_rates_select" ON public."employee_rates";
CREATE POLICY "employee_rates_select" ON public."employee_rates"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_rates.employee_id) AND (( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id))))))));

DROP POLICY IF EXISTS "employee_rates_update" ON public."employee_rates";
CREATE POLICY "employee_rates_update" ON public."employee_rates"
FOR UPDATE TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_rates.employee_id) AND (( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id))))))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_rates.employee_id) AND (( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id))))))));

DROP POLICY IF EXISTS "employee_vacations_insert" ON public."employee_vacations";
CREATE POLICY "employee_vacations_insert" ON public."employee_vacations"
FOR INSERT TO authenticated
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees employee
  WHERE ((employee.id = employee_vacations.employee_id) AND (( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (employee.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id))))))));

DROP POLICY IF EXISTS "employee_vacations_select" ON public."employee_vacations";
CREATE POLICY "employee_vacations_select" ON public."employee_vacations"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees employee
  WHERE ((employee.id = employee_vacations.employee_id) AND (( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (employee.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id))))))));

DROP POLICY IF EXISTS "employee_vacations_update" ON public."employee_vacations";
CREATE POLICY "employee_vacations_update" ON public."employee_vacations"
FOR UPDATE TO authenticated
USING ((EXISTS ( SELECT 1
   FROM employees employee
  WHERE ((employee.id = employee_vacations.employee_id) AND (( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (employee.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id))))))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM employees employee
  WHERE ((employee.id = employee_vacations.employee_id) AND (( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (employee.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id))))))));

DROP POLICY IF EXISTS "employees_insert" ON public."employees";
CREATE POLICY "employees_insert" ON public."employees"
FOR INSERT TO authenticated
WITH CHECK ((( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))));

DROP POLICY IF EXISTS "employees_select" ON public."employees";
CREATE POLICY "employees_select" ON public."employees"
FOR SELECT TO authenticated
USING ((( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))));

DROP POLICY IF EXISTS "employees_update" ON public."employees";
CREATE POLICY "employees_update" ON public."employees"
FOR UPDATE TO authenticated
USING ((( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))
WITH CHECK ((( SELECT is_director() AS is_director) OR ((( SELECT get_user_role() AS get_user_role) = 'production_manager'::user_role) AND (factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))));

DROP POLICY IF EXISTS "factory_zinc_defaults_select" ON public."factory_zinc_outsourcing_defaults";
CREATE POLICY "factory_zinc_defaults_select" ON public."factory_zinc_outsourcing_defaults"
FOR SELECT TO authenticated
USING ((is_director() OR (factory_id = get_user_factory_id())));

DROP POLICY IF EXISTS "factory_zinc_defaults_service_role_modify" ON public."factory_zinc_outsourcing_defaults";
CREATE POLICY "factory_zinc_defaults_service_role_modify" ON public."factory_zinc_outsourcing_defaults"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "finance_budget_limits_modify" ON public."finance_budget_limits";
CREATE POLICY "finance_budget_limits_modify" ON public."finance_budget_limits"
FOR ALL TO public
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "finance_budget_limits_select" ON public."finance_budget_limits";
CREATE POLICY "finance_budget_limits_select" ON public."finance_budget_limits"
FOR SELECT TO public
USING ((is_director() OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'supply_manager'::user_role))))));

DROP POLICY IF EXISTS "finance_event_actions_modify" ON public."finance_event_actions";
CREATE POLICY "finance_event_actions_modify" ON public."finance_event_actions"
FOR ALL TO public
USING ((is_director() OR ((event_type = 'expense'::finance_event_type) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'supply_manager'::user_role)))) AND (EXISTS ( SELECT 1
   FROM finance_expenses e
  WHERE ((e.id = finance_event_actions.event_id) AND (e.is_supply_plan = true)))))))
WITH CHECK ((is_director() OR ((event_type = 'expense'::finance_event_type) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'supply_manager'::user_role)))) AND (EXISTS ( SELECT 1
   FROM finance_expenses e
  WHERE ((e.id = finance_event_actions.event_id) AND (e.is_supply_plan = true)))))));

DROP POLICY IF EXISTS "finance_event_actions_select" ON public."finance_event_actions";
CREATE POLICY "finance_event_actions_select" ON public."finance_event_actions"
FOR SELECT TO public
USING ((is_director() OR ((event_type = 'expense'::finance_event_type) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'supply_manager'::user_role)))) AND (EXISTS ( SELECT 1
   FROM finance_expenses e
  WHERE ((e.id = finance_event_actions.event_id) AND (e.is_supply_plan = true)))))));

DROP POLICY IF EXISTS "finance_expense_series_modify" ON public."finance_expense_series";
CREATE POLICY "finance_expense_series_modify" ON public."finance_expense_series"
FOR ALL TO public
USING ((is_director() OR ((is_supply_plan = true) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'supply_manager'::user_role)))))))
WITH CHECK ((is_director() OR ((is_supply_plan = true) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'supply_manager'::user_role)))))));

DROP POLICY IF EXISTS "finance_expense_series_select" ON public."finance_expense_series";
CREATE POLICY "finance_expense_series_select" ON public."finance_expense_series"
FOR SELECT TO public
USING ((is_director() OR (EXISTS ( SELECT 1
   FROM finance_telegram_recipients r
  WHERE ((r.user_id = auth.uid()) AND r.is_active)))));

DROP POLICY IF EXISTS "finance_expenses_modify" ON public."finance_expenses";
CREATE POLICY "finance_expenses_modify" ON public."finance_expenses"
FOR ALL TO public
USING ((is_director() OR ((is_supply_plan = true) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'supply_manager'::user_role)))))))
WITH CHECK ((is_director() OR ((is_supply_plan = true) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'supply_manager'::user_role)))))));

DROP POLICY IF EXISTS "finance_expenses_select" ON public."finance_expenses";
CREATE POLICY "finance_expenses_select" ON public."finance_expenses"
FOR SELECT TO public
USING ((is_director() OR (responsible_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM finance_telegram_recipients r
  WHERE ((r.user_id = auth.uid()) AND r.is_active)))));

DROP POLICY IF EXISTS "finance_settings_modify" ON public."finance_settings";
CREATE POLICY "finance_settings_modify" ON public."finance_settings"
FOR ALL TO public
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "finance_settings_select" ON public."finance_settings";
CREATE POLICY "finance_settings_select" ON public."finance_settings"
FOR SELECT TO public
USING ((is_director() OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'supply_manager'::user_role))))));

DROP POLICY IF EXISTS "finance_telegram_dialog_states_modify" ON public."finance_telegram_dialog_states";
CREATE POLICY "finance_telegram_dialog_states_modify" ON public."finance_telegram_dialog_states"
FOR ALL TO public
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "finance_telegram_dialog_states_select" ON public."finance_telegram_dialog_states";
CREATE POLICY "finance_telegram_dialog_states_select" ON public."finance_telegram_dialog_states"
FOR SELECT TO public
USING (is_director());

DROP POLICY IF EXISTS "finance_telegram_notifications_modify" ON public."finance_telegram_notifications";
CREATE POLICY "finance_telegram_notifications_modify" ON public."finance_telegram_notifications"
FOR ALL TO public
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "finance_telegram_notifications_select" ON public."finance_telegram_notifications";
CREATE POLICY "finance_telegram_notifications_select" ON public."finance_telegram_notifications"
FOR SELECT TO public
USING (is_director());

DROP POLICY IF EXISTS "finance_telegram_recipients_modify" ON public."finance_telegram_recipients";
CREATE POLICY "finance_telegram_recipients_modify" ON public."finance_telegram_recipients"
FOR ALL TO public
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "finance_telegram_recipients_select" ON public."finance_telegram_recipients";
CREATE POLICY "finance_telegram_recipients_select" ON public."finance_telegram_recipients"
FOR SELECT TO public
USING ((is_director() OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'supply_manager'::user_role))))));

DROP POLICY IF EXISTS "Inventory insert supply roles" ON public."inventory";
CREATE POLICY "Inventory insert supply roles" ON public."inventory"
FOR INSERT TO authenticated
WITH CHECK (security_can_manage_supply());

DROP POLICY IF EXISTS "Inventory read supply roles" ON public."inventory";
CREATE POLICY "Inventory read supply roles" ON public."inventory"
FOR SELECT TO authenticated
USING (security_can_manage_supply());

DROP POLICY IF EXISTS "Inventory update supply roles" ON public."inventory";
CREATE POLICY "Inventory update supply roles" ON public."inventory"
FOR UPDATE TO authenticated
USING (security_can_manage_supply())
WITH CHECK (security_can_manage_supply());

DROP POLICY IF EXISTS "Inventory reservations delete supply roles" ON public."inventory_reservations";
CREATE POLICY "Inventory reservations delete supply roles" ON public."inventory_reservations"
FOR DELETE TO authenticated
USING (security_can_manage_supply());

DROP POLICY IF EXISTS "Inventory reservations insert supply roles" ON public."inventory_reservations";
CREATE POLICY "Inventory reservations insert supply roles" ON public."inventory_reservations"
FOR INSERT TO authenticated
WITH CHECK (security_can_manage_supply());

DROP POLICY IF EXISTS "Inventory reservations read supply roles" ON public."inventory_reservations";
CREATE POLICY "Inventory reservations read supply roles" ON public."inventory_reservations"
FOR SELECT TO authenticated
USING (security_can_manage_supply());

DROP POLICY IF EXISTS "Inventory reservations update supply roles" ON public."inventory_reservations";
CREATE POLICY "Inventory reservations update supply roles" ON public."inventory_reservations"
FOR UPDATE TO authenticated
USING (security_can_manage_supply())
WITH CHECK (security_can_manage_supply());

DROP POLICY IF EXISTS "Inventory transactions insert supply roles" ON public."inventory_transactions";
CREATE POLICY "Inventory transactions insert supply roles" ON public."inventory_transactions"
FOR INSERT TO authenticated
WITH CHECK (security_can_manage_supply());

DROP POLICY IF EXISTS "Inventory transactions read supply roles" ON public."inventory_transactions";
CREATE POLICY "Inventory transactions read supply roles" ON public."inventory_transactions"
FOR SELECT TO authenticated
USING (security_can_manage_supply());

DROP POLICY IF EXISTS "inventory_transfer_items_read" ON public."inventory_transfer_items";
CREATE POLICY "inventory_transfer_items_read" ON public."inventory_transfer_items"
FOR SELECT TO authenticated
USING (inventory_transfer_role_allowed(ARRAY['technologist'::user_role, 'supply_manager'::user_role, 'procurement_head'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role]));

DROP POLICY IF EXISTS "inventory_transfers_read" ON public."inventory_transfers";
CREATE POLICY "inventory_transfers_read" ON public."inventory_transfers"
FOR SELECT TO authenticated
USING (inventory_transfer_role_allowed(ARRAY['technologist'::user_role, 'supply_manager'::user_role, 'procurement_head'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role]));

DROP POLICY IF EXISTS "Invoices - Select role specific" ON public."invoices";
CREATE POLICY "Invoices - Select role specific" ON public."invoices"
FOR SELECT TO authenticated
USING ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])));

DROP POLICY IF EXISTS "invoices_select" ON public."invoices";
CREATE POLICY "invoices_select" ON public."invoices"
FOR SELECT TO public
USING ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])));

DROP POLICY IF EXISTS "machine_chat_mentions_select" ON public."machine_chat_mentions";
CREATE POLICY "machine_chat_mentions_select" ON public."machine_chat_mentions"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_chat_mentions.machine_id) AND
        CASE
            WHEN (get_user_role() = 'production_manager'::user_role) THEN ((m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL))
            ELSE true
        END))));

DROP POLICY IF EXISTS "machine_chat_mentions_service_role_modify" ON public."machine_chat_mentions";
CREATE POLICY "machine_chat_mentions_service_role_modify" ON public."machine_chat_mentions"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "machine_chat_messages_select" ON public."machine_chat_messages";
CREATE POLICY "machine_chat_messages_select" ON public."machine_chat_messages"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_chat_messages.machine_id) AND
        CASE
            WHEN (get_user_role() = 'production_manager'::user_role) THEN ((m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL))
            ELSE true
        END))));

DROP POLICY IF EXISTS "machine_chat_messages_service_role_modify" ON public."machine_chat_messages";
CREATE POLICY "machine_chat_messages_service_role_modify" ON public."machine_chat_messages"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "machine_expenses_delete" ON public."machine_expenses";
CREATE POLICY "machine_expenses_delete" ON public."machine_expenses"
FOR DELETE TO authenticated
USING (((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_expenses.machine_id)))));

DROP POLICY IF EXISTS "machine_expenses_insert" ON public."machine_expenses";
CREATE POLICY "machine_expenses_insert" ON public."machine_expenses"
FOR INSERT TO authenticated
WITH CHECK (((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_expenses.machine_id)))));

DROP POLICY IF EXISTS "machine_expenses_select" ON public."machine_expenses";
CREATE POLICY "machine_expenses_select" ON public."machine_expenses"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_expenses.machine_id) AND
        CASE
            WHEN (get_user_role() = 'production_manager'::user_role) THEN ((m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL))
            ELSE true
        END))));

DROP POLICY IF EXISTS "machine_expenses_update" ON public."machine_expenses";
CREATE POLICY "machine_expenses_update" ON public."machine_expenses"
FOR UPDATE TO authenticated
USING (((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_expenses.machine_id)))))
WITH CHECK (((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_expenses.machine_id)))));

DROP POLICY IF EXISTS "Nesting managers delete machine item nesting runs" ON public."machine_item_nesting_runs";
CREATE POLICY "Nesting managers delete machine item nesting runs" ON public."machine_item_nesting_runs"
FOR DELETE TO authenticated
USING ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "Nesting managers insert machine item nesting runs" ON public."machine_item_nesting_runs";
CREATE POLICY "Nesting managers insert machine item nesting runs" ON public."machine_item_nesting_runs"
FOR INSERT TO authenticated
WITH CHECK ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "Nesting managers read machine item nesting runs" ON public."machine_item_nesting_runs";
CREATE POLICY "Nesting managers read machine item nesting runs" ON public."machine_item_nesting_runs"
FOR SELECT TO authenticated
USING ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "Nesting managers update machine item nesting runs" ON public."machine_item_nesting_runs";
CREATE POLICY "Nesting managers update machine item nesting runs" ON public."machine_item_nesting_runs"
FOR UPDATE TO authenticated
USING ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])))
WITH CHECK ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "machine_items_delete" ON public."machine_items";
CREATE POLICY "machine_items_delete" ON public."machine_items"
FOR DELETE TO authenticated
USING (((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_items.machine_id)))));

DROP POLICY IF EXISTS "machine_items_insert" ON public."machine_items";
CREATE POLICY "machine_items_insert" ON public."machine_items"
FOR INSERT TO authenticated
WITH CHECK (((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_items.machine_id)))));

DROP POLICY IF EXISTS "machine_items_select" ON public."machine_items";
CREATE POLICY "machine_items_select" ON public."machine_items"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_items.machine_id) AND
        CASE
            WHEN (get_user_role() = 'production_manager'::user_role) THEN ((m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL))
            ELSE true
        END))));

DROP POLICY IF EXISTS "machine_items_update" ON public."machine_items";
CREATE POLICY "machine_items_update" ON public."machine_items"
FOR UPDATE TO authenticated
USING (((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_items.machine_id)))))
WITH CHECK (((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_items.machine_id)))));

DROP POLICY IF EXISTS "Machine layout manage sales tech directors" ON public."machine_layout_requests";
CREATE POLICY "Machine layout manage sales tech directors" ON public."machine_layout_requests"
FOR ALL TO authenticated
USING (security_has_role(ARRAY['planning_director'::text, 'financial_director'::text, 'commercial_director'::text, 'sales_manager'::text, 'technologist'::text]))
WITH CHECK (security_has_role(ARRAY['planning_director'::text, 'financial_director'::text, 'commercial_director'::text, 'sales_manager'::text, 'technologist'::text]));

DROP POLICY IF EXISTS "Machine layout read app roles" ON public."machine_layout_requests";
CREATE POLICY "Machine layout read app roles" ON public."machine_layout_requests"
FOR SELECT TO authenticated
USING (security_has_role(ARRAY['planning_director'::text, 'financial_director'::text, 'commercial_director'::text, 'sales_manager'::text, 'engineer'::text, 'technologist'::text, 'supply_manager'::text, 'production_manager'::text, 'procurement_head'::text, 'painting_head'::text]));

DROP POLICY IF EXISTS "machine_outsourcing_operation_items_select" ON public."machine_outsourcing_operation_items";
CREATE POLICY "machine_outsourcing_operation_items_select" ON public."machine_outsourcing_operation_items"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM (machine_outsourcing_operations op
     JOIN machines m ON ((m.id = op.machine_id)))
  WHERE ((op.id = machine_outsourcing_operation_items.operation_id) AND (is_director() OR (m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL) OR (get_user_role() = ANY (ARRAY['sales_manager'::user_role, 'engineer'::user_role, 'technologist'::user_role, 'supply_manager'::user_role, 'procurement_head'::user_role])) OR ((op.executor_type = 'factory'::outsourcing_executor_type) AND (op.executor_factory_id = get_user_factory_id())))))));

DROP POLICY IF EXISTS "machine_outsourcing_operation_items_service_role_modify" ON public."machine_outsourcing_operation_items";
CREATE POLICY "machine_outsourcing_operation_items_service_role_modify" ON public."machine_outsourcing_operation_items"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "machine_outsourcing_operations_select" ON public."machine_outsourcing_operations";
CREATE POLICY "machine_outsourcing_operations_select" ON public."machine_outsourcing_operations"
FOR SELECT TO authenticated
USING ((is_director() OR (EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_outsourcing_operations.machine_id) AND ((m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL) OR (get_user_role() = ANY (ARRAY['sales_manager'::user_role, 'engineer'::user_role, 'technologist'::user_role, 'supply_manager'::user_role, 'procurement_head'::user_role])))))) OR ((executor_type = 'factory'::outsourcing_executor_type) AND (executor_factory_id = get_user_factory_id()))));

DROP POLICY IF EXISTS "machine_outsourcing_operations_service_role_modify" ON public."machine_outsourcing_operations";
CREATE POLICY "machine_outsourcing_operations_service_role_modify" ON public."machine_outsourcing_operations"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "outsourcing_transport_needs_select" ON public."machine_outsourcing_transport_needs";
CREATE POLICY "outsourcing_transport_needs_select" ON public."machine_outsourcing_transport_needs"
FOR SELECT TO authenticated
USING ((is_director() OR (get_user_role() = ANY (ARRAY['supply_manager'::user_role, 'procurement_head'::user_role])) OR (EXISTS ( SELECT 1
   FROM (machine_outsourcing_operations op
     JOIN machines m ON ((m.id = op.machine_id)))
  WHERE ((op.id = machine_outsourcing_transport_needs.operation_id) AND ((m.factory_id = get_user_factory_id()) OR ((op.executor_type = 'factory'::outsourcing_executor_type) AND (op.executor_factory_id = get_user_factory_id()))))))));

DROP POLICY IF EXISTS "outsourcing_transport_needs_service_role_modify" ON public."machine_outsourcing_transport_needs";
CREATE POLICY "outsourcing_transport_needs_service_role_modify" ON public."machine_outsourcing_transport_needs"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "outsourcing_transport_orders_select" ON public."machine_outsourcing_transport_orders";
CREATE POLICY "outsourcing_transport_orders_select" ON public."machine_outsourcing_transport_orders"
FOR SELECT TO authenticated
USING ((is_director() OR (get_user_role() = ANY (ARRAY['supply_manager'::user_role, 'procurement_head'::user_role, 'production_manager'::user_role]))));

DROP POLICY IF EXISTS "outsourcing_transport_orders_service_role_modify" ON public."machine_outsourcing_transport_orders";
CREATE POLICY "outsourcing_transport_orders_service_role_modify" ON public."machine_outsourcing_transport_orders"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "machine_outsourcing_vrb_items_select" ON public."machine_outsourcing_vrb_items";
CREATE POLICY "machine_outsourcing_vrb_items_select" ON public."machine_outsourcing_vrb_items"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM (machine_outsourcing_operations operation
     JOIN machines machine ON ((machine.id = operation.machine_id)))
  WHERE ((operation.id = machine_outsourcing_vrb_items.operation_id) AND (is_director() OR (machine.factory_id = get_user_factory_id()) OR (get_user_role() = ANY (ARRAY['sales_manager'::user_role, 'production_manager'::user_role, 'supply_manager'::user_role, 'procurement_head'::user_role])))))));

DROP POLICY IF EXISTS "machine_outsourcing_vrb_items_service_role_modify" ON public."machine_outsourcing_vrb_items";
CREATE POLICY "machine_outsourcing_vrb_items_service_role_modify" ON public."machine_outsourcing_vrb_items"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "machine_outsourcing_vrb_receipts_select" ON public."machine_outsourcing_vrb_receipts";
CREATE POLICY "machine_outsourcing_vrb_receipts_select" ON public."machine_outsourcing_vrb_receipts"
FOR SELECT TO authenticated
USING ((is_director() OR (factory_id = get_user_factory_id()) OR (get_user_role() = ANY (ARRAY['supply_manager'::user_role, 'procurement_head'::user_role]))));

DROP POLICY IF EXISTS "machine_outsourcing_vrb_receipts_service_role_modify" ON public."machine_outsourcing_vrb_receipts";
CREATE POLICY "machine_outsourcing_vrb_receipts_service_role_modify" ON public."machine_outsourcing_vrb_receipts"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "machine_packing_groups_delete" ON public."machine_packing_groups";
CREATE POLICY "machine_packing_groups_delete" ON public."machine_packing_groups"
FOR DELETE TO authenticated
USING (((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_packing_groups.machine_id) AND
        CASE
            WHEN (get_user_role() = 'production_manager'::user_role) THEN ((m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL))
            ELSE true
        END)))));

DROP POLICY IF EXISTS "machine_packing_groups_insert" ON public."machine_packing_groups";
CREATE POLICY "machine_packing_groups_insert" ON public."machine_packing_groups"
FOR INSERT TO authenticated
WITH CHECK (((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_packing_groups.machine_id) AND
        CASE
            WHEN (get_user_role() = 'production_manager'::user_role) THEN ((m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL))
            ELSE true
        END)))));

DROP POLICY IF EXISTS "machine_packing_groups_select" ON public."machine_packing_groups";
CREATE POLICY "machine_packing_groups_select" ON public."machine_packing_groups"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_packing_groups.machine_id) AND
        CASE
            WHEN (get_user_role() = 'production_manager'::user_role) THEN ((m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL))
            ELSE true
        END))));

DROP POLICY IF EXISTS "machine_packing_groups_update" ON public."machine_packing_groups";
CREATE POLICY "machine_packing_groups_update" ON public."machine_packing_groups"
FOR UPDATE TO authenticated
USING (((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_packing_groups.machine_id) AND
        CASE
            WHEN (get_user_role() = 'production_manager'::user_role) THEN ((m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL))
            ELSE true
        END)))))
WITH CHECK (((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_packing_groups.machine_id) AND
        CASE
            WHEN (get_user_role() = 'production_manager'::user_role) THEN ((m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL))
            ELSE true
        END)))));

DROP POLICY IF EXISTS "machine_updates_select" ON public."machine_updates";
CREATE POLICY "machine_updates_select" ON public."machine_updates"
FOR SELECT TO authenticated
USING (((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_updates.machine_id) AND
        CASE
            WHEN (get_user_role() = 'production_manager'::user_role) THEN ((m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL))
            ELSE true
        END)))));

DROP POLICY IF EXISTS "machine_updates_service_role_modify" ON public."machine_updates";
CREATE POLICY "machine_updates_service_role_modify" ON public."machine_updates"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Machines - Delete directors" ON public."machines";
CREATE POLICY "Machines - Delete directors" ON public."machines"
FOR DELETE TO authenticated
USING (is_director());

DROP POLICY IF EXISTS "Machines - Insert staff" ON public."machines";
CREATE POLICY "Machines - Insert staff" ON public."machines"
FOR INSERT TO authenticated
WITH CHECK ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])));

DROP POLICY IF EXISTS "Machines - Update staff" ON public."machines";
CREATE POLICY "Machines - Update staff" ON public."machines"
FOR UPDATE TO authenticated
USING ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role])));

DROP POLICY IF EXISTS "machines_select" ON public."machines";
CREATE POLICY "machines_select" ON public."machines"
FOR SELECT TO authenticated
USING (
CASE
    WHEN (get_user_role() = 'production_manager'::user_role) THEN ((factory_id = get_user_factory_id()) OR (factory_id IS NULL))
    ELSE true
END);

DROP POLICY IF EXISTS "mail_messages_owner_or_crm_reader" ON public."mail_messages";
CREATE POLICY "mail_messages_owner_or_crm_reader" ON public."mail_messages"
FOR SELECT TO authenticated
USING (((EXISTS ( SELECT 1
   FROM mail_accounts account
  WHERE ((account.id = mail_messages.account_id) AND (account.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM product_project_mail_threads link
  WHERE ((link.thread_id = mail_messages.thread_id) AND (link.unlinked_at IS NULL) AND (EXISTS ( SELECT 1
           FROM (role_permissions permission
             JOIN users actor ON ((actor.id = ( SELECT auth.uid() AS uid))))
          WHERE ((permission.role = actor.role) AND (permission.resource_key = 'product_projects'::text) AND (permission.can_view = true))))))) OR (EXISTS ( SELECT 1
   FROM product_project_mail_messages link
  WHERE ((link.message_id = mail_messages.id) AND (link.unlinked_at IS NULL) AND (EXISTS ( SELECT 1
           FROM (role_permissions permission
             JOIN users actor ON ((actor.id = ( SELECT auth.uid() AS uid))))
          WHERE ((permission.role = actor.role) AND (permission.resource_key = 'product_projects'::text) AND (permission.can_view = true))))))) OR (EXISTS ( SELECT 1
   FROM (department_request_mail_threads link
     JOIN department_requests request ON ((request.id = link.department_request_id)))
  WHERE ((link.thread_id = mail_messages.thread_id) AND (link.unlinked_at IS NULL) AND ((request.created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(request.target_department, request.factory_id))))) OR (EXISTS ( SELECT 1
   FROM (department_request_mail_messages link
     JOIN department_requests request ON ((request.id = link.department_request_id)))
  WHERE ((link.message_id = mail_messages.id) AND (link.unlinked_at IS NULL) AND ((request.created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(request.target_department, request.factory_id)))))));

DROP POLICY IF EXISTS "mail_threads_owner_or_crm_reader" ON public."mail_threads";
CREATE POLICY "mail_threads_owner_or_crm_reader" ON public."mail_threads"
FOR SELECT TO authenticated
USING (((EXISTS ( SELECT 1
   FROM mail_accounts account
  WHERE ((account.id = mail_threads.account_id) AND (account.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM product_project_mail_threads link
  WHERE ((link.thread_id = mail_threads.id) AND (link.unlinked_at IS NULL) AND (EXISTS ( SELECT 1
           FROM (role_permissions permission
             JOIN users actor ON ((actor.id = ( SELECT auth.uid() AS uid))))
          WHERE ((permission.role = actor.role) AND (permission.resource_key = 'product_projects'::text) AND (permission.can_view = true))))))) OR (EXISTS ( SELECT 1
   FROM (department_request_mail_threads link
     JOIN department_requests request ON ((request.id = link.department_request_id)))
  WHERE ((link.thread_id = mail_threads.id) AND (link.unlinked_at IS NULL) AND ((request.created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(request.target_department, request.factory_id)))))));

DROP POLICY IF EXISTS "Material variants insert catalog roles" ON public."material_variants";
CREATE POLICY "Material variants insert catalog roles" ON public."material_variants"
FOR INSERT TO authenticated
WITH CHECK (security_can_manage_catalog());

DROP POLICY IF EXISTS "Material variants read catalog roles" ON public."material_variants";
CREATE POLICY "Material variants read catalog roles" ON public."material_variants"
FOR SELECT TO authenticated
USING ((security_can_manage_catalog() OR security_can_view_request_materials()));

DROP POLICY IF EXISTS "Material variants update catalog roles" ON public."material_variants";
CREATE POLICY "Material variants update catalog roles" ON public."material_variants"
FOR UPDATE TO authenticated
USING (security_can_manage_catalog())
WITH CHECK (security_can_manage_catalog());

DROP POLICY IF EXISTS "Materials insert catalog roles" ON public."materials";
CREATE POLICY "Materials insert catalog roles" ON public."materials"
FOR INSERT TO authenticated
WITH CHECK (security_can_manage_catalog());

DROP POLICY IF EXISTS "Materials read catalog roles" ON public."materials";
CREATE POLICY "Materials read catalog roles" ON public."materials"
FOR SELECT TO authenticated
USING ((security_can_manage_catalog() OR security_can_view_request_materials()));

DROP POLICY IF EXISTS "Materials update catalog roles" ON public."materials";
CREATE POLICY "Materials update catalog roles" ON public."materials"
FOR UPDATE TO authenticated
USING (security_can_manage_catalog())
WITH CHECK (security_can_manage_catalog());

DROP POLICY IF EXISTS "actions_modify" ON public."meeting_action_items";
CREATE POLICY "actions_modify" ON public."meeting_action_items"
FOR ALL TO public
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "actions_select" ON public."meeting_action_items";
CREATE POLICY "actions_select" ON public."meeting_action_items"
FOR SELECT TO public
USING ((auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "agenda_modify" ON public."meeting_agenda_items";
CREATE POLICY "agenda_modify" ON public."meeting_agenda_items"
FOR ALL TO public
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "agenda_select" ON public."meeting_agenda_items";
CREATE POLICY "agenda_select" ON public."meeting_agenda_items"
FOR SELECT TO public
USING ((auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "agenda_pool_modify" ON public."meeting_agenda_pool_items";
CREATE POLICY "agenda_pool_modify" ON public."meeting_agenda_pool_items"
FOR ALL TO public
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "agenda_pool_select" ON public."meeting_agenda_pool_items";
CREATE POLICY "agenda_pool_select" ON public."meeting_agenda_pool_items"
FOR SELECT TO public
USING ((auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "attendees_modify" ON public."meeting_attendees";
CREATE POLICY "attendees_modify" ON public."meeting_attendees"
FOR ALL TO public
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "attendees_select" ON public."meeting_attendees";
CREATE POLICY "attendees_select" ON public."meeting_attendees"
FOR SELECT TO public
USING ((auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "decisions_modify" ON public."meeting_decisions";
CREATE POLICY "decisions_modify" ON public."meeting_decisions"
FOR ALL TO public
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "decisions_select" ON public."meeting_decisions";
CREATE POLICY "decisions_select" ON public."meeting_decisions"
FOR SELECT TO public
USING ((auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "ext_attendees_modify" ON public."meeting_external_attendees";
CREATE POLICY "ext_attendees_modify" ON public."meeting_external_attendees"
FOR ALL TO public
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "ext_attendees_select" ON public."meeting_external_attendees";
CREATE POLICY "ext_attendees_select" ON public."meeting_external_attendees"
FOR SELECT TO public
USING ((auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "meeting_question_events_manage" ON public."meeting_question_events";
CREATE POLICY "meeting_question_events_manage" ON public."meeting_question_events"
FOR ALL TO authenticated
USING (can_manage_meeting_resource('meetings'::text))
WITH CHECK (can_manage_meeting_resource('meetings'::text));

DROP POLICY IF EXISTS "meeting_question_events_view" ON public."meeting_question_events";
CREATE POLICY "meeting_question_events_view" ON public."meeting_question_events"
FOR SELECT TO authenticated
USING (can_view_meeting_resource('meetings'::text));

DROP POLICY IF EXISTS "meeting_question_meeting_history_manage" ON public."meeting_question_meeting_history";
CREATE POLICY "meeting_question_meeting_history_manage" ON public."meeting_question_meeting_history"
FOR ALL TO authenticated
USING (can_manage_meeting_resource('meetings'::text))
WITH CHECK (can_manage_meeting_resource('meetings'::text));

DROP POLICY IF EXISTS "meeting_question_meeting_history_view" ON public."meeting_question_meeting_history";
CREATE POLICY "meeting_question_meeting_history_view" ON public."meeting_question_meeting_history"
FOR SELECT TO authenticated
USING (can_view_meeting_resource('meetings'::text));

DROP POLICY IF EXISTS "meeting_question_members_manage" ON public."meeting_question_members";
CREATE POLICY "meeting_question_members_manage" ON public."meeting_question_members"
FOR ALL TO authenticated
USING (can_manage_meeting_resource('meetings_agenda_pool'::text))
WITH CHECK (can_manage_meeting_resource('meetings_agenda_pool'::text));

DROP POLICY IF EXISTS "meeting_question_members_view" ON public."meeting_question_members";
CREATE POLICY "meeting_question_members_view" ON public."meeting_question_members"
FOR SELECT TO authenticated
USING (can_view_meeting_resource('meetings_agenda_pool'::text));

DROP POLICY IF EXISTS "meeting_question_outcomes_manage" ON public."meeting_question_outcomes";
CREATE POLICY "meeting_question_outcomes_manage" ON public."meeting_question_outcomes"
FOR ALL TO authenticated
USING (can_manage_meeting_resource('meetings'::text))
WITH CHECK (can_manage_meeting_resource('meetings'::text));

DROP POLICY IF EXISTS "meeting_question_outcomes_view" ON public."meeting_question_outcomes";
CREATE POLICY "meeting_question_outcomes_view" ON public."meeting_question_outcomes"
FOR SELECT TO authenticated
USING (can_view_meeting_resource('meetings'::text));

DROP POLICY IF EXISTS "meeting_question_task_links_manage" ON public."meeting_question_task_links";
CREATE POLICY "meeting_question_task_links_manage" ON public."meeting_question_task_links"
FOR ALL TO authenticated
USING (can_manage_meeting_resource('meetings'::text))
WITH CHECK (can_manage_meeting_resource('meetings'::text));

DROP POLICY IF EXISTS "meeting_question_task_links_view" ON public."meeting_question_task_links";
CREATE POLICY "meeting_question_task_links_view" ON public."meeting_question_task_links"
FOR SELECT TO authenticated
USING (can_view_meeting_resource('meetings'::text));

DROP POLICY IF EXISTS "meeting_question_templates_manage" ON public."meeting_question_templates";
CREATE POLICY "meeting_question_templates_manage" ON public."meeting_question_templates"
FOR ALL TO authenticated
USING (can_manage_meeting_resource('meeting_question_templates'::text))
WITH CHECK (can_manage_meeting_resource('meeting_question_templates'::text));

DROP POLICY IF EXISTS "meeting_question_templates_view" ON public."meeting_question_templates";
CREATE POLICY "meeting_question_templates_view" ON public."meeting_question_templates"
FOR SELECT TO authenticated
USING (can_view_meeting_resource('meeting_question_templates'::text));

DROP POLICY IF EXISTS "meeting_questions_manage" ON public."meeting_questions";
CREATE POLICY "meeting_questions_manage" ON public."meeting_questions"
FOR ALL TO authenticated
USING (can_manage_meeting_resource('meetings_agenda_pool'::text))
WITH CHECK (can_manage_meeting_resource('meetings_agenda_pool'::text));

DROP POLICY IF EXISTS "meeting_questions_view" ON public."meeting_questions";
CREATE POLICY "meeting_questions_view" ON public."meeting_questions"
FOR SELECT TO authenticated
USING (can_view_meeting_resource('meetings_agenda_pool'::text));

DROP POLICY IF EXISTS "meeting_recurrence_rules_modify" ON public."meeting_recurrence_rules";
CREATE POLICY "meeting_recurrence_rules_modify" ON public."meeting_recurrence_rules"
FOR ALL TO public
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "meeting_recurrence_rules_select" ON public."meeting_recurrence_rules";
CREATE POLICY "meeting_recurrence_rules_select" ON public."meeting_recurrence_rules"
FOR SELECT TO public
USING ((auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "meeting_rule_versions_manage" ON public."meeting_rule_versions";
CREATE POLICY "meeting_rule_versions_manage" ON public."meeting_rule_versions"
FOR ALL TO authenticated
USING (can_manage_meeting_resource('meeting_rules'::text))
WITH CHECK (can_manage_meeting_resource('meeting_rules'::text));

DROP POLICY IF EXISTS "meeting_rule_versions_view" ON public."meeting_rule_versions";
CREATE POLICY "meeting_rule_versions_view" ON public."meeting_rule_versions"
FOR SELECT TO authenticated
USING (can_view_meeting_resource('meeting_rules'::text));

DROP POLICY IF EXISTS "meeting_rules_manage" ON public."meeting_rules";
CREATE POLICY "meeting_rules_manage" ON public."meeting_rules"
FOR ALL TO authenticated
USING (can_manage_meeting_resource('meeting_rules'::text))
WITH CHECK (can_manage_meeting_resource('meeting_rules'::text));

DROP POLICY IF EXISTS "meeting_rules_view" ON public."meeting_rules";
CREATE POLICY "meeting_rules_view" ON public."meeting_rules"
FOR SELECT TO authenticated
USING (can_view_meeting_resource('meeting_rules'::text));

DROP POLICY IF EXISTS "meeting_schedule_exceptions_manage" ON public."meeting_schedule_exceptions";
CREATE POLICY "meeting_schedule_exceptions_manage" ON public."meeting_schedule_exceptions"
FOR ALL TO authenticated
USING (can_manage_meeting_resource('meetings'::text))
WITH CHECK (can_manage_meeting_resource('meetings'::text));

DROP POLICY IF EXISTS "meeting_schedule_exceptions_view" ON public."meeting_schedule_exceptions";
CREATE POLICY "meeting_schedule_exceptions_view" ON public."meeting_schedule_exceptions"
FOR SELECT TO authenticated
USING (can_view_meeting_resource('meetings'::text));

DROP POLICY IF EXISTS "meeting_schedule_versions_manage" ON public."meeting_schedule_versions";
CREATE POLICY "meeting_schedule_versions_manage" ON public."meeting_schedule_versions"
FOR ALL TO authenticated
USING (can_manage_meeting_resource('meeting_templates'::text))
WITH CHECK (can_manage_meeting_resource('meeting_templates'::text));

DROP POLICY IF EXISTS "meeting_schedule_versions_view" ON public."meeting_schedule_versions";
CREATE POLICY "meeting_schedule_versions_view" ON public."meeting_schedule_versions"
FOR SELECT TO authenticated
USING (can_view_meeting_resource('meeting_templates'::text));

DROP POLICY IF EXISTS "meeting_system_rollout_events_manage" ON public."meeting_system_rollout_events";
CREATE POLICY "meeting_system_rollout_events_manage" ON public."meeting_system_rollout_events"
FOR ALL TO authenticated
USING (can_manage_meeting_resource('meeting_rules'::text))
WITH CHECK (can_manage_meeting_resource('meeting_rules'::text));

DROP POLICY IF EXISTS "meeting_system_rollout_events_view" ON public."meeting_system_rollout_events";
CREATE POLICY "meeting_system_rollout_events_view" ON public."meeting_system_rollout_events"
FOR SELECT TO authenticated
USING (can_view_meeting_resource('meeting_rules'::text));

DROP POLICY IF EXISTS "meeting_telegram_reminders_manage_directors" ON public."meeting_telegram_reminders";
CREATE POLICY "meeting_telegram_reminders_manage_directors" ON public."meeting_telegram_reminders"
FOR ALL TO public
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "meeting_telegram_reminders_select_directors" ON public."meeting_telegram_reminders";
CREATE POLICY "meeting_telegram_reminders_select_directors" ON public."meeting_telegram_reminders"
FOR SELECT TO public
USING (is_director());

DROP POLICY IF EXISTS "meeting_template_participants_manage" ON public."meeting_template_participants";
CREATE POLICY "meeting_template_participants_manage" ON public."meeting_template_participants"
FOR ALL TO authenticated
USING (can_manage_meeting_resource('meeting_templates'::text))
WITH CHECK (can_manage_meeting_resource('meeting_templates'::text));

DROP POLICY IF EXISTS "meeting_template_participants_view" ON public."meeting_template_participants";
CREATE POLICY "meeting_template_participants_view" ON public."meeting_template_participants"
FOR SELECT TO authenticated
USING (can_view_meeting_resource('meeting_templates'::text));

DROP POLICY IF EXISTS "meeting_template_questions_manage" ON public."meeting_template_questions";
CREATE POLICY "meeting_template_questions_manage" ON public."meeting_template_questions"
FOR ALL TO authenticated
USING (can_manage_meeting_resource('meeting_question_templates'::text))
WITH CHECK (can_manage_meeting_resource('meeting_question_templates'::text));

DROP POLICY IF EXISTS "meeting_template_questions_view" ON public."meeting_template_questions";
CREATE POLICY "meeting_template_questions_view" ON public."meeting_template_questions"
FOR SELECT TO authenticated
USING (can_view_meeting_resource('meeting_question_templates'::text));

DROP POLICY IF EXISTS "meeting_templates_manage" ON public."meeting_templates";
CREATE POLICY "meeting_templates_manage" ON public."meeting_templates"
FOR ALL TO authenticated
USING (can_manage_meeting_resource('meeting_templates'::text))
WITH CHECK (can_manage_meeting_resource('meeting_templates'::text));

DROP POLICY IF EXISTS "meeting_templates_view" ON public."meeting_templates";
CREATE POLICY "meeting_templates_view" ON public."meeting_templates"
FOR SELECT TO authenticated
USING (can_view_meeting_resource('meeting_templates'::text));

DROP POLICY IF EXISTS "meeting_types_modify" ON public."meeting_types";
CREATE POLICY "meeting_types_modify" ON public."meeting_types"
FOR ALL TO public
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "meeting_types_select" ON public."meeting_types";
CREATE POLICY "meeting_types_select" ON public."meeting_types"
FOR SELECT TO public
USING ((auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "meetings_delete" ON public."meetings";
CREATE POLICY "meetings_delete" ON public."meetings"
FOR DELETE TO public
USING (is_director());

DROP POLICY IF EXISTS "meetings_insert" ON public."meetings";
CREATE POLICY "meetings_insert" ON public."meetings"
FOR INSERT TO public
WITH CHECK (is_director());

DROP POLICY IF EXISTS "meetings_select" ON public."meetings";
CREATE POLICY "meetings_select" ON public."meetings"
FOR SELECT TO public
USING ((auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "meetings_update" ON public."meetings";
CREATE POLICY "meetings_update" ON public."meetings"
FOR UPDATE TO public
USING (is_director());

DROP POLICY IF EXISTS "Nesting managers delete nesting batch items" ON public."nesting_batch_items";
CREATE POLICY "Nesting managers delete nesting batch items" ON public."nesting_batch_items"
FOR DELETE TO authenticated
USING ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "Nesting managers insert nesting batch items" ON public."nesting_batch_items";
CREATE POLICY "Nesting managers insert nesting batch items" ON public."nesting_batch_items"
FOR INSERT TO authenticated
WITH CHECK ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "Nesting managers read nesting batch items" ON public."nesting_batch_items";
CREATE POLICY "Nesting managers read nesting batch items" ON public."nesting_batch_items"
FOR SELECT TO authenticated
USING ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "Nesting managers update nesting batch items" ON public."nesting_batch_items";
CREATE POLICY "Nesting managers update nesting batch items" ON public."nesting_batch_items"
FOR UPDATE TO authenticated
USING ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])))
WITH CHECK ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "Nesting managers delete nesting batches" ON public."nesting_batches";
CREATE POLICY "Nesting managers delete nesting batches" ON public."nesting_batches"
FOR DELETE TO authenticated
USING ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "Nesting managers insert nesting batches" ON public."nesting_batches";
CREATE POLICY "Nesting managers insert nesting batches" ON public."nesting_batches"
FOR INSERT TO authenticated
WITH CHECK ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "Nesting managers read nesting batches" ON public."nesting_batches";
CREATE POLICY "Nesting managers read nesting batches" ON public."nesting_batches"
FOR SELECT TO authenticated
USING ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "Nesting managers update nesting batches" ON public."nesting_batches";
CREATE POLICY "Nesting managers update nesting batches" ON public."nesting_batches"
FOR UPDATE TO authenticated
USING ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])))
WITH CHECK ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "Nesting managers delete precut parts" ON public."nesting_precut_parts";
CREATE POLICY "Nesting managers delete precut parts" ON public."nesting_precut_parts"
FOR DELETE TO authenticated
USING ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "Nesting managers insert precut parts" ON public."nesting_precut_parts";
CREATE POLICY "Nesting managers insert precut parts" ON public."nesting_precut_parts"
FOR INSERT TO authenticated
WITH CHECK ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "Nesting managers read precut parts" ON public."nesting_precut_parts";
CREATE POLICY "Nesting managers read precut parts" ON public."nesting_precut_parts"
FOR SELECT TO authenticated
USING ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "Nesting managers update precut parts" ON public."nesting_precut_parts";
CREATE POLICY "Nesting managers update precut parts" ON public."nesting_precut_parts"
FOR UPDATE TO authenticated
USING ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])))
WITH CHECK ((get_user_role() = ANY (ARRAY['technologist'::user_role, 'planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role])));

DROP POLICY IF EXISTS "Authenticated read product files" ON public."product_files";
CREATE POLICY "Authenticated read product files" ON public."product_files"
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Catalog managers delete product files" ON public."product_files";
CREATE POLICY "Catalog managers delete product files" ON public."product_files"
FOR DELETE TO authenticated
USING ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role, 'engineer'::user_role])));

DROP POLICY IF EXISTS "Catalog managers insert product files" ON public."product_files";
CREATE POLICY "Catalog managers insert product files" ON public."product_files"
FOR INSERT TO authenticated
WITH CHECK ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role, 'engineer'::user_role])));

DROP POLICY IF EXISTS "Authenticated read product project files" ON public."product_project_files";
CREATE POLICY "Authenticated read product project files" ON public."product_project_files"
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Catalog managers delete product project files" ON public."product_project_files";
CREATE POLICY "Catalog managers delete product project files" ON public."product_project_files"
FOR DELETE TO authenticated
USING ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role, 'engineer'::user_role])));

DROP POLICY IF EXISTS "Catalog managers insert product project files" ON public."product_project_files";
CREATE POLICY "Catalog managers insert product project files" ON public."product_project_files"
FOR INSERT TO authenticated
WITH CHECK ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role, 'engineer'::user_role])));

DROP POLICY IF EXISTS "product_project_mail_messages_manager_insert" ON public."product_project_mail_messages";
CREATE POLICY "product_project_mail_messages_manager_insert" ON public."product_project_mail_messages"
FOR INSERT TO authenticated
WITH CHECK (((linked_by = ( SELECT auth.uid() AS uid)) AND can_manage_product_projects() AND current_user_owns_mail_message(message_id)));

DROP POLICY IF EXISTS "product_project_mail_messages_manager_update" ON public."product_project_mail_messages";
CREATE POLICY "product_project_mail_messages_manager_update" ON public."product_project_mail_messages"
FOR UPDATE TO authenticated
USING (can_manage_product_projects())
WITH CHECK ((can_manage_product_projects() AND ((unlinked_at IS NULL) OR (unlinked_by = ( SELECT auth.uid() AS uid)))));

DROP POLICY IF EXISTS "product_project_mail_messages_reader" ON public."product_project_mail_messages";
CREATE POLICY "product_project_mail_messages_reader" ON public."product_project_mail_messages"
FOR SELECT TO authenticated
USING (can_view_product_projects());

DROP POLICY IF EXISTS "product_project_mail_links_manager_insert" ON public."product_project_mail_threads";
CREATE POLICY "product_project_mail_links_manager_insert" ON public."product_project_mail_threads"
FOR INSERT TO authenticated
WITH CHECK (((linked_by = ( SELECT auth.uid() AS uid)) AND can_manage_product_projects() AND current_user_owns_mail_thread(thread_id)));

DROP POLICY IF EXISTS "product_project_mail_links_manager_update" ON public."product_project_mail_threads";
CREATE POLICY "product_project_mail_links_manager_update" ON public."product_project_mail_threads"
FOR UPDATE TO authenticated
USING (can_manage_product_projects())
WITH CHECK ((can_manage_product_projects() AND ((unlinked_at IS NULL) OR (unlinked_by = ( SELECT auth.uid() AS uid)))));

DROP POLICY IF EXISTS "product_project_mail_links_reader" ON public."product_project_mail_threads";
CREATE POLICY "product_project_mail_links_reader" ON public."product_project_mail_threads"
FOR SELECT TO authenticated
USING (can_view_product_projects());

DROP POLICY IF EXISTS "Authenticated read product project versions" ON public."product_project_versions";
CREATE POLICY "Authenticated read product project versions" ON public."product_project_versions"
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Catalog managers insert product project versions" ON public."product_project_versions";
CREATE POLICY "Catalog managers insert product project versions" ON public."product_project_versions"
FOR INSERT TO authenticated
WITH CHECK ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role, 'engineer'::user_role])));

DROP POLICY IF EXISTS "Catalog managers update product project versions" ON public."product_project_versions";
CREATE POLICY "Catalog managers update product project versions" ON public."product_project_versions"
FOR UPDATE TO authenticated
USING ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role, 'engineer'::user_role])));

DROP POLICY IF EXISTS "Authenticated read product projects" ON public."product_projects";
CREATE POLICY "Authenticated read product projects" ON public."product_projects"
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Catalog managers insert product projects" ON public."product_projects";
CREATE POLICY "Catalog managers insert product projects" ON public."product_projects"
FOR INSERT TO authenticated
WITH CHECK ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role, 'engineer'::user_role])));

DROP POLICY IF EXISTS "Catalog managers update product projects" ON public."product_projects";
CREATE POLICY "Catalog managers update product projects" ON public."product_projects"
FOR UPDATE TO authenticated
USING ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role, 'engineer'::user_role])));

DROP POLICY IF EXISTS "Authenticated read product versions" ON public."product_versions";
CREATE POLICY "Authenticated read product versions" ON public."product_versions"
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Catalog managers insert product versions" ON public."product_versions";
CREATE POLICY "Catalog managers insert product versions" ON public."product_versions"
FOR INSERT TO authenticated
WITH CHECK ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'engineer'::user_role])));

DROP POLICY IF EXISTS "Catalog managers update product versions" ON public."product_versions";
CREATE POLICY "Catalog managers update product versions" ON public."product_versions"
FOR UPDATE TO authenticated
USING ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'engineer'::user_role])));

DROP POLICY IF EXISTS "production_fact_sections_insert" ON public."production_fact_sections";
CREATE POLICY "production_fact_sections_insert" ON public."production_fact_sections"
FOR INSERT TO authenticated
WITH CHECK ((is_director() OR ((get_user_role() = 'production_manager'::user_role) AND (factory_id = get_user_factory_id()))));

DROP POLICY IF EXISTS "production_fact_sections_select" ON public."production_fact_sections";
CREATE POLICY "production_fact_sections_select" ON public."production_fact_sections"
FOR SELECT TO authenticated
USING ((is_director() OR ((get_user_role() = 'production_manager'::user_role) AND (factory_id = get_user_factory_id()))));

DROP POLICY IF EXISTS "production_fact_sections_update" ON public."production_fact_sections";
CREATE POLICY "production_fact_sections_update" ON public."production_fact_sections"
FOR UPDATE TO authenticated
USING ((is_director() OR ((get_user_role() = 'production_manager'::user_role) AND (factory_id = get_user_factory_id()))))
WITH CHECK ((is_director() OR ((get_user_role() = 'production_manager'::user_role) AND (factory_id = get_user_factory_id()))));

DROP POLICY IF EXISTS "production_machine_facts_delete" ON public."production_machine_facts";
CREATE POLICY "production_machine_facts_delete" ON public."production_machine_facts"
FOR DELETE TO authenticated
USING ((is_director() OR ((get_user_role() = 'production_manager'::user_role) AND (factory_id = get_user_factory_id()))));

DROP POLICY IF EXISTS "production_machine_facts_insert" ON public."production_machine_facts";
CREATE POLICY "production_machine_facts_insert" ON public."production_machine_facts"
FOR INSERT TO authenticated
WITH CHECK ((is_director() OR ((get_user_role() = 'production_manager'::user_role) AND (factory_id = get_user_factory_id()))));

DROP POLICY IF EXISTS "production_machine_facts_select" ON public."production_machine_facts";
CREATE POLICY "production_machine_facts_select" ON public."production_machine_facts"
FOR SELECT TO authenticated
USING ((is_director() OR ((get_user_role() = 'production_manager'::user_role) AND (factory_id = get_user_factory_id()))));

DROP POLICY IF EXISTS "production_machine_facts_update" ON public."production_machine_facts";
CREATE POLICY "production_machine_facts_update" ON public."production_machine_facts"
FOR UPDATE TO authenticated
USING ((is_director() OR ((get_user_role() = 'production_manager'::user_role) AND (factory_id = get_user_factory_id()))))
WITH CHECK ((is_director() OR ((get_user_role() = 'production_manager'::user_role) AND (factory_id = get_user_factory_id()))));

DROP POLICY IF EXISTS "production_machine_item_facts_select" ON public."production_machine_item_facts";
CREATE POLICY "production_machine_item_facts_select" ON public."production_machine_item_facts"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM production_machine_facts fact
  WHERE ((fact.id = production_machine_item_facts.production_machine_fact_id) AND (is_director() OR ((get_user_role() = 'production_manager'::user_role) AND (fact.factory_id = get_user_factory_id())))))));

DROP POLICY IF EXISTS "production_month_plans_select" ON public."production_month_plans";
CREATE POLICY "production_month_plans_select" ON public."production_month_plans"
FOR SELECT TO authenticated
USING (
CASE
    WHEN (get_user_role() = 'production_manager'::user_role) THEN (factory_id = get_user_factory_id())
    ELSE true
END);

DROP POLICY IF EXISTS "production_month_plans_service_role_modify" ON public."production_month_plans";
CREATE POLICY "production_month_plans_service_role_modify" ON public."production_month_plans"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "production_plan_date_change_request_items_select" ON public."production_plan_date_change_request_items";
CREATE POLICY "production_plan_date_change_request_items_select" ON public."production_plan_date_change_request_items"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM production_plan_date_change_requests r
  WHERE ((r.id = production_plan_date_change_request_items.request_id) AND ((r.requested_by = auth.uid()) OR (EXISTS ( SELECT 1
           FROM tasks t
          WHERE ((t.id = r.task_id) AND (t.assigned_to = auth.uid())))) OR is_director() OR (EXISTS ( SELECT 1
           FROM machines m
          WHERE ((m.id = r.machine_id) AND (get_user_role() = 'production_manager'::user_role) AND (m.factory_id = get_user_factory_id())))))))));

DROP POLICY IF EXISTS "production_plan_date_change_request_items_service_role_modify" ON public."production_plan_date_change_request_items";
CREATE POLICY "production_plan_date_change_request_items_service_role_modify" ON public."production_plan_date_change_request_items"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "production_plan_date_change_requests_select" ON public."production_plan_date_change_requests";
CREATE POLICY "production_plan_date_change_requests_select" ON public."production_plan_date_change_requests"
FOR SELECT TO authenticated
USING (((requested_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = production_plan_date_change_requests.task_id) AND (t.assigned_to = auth.uid())))) OR is_director() OR (EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = production_plan_date_change_requests.machine_id) AND (get_user_role() = 'production_manager'::user_role) AND (m.factory_id = get_user_factory_id()))))));

DROP POLICY IF EXISTS "production_plan_date_change_requests_service_role_modify" ON public."production_plan_date_change_requests";
CREATE POLICY "production_plan_date_change_requests_service_role_modify" ON public."production_plan_date_change_requests"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "production_stage_intervals_select" ON public."production_stage_intervals";
CREATE POLICY "production_stage_intervals_select" ON public."production_stage_intervals"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM (production_stages ps
     JOIN machines m ON ((m.id = ps.machine_id)))
  WHERE ((ps.id = production_stage_intervals.production_stage_id) AND
        CASE
            WHEN (get_user_role() = 'production_manager'::user_role) THEN ((m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL))
            ELSE true
        END))));

DROP POLICY IF EXISTS "production_stage_intervals_service_role_all" ON public."production_stage_intervals";
CREATE POLICY "production_stage_intervals_service_role_all" ON public."production_stage_intervals"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Production Stages - Insert staff" ON public."production_stages";
CREATE POLICY "Production Stages - Insert staff" ON public."production_stages"
FOR INSERT TO authenticated
WITH CHECK ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'production_manager'::user_role])));

DROP POLICY IF EXISTS "Production Stages - Update staff" ON public."production_stages";
CREATE POLICY "Production Stages - Update staff" ON public."production_stages"
FOR UPDATE TO authenticated
USING ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'production_manager'::user_role])));

DROP POLICY IF EXISTS "production_stages_select" ON public."production_stages";
CREATE POLICY "production_stages_select" ON public."production_stages"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = production_stages.machine_id) AND
        CASE
            WHEN (get_user_role() = 'production_manager'::user_role) THEN ((m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL))
            ELSE true
        END))));

DROP POLICY IF EXISTS "production_tonnage_facts_delete" ON public."production_tonnage_facts";
CREATE POLICY "production_tonnage_facts_delete" ON public."production_tonnage_facts"
FOR DELETE TO authenticated
USING ((is_director() OR ((get_user_role() = 'production_manager'::user_role) AND (factory_id = get_user_factory_id()))));

DROP POLICY IF EXISTS "production_tonnage_facts_insert" ON public."production_tonnage_facts";
CREATE POLICY "production_tonnage_facts_insert" ON public."production_tonnage_facts"
FOR INSERT TO authenticated
WITH CHECK ((is_director() OR ((get_user_role() = 'production_manager'::user_role) AND (factory_id = get_user_factory_id()))));

DROP POLICY IF EXISTS "production_tonnage_facts_select" ON public."production_tonnage_facts";
CREATE POLICY "production_tonnage_facts_select" ON public."production_tonnage_facts"
FOR SELECT TO authenticated
USING ((is_director() OR ((get_user_role() = 'production_manager'::user_role) AND (factory_id = get_user_factory_id()))));

DROP POLICY IF EXISTS "production_tonnage_facts_update" ON public."production_tonnage_facts";
CREATE POLICY "production_tonnage_facts_update" ON public."production_tonnage_facts"
FOR UPDATE TO authenticated
USING ((is_director() OR ((get_user_role() = 'production_manager'::user_role) AND (factory_id = get_user_factory_id()))))
WITH CHECK ((is_director() OR ((get_user_role() = 'production_manager'::user_role) AND (factory_id = get_user_factory_id()))));

DROP POLICY IF EXISTS "Authenticated read products" ON public."products";
CREATE POLICY "Authenticated read products" ON public."products"
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Catalog managers insert products" ON public."products";
CREATE POLICY "Catalog managers insert products" ON public."products"
FOR INSERT TO authenticated
WITH CHECK ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role, 'engineer'::user_role])));

DROP POLICY IF EXISTS "Catalog managers update products" ON public."products";
CREATE POLICY "Catalog managers update products" ON public."products"
FOR UPDATE TO authenticated
USING ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'sales_manager'::user_role, 'engineer'::user_role])));

DROP POLICY IF EXISTS "Request chain cord delete request roles" ON public."request_chain_cord";
CREATE POLICY "Request chain cord delete request roles" ON public."request_chain_cord"
FOR DELETE TO authenticated
USING (security_can_manage_request_materials());

DROP POLICY IF EXISTS "Request chain cord insert request roles" ON public."request_chain_cord";
CREATE POLICY "Request chain cord insert request roles" ON public."request_chain_cord"
FOR INSERT TO authenticated
WITH CHECK (security_can_manage_request_materials());

DROP POLICY IF EXISTS "Request chain cord read request roles" ON public."request_chain_cord";
CREATE POLICY "Request chain cord read request roles" ON public."request_chain_cord"
FOR SELECT TO authenticated
USING (security_can_view_request_materials());

DROP POLICY IF EXISTS "Request chain cord update request roles" ON public."request_chain_cord";
CREATE POLICY "Request chain cord update request roles" ON public."request_chain_cord"
FOR UPDATE TO authenticated
USING (security_can_manage_request_materials())
WITH CHECK (security_can_manage_request_materials());

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_chain_cord";
CREATE POLICY "financial_supply_item_visibility" ON public."request_chain_cord"
AS RESTRICTIVE FOR ALL TO authenticated
USING (fn_financial_supply_visibility(request_id))
WITH CHECK (fn_financial_supply_visibility(request_id));

DROP POLICY IF EXISTS "Request circle delete request roles" ON public."request_circle";
CREATE POLICY "Request circle delete request roles" ON public."request_circle"
FOR DELETE TO authenticated
USING ((security_can_manage_request_materials() AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_circle.request_id) AND (NOT request.is_recalculation_staging))))));

DROP POLICY IF EXISTS "Request circle insert request roles" ON public."request_circle";
CREATE POLICY "Request circle insert request roles" ON public."request_circle"
FOR INSERT TO authenticated
WITH CHECK ((security_can_manage_request_materials() AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_circle.request_id) AND (NOT request.is_recalculation_staging))))));

DROP POLICY IF EXISTS "Request circle read request roles" ON public."request_circle";
CREATE POLICY "Request circle read request roles" ON public."request_circle"
FOR SELECT TO authenticated
USING ((security_can_view_request_materials() AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_circle.request_id) AND (NOT request.is_recalculation_staging))))));

DROP POLICY IF EXISTS "Request circle update request roles" ON public."request_circle";
CREATE POLICY "Request circle update request roles" ON public."request_circle"
FOR UPDATE TO authenticated
USING ((security_can_manage_request_materials() AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_circle.request_id) AND (NOT request.is_recalculation_staging))))))
WITH CHECK ((security_can_manage_request_materials() AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_circle.request_id) AND (NOT request.is_recalculation_staging))))));

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_circle";
CREATE POLICY "financial_supply_item_visibility" ON public."request_circle"
AS RESTRICTIVE FOR ALL TO authenticated
USING (fn_financial_supply_visibility(request_id))
WITH CHECK (fn_financial_supply_visibility(request_id));

DROP POLICY IF EXISTS "Request components delete request roles" ON public."request_components";
CREATE POLICY "Request components delete request roles" ON public."request_components"
FOR DELETE TO authenticated
USING (security_can_manage_request_materials());

DROP POLICY IF EXISTS "Request components insert request roles" ON public."request_components";
CREATE POLICY "Request components insert request roles" ON public."request_components"
FOR INSERT TO authenticated
WITH CHECK (security_can_manage_request_materials());

DROP POLICY IF EXISTS "Request components read request roles" ON public."request_components";
CREATE POLICY "Request components read request roles" ON public."request_components"
FOR SELECT TO authenticated
USING (security_can_view_request_materials());

DROP POLICY IF EXISTS "Request components update request roles" ON public."request_components";
CREATE POLICY "Request components update request roles" ON public."request_components"
FOR UPDATE TO authenticated
USING (security_can_manage_request_materials())
WITH CHECK (security_can_manage_request_materials());

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_components";
CREATE POLICY "financial_supply_item_visibility" ON public."request_components"
AS RESTRICTIVE FOR ALL TO authenticated
USING (fn_financial_supply_visibility(request_id))
WITH CHECK (fn_financial_supply_visibility(request_id));

DROP POLICY IF EXISTS "Request knives delete request roles" ON public."request_knives";
CREATE POLICY "Request knives delete request roles" ON public."request_knives"
FOR DELETE TO authenticated
USING ((security_can_manage_request_materials() AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_knives.request_id) AND (NOT request.is_recalculation_staging))))));

DROP POLICY IF EXISTS "Request knives insert request roles" ON public."request_knives";
CREATE POLICY "Request knives insert request roles" ON public."request_knives"
FOR INSERT TO authenticated
WITH CHECK ((security_can_manage_request_materials() AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_knives.request_id) AND (NOT request.is_recalculation_staging))))));

DROP POLICY IF EXISTS "Request knives read request roles" ON public."request_knives";
CREATE POLICY "Request knives read request roles" ON public."request_knives"
FOR SELECT TO authenticated
USING ((security_can_view_request_materials() AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_knives.request_id) AND (NOT request.is_recalculation_staging))))));

DROP POLICY IF EXISTS "Request knives update request roles" ON public."request_knives";
CREATE POLICY "Request knives update request roles" ON public."request_knives"
FOR UPDATE TO authenticated
USING ((security_can_manage_request_materials() AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_knives.request_id) AND (NOT request.is_recalculation_staging))))))
WITH CHECK ((security_can_manage_request_materials() AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_knives.request_id) AND (NOT request.is_recalculation_staging))))));

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_knives";
CREATE POLICY "financial_supply_item_visibility" ON public."request_knives"
AS RESTRICTIVE FOR ALL TO authenticated
USING (fn_financial_supply_visibility(request_id))
WITH CHECK (fn_financial_supply_visibility(request_id));

DROP POLICY IF EXISTS "Request mesh delete request roles" ON public."request_mesh";
CREATE POLICY "Request mesh delete request roles" ON public."request_mesh"
FOR DELETE TO authenticated
USING (security_can_manage_request_materials());

DROP POLICY IF EXISTS "Request mesh insert request roles" ON public."request_mesh";
CREATE POLICY "Request mesh insert request roles" ON public."request_mesh"
FOR INSERT TO authenticated
WITH CHECK (security_can_manage_request_materials());

DROP POLICY IF EXISTS "Request mesh read request roles" ON public."request_mesh";
CREATE POLICY "Request mesh read request roles" ON public."request_mesh"
FOR SELECT TO authenticated
USING (security_can_view_request_materials());

DROP POLICY IF EXISTS "Request mesh update request roles" ON public."request_mesh";
CREATE POLICY "Request mesh update request roles" ON public."request_mesh"
FOR UPDATE TO authenticated
USING (security_can_manage_request_materials())
WITH CHECK (security_can_manage_request_materials());

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_mesh";
CREATE POLICY "financial_supply_item_visibility" ON public."request_mesh"
AS RESTRICTIVE FOR ALL TO authenticated
USING (fn_financial_supply_visibility(request_id))
WITH CHECK (fn_financial_supply_visibility(request_id));

DROP POLICY IF EXISTS "Request paint delete request roles" ON public."request_paint";
CREATE POLICY "Request paint delete request roles" ON public."request_paint"
FOR DELETE TO authenticated
USING (security_can_manage_request_materials());

DROP POLICY IF EXISTS "Request paint insert request roles" ON public."request_paint";
CREATE POLICY "Request paint insert request roles" ON public."request_paint"
FOR INSERT TO authenticated
WITH CHECK (security_can_manage_request_materials());

DROP POLICY IF EXISTS "Request paint read request roles" ON public."request_paint";
CREATE POLICY "Request paint read request roles" ON public."request_paint"
FOR SELECT TO authenticated
USING (security_can_view_request_materials());

DROP POLICY IF EXISTS "Request paint update request roles" ON public."request_paint";
CREATE POLICY "Request paint update request roles" ON public."request_paint"
FOR UPDATE TO authenticated
USING (security_can_manage_request_materials())
WITH CHECK (security_can_manage_request_materials());

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_paint";
CREATE POLICY "financial_supply_item_visibility" ON public."request_paint"
AS RESTRICTIVE FOR ALL TO authenticated
USING (fn_financial_supply_visibility(request_id))
WITH CHECK (fn_financial_supply_visibility(request_id));

DROP POLICY IF EXISTS "Request pipe delete request roles" ON public."request_pipe";
CREATE POLICY "Request pipe delete request roles" ON public."request_pipe"
FOR DELETE TO authenticated
USING ((security_can_manage_request_materials() AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_pipe.request_id) AND (NOT request.is_recalculation_staging))))));

DROP POLICY IF EXISTS "Request pipe insert request roles" ON public."request_pipe";
CREATE POLICY "Request pipe insert request roles" ON public."request_pipe"
FOR INSERT TO authenticated
WITH CHECK ((security_can_manage_request_materials() AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_pipe.request_id) AND (NOT request.is_recalculation_staging))))));

DROP POLICY IF EXISTS "Request pipe read request roles" ON public."request_pipe";
CREATE POLICY "Request pipe read request roles" ON public."request_pipe"
FOR SELECT TO authenticated
USING ((security_can_view_request_materials() AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_pipe.request_id) AND (NOT request.is_recalculation_staging))))));

DROP POLICY IF EXISTS "Request pipe update request roles" ON public."request_pipe";
CREATE POLICY "Request pipe update request roles" ON public."request_pipe"
FOR UPDATE TO authenticated
USING ((security_can_manage_request_materials() AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_pipe.request_id) AND (NOT request.is_recalculation_staging))))))
WITH CHECK ((security_can_manage_request_materials() AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_pipe.request_id) AND (NOT request.is_recalculation_staging))))));

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_pipe";
CREATE POLICY "financial_supply_item_visibility" ON public."request_pipe"
AS RESTRICTIVE FOR ALL TO authenticated
USING (fn_financial_supply_visibility(request_id))
WITH CHECK (fn_financial_supply_visibility(request_id));

DROP POLICY IF EXISTS "Request round tube delete request roles" ON public."request_round_tube";
CREATE POLICY "Request round tube delete request roles" ON public."request_round_tube"
FOR DELETE TO authenticated
USING (security_can_manage_request_materials());

DROP POLICY IF EXISTS "Request round tube insert request roles" ON public."request_round_tube";
CREATE POLICY "Request round tube insert request roles" ON public."request_round_tube"
FOR INSERT TO authenticated
WITH CHECK (security_can_manage_request_materials());

DROP POLICY IF EXISTS "Request round tube read request roles" ON public."request_round_tube";
CREATE POLICY "Request round tube read request roles" ON public."request_round_tube"
FOR SELECT TO authenticated
USING (security_can_view_request_materials());

DROP POLICY IF EXISTS "Request round tube update request roles" ON public."request_round_tube";
CREATE POLICY "Request round tube update request roles" ON public."request_round_tube"
FOR UPDATE TO authenticated
USING (security_can_manage_request_materials())
WITH CHECK (security_can_manage_request_materials());

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_round_tube";
CREATE POLICY "financial_supply_item_visibility" ON public."request_round_tube"
AS RESTRICTIVE FOR ALL TO authenticated
USING (fn_financial_supply_visibility(request_id))
WITH CHECK (fn_financial_supply_visibility(request_id));

DROP POLICY IF EXISTS "Request sheet metal delete request roles" ON public."request_sheet_metal";
CREATE POLICY "Request sheet metal delete request roles" ON public."request_sheet_metal"
FOR DELETE TO authenticated
USING (security_can_manage_request_materials());

DROP POLICY IF EXISTS "Request sheet metal insert request roles" ON public."request_sheet_metal";
CREATE POLICY "Request sheet metal insert request roles" ON public."request_sheet_metal"
FOR INSERT TO authenticated
WITH CHECK (security_can_manage_request_materials());

DROP POLICY IF EXISTS "Request sheet metal read request roles" ON public."request_sheet_metal";
CREATE POLICY "Request sheet metal read request roles" ON public."request_sheet_metal"
FOR SELECT TO authenticated
USING (security_can_view_request_materials());

DROP POLICY IF EXISTS "Request sheet metal update request roles" ON public."request_sheet_metal";
CREATE POLICY "Request sheet metal update request roles" ON public."request_sheet_metal"
FOR UPDATE TO authenticated
USING (security_can_manage_request_materials())
WITH CHECK (security_can_manage_request_materials());

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_sheet_metal";
CREATE POLICY "financial_supply_item_visibility" ON public."request_sheet_metal"
AS RESTRICTIVE FOR ALL TO authenticated
USING (fn_financial_supply_visibility(request_id))
WITH CHECK (fn_financial_supply_visibility(request_id));

DROP POLICY IF EXISTS "role_permission_audit_insert_directors" ON public."role_permission_audit_log";
CREATE POLICY "role_permission_audit_insert_directors" ON public."role_permission_audit_log"
FOR INSERT TO authenticated
WITH CHECK (is_director());

DROP POLICY IF EXISTS "role_permission_audit_select_directors" ON public."role_permission_audit_log";
CREATE POLICY "role_permission_audit_select_directors" ON public."role_permission_audit_log"
FOR SELECT TO authenticated
USING (is_director());

DROP POLICY IF EXISTS "role_permissions_modify_directors" ON public."role_permissions";
CREATE POLICY "role_permissions_modify_directors" ON public."role_permissions"
FOR ALL TO authenticated
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "role_permissions_select_authenticated" ON public."role_permissions";
CREATE POLICY "role_permissions_select_authenticated" ON public."role_permissions"
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Steel types delete directors" ON public."steel_types";
CREATE POLICY "Steel types delete directors" ON public."steel_types"
FOR DELETE TO authenticated
USING (is_director());

DROP POLICY IF EXISTS "Steel types insert nesting roles" ON public."steel_types";
CREATE POLICY "Steel types insert nesting roles" ON public."steel_types"
FOR INSERT TO authenticated
WITH CHECK ((security_can_manage_nesting_catalog() OR security_can_manage_catalog()));

DROP POLICY IF EXISTS "Steel types read nesting roles" ON public."steel_types";
CREATE POLICY "Steel types read nesting roles" ON public."steel_types"
FOR SELECT TO authenticated
USING ((security_can_manage_nesting_catalog() OR security_can_manage_catalog()));

DROP POLICY IF EXISTS "Steel types update nesting roles" ON public."steel_types";
CREATE POLICY "Steel types update nesting roles" ON public."steel_types"
FOR UPDATE TO authenticated
USING ((security_can_manage_nesting_catalog() OR security_can_manage_catalog()))
WITH CHECK ((security_can_manage_nesting_catalog() OR security_can_manage_catalog()));

DROP POLICY IF EXISTS "Supplier delivery days delete directors" ON public."supplier_delivery_days";
CREATE POLICY "Supplier delivery days delete directors" ON public."supplier_delivery_days"
FOR DELETE TO authenticated
USING (is_director());

DROP POLICY IF EXISTS "Supplier delivery days insert directors" ON public."supplier_delivery_days";
CREATE POLICY "Supplier delivery days insert directors" ON public."supplier_delivery_days"
FOR INSERT TO authenticated
WITH CHECK (is_director());

DROP POLICY IF EXISTS "Supplier delivery days read supply roles" ON public."supplier_delivery_days";
CREATE POLICY "Supplier delivery days read supply roles" ON public."supplier_delivery_days"
FOR SELECT TO authenticated
USING (security_can_manage_supply());

DROP POLICY IF EXISTS "Supplier delivery days update directors" ON public."supplier_delivery_days";
CREATE POLICY "Supplier delivery days update directors" ON public."supplier_delivery_days"
FOR UPDATE TO authenticated
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "Supplier categories delete directors" ON public."supplier_material_categories";
CREATE POLICY "Supplier categories delete directors" ON public."supplier_material_categories"
FOR DELETE TO authenticated
USING (is_director());

DROP POLICY IF EXISTS "Supplier categories insert directors" ON public."supplier_material_categories";
CREATE POLICY "Supplier categories insert directors" ON public."supplier_material_categories"
FOR INSERT TO authenticated
WITH CHECK (is_director());

DROP POLICY IF EXISTS "Supplier categories read supply roles" ON public."supplier_material_categories";
CREATE POLICY "Supplier categories read supply roles" ON public."supplier_material_categories"
FOR SELECT TO authenticated
USING (security_can_manage_supply());

DROP POLICY IF EXISTS "Supplier categories update directors" ON public."supplier_material_categories";
CREATE POLICY "Supplier categories update directors" ON public."supplier_material_categories"
FOR UPDATE TO authenticated
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "Suppliers insert directors" ON public."suppliers";
CREATE POLICY "Suppliers insert directors" ON public."suppliers"
FOR INSERT TO authenticated
WITH CHECK (is_director());

DROP POLICY IF EXISTS "Suppliers read supply roles" ON public."suppliers";
CREATE POLICY "Suppliers read supply roles" ON public."suppliers"
FOR SELECT TO authenticated
USING (security_can_manage_supply());

DROP POLICY IF EXISTS "Suppliers update directors" ON public."suppliers";
CREATE POLICY "Suppliers update directors" ON public."suppliers"
FOR UPDATE TO authenticated
USING (is_director())
WITH CHECK (is_director());

DROP POLICY IF EXISTS "Supply Items - Insert staff" ON public."supply_items";
CREATE POLICY "Supply Items - Insert staff" ON public."supply_items"
FOR INSERT TO authenticated
WITH CHECK ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'technologist'::user_role, 'supply_manager'::user_role])));

DROP POLICY IF EXISTS "Supply Items - Update staff" ON public."supply_items";
CREATE POLICY "Supply Items - Update staff" ON public."supply_items"
FOR UPDATE TO authenticated
USING ((get_user_role() = ANY (ARRAY['planning_director'::user_role, 'financial_director'::user_role, 'commercial_director'::user_role, 'engineer'::user_role, 'technologist'::user_role, 'supply_manager'::user_role])));

DROP POLICY IF EXISTS "supply_items_select" ON public."supply_items";
CREATE POLICY "supply_items_select" ON public."supply_items"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = supply_items.machine_id) AND
        CASE
            WHEN (get_user_role() = 'production_manager'::user_role) THEN ((m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL))
            ELSE true
        END))));

DROP POLICY IF EXISTS "Supply schedule changes insert supply roles" ON public."supply_order_delivery_schedule_changes";
CREATE POLICY "Supply schedule changes insert supply roles" ON public."supply_order_delivery_schedule_changes"
FOR INSERT TO authenticated
WITH CHECK (security_can_manage_supply());

DROP POLICY IF EXISTS "Supply schedule changes read supply roles" ON public."supply_order_delivery_schedule_changes";
CREATE POLICY "Supply schedule changes read supply roles" ON public."supply_order_delivery_schedule_changes"
FOR SELECT TO authenticated
USING (security_can_manage_supply());

DROP POLICY IF EXISTS "Supply schedules insert supply roles" ON public."supply_order_delivery_schedules";
CREATE POLICY "Supply schedules insert supply roles" ON public."supply_order_delivery_schedules"
FOR INSERT TO authenticated
WITH CHECK (security_can_manage_supply());

DROP POLICY IF EXISTS "Supply schedules read supply roles" ON public."supply_order_delivery_schedules";
CREATE POLICY "Supply schedules read supply roles" ON public."supply_order_delivery_schedules"
FOR SELECT TO authenticated
USING (security_can_manage_supply());

DROP POLICY IF EXISTS "Supply schedules update supply roles" ON public."supply_order_delivery_schedules";
CREATE POLICY "Supply schedules update supply roles" ON public."supply_order_delivery_schedules"
FOR UPDATE TO authenticated
USING (security_can_manage_supply())
WITH CHECK (security_can_manage_supply());

DROP POLICY IF EXISTS "supply_position_revisions_select" ON public."supply_position_revisions";
CREATE POLICY "supply_position_revisions_select" ON public."supply_position_revisions"
FOR SELECT TO authenticated
USING (((requested_by = ( SELECT auth.uid() AS uid)) OR (assigned_to = ( SELECT auth.uid() AS uid)) OR security_can_view_request_materials()));

DROP POLICY IF EXISTS "task_delegations_select_involved" ON public."task_delegations";
CREATE POLICY "task_delegations_select_involved" ON public."task_delegations"
FOR SELECT TO authenticated
USING (((delegated_by = auth.uid()) OR (delegated_from = auth.uid()) OR (delegated_to = auth.uid()) OR is_director()));

DROP POLICY IF EXISTS "Tasks insert own or directors" ON public."tasks";
CREATE POLICY "Tasks insert own or directors" ON public."tasks"
FOR INSERT TO authenticated
WITH CHECK (((assigned_to = auth.uid()) OR is_director()));

DROP POLICY IF EXISTS "Tasks read app roles" ON public."tasks";
CREATE POLICY "Tasks read app roles" ON public."tasks"
FOR SELECT TO authenticated
USING (security_has_role(ARRAY['planning_director'::text, 'financial_director'::text, 'commercial_director'::text, 'sales_manager'::text, 'engineer'::text, 'technologist'::text, 'supply_manager'::text, 'production_manager'::text, 'procurement_head'::text, 'painting_head'::text]));

DROP POLICY IF EXISTS "Tasks update own or directors" ON public."tasks";
CREATE POLICY "Tasks update own or directors" ON public."tasks"
FOR UPDATE TO authenticated
USING (((assigned_to = auth.uid()) OR is_director()))
WITH CHECK (((assigned_to = auth.uid()) OR is_director()));

DROP POLICY IF EXISTS "Technologist requests insert request roles" ON public."technologist_requests";
CREATE POLICY "Technologist requests insert request roles" ON public."technologist_requests"
FOR INSERT TO authenticated
WITH CHECK (((NOT is_recalculation_staging) AND security_can_manage_request_materials()));

DROP POLICY IF EXISTS "Technologist requests read request roles" ON public."technologist_requests";
CREATE POLICY "Technologist requests read request roles" ON public."technologist_requests"
FOR SELECT TO authenticated
USING (((NOT is_recalculation_staging) AND security_can_view_request_materials()));

DROP POLICY IF EXISTS "Technologist requests update request roles" ON public."technologist_requests";
CREATE POLICY "Technologist requests update request roles" ON public."technologist_requests"
FOR UPDATE TO authenticated
USING (((NOT is_recalculation_staging) AND security_can_manage_request_materials()))
WITH CHECK (((NOT is_recalculation_staging) AND security_can_manage_request_materials()));

DROP POLICY IF EXISTS "financial_request_insert_state" ON public."technologist_requests";
CREATE POLICY "financial_request_insert_state" ON public."technologist_requests"
AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (((status)::text <> ALL (ARRAY['pending_financial_approval'::text, 'submitted_to_supply'::text, 'completed'::text])));

DROP POLICY IF EXISTS "financial_supply_request_visibility" ON public."technologist_requests";
CREATE POLICY "financial_supply_request_visibility" ON public."technologist_requests"
AS RESTRICTIVE FOR SELECT TO authenticated
USING (fn_financial_supply_visibility(id));

DROP POLICY IF EXISTS "transport_trip_date_items_select" ON public."transport_trip_date_change_items";
CREATE POLICY "transport_trip_date_items_select" ON public."transport_trip_date_change_items"
FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM transport_trip_date_change_requests r
  WHERE ((r.id = transport_trip_date_change_items.request_id) AND ((r.requested_by = auth.uid()) OR is_director() OR (EXISTS ( SELECT 1
           FROM tasks t
          WHERE ((t.id = r.task_id) AND (t.assigned_to = auth.uid())))))))));

DROP POLICY IF EXISTS "transport_trip_date_items_service_modify" ON public."transport_trip_date_change_items";
CREATE POLICY "transport_trip_date_items_service_modify" ON public."transport_trip_date_change_items"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "transport_trip_date_requests_select" ON public."transport_trip_date_change_requests";
CREATE POLICY "transport_trip_date_requests_select" ON public."transport_trip_date_change_requests"
FOR SELECT TO authenticated
USING (((requested_by = auth.uid()) OR is_director() OR (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = transport_trip_date_change_requests.task_id) AND (t.assigned_to = auth.uid()))))));

DROP POLICY IF EXISTS "transport_trip_date_requests_service_modify" ON public."transport_trip_date_change_requests";
CREATE POLICY "transport_trip_date_requests_service_modify" ON public."transport_trip_date_change_requests"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "transport_trip_need_links_select" ON public."transport_trip_need_links";
CREATE POLICY "transport_trip_need_links_select" ON public."transport_trip_need_links"
FOR SELECT TO authenticated
USING ((( SELECT is_director() AS is_director) OR (( SELECT get_user_role() AS get_user_role) = ANY (ARRAY['supply_manager'::user_role, 'procurement_head'::user_role, 'production_manager'::user_role]))));

DROP POLICY IF EXISTS "transport_trip_need_links_service_role_modify" ON public."transport_trip_need_links";
CREATE POLICY "transport_trip_need_links_service_role_modify" ON public."transport_trip_need_links"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "transport_trip_stops_select" ON public."transport_trip_stops";
CREATE POLICY "transport_trip_stops_select" ON public."transport_trip_stops"
FOR SELECT TO authenticated
USING ((( SELECT is_director() AS is_director) OR (( SELECT get_user_role() AS get_user_role) = ANY (ARRAY['supply_manager'::user_role, 'procurement_head'::user_role, 'production_manager'::user_role]))));

DROP POLICY IF EXISTS "transport_trip_stops_service_role_modify" ON public."transport_trip_stops";
CREATE POLICY "transport_trip_stops_service_role_modify" ON public."transport_trip_stops"
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "technologist_request_approval_versions_select" ON public."technologist_request_approval_versions";
CREATE POLICY "technologist_request_approval_versions_select" ON public."technologist_request_approval_versions"
FOR SELECT TO authenticated
USING (((submitted_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND u.is_active AND (u.role = 'financial_director'::user_role)))) OR (EXISTS ( SELECT 1
   FROM ((department_members dm
     JOIN positions p ON ((p.id = dm.position_id)))
     JOIN users u ON ((u.id = dm.user_id)))
  WHERE ((dm.user_id = auth.uid()) AND u.is_active AND p.is_active AND (p.name = 'Администратор CRM'::text))))));

DROP POLICY IF EXISTS "Users - Delete planning_director" ON public."users";
CREATE POLICY "Users - Delete planning_director" ON public."users"
FOR DELETE TO authenticated
USING ((get_user_role() = 'planning_director'::user_role));

DROP POLICY IF EXISTS "Users - Insert planning_director" ON public."users";
CREATE POLICY "Users - Insert planning_director" ON public."users"
FOR INSERT TO authenticated
WITH CHECK ((get_user_role() = 'planning_director'::user_role));

DROP POLICY IF EXISTS "Users - Update planning_director" ON public."users";
CREATE POLICY "Users - Update planning_director" ON public."users"
FOR UPDATE TO authenticated
USING ((get_user_role() = 'planning_director'::user_role));

DROP POLICY IF EXISTS "users_select" ON public."users";
CREATE POLICY "users_select" ON public."users"
FOR SELECT TO authenticated
USING (((get_user_role() = 'planning_director'::user_role) OR (id = auth.uid()) OR ((factory_id IS NOT NULL) AND (factory_id = get_user_factory_id()))));

DO $restore_acl$
DECLARE
  item record;
  v_grantee text;
  v_grant_option text;
  v_security_invoker text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM private.rls_cutover_object_snapshot
    WHERE cutover_key = '20260916090000_department_rls_matrix_cutover'
  ) THEN
    RAISE EXCEPTION 'Exact cutover ACL snapshot is missing';
  END IF;

  -- Remove cutover relation and column grants from the roles that were changed.
  FOR item IN
    SELECT namespace.nspname, relation.relname, attribute.attname
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('products', 'role_permissions', 'machines_with_totals')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON TABLE %2$I.%3$I FROM PUBLIC, anon, authenticated, service_role',
      item.attname, item.nspname, item.relname
    );
  END LOOP;
  FOR item IN
    SELECT DISTINCT object_identity
    FROM private.rls_cutover_object_snapshot
    WHERE cutover_key = '20260916090000_department_rls_matrix_cutover'
      AND object_kind IN ('relation_acl', 'view_options')
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, anon, authenticated, service_role',
      item.object_identity
    );
  END LOOP;

  FOR item IN
    SELECT object_identity, payload
    FROM private.rls_cutover_object_snapshot
    WHERE cutover_key = '20260916090000_department_rls_matrix_cutover'
      AND object_kind = 'relation_acl'
  LOOP
    v_grantee := CASE item.payload->>'grantee' WHEN 'PUBLIC' THEN 'PUBLIC' ELSE format('%I', item.payload->>'grantee') END;
    v_grant_option := CASE WHEN (item.payload->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
    EXECUTE format(
      'GRANT %s ON TABLE %s TO %s%s',
      item.payload->>'privilege', item.object_identity, v_grantee, v_grant_option
    );
  END LOOP;
  FOR item IN
    SELECT object_identity, payload
    FROM private.rls_cutover_object_snapshot
    WHERE cutover_key = '20260916090000_department_rls_matrix_cutover'
      AND object_kind = 'column_acl'
  LOOP
    v_grantee := CASE item.payload->>'grantee' WHEN 'PUBLIC' THEN 'PUBLIC' ELSE format('%I', item.payload->>'grantee') END;
    v_grant_option := CASE WHEN (item.payload->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
    EXECUTE format(
      'GRANT %s (%I) ON TABLE %s TO %s%s',
      item.payload->>'privilege', item.payload->>'column', item.object_identity, v_grantee, v_grant_option
    );
  END LOOP;

  -- CREATE OR REPLACE preserves function OIDs, but grants are restored from the
  -- exact pre-cutover ACL rather than reconstructed from assumed defaults.
  FOR item IN
    SELECT DISTINCT object_identity
    FROM private.rls_cutover_object_snapshot
    WHERE cutover_key = '20260916090000_department_rls_matrix_cutover'
      AND object_kind = 'function_acl'
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      item.object_identity
    );
  END LOOP;
  FOR item IN
    SELECT object_identity, payload
    FROM private.rls_cutover_object_snapshot
    WHERE cutover_key = '20260916090000_department_rls_matrix_cutover'
      AND object_kind = 'function_acl'
  LOOP
    v_grantee := CASE item.payload->>'grantee' WHEN 'PUBLIC' THEN 'PUBLIC' ELSE format('%I', item.payload->>'grantee') END;
    v_grant_option := CASE WHEN (item.payload->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
    EXECUTE format(
      'GRANT %s ON FUNCTION %s TO %s%s',
      item.payload->>'privilege', item.object_identity, v_grantee, v_grant_option
    );
  END LOOP;

  ALTER VIEW public.machines_with_totals RESET (security_invoker);
  SELECT option_value INTO v_security_invoker
  FROM private.rls_cutover_object_snapshot AS snapshot
  CROSS JOIN LATERAL jsonb_array_elements_text(snapshot.payload->'reloptions') AS option_value
  WHERE snapshot.cutover_key = '20260916090000_department_rls_matrix_cutover'
    AND snapshot.object_kind = 'view_options'
    AND option_value LIKE 'security_invoker=%'
  LIMIT 1;
  IF v_security_invoker IS NOT NULL THEN
    EXECUTE format(
      'ALTER VIEW public.machines_with_totals SET (security_invoker = %s)',
      split_part(v_security_invoker, '=', 2)
    );
  END IF;

  REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
  FOR item IN
    SELECT object_identity, payload
    FROM private.rls_cutover_object_snapshot
    WHERE cutover_key = '20260916090000_department_rls_matrix_cutover'
      AND object_kind = 'schema_acl'
  LOOP
    v_grantee := CASE item.payload->>'grantee' WHEN 'PUBLIC' THEN 'PUBLIC' ELSE format('%I', item.payload->>'grantee') END;
    v_grant_option := CASE WHEN (item.payload->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
    EXECUTE format(
      'GRANT %s ON SCHEMA %s TO %s%s',
      item.payload->>'privilege', item.object_identity, v_grantee, v_grant_option
    );
  END LOOP;
END;
$restore_acl$;

DROP POLICY IF EXISTS "department_access_permissions_select_matrix"
  ON public.department_access_permissions;
DROP POLICY IF EXISTS "department_access_audit_log_select_matrix"
  ON public.department_access_audit_log;
CREATE POLICY "department_access_permissions_select_authenticated"
  ON public.department_access_permissions
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "department_access_audit_log_select_authenticated"
  ON public.department_access_audit_log
  FOR SELECT TO authenticated
  USING (true);

DROP FUNCTION IF EXISTS public.fn_save_department_access_permissions(jsonb);
DROP FUNCTION IF EXISTS public.fn_get_product_base_prices(uuid[]);
DROP FUNCTION IF EXISTS public.fn_set_product_base_price(uuid, numeric);
DROP FUNCTION IF EXISTS private.crm_has_company_permission(text, text, uuid);
DROP FUNCTION IF EXISTS private.crm_has_factory_permission(text, text, uuid);
DROP FUNCTION IF EXISTS private.crm_has_permission(text, text);

ALTER TABLE public.department_access_permissions
  DROP CONSTRAINT IF EXISTS department_access_permissions_factory_scope_check,
  DROP CONSTRAINT IF EXISTS department_access_permissions_company_view_scope_check,
  DROP CONSTRAINT IF EXISTS department_access_permissions_company_manage_scope_check;
ALTER TABLE public.department_access_permissions
  ADD CONSTRAINT department_access_permissions_factory_scope_check
    CHECK (factory_scope IN ('own', 'all') AND (factory_scope = 'own' OR resource_key IN ('production_reports', 'customs_clearance', 'production_fact', 'production_cutting_area'))),
  ADD CONSTRAINT department_access_permissions_company_view_scope_check
    CHECK (company_view_scope IN ('own', 'all') AND (company_view_scope = 'own' OR resource_key IN ('invoices', 'client_payments'))),
  ADD CONSTRAINT department_access_permissions_company_manage_scope_check
    CHECK (company_manage_scope IN ('own', 'all') AND (company_manage_scope = 'own' OR resource_key IN ('invoices', 'client_payments')));

COMMIT;
