-- Atomic cutover from users.role/role_permissions authorization to the
-- department access matrix. This migration is intentionally non-additive and
-- must only run after the rehearsal and backup gates documented in OPERATIONS.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SELECT pg_advisory_xact_lock(hashtextextended('crm:department-rls-matrix-cutover:v1', 0));

-- generated-cutover-locks:start
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
-- generated-cutover-locks:end

CREATE SCHEMA IF NOT EXISTS private;

-- Capture the live ACL and view options inside the same transaction before the
-- cutover changes them. Rollback consumes this catalog-backed snapshot instead
-- of assuming that production grants match repository defaults.
CREATE TABLE IF NOT EXISTS private.rls_cutover_object_snapshot (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cutover_key text NOT NULL,
  object_kind text NOT NULL,
  object_identity text NOT NULL,
  payload jsonb NOT NULL
);
REVOKE ALL ON private.rls_cutover_object_snapshot FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.rls_cutover_object_snapshot TO service_role;
DELETE FROM private.rls_cutover_object_snapshot
WHERE cutover_key = '20260916090000_department_rls_matrix_cutover';

INSERT INTO private.rls_cutover_object_snapshot(cutover_key, object_kind, object_identity, payload)
SELECT
  '20260916090000_department_rls_matrix_cutover',
  'relation_acl',
  format('%I.%I', namespace.nspname, relation.relname),
  jsonb_build_object(
    'grantee', CASE privilege.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(privilege.grantee) END,
    'privilege', privilege.privilege_type,
    'grantable', privilege.is_grantable
  )
FROM pg_class AS relation
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) AS privilege
WHERE namespace.nspname = 'public'
  AND relation.relname IN ('products', 'role_permissions', 'machines_with_totals')
  AND CASE privilege.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(privilege.grantee) END
      IN ('PUBLIC', 'anon', 'authenticated', 'service_role');

INSERT INTO private.rls_cutover_object_snapshot(cutover_key, object_kind, object_identity, payload)
SELECT
  '20260916090000_department_rls_matrix_cutover',
  'column_acl',
  format('%I.%I', namespace.nspname, relation.relname),
  jsonb_build_object(
    'column', attribute.attname,
    'grantee', CASE privilege.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(privilege.grantee) END,
    'privilege', privilege.privilege_type,
    'grantable', privilege.is_grantable
  )
FROM pg_class AS relation
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid
CROSS JOIN LATERAL aclexplode(attribute.attacl) AS privilege
WHERE namespace.nspname = 'public'
  AND relation.relname IN ('products', 'role_permissions', 'machines_with_totals')
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped
  AND attribute.attacl IS NOT NULL
  AND CASE privilege.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(privilege.grantee) END
      IN ('PUBLIC', 'anon', 'authenticated', 'service_role');

INSERT INTO private.rls_cutover_object_snapshot(cutover_key, object_kind, object_identity, payload)
SELECT
  '20260916090000_department_rls_matrix_cutover',
  'function_acl',
  format('%I.%I(%s)', namespace.nspname, procedure.proname, pg_get_function_identity_arguments(procedure.oid)),
  jsonb_build_object(
    'grantee', CASE privilege.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(privilege.grantee) END,
    'privilege', privilege.privilege_type,
    'grantable', privilege.is_grantable
  )
FROM pg_proc AS procedure
JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS privilege
WHERE namespace.nspname = 'public'
  AND procedure.prokind IN ('f', 'p')
  AND pg_get_functiondef(procedure.oid) ~* '(users\.role|role_permissions|get_user_role\s*\(|is_director\s*\(|security_can_|security_has_role\s*\()'
  AND CASE privilege.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(privilege.grantee) END
      IN ('PUBLIC', 'anon', 'authenticated', 'service_role');

INSERT INTO private.rls_cutover_object_snapshot(cutover_key, object_kind, object_identity, payload)
SELECT
  '20260916090000_department_rls_matrix_cutover',
  'schema_acl',
  quote_ident(namespace.nspname),
  jsonb_build_object(
    'grantee', CASE privilege.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(privilege.grantee) END,
    'privilege', privilege.privilege_type,
    'grantable', privilege.is_grantable
  )
FROM pg_namespace AS namespace
CROSS JOIN LATERAL aclexplode(COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))) AS privilege
WHERE namespace.nspname = 'private'
  AND CASE privilege.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(privilege.grantee) END
      IN ('PUBLIC', 'anon', 'authenticated', 'service_role');

INSERT INTO private.rls_cutover_object_snapshot(cutover_key, object_kind, object_identity, payload)
SELECT
  '20260916090000_department_rls_matrix_cutover',
  'view_options',
  'public.machines_with_totals',
  jsonb_build_object('reloptions', COALESCE(to_jsonb(relation.reloptions), '[]'::jsonb))
FROM pg_class AS relation
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relname = 'machines_with_totals';

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Factory/company scope is configurable only for the resources whose rows have
-- an unambiguous factory/client owner.
ALTER TABLE public.department_access_permissions
  DROP CONSTRAINT IF EXISTS department_access_permissions_factory_scope_check,
  DROP CONSTRAINT IF EXISTS department_access_permissions_company_view_scope_check,
  DROP CONSTRAINT IF EXISTS department_access_permissions_company_manage_scope_check;

ALTER TABLE public.department_access_permissions
  ADD CONSTRAINT department_access_permissions_factory_scope_check
    CHECK (
      factory_scope IN ('own', 'all')
      AND (
        factory_scope = 'own'
        OR resource_key IN ('production_reports', 'customs_clearance', 'production_fact', 'production_cutting_area')
      )
    ),
  ADD CONSTRAINT department_access_permissions_company_view_scope_check
    CHECK (
      company_view_scope IN ('own', 'all')
      AND (
        company_view_scope = 'own'
        OR resource_key IN ('my_orders', 'client_identity', 'client_prices', 'invoices', 'client_payments')
      )
    ),
  ADD CONSTRAINT department_access_permissions_company_manage_scope_check
    CHECK (
      company_manage_scope IN ('own', 'all')
      AND (
        company_manage_scope = 'own'
        OR resource_key IN ('my_orders', 'client_identity', 'client_prices', 'invoices', 'client_payments')
      )
    );

CREATE OR REPLACE FUNCTION private.crm_has_permission(
  p_resource_key text,
  p_operation text DEFAULT 'view'
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    p_operation IN ('view', 'manage')
    AND EXISTS (
      SELECT 1
      FROM public.users AS app_user
      WHERE app_user.id = auth.uid()
        AND app_user.is_active IS TRUE
        AND (
          EXISTS (
            SELECT 1
            FROM public.department_members AS member
            JOIN public.positions AS position ON position.id = member.position_id
            WHERE member.user_id = app_user.id
              AND position.is_active IS TRUE
              AND position.name = 'Администратор CRM'
          )
          OR EXISTS (
            SELECT 1
            FROM public.department_members AS member
            JOIN public.department_access_permissions AS permission
              ON permission.department_id = member.department_id
             AND permission.subject_scope = CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END
            WHERE member.user_id = app_user.id
              AND permission.resource_key = p_resource_key
              AND CASE p_operation
                    WHEN 'manage' THEN permission.can_manage
                    ELSE permission.can_view OR permission.can_manage
                  END
          )
        )
    );
$function$;

CREATE OR REPLACE FUNCTION private.crm_has_factory_permission(
  p_resource_key text,
  p_operation text,
  p_factory_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    p_factory_id IS NOT NULL
    AND private.crm_has_permission(p_resource_key, p_operation)
    AND EXISTS (
      SELECT 1
      FROM public.users AS app_user
      WHERE app_user.id = auth.uid()
        AND app_user.is_active IS TRUE
        AND (
          EXISTS (
            SELECT 1
            FROM public.department_members AS member
            JOIN public.positions AS position ON position.id = member.position_id
            WHERE member.user_id = app_user.id
              AND position.is_active IS TRUE
              AND position.name = 'Администратор CRM'
          )
          OR app_user.factory_id = p_factory_id
          OR EXISTS (
            SELECT 1
            FROM public.department_members AS member
            JOIN public.department_access_permissions AS permission
              ON permission.department_id = member.department_id
             AND permission.subject_scope = CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END
            WHERE member.user_id = app_user.id
              AND permission.resource_key = p_resource_key
              AND p_resource_key IN ('production_reports', 'customs_clearance', 'production_fact', 'production_cutting_area')
              AND permission.factory_scope = 'all'
              AND CASE p_operation
                    WHEN 'manage' THEN permission.can_manage
                    ELSE permission.can_view OR permission.can_manage
                  END
          )
        )
    );
$function$;

CREATE OR REPLACE FUNCTION private.crm_has_company_permission(
  p_resource_key text,
  p_operation text,
  p_client_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    p_resource_key IN ('my_orders', 'client_identity', 'client_prices', 'invoices', 'client_payments')
    AND p_client_id IS NOT NULL
    AND private.crm_has_permission(p_resource_key, p_operation)
    AND EXISTS (
      SELECT 1
      FROM public.users AS app_user
      WHERE app_user.id = auth.uid()
        AND app_user.is_active IS TRUE
        AND (
          EXISTS (
            SELECT 1
            FROM public.department_members AS member
            JOIN public.positions AS position ON position.id = member.position_id
            WHERE member.user_id = app_user.id
              AND position.is_active IS TRUE
              AND position.name = 'Администратор CRM'
          )
          OR EXISTS (
            SELECT 1
            FROM public.clients AS client
            WHERE client.id = p_client_id
              AND client.responsible_user_id = app_user.id
          )
          OR EXISTS (
            SELECT 1
            FROM public.department_members AS member
            JOIN public.department_access_permissions AS permission
              ON permission.department_id = member.department_id
             AND permission.subject_scope = CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END
            WHERE member.user_id = app_user.id
              AND permission.resource_key = p_resource_key
              AND CASE p_operation
                    WHEN 'manage' THEN permission.company_manage_scope = 'all' AND permission.can_manage
                    ELSE permission.company_view_scope = 'all' AND (permission.can_view OR permission.can_manage)
                  END
          )
        )
    );
$function$;

REVOKE ALL ON FUNCTION private.crm_has_permission(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.crm_has_factory_permission(text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.crm_has_company_permission(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.crm_has_permission(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.crm_has_factory_permission(text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.crm_has_company_permission(text, text, uuid) TO authenticated, service_role;

-- Compatibility entry point used by existing receiving RPCs. The actor
-- argument can no longer be used to impersonate another user.
CREATE OR REPLACE FUNCTION public.crm_user_has_resource_permission(
  p_actor uuid,
  p_resource_key text,
  p_manage boolean DEFAULT false
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_actor = auth.uid()
     AND private.crm_has_permission(p_resource_key, CASE WHEN p_manage THEN 'manage' ELSE 'view' END);
$function$;

REVOKE ALL ON FUNCTION public.crm_user_has_resource_permission(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_user_has_resource_permission(uuid, text, boolean) TO authenticated, service_role;

-- Transitional public names that are referenced by existing policies keep
-- their signatures, but their decisions now come exclusively from the matrix.
CREATE OR REPLACE FUNCTION public.can_view_meeting_resource(p_resource_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$ SELECT private.crm_has_permission(p_resource_key, 'view') $function$;

CREATE OR REPLACE FUNCTION public.can_manage_meeting_resource(p_resource_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$ SELECT private.crm_has_permission(p_resource_key, 'manage') $function$;

CREATE OR REPLACE FUNCTION public.can_view_product_projects()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$ SELECT private.crm_has_permission('product_projects', 'view') $function$;

CREATE OR REPLACE FUNCTION public.can_manage_product_projects()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$ SELECT private.crm_has_permission('product_projects', 'manage') $function$;

CREATE OR REPLACE FUNCTION public.can_manage_department_request_target(
  p_target_department text,
  p_factory_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT p_target_department IN ('technologist', 'supply', 'production', 'planning')
     AND private.crm_has_permission('department_requests', 'manage');
$function$;

CREATE OR REPLACE FUNCTION public.consumables_can_view_factory(p_factory_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$ SELECT private.crm_has_factory_permission('consumables', 'view', p_factory_id) $function$;

CREATE OR REPLACE FUNCTION public.consumables_can_manage_factory(p_factory_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$ SELECT private.crm_has_factory_permission('consumables', 'manage', p_factory_id) $function$;

CREATE OR REPLACE FUNCTION public.consumables_can_adjust_stock()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$ SELECT private.crm_has_permission('consumables', 'manage') $function$;

CREATE OR REPLACE FUNCTION public.consumables_can_supply_requests()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$ SELECT private.crm_has_permission('consumable_requests', 'manage') $function$;

CREATE OR REPLACE FUNCTION public.detailing_role_allowed(p_roles public.user_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$ SELECT private.crm_has_permission('inventory_detailing', 'view') $function$;

CREATE OR REPLACE FUNCTION public.inventory_transfer_role_allowed(p_roles public.user_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  -- The legacy argument is retained only as an operation discriminator for
  -- existing internal RPCs. It is never compared with users.role.
  SELECT CASE
    WHEN p_roles = ARRAY[
      'technologist', 'planning_director',
      'financial_director', 'commercial_director'
    ]::public.user_role[]
      THEN private.crm_has_permission('inventory_detailing_receiving', 'manage')
    WHEN p_roles = ARRAY[
      'supply_manager', 'procurement_head',
      'planning_director', 'financial_director', 'commercial_director'
    ]::public.user_role[]
      THEN private.crm_has_permission('supply_transport', 'manage')
    WHEN p_roles = ARRAY[
      'technologist', 'supply_manager', 'procurement_head',
      'planning_director', 'financial_director', 'commercial_director'
    ]::public.user_role[]
      THEN private.crm_has_permission('inventory', 'manage')
    ELSE false
  END
$function$;

CREATE OR REPLACE FUNCTION public.security_can_manage_catalog()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$ SELECT private.crm_has_permission('materials', 'manage') $function$;

CREATE OR REPLACE FUNCTION public.security_can_manage_nesting_catalog()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$ SELECT private.crm_has_permission('nesting_catalog', 'manage') $function$;

CREATE OR REPLACE FUNCTION public.security_can_view_request_materials()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$ SELECT private.crm_has_permission('technologist_requests', 'view') $function$;

CREATE OR REPLACE FUNCTION public.security_can_manage_request_materials()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$ SELECT private.crm_has_permission('technologist_requests', 'manage') $function$;

CREATE OR REPLACE FUNCTION public.security_can_manage_supply()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$ SELECT private.crm_has_permission('supply_orders', 'manage') $function$;

CREATE OR REPLACE FUNCTION public.fn_financial_supply_visibility(p_request_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.technologist_requests AS request
      WHERE request.id = p_request_id
        AND request.status IN ('submitted_to_supply', 'completed')
    )
    OR (
      NOT private.crm_has_permission('supply_material_requests', 'view')
      AND (
        EXISTS (
          SELECT 1 FROM public.technologist_requests AS request
          WHERE request.id = p_request_id AND request.created_by = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.technologist_requests AS request
          JOIN public.tasks AS task ON task.machine_id = request.machine_id
          WHERE request.id = p_request_id
            AND task.assigned_to = auth.uid()
            AND task.task_type = 'technologist_request'
            AND task.status IN ('pending', 'in_progress', 'completed')
        )
        OR private.crm_has_permission('technologist_requests', 'manage')
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.check_supply_items_column_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT private.crm_has_permission('supply_material_requests', 'manage') THEN
    RAISE EXCEPTION 'Недостаточно прав для изменения позиции снабжения' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_client_responsible_user()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN
      IF NOT private.crm_has_permission('client_identity', 'manage') THEN
        RAISE EXCEPTION 'Недостаточно прав для создания клиента' USING ERRCODE = '42501';
      END IF;
      IF NOT private.crm_has_permission('access_settings', 'manage') THEN
        NEW.responsible_user_id := auth.uid();
      END IF;
    ELSIF NEW.responsible_user_id IS DISTINCT FROM OLD.responsible_user_id THEN
      RAISE EXCEPTION 'Ответственного менеджера можно изменить только через защищённое действие';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.can_view_meeting_resource(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_meeting_resource(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_product_projects() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_product_projects() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_department_request_target(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consumables_can_view_factory(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consumables_can_manage_factory(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consumables_can_adjust_stock() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consumables_can_supply_requests() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.detailing_role_allowed(public.user_role[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inventory_transfer_role_allowed(public.user_role[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.security_can_manage_catalog() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.security_can_manage_nesting_catalog() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.security_can_view_request_materials() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.security_can_manage_request_materials() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.security_can_manage_supply() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_financial_supply_visibility(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_supply_items_column_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_client_responsible_user() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.can_view_meeting_resource(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_meeting_resource(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_product_projects() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_product_projects() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_department_request_target(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consumables_can_view_factory(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consumables_can_manage_factory(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consumables_can_adjust_stock() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consumables_can_supply_requests() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.detailing_role_allowed(public.user_role[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_transfer_role_allowed(public.user_role[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.security_can_manage_catalog() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.security_can_manage_nesting_catalog() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.security_can_view_request_materials() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.security_can_manage_request_materials() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.security_can_manage_supply() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_financial_supply_visibility(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_supply_items_column_update() TO service_role;
GRANT EXECUTE ON FUNCTION public.protect_client_responsible_user() TO service_role;

-- Saving the matrix and its audit is one database transaction. The function
-- normalizes every row server-side and records only the effective diff.
CREATE OR REPLACE FUNCTION public.fn_save_department_access_permissions(p_permissions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item jsonb;
  v_department_id uuid;
  v_subject_scope text;
  v_resource_key text;
  v_can_view boolean;
  v_can_manage boolean;
  v_factory_scope text;
  v_company_view_scope text;
  v_company_manage_scope text;
  v_old public.department_access_permissions%ROWTYPE;
  v_had_old boolean;
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF NOT private.crm_has_permission('access_settings', 'manage') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_permissions) <> 'array' THEN
    RAISE EXCEPTION 'Ожидался массив прав' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_permissions) AS item
    GROUP BY item->>'departmentId', item->>'subjectScope', item->>'resourceKey'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'В запросе есть дубли прав' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_permissions) LOOP
    v_department_id := NULLIF(v_item->>'departmentId', '')::uuid;
    v_subject_scope := v_item->>'subjectScope';
    v_resource_key := v_item->>'resourceKey';
    v_can_manage := COALESCE((v_item->>'canManage')::boolean, false);
    v_can_view := COALESCE((v_item->>'canView')::boolean, false) OR v_can_manage;
    v_factory_scope := CASE
      WHEN v_resource_key IN ('production_reports', 'customs_clearance', 'production_fact', 'production_cutting_area')
       AND v_item->>'factoryScope' = 'all' THEN 'all' ELSE 'own' END;
    v_company_view_scope := CASE
      WHEN v_resource_key IN ('my_orders', 'client_identity', 'client_prices', 'invoices', 'client_payments')
       AND v_item->>'companyViewScope' = 'all' THEN 'all' ELSE 'own' END;
    v_company_manage_scope := CASE
      WHEN v_resource_key IN ('my_orders', 'client_identity', 'client_prices', 'invoices', 'client_payments')
       AND v_item->>'companyManageScope' = 'all' THEN 'all' ELSE 'own' END;
    IF v_company_manage_scope = 'all' THEN v_company_view_scope := 'all'; END IF;

    IF v_subject_scope NOT IN ('head', 'member')
       OR NOT EXISTS (SELECT 1 FROM public.departments WHERE id = v_department_id)
       OR NOT EXISTS (SELECT 1 FROM public.department_access_permissions WHERE resource_key = v_resource_key) THEN
      RAISE EXCEPTION 'Некорректная строка матрицы доступа' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_old
    FROM public.department_access_permissions
    WHERE department_id = v_department_id
      AND subject_scope = v_subject_scope
      AND resource_key = v_resource_key
    FOR UPDATE;
    v_had_old := FOUND;

    INSERT INTO public.department_access_permissions (
      department_id, subject_scope, resource_key, can_view, can_manage,
      factory_scope, company_view_scope, company_manage_scope, updated_by
    ) VALUES (
      v_department_id, v_subject_scope, v_resource_key, v_can_view, v_can_manage,
      v_factory_scope, v_company_view_scope, v_company_manage_scope, auth.uid()
    )
    ON CONFLICT (department_id, subject_scope, resource_key) DO UPDATE SET
      can_view = EXCLUDED.can_view,
      can_manage = EXCLUDED.can_manage,
      factory_scope = EXCLUDED.factory_scope,
      company_view_scope = EXCLUDED.company_view_scope,
      company_manage_scope = EXCLUDED.company_manage_scope,
      updated_by = EXCLUDED.updated_by;

    IF NOT v_had_old
       OR v_old.can_view IS DISTINCT FROM v_can_view
       OR v_old.can_manage IS DISTINCT FROM v_can_manage
       OR v_old.factory_scope IS DISTINCT FROM v_factory_scope
       OR v_old.company_view_scope IS DISTINCT FROM v_company_view_scope
       OR v_old.company_manage_scope IS DISTINCT FROM v_company_manage_scope THEN
      INSERT INTO public.department_access_audit_log (
        department_id, subject_scope, resource_key,
        old_can_view, old_can_manage, new_can_view, new_can_manage,
        old_factory_scope, new_factory_scope,
        old_company_view_scope, new_company_view_scope,
        old_company_manage_scope, new_company_manage_scope, changed_by
      ) VALUES (
        v_department_id, v_subject_scope, v_resource_key,
        CASE WHEN v_had_old THEN v_old.can_view ELSE false END,
        CASE WHEN v_had_old THEN v_old.can_manage ELSE false END,
        v_can_view, v_can_manage,
        CASE WHEN v_had_old THEN v_old.factory_scope ELSE 'own' END, v_factory_scope,
        CASE WHEN v_had_old THEN v_old.company_view_scope ELSE 'own' END, v_company_view_scope,
        CASE WHEN v_had_old THEN v_old.company_manage_scope ELSE 'own' END, v_company_manage_scope,
        auth.uid()
      );
    END IF;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'departmentId', v_department_id,
      'subjectScope', v_subject_scope,
      'resourceKey', v_resource_key,
      'canView', v_can_view,
      'canManage', v_can_manage,
      'factoryScope', v_factory_scope,
      'companyViewScope', v_company_view_scope,
      'companyManageScope', v_company_manage_scope
    ));
  END LOOP;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_save_department_access_permissions(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_save_department_access_permissions(jsonb) TO authenticated, service_role;

-- RLS on the matrix itself: ordinary users see only rows for their own
-- departments; access administrators see the full matrix and its audit.
DROP POLICY IF EXISTS "department_access_permissions_select_authenticated" ON public.department_access_permissions;
DROP POLICY IF EXISTS "department_access_permissions_select_matrix" ON public.department_access_permissions;
CREATE POLICY "department_access_permissions_select_matrix"
ON public.department_access_permissions FOR SELECT TO authenticated
USING (
  private.crm_has_permission('access_settings', 'view')
  OR EXISTS (
    SELECT 1 FROM public.department_members AS member
    WHERE member.user_id = auth.uid()
      AND member.department_id = department_access_permissions.department_id
  )
);

DROP POLICY IF EXISTS "department_access_audit_log_select_authenticated" ON public.department_access_audit_log;
DROP POLICY IF EXISTS "department_access_audit_log_select_matrix" ON public.department_access_audit_log;
CREATE POLICY "department_access_audit_log_select_matrix"
ON public.department_access_audit_log FOR SELECT TO authenticated
USING (private.crm_has_permission('access_settings', 'view'));

-- role_permissions is retained as rollback data only and is no longer reachable
-- through the user-facing Data API.
REVOKE ALL ON public.role_permissions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.role_permissions TO service_role;

-- Views execute with the caller's RLS. Price/cost columns remain unavailable to
-- authenticated callers even when the underlying view gains new columns.
ALTER VIEW public.machines_with_totals SET (security_invoker = true);

DO $block$
DECLARE
  v_columns text;
BEGIN
  REVOKE SELECT ON public.machines_with_totals FROM authenticated;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'machines_with_totals'
    AND column_name <> ALL (ARRAY['freight_cost', 'total_items_cost', 'total_expenses', 'total_cost']);
  IF v_columns IS NULL THEN RAISE EXCEPTION 'machines_with_totals safe projection is empty'; END IF;
  EXECUTE format('GRANT SELECT (%s) ON public.machines_with_totals TO authenticated', v_columns);
  GRANT SELECT ON public.machines_with_totals TO service_role;
END;
$block$;

-- Product list/card queries never receive the price column. Authorized price
-- access is isolated in RPCs that cannot be used for actor substitution.
REVOKE SELECT, INSERT, UPDATE ON public.products FROM authenticated;

DO $block$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'products'
    AND column_name <> 'base_price_eur';
  IF v_columns IS NULL THEN RAISE EXCEPTION 'products safe projection is empty'; END IF;
  EXECUTE format('GRANT SELECT (%s), INSERT (%s), UPDATE (%s) ON public.products TO authenticated', v_columns, v_columns, v_columns);
END;
$block$;

CREATE OR REPLACE FUNCTION public.fn_get_product_base_prices(p_product_ids uuid[])
RETURNS TABLE(product_id uuid, base_price_eur numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT product.id, product.base_price_eur
  FROM public.products AS product
  WHERE product.id = ANY(COALESCE(p_product_ids, ARRAY[]::uuid[]))
    AND private.crm_has_permission('products', 'view')
    AND private.crm_has_permission('client_prices', 'view');
$function$;

CREATE OR REPLACE FUNCTION public.fn_set_product_base_price(
  p_product_id uuid,
  p_base_price_eur numeric
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_price numeric;
BEGIN
  IF NOT private.crm_has_permission('products', 'manage')
     OR NOT private.crm_has_permission('client_prices', 'manage') THEN
    RAISE EXCEPTION 'Недостаточно прав для изменения цены' USING ERRCODE = '42501';
  END IF;
  IF p_base_price_eur IS NULL OR p_base_price_eur < 0 THEN
    RAISE EXCEPTION 'Цена не может быть отрицательной' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products
  SET base_price_eur = p_base_price_eur,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_product_id
  RETURNING base_price_eur INTO v_price;

  IF NOT FOUND THEN RAISE EXCEPTION 'Изделие не найдено' USING ERRCODE = 'P0002'; END IF;
  RETURN v_price;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_get_product_base_prices(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_set_product_base_price(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_product_base_prices(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_set_product_base_price(uuid, numeric) TO authenticated, service_role;

-- Remaining policy/RPC replacements and the transactional invariants are
-- generated below from the checked-in production catalog snapshot.

CREATE OR REPLACE FUNCTION public.fn_people_cancel_employee_day(p_employee_id uuid, p_work_date date)
 RETURNS SETOF employee_assignments
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_employee_factory uuid;
BEGIN
  IF NOT private.crm_has_permission('people_planning', 'manage') THEN
    RAISE EXCEPTION 'People planning access denied' USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION public.fn_people_cancel_employee_day(p_employee_id uuid, p_work_date date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_people_cancel_employee_day(p_employee_id uuid, p_work_date date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_people_confirm_assignment(p_assignment_id uuid)
 RETURNS employee_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_factory uuid;
  v_result public.employee_assignments;
BEGIN
  IF NOT private.crm_has_permission('people_planning', 'manage') THEN
    RAISE EXCEPTION 'People planning access denied' USING ERRCODE = '42501';
  END IF;

  SELECT e.factory_id INTO v_factory
    FROM public.employee_assignments a
    JOIN public.employees e ON e.id = a.employee_id
    WHERE a.id = p_assignment_id
    FOR UPDATE OF a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  UPDATE public.employee_assignments
    SET status = 'confirmed'::public.employee_assignment_status,
        updated_by = auth.uid()
    WHERE id = p_assignment_id
    RETURNING * INTO v_result;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_people_confirm_assignment(p_assignment_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_people_confirm_assignment(p_assignment_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_people_copy_previous_day(p_employee_id uuid, p_target_date date)
 RETURNS SETOF employee_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_employee_factory uuid;
  v_source_count integer;
BEGIN
  IF NOT private.crm_has_permission('people_planning', 'manage') THEN
    RAISE EXCEPTION 'People planning access denied' USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION public.fn_people_copy_previous_day(p_employee_id uuid, p_target_date date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_people_copy_previous_day(p_employee_id uuid, p_target_date date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_people_planning_period(p_factory_id uuid, p_start_date date, p_end_date date)
 RETURNS SETOF employee_assignments
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
BEGIN
  IF NOT private.crm_has_permission('people_planning', 'view') THEN
    RAISE EXCEPTION 'People planning access denied' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL
     OR p_end_date IS NULL
     OR p_end_date < p_start_date
     OR p_end_date - p_start_date > 6 THEN
    RAISE EXCEPTION 'People planning period must contain from 1 to 7 days';
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

REVOKE ALL ON FUNCTION public.fn_people_planning_period(p_factory_id uuid, p_start_date date, p_end_date date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_people_planning_period(p_factory_id uuid, p_start_date date, p_end_date date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_people_schedule_assignment(p_employee_id uuid, p_machine_id uuid, p_section_id uuid, p_start_date date, p_start_half smallint DEFAULT 1)
 RETURNS SETOF employee_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
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
  IF NOT private.crm_has_permission('people_planning', 'manage') THEN
    RAISE EXCEPTION 'People planning access denied' USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION public.fn_people_schedule_assignment(p_employee_id uuid, p_machine_id uuid, p_section_id uuid, p_start_date date, p_start_half smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_people_schedule_assignment(p_employee_id uuid, p_machine_id uuid, p_section_id uuid, p_start_date date, p_start_half smallint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_people_vacations_period(p_factory_id uuid, p_start_date date, p_end_date date)
 RETURNS SETOF employee_vacations
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
BEGIN
  IF NOT private.crm_has_permission('people_planning', 'view') THEN
    RAISE EXCEPTION 'People planning access denied' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL
     OR p_end_date IS NULL
     OR p_end_date < p_start_date
     OR p_end_date - p_start_date > 6 THEN
    RAISE EXCEPTION 'People planning period must contain from 1 to 7 days';
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

REVOKE ALL ON FUNCTION public.fn_people_vacations_period(p_factory_id uuid, p_start_date date, p_end_date date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_people_vacations_period(p_factory_id uuid, p_start_date date, p_end_date date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_approve_technologist_request(p_approval_version_id uuid, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_version public.technologist_request_approval_versions%rowtype;
  v_request public.technologist_requests%rowtype;
  v_completion uuid;
  v_original_sub text;
begin
  if p_actor is distinct from auth.uid() or not private.crm_has_permission('technologist_request_results', 'manage') then raise exception 'Недостаточно прав' using errcode = '42501'; end if;

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

REVOKE ALL ON FUNCTION public.fn_approve_technologist_request(p_approval_version_id uuid, p_actor uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_approve_technologist_request(p_approval_version_id uuid, p_actor uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_return_technologist_request_for_revision(p_approval_version_id uuid, p_actor uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_version public.technologist_request_approval_versions%rowtype; v_request public.technologist_requests%rowtype;
begin
  if p_actor is distinct from auth.uid() or not private.crm_has_permission('technologist_request_results', 'manage') then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Укажите причину возврата'; end if;

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

REVOKE ALL ON FUNCTION public.fn_return_technologist_request_for_revision(p_approval_version_id uuid, p_actor uuid, p_reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_return_technologist_request_for_revision(p_approval_version_id uuid, p_actor uuid, p_reason text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_submit_technologist_request_for_approval(p_request_id uuid, p_actor uuid, p_completion_payload jsonb, p_summary_snapshot jsonb, p_archives jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  if p_actor is distinct from auth.uid() or not private.crm_has_permission('technologist_requests', 'manage') then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
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
  if p_actor is distinct from auth.uid() or not private.crm_has_permission('technologist_requests', 'manage') then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
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

REVOKE ALL ON FUNCTION public.fn_submit_technologist_request_for_approval(p_request_id uuid, p_actor uuid, p_completion_payload jsonb, p_summary_snapshot jsonb, p_archives jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_submit_technologist_request_for_approval(p_request_id uuid, p_actor uuid, p_completion_payload jsonb, p_summary_snapshot jsonb, p_archives jsonb) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_user_can_manage_client_prices(p_actor uuid, p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users actor
    JOIN public.clients client ON client.id = p_client_id
    WHERE actor.id = p_actor
      AND actor.is_active IS TRUE
      AND (
        EXISTS (
          SELECT 1
          FROM public.department_members admin_member
          JOIN public.positions admin_position ON admin_position.id = admin_member.position_id
          WHERE admin_member.user_id = actor.id
            AND admin_position.is_active IS TRUE
            AND admin_position.name = 'Администратор CRM'
        )
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

CREATE OR REPLACE FUNCTION public.fn_user_can_decide_machine_discount(p_actor uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users actor
    WHERE actor.id = p_actor
      AND actor.is_active IS TRUE
      AND (
        EXISTS (
          SELECT 1
          FROM public.department_members admin_member
          JOIN public.positions admin_position ON admin_position.id = admin_member.position_id
          WHERE admin_member.user_id = actor.id
            AND admin_position.is_active IS TRUE
            AND admin_position.name = 'Администратор CRM'
        )
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

REVOKE ALL ON FUNCTION public.fn_user_can_manage_client_prices(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_user_can_decide_machine_discount(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_user_can_manage_client_prices(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_user_can_decide_machine_discount(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.fn_receive_supply_order_schedule_batch_v1(p_receipts jsonb, p_performed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  IF p_performed_by IS DISTINCT FROM auth.uid() OR NOT private.crm_has_permission('inventory_receiving', 'manage') THEN RAISE EXCEPTION 'Недостаточно прав для приёмки' USING ERRCODE = '42501'; END IF;
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

REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_batch_v1(p_receipts jsonb, p_performed_by uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_receive_supply_order_schedule_batch_v1(p_receipts jsonb, p_performed_by uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_receive_supply_order_schedule_v2(p_schedule_id uuid, p_performed_by uuid, p_received_quantity numeric, p_allocations jsonb, p_received_piece_length_mm numeric DEFAULT NULL::numeric, p_received_piece_count numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  IF p_performed_by IS DISTINCT FROM auth.uid() OR NOT private.crm_has_permission('inventory_receiving', 'manage') THEN RAISE EXCEPTION 'Недостаточно прав для приёмки' USING ERRCODE = '42501'; END IF;
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

REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_v2(p_schedule_id uuid, p_performed_by uuid, p_received_quantity numeric, p_allocations jsonb, p_received_piece_length_mm numeric, p_received_piece_count numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_receive_supply_order_schedule_v2(p_schedule_id uuid, p_performed_by uuid, p_received_quantity numeric, p_allocations jsonb, p_received_piece_length_mm numeric, p_received_piece_count numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_replace_supply_order_delivery_schedules_v1(p_delete_ids uuid[], p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_delete_count integer := 0;
  v_existing_count integer := 0;
begin
  if v_actor is null or not private.crm_has_permission('supply_orders', 'manage') then
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

REVOKE ALL ON FUNCTION public.fn_replace_supply_order_delivery_schedules_v1(p_delete_ids uuid[], p_rows jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_replace_supply_order_delivery_schedules_v1(p_delete_ids uuid[], p_rows jsonb) TO authenticated, service_role;


-- Old authorization helpers remain available only to service-owned routing and
-- rollback code. Authenticated callers cannot use them as an access oracle.
REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_director() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.security_has_role(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_director() TO service_role;
GRANT EXECUTE ON FUNCTION public.security_has_role(text[]) TO service_role;

DROP POLICY IF EXISTS "Directors delete settings" ON public."app_settings";
CREATE POLICY "Directors delete settings" ON public."app_settings"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('admin_settings', 'manage')) AND ((private.crm_has_permission('admin_settings', 'manage')))));

DROP POLICY IF EXISTS "Directors insert settings" ON public."app_settings";
CREATE POLICY "Directors insert settings" ON public."app_settings"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('admin_settings', 'manage')) AND ((private.crm_has_permission('admin_settings', 'manage')))));

DROP POLICY IF EXISTS "Directors read settings" ON public."app_settings";
CREATE POLICY "Directors read settings" ON public."app_settings"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('admin_settings', 'view')) AND ((private.crm_has_permission('admin_settings', 'view')))));

DROP POLICY IF EXISTS "Directors update settings" ON public."app_settings";
CREATE POLICY "Directors update settings" ON public."app_settings"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('admin_settings', 'manage')) AND ((private.crm_has_permission('admin_settings', 'manage')))))
WITH CHECK (((private.crm_has_permission('admin_settings', 'manage')) AND ((private.crm_has_permission('admin_settings', 'manage')))));

DROP POLICY IF EXISTS "business_scrap_correction_holds_select" ON public."business_scrap_correction_holds";
CREATE POLICY "business_scrap_correction_holds_select" ON public."business_scrap_correction_holds"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('business_scrap_reservations', 'view')) AND ((EXISTS ( SELECT 1
   FROM business_scrap_correction_requests request
  WHERE ((request.id = business_scrap_correction_holds.correction_request_id) AND ((request.requested_by = ( SELECT auth.uid() AS uid)) OR (request.approver_id = ( SELECT auth.uid() AS uid)) OR (EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )))))))));

DROP POLICY IF EXISTS "business_scrap_correction_items_select" ON public."business_scrap_correction_items";
CREATE POLICY "business_scrap_correction_items_select" ON public."business_scrap_correction_items"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('business_scrap_reservations', 'view')) AND ((EXISTS ( SELECT 1
   FROM business_scrap_correction_requests request
  WHERE ((request.id = business_scrap_correction_items.correction_request_id) AND ((request.requested_by = ( SELECT auth.uid() AS uid)) OR (request.approver_id = ( SELECT auth.uid() AS uid)) OR (EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )))))))));

DROP POLICY IF EXISTS "business_scrap_correction_requests_select" ON public."business_scrap_correction_requests";
CREATE POLICY "business_scrap_correction_requests_select" ON public."business_scrap_correction_requests"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('business_scrap_reservations', 'view')) AND (((( SELECT auth.uid() AS uid) = requested_by) OR (( SELECT auth.uid() AS uid) = approver_id) OR (EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  ))))));

DROP POLICY IF EXISTS "consumable_balances_select" ON public."consumable_balances";
CREATE POLICY "consumable_balances_select" ON public."consumable_balances"
FOR SELECT TO authenticated
USING (((private.crm_has_factory_permission('consumables', 'view', factory_id)) AND (consumables_can_view_factory(factory_id))));

DROP POLICY IF EXISTS "consumable_categories_select" ON public."consumable_categories";
CREATE POLICY "consumable_categories_select" ON public."consumable_categories"
FOR SELECT TO authenticated
USING (((private.crm_has_factory_permission('consumables', 'view', factory_id)) AND (consumables_can_view_factory(factory_id))));

DROP POLICY IF EXISTS "consumable_movements_select" ON public."consumable_movements";
CREATE POLICY "consumable_movements_select" ON public."consumable_movements"
FOR SELECT TO authenticated
USING (((private.crm_has_factory_permission('consumables', 'view', factory_id)) AND (consumables_can_view_factory(factory_id))));

DROP POLICY IF EXISTS "consumable_request_events_select" ON public."consumable_request_events";
CREATE POLICY "consumable_request_events_select" ON public."consumable_request_events"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('consumable_requests', 'view')) AND ((EXISTS ( SELECT 1
   FROM consumable_requests cr
  WHERE ((cr.id = consumable_request_events.request_id) AND consumables_can_view_factory(cr.factory_id)))))));

DROP POLICY IF EXISTS "consumable_request_receipts_select" ON public."consumable_request_receipts";
CREATE POLICY "consumable_request_receipts_select" ON public."consumable_request_receipts"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('consumable_requests', 'view')) AND ((EXISTS ( SELECT 1
   FROM consumable_requests cr
  WHERE ((cr.id = consumable_request_receipts.request_id) AND consumables_can_view_factory(cr.factory_id)))))));

DROP POLICY IF EXISTS "consumable_requests_select" ON public."consumable_requests";
CREATE POLICY "consumable_requests_select" ON public."consumable_requests"
FOR SELECT TO authenticated
USING (((private.crm_has_factory_permission('consumable_requests', 'view', factory_id)) AND (consumables_can_view_factory(factory_id))));

DROP POLICY IF EXISTS "consumables_select" ON public."consumables";
CREATE POLICY "consumables_select" ON public."consumables"
FOR SELECT TO authenticated
USING (((private.crm_has_factory_permission('consumables', 'view', factory_id)) AND (consumables_can_view_factory(factory_id))));

DROP POLICY IF EXISTS "contracts_delete_sales" ON public."contracts";
CREATE POLICY "contracts_delete_sales" ON public."contracts"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('contracts', 'manage')) AND (((private.crm_has_permission('contracts', 'manage'))))));

DROP POLICY IF EXISTS "contracts_insert_sales" ON public."contracts";
CREATE POLICY "contracts_insert_sales" ON public."contracts"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('contracts', 'manage')) AND (((private.crm_has_permission('contracts', 'manage'))))));

DROP POLICY IF EXISTS "contracts_select" ON public."contracts";
CREATE POLICY "contracts_select" ON public."contracts"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('contracts', 'view')) AND ((auth.uid() IS NOT NULL))));

DROP POLICY IF EXISTS "contracts_update_sales" ON public."contracts";
CREATE POLICY "contracts_update_sales" ON public."contracts"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('contracts', 'manage')) AND (((private.crm_has_permission('contracts', 'manage'))))))
WITH CHECK (((private.crm_has_permission('contracts', 'manage')) AND (((private.crm_has_permission('contracts', 'manage'))))));

DROP POLICY IF EXISTS "department_request_attachments_select" ON public."department_request_attachments";
CREATE POLICY "department_request_attachments_select" ON public."department_request_attachments"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('department_requests', 'view')) AND ((EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_attachments.request_id) AND ((request.created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(request.target_department, request.factory_id))))))));

DROP POLICY IF EXISTS "department_request_events_select" ON public."department_request_events";
CREATE POLICY "department_request_events_select" ON public."department_request_events"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('department_requests', 'view')) AND ((EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_events.request_id) AND ((request.created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(request.target_department, request.factory_id))))))));

DROP POLICY IF EXISTS "department_request_mail_messages_owner_insert" ON public."department_request_mail_messages";
CREATE POLICY "department_request_mail_messages_owner_insert" ON public."department_request_mail_messages"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('department_requests', 'manage')) AND (((linked_by = ( SELECT auth.uid() AS uid)) AND current_user_owns_mail_message(message_id) AND (EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_mail_messages.department_request_id) AND (request.created_by = ( SELECT auth.uid() AS uid)))))))));

DROP POLICY IF EXISTS "department_request_mail_messages_reader" ON public."department_request_mail_messages";
CREATE POLICY "department_request_mail_messages_reader" ON public."department_request_mail_messages"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('department_requests', 'view')) AND ((EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_mail_messages.department_request_id) AND ((request.created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(request.target_department, request.factory_id))))))));

DROP POLICY IF EXISTS "department_request_mail_messages_unlink" ON public."department_request_mail_messages";
CREATE POLICY "department_request_mail_messages_unlink" ON public."department_request_mail_messages"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('department_requests', 'manage')) AND ((EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_mail_messages.department_request_id) AND ((request.created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(request.target_department, request.factory_id))))))))
WITH CHECK (((private.crm_has_permission('department_requests', 'manage')) AND (((unlinked_at IS NOT NULL) AND (unlinked_by = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "department_request_mail_threads_owner_insert" ON public."department_request_mail_threads";
CREATE POLICY "department_request_mail_threads_owner_insert" ON public."department_request_mail_threads"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('department_requests', 'manage')) AND (((linked_by = ( SELECT auth.uid() AS uid)) AND current_user_owns_mail_thread(thread_id) AND (EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_mail_threads.department_request_id) AND (request.created_by = ( SELECT auth.uid() AS uid)))))))));

DROP POLICY IF EXISTS "department_request_mail_threads_reader" ON public."department_request_mail_threads";
CREATE POLICY "department_request_mail_threads_reader" ON public."department_request_mail_threads"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('department_requests', 'view')) AND ((EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_mail_threads.department_request_id) AND ((request.created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(request.target_department, request.factory_id))))))));

DROP POLICY IF EXISTS "department_request_mail_threads_unlink" ON public."department_request_mail_threads";
CREATE POLICY "department_request_mail_threads_unlink" ON public."department_request_mail_threads"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('department_requests', 'manage')) AND ((EXISTS ( SELECT 1
   FROM department_requests request
  WHERE ((request.id = department_request_mail_threads.department_request_id) AND ((request.created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(request.target_department, request.factory_id))))))))
WITH CHECK (((private.crm_has_permission('department_requests', 'manage')) AND (((unlinked_at IS NOT NULL) AND (unlinked_by = ( SELECT auth.uid() AS uid))))));

DROP POLICY IF EXISTS "department_requests_select" ON public."department_requests";
CREATE POLICY "department_requests_select" ON public."department_requests"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('department_requests', 'view')) AND (((created_by = ( SELECT auth.uid() AS uid)) OR can_manage_department_request_target(target_department, factory_id)))));

DROP POLICY IF EXISTS "detailing_balances_read" ON public."detailing_balances";
CREATE POLICY "detailing_balances_read" ON public."detailing_balances"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory_detailing', 'view')) AND ((private.crm_has_permission('inventory_detailing', 'view')))));

DROP POLICY IF EXISTS "detailing_consumption_events_read" ON public."detailing_consumption_events";
CREATE POLICY "detailing_consumption_events_read" ON public."detailing_consumption_events"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory_detailing', 'view')) AND ((private.crm_has_permission('inventory_detailing', 'view')))));

DROP POLICY IF EXISTS "detailing_consumption_items_read" ON public."detailing_consumption_items";
CREATE POLICY "detailing_consumption_items_read" ON public."detailing_consumption_items"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory_detailing', 'view')) AND ((private.crm_has_permission('inventory_detailing', 'view')))));

DROP POLICY IF EXISTS "detailing_movements_read" ON public."detailing_movements";
CREATE POLICY "detailing_movements_read" ON public."detailing_movements"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory_detailing', 'view')) AND ((private.crm_has_permission('inventory_detailing', 'view')))));

DROP POLICY IF EXISTS "detailing_part_versions_read" ON public."detailing_part_product_versions";
CREATE POLICY "detailing_part_versions_read" ON public."detailing_part_product_versions"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory_detailing', 'view') OR private.crm_has_permission('products', 'view')) AND ((private.crm_has_permission('inventory_detailing', 'view') OR private.crm_has_permission('products', 'view')))));

DROP POLICY IF EXISTS "detailing_part_products_read" ON public."detailing_part_products";
CREATE POLICY "detailing_part_products_read" ON public."detailing_part_products"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory_detailing', 'view') OR private.crm_has_permission('products', 'view')) AND ((private.crm_has_permission('inventory_detailing', 'view') OR private.crm_has_permission('products', 'view')))));

DROP POLICY IF EXISTS "detailing_catalogue_read" ON public."detailing_parts";
CREATE POLICY "detailing_catalogue_read" ON public."detailing_parts"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory_detailing', 'view')) AND ((private.crm_has_permission('inventory_detailing', 'view')))));

DROP POLICY IF EXISTS "detailing_checks_read" ON public."detailing_request_checks";
CREATE POLICY "detailing_checks_read" ON public."detailing_request_checks"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory_detailing', 'view')) AND ((private.crm_has_permission('inventory_detailing', 'view')))));

DROP POLICY IF EXISTS "detailing_allocations_read" ON public."detailing_reservation_allocations";
CREATE POLICY "detailing_allocations_read" ON public."detailing_reservation_allocations"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory_detailing', 'view')) AND ((private.crm_has_permission('inventory_detailing', 'view')))));

DROP POLICY IF EXISTS "detailing_reservations_read" ON public."detailing_reservations";
CREATE POLICY "detailing_reservations_read" ON public."detailing_reservations"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory_detailing', 'view')) AND ((private.crm_has_permission('inventory_detailing', 'view')))));

DROP POLICY IF EXISTS "detailing_transfer_items_read" ON public."detailing_transfer_items";
CREATE POLICY "detailing_transfer_items_read" ON public."detailing_transfer_items"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory_detailing', 'view') OR private.crm_has_permission('inventory_detailing_receiving', 'view')) AND ((private.crm_has_permission('inventory_detailing', 'view') OR private.crm_has_permission('inventory_detailing_receiving', 'view')))));

DROP POLICY IF EXISTS "detailing_transfers_read" ON public."detailing_transfers";
CREATE POLICY "detailing_transfers_read" ON public."detailing_transfers"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory_detailing', 'view') OR private.crm_has_permission('inventory_detailing_receiving', 'view')) AND ((private.crm_has_permission('inventory_detailing', 'view') OR private.crm_has_permission('inventory_detailing_receiving', 'view')))));

DROP POLICY IF EXISTS "employee_assignments_insert" ON public."employee_assignments";
CREATE POLICY "employee_assignments_insert" ON public."employee_assignments"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('production_fact', 'manage')) AND ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_assignments.employee_id) AND (( SELECT (private.crm_has_permission('production_fact', 'manage')) AS is_director) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))))) AND (EXISTS (
      SELECT 1 FROM public.employees AS scope_employee
      WHERE scope_employee.id = "employee_assignments".employee_id
        AND (private.crm_has_factory_permission('production_fact', 'manage', scope_employee.factory_id))
    ))));

DROP POLICY IF EXISTS "employee_assignments_select" ON public."employee_assignments";
CREATE POLICY "employee_assignments_select" ON public."employee_assignments"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('production_fact', 'view')) AND ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_assignments.employee_id) AND (( SELECT (private.crm_has_permission('production_fact', 'view')) AS is_director) OR (((private.crm_has_permission('production_fact', 'view'))) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))))) AND (EXISTS (
      SELECT 1 FROM public.employees AS scope_employee
      WHERE scope_employee.id = "employee_assignments".employee_id
        AND (private.crm_has_factory_permission('production_fact', 'view', scope_employee.factory_id))
    ))));

DROP POLICY IF EXISTS "employee_assignments_update" ON public."employee_assignments";
CREATE POLICY "employee_assignments_update" ON public."employee_assignments"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('production_fact', 'manage')) AND ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_assignments.employee_id) AND (( SELECT (private.crm_has_permission('production_fact', 'manage')) AS is_director) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))))) AND (EXISTS (
      SELECT 1 FROM public.employees AS scope_employee
      WHERE scope_employee.id = "employee_assignments".employee_id
        AND (private.crm_has_factory_permission('production_fact', 'manage', scope_employee.factory_id))
    ))))
WITH CHECK (((private.crm_has_permission('production_fact', 'manage')) AND ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_assignments.employee_id) AND (( SELECT (private.crm_has_permission('production_fact', 'manage')) AS is_director) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))))) AND (EXISTS (
      SELECT 1 FROM public.employees AS scope_employee
      WHERE scope_employee.id = "employee_assignments".employee_id
        AND (private.crm_has_factory_permission('production_fact', 'manage', scope_employee.factory_id))
    ))));

DROP POLICY IF EXISTS "employee_rates_insert" ON public."employee_rates";
CREATE POLICY "employee_rates_insert" ON public."employee_rates"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('production_fact', 'manage')) AND ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_rates.employee_id) AND (( SELECT (private.crm_has_permission('production_fact', 'manage')) AS is_director) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))))) AND (EXISTS (
      SELECT 1 FROM public.employees AS scope_employee
      WHERE scope_employee.id = "employee_rates".employee_id
        AND (private.crm_has_factory_permission('production_fact', 'manage', scope_employee.factory_id))
    ))));

DROP POLICY IF EXISTS "employee_rates_select" ON public."employee_rates";
CREATE POLICY "employee_rates_select" ON public."employee_rates"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('production_fact', 'view')) AND ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_rates.employee_id) AND (( SELECT (private.crm_has_permission('production_fact', 'view')) AS is_director) OR (((private.crm_has_permission('production_fact', 'view'))) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))))) AND (EXISTS (
      SELECT 1 FROM public.employees AS scope_employee
      WHERE scope_employee.id = "employee_rates".employee_id
        AND (private.crm_has_factory_permission('production_fact', 'view', scope_employee.factory_id))
    ))));

DROP POLICY IF EXISTS "employee_rates_update" ON public."employee_rates";
CREATE POLICY "employee_rates_update" ON public."employee_rates"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('production_fact', 'manage')) AND ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_rates.employee_id) AND (( SELECT (private.crm_has_permission('production_fact', 'manage')) AS is_director) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))))) AND (EXISTS (
      SELECT 1 FROM public.employees AS scope_employee
      WHERE scope_employee.id = "employee_rates".employee_id
        AND (private.crm_has_factory_permission('production_fact', 'manage', scope_employee.factory_id))
    ))))
WITH CHECK (((private.crm_has_permission('production_fact', 'manage')) AND ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_rates.employee_id) AND (( SELECT (private.crm_has_permission('production_fact', 'manage')) AS is_director) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (e.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))))) AND (EXISTS (
      SELECT 1 FROM public.employees AS scope_employee
      WHERE scope_employee.id = "employee_rates".employee_id
        AND (private.crm_has_factory_permission('production_fact', 'manage', scope_employee.factory_id))
    ))));

DROP POLICY IF EXISTS "employee_vacations_insert" ON public."employee_vacations";
CREATE POLICY "employee_vacations_insert" ON public."employee_vacations"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('production_fact', 'manage')) AND ((EXISTS ( SELECT 1
   FROM employees employee
  WHERE ((employee.id = employee_vacations.employee_id) AND (( SELECT (private.crm_has_permission('production_fact', 'manage')) AS is_director) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (employee.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))))) AND (EXISTS (
      SELECT 1 FROM public.employees AS scope_employee
      WHERE scope_employee.id = "employee_vacations".employee_id
        AND (private.crm_has_factory_permission('production_fact', 'manage', scope_employee.factory_id))
    ))));

DROP POLICY IF EXISTS "employee_vacations_select" ON public."employee_vacations";
CREATE POLICY "employee_vacations_select" ON public."employee_vacations"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('production_fact', 'view')) AND ((EXISTS ( SELECT 1
   FROM employees employee
  WHERE ((employee.id = employee_vacations.employee_id) AND (( SELECT (private.crm_has_permission('production_fact', 'view')) AS is_director) OR (((private.crm_has_permission('production_fact', 'view'))) AND (employee.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))))) AND (EXISTS (
      SELECT 1 FROM public.employees AS scope_employee
      WHERE scope_employee.id = "employee_vacations".employee_id
        AND (private.crm_has_factory_permission('production_fact', 'view', scope_employee.factory_id))
    ))));

DROP POLICY IF EXISTS "employee_vacations_update" ON public."employee_vacations";
CREATE POLICY "employee_vacations_update" ON public."employee_vacations"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('production_fact', 'manage')) AND ((EXISTS ( SELECT 1
   FROM employees employee
  WHERE ((employee.id = employee_vacations.employee_id) AND (( SELECT (private.crm_has_permission('production_fact', 'manage')) AS is_director) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (employee.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))))) AND (EXISTS (
      SELECT 1 FROM public.employees AS scope_employee
      WHERE scope_employee.id = "employee_vacations".employee_id
        AND (private.crm_has_factory_permission('production_fact', 'manage', scope_employee.factory_id))
    ))))
WITH CHECK (((private.crm_has_permission('production_fact', 'manage')) AND ((EXISTS ( SELECT 1
   FROM employees employee
  WHERE ((employee.id = employee_vacations.employee_id) AND (( SELECT (private.crm_has_permission('production_fact', 'manage')) AS is_director) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (employee.factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))))) AND (EXISTS (
      SELECT 1 FROM public.employees AS scope_employee
      WHERE scope_employee.id = "employee_vacations".employee_id
        AND (private.crm_has_factory_permission('production_fact', 'manage', scope_employee.factory_id))
    ))));

DROP POLICY IF EXISTS "employees_insert" ON public."employees";
CREATE POLICY "employees_insert" ON public."employees"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_factory_permission('production_fact', 'manage', factory_id)) AND ((( SELECT (private.crm_has_permission('production_fact', 'manage')) AS is_director) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))));

DROP POLICY IF EXISTS "employees_select" ON public."employees";
CREATE POLICY "employees_select" ON public."employees"
FOR SELECT TO authenticated
USING (((private.crm_has_factory_permission('production_fact', 'view', factory_id)) AND ((( SELECT (private.crm_has_permission('production_fact', 'view')) AS is_director) OR (((private.crm_has_permission('production_fact', 'view'))) AND (factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))));

DROP POLICY IF EXISTS "employees_update" ON public."employees";
CREATE POLICY "employees_update" ON public."employees"
FOR UPDATE TO authenticated
USING (((private.crm_has_factory_permission('production_fact', 'manage', factory_id)) AND ((( SELECT (private.crm_has_permission('production_fact', 'manage')) AS is_director) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))))
WITH CHECK (((private.crm_has_factory_permission('production_fact', 'manage', factory_id)) AND ((( SELECT (private.crm_has_permission('production_fact', 'manage')) AS is_director) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (factory_id = ( SELECT get_user_factory_id() AS get_user_factory_id)))))));

DROP POLICY IF EXISTS "factory_zinc_defaults_select" ON public."factory_zinc_outsourcing_defaults";
CREATE POLICY "factory_zinc_defaults_select" ON public."factory_zinc_outsourcing_defaults"
FOR SELECT TO authenticated
USING (((private.crm_has_factory_permission('production_fact_settings', 'view', factory_id)) AND (((private.crm_has_permission('production_fact_settings', 'view')) OR (factory_id = get_user_factory_id())))));

DROP POLICY IF EXISTS "finance_budget_limits_modify" ON public."finance_budget_limits";
CREATE POLICY "finance_budget_limits_modify" ON public."finance_budget_limits"
FOR ALL TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'manage') OR private.crm_has_permission('supply_finance', 'manage')) AND ((private.crm_has_permission('finance_calendar', 'manage') OR private.crm_has_permission('supply_finance', 'manage')))))
WITH CHECK (((private.crm_has_permission('finance_calendar', 'manage') OR private.crm_has_permission('supply_finance', 'manage')) AND ((private.crm_has_permission('finance_calendar', 'manage') OR private.crm_has_permission('supply_finance', 'manage')))));

DROP POLICY IF EXISTS "finance_budget_limits_select" ON public."finance_budget_limits";
CREATE POLICY "finance_budget_limits_select" ON public."finance_budget_limits"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'view') OR private.crm_has_permission('supply_finance', 'view')) AND (((EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR (private.crm_has_permission('supply_finance', 'view'))))));

DROP POLICY IF EXISTS "finance_event_actions_modify" ON public."finance_event_actions";
CREATE POLICY "finance_event_actions_modify" ON public."finance_event_actions"
FOR ALL TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'manage') OR private.crm_has_permission('supply_finance', 'manage')) AND (((EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR ((event_type = 'expense'::finance_event_type) AND (private.crm_has_permission('supply_finance', 'manage')) AND (EXISTS ( SELECT 1
   FROM finance_expenses e
  WHERE ((e.id = finance_event_actions.event_id) AND (e.is_supply_plan = true)))))))))
WITH CHECK (((private.crm_has_permission('finance_calendar', 'manage') OR private.crm_has_permission('supply_finance', 'manage')) AND (((EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR ((event_type = 'expense'::finance_event_type) AND (private.crm_has_permission('supply_finance', 'manage')) AND (EXISTS ( SELECT 1
   FROM finance_expenses e
  WHERE ((e.id = finance_event_actions.event_id) AND (e.is_supply_plan = true)))))))));

DROP POLICY IF EXISTS "finance_event_actions_select" ON public."finance_event_actions";
CREATE POLICY "finance_event_actions_select" ON public."finance_event_actions"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'view') OR private.crm_has_permission('supply_finance', 'view')) AND (((EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR ((event_type = 'expense'::finance_event_type) AND (private.crm_has_permission('supply_finance', 'view')) AND (EXISTS ( SELECT 1
   FROM finance_expenses e
  WHERE ((e.id = finance_event_actions.event_id) AND (e.is_supply_plan = true)))))))));

DROP POLICY IF EXISTS "finance_expense_series_modify" ON public."finance_expense_series";
CREATE POLICY "finance_expense_series_modify" ON public."finance_expense_series"
FOR ALL TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'manage') OR private.crm_has_permission('supply_finance', 'manage')) AND (((EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR ((is_supply_plan = true) AND (private.crm_has_permission('supply_finance', 'manage')))))))
WITH CHECK (((private.crm_has_permission('finance_calendar', 'manage') OR private.crm_has_permission('supply_finance', 'manage')) AND (((EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR ((is_supply_plan = true) AND (private.crm_has_permission('supply_finance', 'manage')))))));

DROP POLICY IF EXISTS "finance_expense_series_select" ON public."finance_expense_series";
CREATE POLICY "finance_expense_series_select" ON public."finance_expense_series"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'view') OR private.crm_has_permission('supply_finance', 'view')) AND (((EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR (EXISTS ( SELECT 1
   FROM finance_telegram_recipients r
  WHERE ((r.user_id = auth.uid()) AND r.is_active)))))));

DROP POLICY IF EXISTS "finance_expenses_modify" ON public."finance_expenses";
CREATE POLICY "finance_expenses_modify" ON public."finance_expenses"
FOR ALL TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'manage') OR private.crm_has_permission('supply_finance', 'manage')) AND (((EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR ((is_supply_plan = true) AND (private.crm_has_permission('supply_finance', 'manage')))))))
WITH CHECK (((private.crm_has_permission('finance_calendar', 'manage') OR private.crm_has_permission('supply_finance', 'manage')) AND (((EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR ((is_supply_plan = true) AND (private.crm_has_permission('supply_finance', 'manage')))))));

DROP POLICY IF EXISTS "finance_expenses_select" ON public."finance_expenses";
CREATE POLICY "finance_expenses_select" ON public."finance_expenses"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'view') OR private.crm_has_permission('supply_finance', 'view')) AND (((EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR (responsible_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM finance_telegram_recipients r
  WHERE ((r.user_id = auth.uid()) AND r.is_active)))))));

DROP POLICY IF EXISTS "finance_settings_modify" ON public."finance_settings";
CREATE POLICY "finance_settings_modify" ON public."finance_settings"
FOR ALL TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'manage')) AND ((private.crm_has_permission('finance_calendar', 'manage')))))
WITH CHECK (((private.crm_has_permission('finance_calendar', 'manage')) AND ((private.crm_has_permission('finance_calendar', 'manage')))));

DROP POLICY IF EXISTS "finance_settings_select" ON public."finance_settings";
CREATE POLICY "finance_settings_select" ON public."finance_settings"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'view') OR private.crm_has_permission('supply_finance', 'view')) AND (((EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR (private.crm_has_permission('supply_finance', 'view'))))));

DROP POLICY IF EXISTS "finance_telegram_dialog_states_modify" ON public."finance_telegram_dialog_states";
CREATE POLICY "finance_telegram_dialog_states_modify" ON public."finance_telegram_dialog_states"
FOR ALL TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'manage')) AND ((private.crm_has_permission('finance_calendar', 'manage')))))
WITH CHECK (((private.crm_has_permission('finance_calendar', 'manage')) AND ((private.crm_has_permission('finance_calendar', 'manage')))));

DROP POLICY IF EXISTS "finance_telegram_dialog_states_select" ON public."finance_telegram_dialog_states";
CREATE POLICY "finance_telegram_dialog_states_select" ON public."finance_telegram_dialog_states"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'view')) AND ((private.crm_has_permission('finance_calendar', 'view')))));

DROP POLICY IF EXISTS "finance_telegram_notifications_modify" ON public."finance_telegram_notifications";
CREATE POLICY "finance_telegram_notifications_modify" ON public."finance_telegram_notifications"
FOR ALL TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'manage')) AND ((private.crm_has_permission('finance_calendar', 'manage')))))
WITH CHECK (((private.crm_has_permission('finance_calendar', 'manage')) AND ((private.crm_has_permission('finance_calendar', 'manage')))));

DROP POLICY IF EXISTS "finance_telegram_notifications_select" ON public."finance_telegram_notifications";
CREATE POLICY "finance_telegram_notifications_select" ON public."finance_telegram_notifications"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'view')) AND ((private.crm_has_permission('finance_calendar', 'view')))));

DROP POLICY IF EXISTS "finance_telegram_recipients_modify" ON public."finance_telegram_recipients";
CREATE POLICY "finance_telegram_recipients_modify" ON public."finance_telegram_recipients"
FOR ALL TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'manage')) AND ((private.crm_has_permission('finance_calendar', 'manage')))))
WITH CHECK (((private.crm_has_permission('finance_calendar', 'manage')) AND ((private.crm_has_permission('finance_calendar', 'manage')))));

DROP POLICY IF EXISTS "finance_telegram_recipients_select" ON public."finance_telegram_recipients";
CREATE POLICY "finance_telegram_recipients_select" ON public."finance_telegram_recipients"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('finance_calendar', 'view') OR private.crm_has_permission('supply_finance', 'view')) AND (((EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR (private.crm_has_permission('supply_finance', 'view'))))));

DROP POLICY IF EXISTS "Inventory insert supply roles" ON public."inventory";
CREATE POLICY "Inventory insert supply roles" ON public."inventory"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('inventory', 'manage')) AND ((private.crm_has_permission('inventory', 'manage')))));

DROP POLICY IF EXISTS "Inventory read supply roles" ON public."inventory";
CREATE POLICY "Inventory read supply roles" ON public."inventory"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND ((private.crm_has_permission('inventory', 'view') OR private.crm_has_permission('supply_orders', 'view')))));

DROP POLICY IF EXISTS "Inventory update supply roles" ON public."inventory";
CREATE POLICY "Inventory update supply roles" ON public."inventory"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('inventory', 'manage')) AND ((private.crm_has_permission('inventory', 'manage')))))
WITH CHECK (((private.crm_has_permission('inventory', 'manage')) AND ((private.crm_has_permission('inventory', 'manage')))));

DROP POLICY IF EXISTS "Inventory reservations delete supply roles" ON public."inventory_reservations";
CREATE POLICY "Inventory reservations delete supply roles" ON public."inventory_reservations"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('inventory', 'manage') OR private.crm_has_permission('business_scrap_reservations', 'manage')) AND ((private.crm_has_permission('inventory', 'manage') OR private.crm_has_permission('business_scrap_reservations', 'manage')))));

DROP POLICY IF EXISTS "Inventory reservations insert supply roles" ON public."inventory_reservations";
CREATE POLICY "Inventory reservations insert supply roles" ON public."inventory_reservations"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('inventory', 'manage') OR private.crm_has_permission('business_scrap_reservations', 'manage')) AND ((private.crm_has_permission('inventory', 'manage') OR private.crm_has_permission('business_scrap_reservations', 'manage')))));

DROP POLICY IF EXISTS "Inventory reservations read supply roles" ON public."inventory_reservations";
CREATE POLICY "Inventory reservations read supply roles" ON public."inventory_reservations"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory', 'view') OR private.crm_has_permission('business_scrap_reservations', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND ((private.crm_has_permission('inventory', 'view') OR private.crm_has_permission('business_scrap_reservations', 'view') OR private.crm_has_permission('supply_orders', 'view')))));

DROP POLICY IF EXISTS "Inventory reservations update supply roles" ON public."inventory_reservations";
CREATE POLICY "Inventory reservations update supply roles" ON public."inventory_reservations"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('inventory', 'manage') OR private.crm_has_permission('business_scrap_reservations', 'manage')) AND ((private.crm_has_permission('inventory', 'manage') OR private.crm_has_permission('business_scrap_reservations', 'manage')))))
WITH CHECK (((private.crm_has_permission('inventory', 'manage') OR private.crm_has_permission('business_scrap_reservations', 'manage')) AND ((private.crm_has_permission('inventory', 'manage') OR private.crm_has_permission('business_scrap_reservations', 'manage')))));

DROP POLICY IF EXISTS "Inventory transactions insert supply roles" ON public."inventory_transactions";
CREATE POLICY "Inventory transactions insert supply roles" ON public."inventory_transactions"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('inventory', 'manage') OR private.crm_has_permission('inventory_receiving', 'manage')) AND ((private.crm_has_permission('inventory', 'manage') OR private.crm_has_permission('inventory_receiving', 'manage')))));

DROP POLICY IF EXISTS "Inventory transactions read supply roles" ON public."inventory_transactions";
CREATE POLICY "Inventory transactions read supply roles" ON public."inventory_transactions"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory', 'view') OR private.crm_has_permission('inventory_history', 'view')) AND ((private.crm_has_permission('inventory', 'view') OR private.crm_has_permission('inventory_history', 'view')))));

DROP POLICY IF EXISTS "inventory_transfer_items_read" ON public."inventory_transfer_items";
CREATE POLICY "inventory_transfer_items_read" ON public."inventory_transfer_items"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory_receiving', 'view') OR private.crm_has_permission('inventory_detailing_receiving', 'view')) AND ((private.crm_has_permission('inventory_receiving', 'view') OR private.crm_has_permission('inventory_detailing_receiving', 'view')))));

DROP POLICY IF EXISTS "inventory_transfers_read" ON public."inventory_transfers";
CREATE POLICY "inventory_transfers_read" ON public."inventory_transfers"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('inventory_receiving', 'view') OR private.crm_has_permission('inventory_detailing_receiving', 'view')) AND ((private.crm_has_permission('inventory_receiving', 'view') OR private.crm_has_permission('inventory_detailing_receiving', 'view')))));

DROP POLICY IF EXISTS "Invoices - Select role specific" ON public."invoices";
CREATE POLICY "Invoices - Select role specific" ON public."invoices"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('invoices', 'view')) AND (((private.crm_has_permission('invoices', 'view'))))));

DROP POLICY IF EXISTS "invoices_select" ON public."invoices";
CREATE POLICY "invoices_select" ON public."invoices"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('invoices', 'view')) AND (((private.crm_has_permission('invoices', 'view'))))));

DROP POLICY IF EXISTS "machine_chat_mentions_select" ON public."machine_chat_mentions";
CREATE POLICY "machine_chat_mentions_select" ON public."machine_chat_mentions"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('sales_plan', 'view') OR private.crm_has_permission('production', 'view')) AND ((EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_chat_mentions.machine_id) AND
        true))))));

DROP POLICY IF EXISTS "machine_chat_messages_select" ON public."machine_chat_messages";
CREATE POLICY "machine_chat_messages_select" ON public."machine_chat_messages"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('sales_plan', 'view') OR private.crm_has_permission('production', 'view')) AND ((EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_chat_messages.machine_id) AND
        true))))));

DROP POLICY IF EXISTS "machine_expenses_delete" ON public."machine_expenses";
CREATE POLICY "machine_expenses_delete" ON public."machine_expenses"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('client_prices', 'manage')) AND ((((private.crm_has_permission('client_prices', 'manage'))) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_expenses.machine_id)))))));

DROP POLICY IF EXISTS "machine_expenses_insert" ON public."machine_expenses";
CREATE POLICY "machine_expenses_insert" ON public."machine_expenses"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('client_prices', 'manage')) AND ((((private.crm_has_permission('client_prices', 'manage'))) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_expenses.machine_id)))))));

DROP POLICY IF EXISTS "machine_expenses_select" ON public."machine_expenses";
CREATE POLICY "machine_expenses_select" ON public."machine_expenses"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('client_prices', 'view')) AND ((EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_expenses.machine_id) AND
        true))))));

DROP POLICY IF EXISTS "machine_expenses_update" ON public."machine_expenses";
CREATE POLICY "machine_expenses_update" ON public."machine_expenses"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('client_prices', 'manage')) AND ((((private.crm_has_permission('client_prices', 'manage'))) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_expenses.machine_id)))))))
WITH CHECK (((private.crm_has_permission('client_prices', 'manage')) AND ((((private.crm_has_permission('client_prices', 'manage'))) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_expenses.machine_id)))))));

DROP POLICY IF EXISTS "Nesting managers delete machine item nesting runs" ON public."machine_item_nesting_runs";
CREATE POLICY "Nesting managers delete machine item nesting runs" ON public."machine_item_nesting_runs"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))));

DROP POLICY IF EXISTS "Nesting managers insert machine item nesting runs" ON public."machine_item_nesting_runs";
CREATE POLICY "Nesting managers insert machine item nesting runs" ON public."machine_item_nesting_runs"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))));

DROP POLICY IF EXISTS "Nesting managers read machine item nesting runs" ON public."machine_item_nesting_runs";
CREATE POLICY "Nesting managers read machine item nesting runs" ON public."machine_item_nesting_runs"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('nesting', 'view')) AND (((private.crm_has_permission('nesting', 'view'))))));

DROP POLICY IF EXISTS "Nesting managers update machine item nesting runs" ON public."machine_item_nesting_runs";
CREATE POLICY "Nesting managers update machine item nesting runs" ON public."machine_item_nesting_runs"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))))
WITH CHECK (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))));

DROP POLICY IF EXISTS "machine_items_delete" ON public."machine_items";
CREATE POLICY "machine_items_delete" ON public."machine_items"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('sales_plan', 'manage')) AND ((((private.crm_has_permission('sales_plan', 'manage'))) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_items.machine_id)))))));

DROP POLICY IF EXISTS "machine_items_insert" ON public."machine_items";
CREATE POLICY "machine_items_insert" ON public."machine_items"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('sales_plan', 'manage')) AND ((((private.crm_has_permission('sales_plan', 'manage'))) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_items.machine_id)))))));

DROP POLICY IF EXISTS "machine_items_select" ON public."machine_items";
CREATE POLICY "machine_items_select" ON public."machine_items"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('sales_plan', 'view') OR private.crm_has_permission('production', 'view')) AND ((EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_items.machine_id) AND
        true))))));

DROP POLICY IF EXISTS "machine_items_update" ON public."machine_items";
CREATE POLICY "machine_items_update" ON public."machine_items"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('sales_plan', 'manage')) AND ((((private.crm_has_permission('sales_plan', 'manage'))) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_items.machine_id)))))))
WITH CHECK (((private.crm_has_permission('sales_plan', 'manage')) AND ((((private.crm_has_permission('sales_plan', 'manage'))) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE (m.id = machine_items.machine_id)))))));

DROP POLICY IF EXISTS "Machine layout manage sales tech directors" ON public."machine_layout_requests";
CREATE POLICY "Machine layout manage sales tech directors" ON public."machine_layout_requests"
FOR ALL TO authenticated
USING (((private.crm_has_permission('machine_cutting', 'manage') OR private.crm_has_permission('nesting', 'manage')) AND ((private.crm_has_permission('machine_cutting', 'manage') OR private.crm_has_permission('nesting', 'manage')))))
WITH CHECK (((private.crm_has_permission('machine_cutting', 'manage') OR private.crm_has_permission('nesting', 'manage')) AND ((private.crm_has_permission('machine_cutting', 'manage') OR private.crm_has_permission('nesting', 'manage')))));

DROP POLICY IF EXISTS "Machine layout read app roles" ON public."machine_layout_requests";
CREATE POLICY "Machine layout read app roles" ON public."machine_layout_requests"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('machine_cutting', 'view') OR private.crm_has_permission('nesting', 'view')) AND ((private.crm_has_permission('machine_cutting', 'view') OR private.crm_has_permission('nesting', 'view')))));

DROP POLICY IF EXISTS "machine_outsourcing_operation_items_select" ON public."machine_outsourcing_operation_items";
CREATE POLICY "machine_outsourcing_operation_items_select" ON public."machine_outsourcing_operation_items"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('production_fact', 'view') OR private.crm_has_permission('supply_transport', 'view')) AND ((EXISTS ( SELECT 1
   FROM (machine_outsourcing_operations op
     JOIN machines m ON ((m.id = op.machine_id)))
  WHERE ((op.id = machine_outsourcing_operation_items.operation_id) AND ((private.crm_has_permission('production_fact', 'view') OR private.crm_has_permission('supply_transport', 'view')) OR (m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL) OR ((private.crm_has_permission('production_fact', 'view') OR private.crm_has_permission('supply_transport', 'view'))) OR ((op.executor_type = 'factory'::outsourcing_executor_type) AND (op.executor_factory_id = get_user_factory_id()))))))) AND (EXISTS (
      SELECT 1
      FROM public.machine_outsourcing_operations AS scope_operation
      JOIN public.machines AS scope_machine ON scope_machine.id = scope_operation.machine_id
      WHERE scope_operation.id = "machine_outsourcing_operation_items".operation_id
        AND (private.crm_has_factory_permission('production_fact', 'view', scope_machine.factory_id) OR private.crm_has_factory_permission('supply_transport', 'view', scope_machine.factory_id))
    ))));

DROP POLICY IF EXISTS "machine_outsourcing_operations_select" ON public."machine_outsourcing_operations";
CREATE POLICY "machine_outsourcing_operations_select" ON public."machine_outsourcing_operations"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('production_fact', 'view') OR private.crm_has_permission('supply_transport', 'view')) AND (((private.crm_has_permission('production_fact', 'view') OR private.crm_has_permission('supply_transport', 'view')) OR (EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_outsourcing_operations.machine_id) AND ((m.factory_id = get_user_factory_id()) OR (m.factory_id IS NULL) OR ((private.crm_has_permission('production_fact', 'view') OR private.crm_has_permission('supply_transport', 'view'))))))) OR ((executor_type = 'factory'::outsourcing_executor_type) AND (executor_factory_id = get_user_factory_id())))) AND (EXISTS (
      SELECT 1 FROM public.machines AS scope_machine
      WHERE scope_machine.id = machine_outsourcing_operations.machine_id
        AND (private.crm_has_factory_permission('production_fact', 'view', scope_machine.factory_id) OR private.crm_has_factory_permission('supply_transport', 'view', scope_machine.factory_id))
    ))));

DROP POLICY IF EXISTS "outsourcing_transport_needs_select" ON public."machine_outsourcing_transport_needs";
CREATE POLICY "outsourcing_transport_needs_select" ON public."machine_outsourcing_transport_needs"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('supply_transport', 'view') OR private.crm_has_permission('production_fact', 'view')) AND (((private.crm_has_permission('supply_transport', 'view') OR private.crm_has_permission('production_fact', 'view')) OR ((private.crm_has_permission('supply_transport', 'view') OR private.crm_has_permission('production_fact', 'view'))) OR (EXISTS ( SELECT 1
   FROM (machine_outsourcing_operations op
     JOIN machines m ON ((m.id = op.machine_id)))
  WHERE ((op.id = machine_outsourcing_transport_needs.operation_id) AND ((m.factory_id = get_user_factory_id()) OR ((op.executor_type = 'factory'::outsourcing_executor_type) AND (op.executor_factory_id = get_user_factory_id())))))))) AND (EXISTS (
      SELECT 1
      FROM public.machine_outsourcing_operations AS scope_operation
      JOIN public.machines AS scope_machine ON scope_machine.id = scope_operation.machine_id
      WHERE scope_operation.id = "machine_outsourcing_transport_needs".operation_id
        AND (private.crm_has_factory_permission('supply_transport', 'view', scope_machine.factory_id) OR private.crm_has_factory_permission('production_fact', 'view', scope_machine.factory_id))
    ))));

DROP POLICY IF EXISTS "outsourcing_transport_orders_select" ON public."machine_outsourcing_transport_orders";
CREATE POLICY "outsourcing_transport_orders_select" ON public."machine_outsourcing_transport_orders"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('supply_transport', 'view')) AND (((EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR ((private.crm_has_permission('supply_transport', 'view')))))));

DROP POLICY IF EXISTS "machine_outsourcing_vrb_items_select" ON public."machine_outsourcing_vrb_items";
CREATE POLICY "machine_outsourcing_vrb_items_select" ON public."machine_outsourcing_vrb_items"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('production_fact', 'view') OR private.crm_has_permission('supply', 'view')) AND ((EXISTS ( SELECT 1
   FROM (machine_outsourcing_operations operation
     JOIN machines machine ON ((machine.id = operation.machine_id)))
  WHERE ((operation.id = machine_outsourcing_vrb_items.operation_id) AND ((private.crm_has_permission('production_fact', 'view') OR private.crm_has_permission('supply', 'view')) OR (machine.factory_id = get_user_factory_id()) OR ((private.crm_has_permission('production_fact', 'view') OR private.crm_has_permission('supply', 'view')))))))) AND (EXISTS (
      SELECT 1
      FROM public.machine_outsourcing_operations AS scope_operation
      JOIN public.machines AS scope_machine ON scope_machine.id = scope_operation.machine_id
      WHERE scope_operation.id = "machine_outsourcing_vrb_items".operation_id
        AND (private.crm_has_factory_permission('production_fact', 'view', scope_machine.factory_id) OR private.crm_has_factory_permission('supply', 'view', scope_machine.factory_id))
    ))));

DROP POLICY IF EXISTS "machine_outsourcing_vrb_receipts_select" ON public."machine_outsourcing_vrb_receipts";
CREATE POLICY "machine_outsourcing_vrb_receipts_select" ON public."machine_outsourcing_vrb_receipts"
FOR SELECT TO authenticated
USING (((private.crm_has_factory_permission('production_fact', 'view', factory_id) OR private.crm_has_factory_permission('supply', 'view', factory_id)) AND (((private.crm_has_permission('production_fact', 'view') OR private.crm_has_permission('supply', 'view')) OR (factory_id = get_user_factory_id()) OR ((private.crm_has_permission('production_fact', 'view') OR private.crm_has_permission('supply', 'view')))))));

DROP POLICY IF EXISTS "machine_packing_groups_delete" ON public."machine_packing_groups";
CREATE POLICY "machine_packing_groups_delete" ON public."machine_packing_groups"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('sales_plan', 'manage')) AND ((((private.crm_has_permission('sales_plan', 'manage'))) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_packing_groups.machine_id) AND
        true)))))));

DROP POLICY IF EXISTS "machine_packing_groups_insert" ON public."machine_packing_groups";
CREATE POLICY "machine_packing_groups_insert" ON public."machine_packing_groups"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('sales_plan', 'manage')) AND ((((private.crm_has_permission('sales_plan', 'manage'))) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_packing_groups.machine_id) AND
        true)))))));

DROP POLICY IF EXISTS "machine_packing_groups_select" ON public."machine_packing_groups";
CREATE POLICY "machine_packing_groups_select" ON public."machine_packing_groups"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('sales_plan', 'view') OR private.crm_has_permission('production', 'view')) AND ((EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_packing_groups.machine_id) AND
        true))))));

DROP POLICY IF EXISTS "machine_packing_groups_update" ON public."machine_packing_groups";
CREATE POLICY "machine_packing_groups_update" ON public."machine_packing_groups"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('sales_plan', 'manage')) AND ((((private.crm_has_permission('sales_plan', 'manage'))) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_packing_groups.machine_id) AND
        true)))))))
WITH CHECK (((private.crm_has_permission('sales_plan', 'manage')) AND ((((private.crm_has_permission('sales_plan', 'manage'))) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_packing_groups.machine_id) AND
        true)))))));

DROP POLICY IF EXISTS "machine_updates_select" ON public."machine_updates";
CREATE POLICY "machine_updates_select" ON public."machine_updates"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('sales_plan', 'view') OR private.crm_has_permission('production', 'view')) AND (((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = machine_updates.machine_id) AND
        true)))))));

DROP POLICY IF EXISTS "Machines - Delete directors" ON public."machines";
CREATE POLICY "Machines - Delete directors" ON public."machines"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('sales_plan', 'manage')) AND ((private.crm_has_permission('sales_plan', 'manage')))));

DROP POLICY IF EXISTS "Machines - Insert staff" ON public."machines";
CREATE POLICY "Machines - Insert staff" ON public."machines"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('sales_plan', 'manage')) AND (((private.crm_has_permission('sales_plan', 'manage'))))));

DROP POLICY IF EXISTS "Machines - Update staff" ON public."machines";
CREATE POLICY "Machines - Update staff" ON public."machines"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('sales_plan', 'manage')) AND (((private.crm_has_permission('sales_plan', 'manage'))))));

DROP POLICY IF EXISTS "machines_select" ON public."machines";
CREATE POLICY "machines_select" ON public."machines"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('sales_plan', 'view') OR private.crm_has_permission('production', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND (
      private.crm_has_permission('sales_plan', 'view')
      OR private.crm_has_permission('production', 'view')
      OR (
        private.crm_has_permission('supply_orders', 'view')
        AND EXISTS (
          SELECT 1
          FROM public.technologist_requests AS supply_request
          WHERE supply_request.machine_id = machines.id
            AND supply_request.status IN ('submitted_to_supply', 'completed')
        )
      ))));

DROP POLICY IF EXISTS "mail_messages_owner_or_crm_reader" ON public."mail_messages";
CREATE POLICY "mail_messages_owner_or_crm_reader" ON public."mail_messages"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('mail', 'view') OR private.crm_has_permission('product_projects', 'view') OR private.crm_has_permission('department_requests', 'view')) AND (
      EXISTS (SELECT 1 FROM public.mail_accounts account WHERE account.id = mail_messages.account_id AND account.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.product_project_mail_threads link WHERE link.thread_id = mail_messages.thread_id AND link.unlinked_at IS NULL AND private.crm_has_permission('product_projects', 'view'))
      OR EXISTS (SELECT 1 FROM public.product_project_mail_messages link WHERE link.message_id = mail_messages.id AND link.unlinked_at IS NULL AND private.crm_has_permission('product_projects', 'view'))
      OR EXISTS (
        SELECT 1 FROM public.department_request_mail_threads link
        JOIN public.department_requests request ON request.id = link.department_request_id
        WHERE link.thread_id = mail_messages.thread_id AND link.unlinked_at IS NULL
          AND (request.created_by = auth.uid() OR public.can_manage_department_request_target(request.target_department, request.factory_id))
      )
      OR EXISTS (
        SELECT 1 FROM public.department_request_mail_messages link
        JOIN public.department_requests request ON request.id = link.department_request_id
        WHERE link.message_id = mail_messages.id AND link.unlinked_at IS NULL
          AND (request.created_by = auth.uid() OR public.can_manage_department_request_target(request.target_department, request.factory_id))
      ))));

DROP POLICY IF EXISTS "mail_threads_owner_or_crm_reader" ON public."mail_threads";
CREATE POLICY "mail_threads_owner_or_crm_reader" ON public."mail_threads"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('mail', 'view') OR private.crm_has_permission('product_projects', 'view') OR private.crm_has_permission('department_requests', 'view')) AND (
      EXISTS (SELECT 1 FROM public.mail_accounts account WHERE account.id = mail_threads.account_id AND account.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.product_project_mail_threads link WHERE link.thread_id = mail_threads.id AND link.unlinked_at IS NULL AND private.crm_has_permission('product_projects', 'view'))
      OR EXISTS (
        SELECT 1 FROM public.department_request_mail_threads link
        JOIN public.department_requests request ON request.id = link.department_request_id
        WHERE link.thread_id = mail_threads.id AND link.unlinked_at IS NULL
          AND (request.created_by = auth.uid() OR public.can_manage_department_request_target(request.target_department, request.factory_id))
      ))));

DROP POLICY IF EXISTS "Material variants insert catalog roles" ON public."material_variants";
CREATE POLICY "Material variants insert catalog roles" ON public."material_variants"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('materials', 'manage')) AND ((private.crm_has_permission('materials', 'manage')))));

DROP POLICY IF EXISTS "Material variants read catalog roles" ON public."material_variants";
CREATE POLICY "Material variants read catalog roles" ON public."material_variants"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('materials', 'view') OR private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view') OR private.crm_has_permission('inventory', 'view')) AND (((private.crm_has_permission('materials', 'view') OR private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view') OR private.crm_has_permission('inventory', 'view')) OR (private.crm_has_permission('materials', 'view') OR private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view') OR private.crm_has_permission('inventory', 'view'))))));

DROP POLICY IF EXISTS "Material variants update catalog roles" ON public."material_variants";
CREATE POLICY "Material variants update catalog roles" ON public."material_variants"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('materials', 'manage')) AND ((private.crm_has_permission('materials', 'manage')))))
WITH CHECK (((private.crm_has_permission('materials', 'manage')) AND ((private.crm_has_permission('materials', 'manage')))));

DROP POLICY IF EXISTS "Materials insert catalog roles" ON public."materials";
CREATE POLICY "Materials insert catalog roles" ON public."materials"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('materials', 'manage')) AND ((private.crm_has_permission('materials', 'manage')))));

DROP POLICY IF EXISTS "Materials read catalog roles" ON public."materials";
CREATE POLICY "Materials read catalog roles" ON public."materials"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('materials', 'view') OR private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view') OR private.crm_has_permission('inventory', 'view')) AND (((private.crm_has_permission('materials', 'view') OR private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view') OR private.crm_has_permission('inventory', 'view')) OR (private.crm_has_permission('materials', 'view') OR private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view') OR private.crm_has_permission('inventory', 'view'))))));

DROP POLICY IF EXISTS "Materials update catalog roles" ON public."materials";
CREATE POLICY "Materials update catalog roles" ON public."materials"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('materials', 'manage')) AND ((private.crm_has_permission('materials', 'manage')))))
WITH CHECK (((private.crm_has_permission('materials', 'manage')) AND ((private.crm_has_permission('materials', 'manage')))));

DROP POLICY IF EXISTS "actions_modify" ON public."meeting_action_items";
CREATE POLICY "actions_modify" ON public."meeting_action_items"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))))
WITH CHECK (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))));

DROP POLICY IF EXISTS "actions_select" ON public."meeting_action_items";
CREATE POLICY "actions_select" ON public."meeting_action_items"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings', 'view')) AND ((auth.uid() IS NOT NULL))));

DROP POLICY IF EXISTS "agenda_modify" ON public."meeting_agenda_items";
CREATE POLICY "agenda_modify" ON public."meeting_agenda_items"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))))
WITH CHECK (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))));

DROP POLICY IF EXISTS "agenda_select" ON public."meeting_agenda_items";
CREATE POLICY "agenda_select" ON public."meeting_agenda_items"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings', 'view')) AND ((auth.uid() IS NOT NULL))));

DROP POLICY IF EXISTS "agenda_pool_modify" ON public."meeting_agenda_pool_items";
CREATE POLICY "agenda_pool_modify" ON public."meeting_agenda_pool_items"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meetings_agenda_pool', 'manage')) AND ((private.crm_has_permission('meetings_agenda_pool', 'manage')))))
WITH CHECK (((private.crm_has_permission('meetings_agenda_pool', 'manage')) AND ((private.crm_has_permission('meetings_agenda_pool', 'manage')))));

DROP POLICY IF EXISTS "agenda_pool_select" ON public."meeting_agenda_pool_items";
CREATE POLICY "agenda_pool_select" ON public."meeting_agenda_pool_items"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings_agenda_pool', 'view')) AND ((auth.uid() IS NOT NULL))));

DROP POLICY IF EXISTS "attendees_modify" ON public."meeting_attendees";
CREATE POLICY "attendees_modify" ON public."meeting_attendees"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))))
WITH CHECK (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))));

DROP POLICY IF EXISTS "attendees_select" ON public."meeting_attendees";
CREATE POLICY "attendees_select" ON public."meeting_attendees"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings', 'view')) AND ((auth.uid() IS NOT NULL))));

DROP POLICY IF EXISTS "decisions_modify" ON public."meeting_decisions";
CREATE POLICY "decisions_modify" ON public."meeting_decisions"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))))
WITH CHECK (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))));

DROP POLICY IF EXISTS "decisions_select" ON public."meeting_decisions";
CREATE POLICY "decisions_select" ON public."meeting_decisions"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings', 'view')) AND ((auth.uid() IS NOT NULL))));

DROP POLICY IF EXISTS "ext_attendees_modify" ON public."meeting_external_attendees";
CREATE POLICY "ext_attendees_modify" ON public."meeting_external_attendees"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))))
WITH CHECK (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))));

DROP POLICY IF EXISTS "ext_attendees_select" ON public."meeting_external_attendees";
CREATE POLICY "ext_attendees_select" ON public."meeting_external_attendees"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings', 'view')) AND ((auth.uid() IS NOT NULL))));

DROP POLICY IF EXISTS "meeting_question_events_manage" ON public."meeting_question_events";
CREATE POLICY "meeting_question_events_manage" ON public."meeting_question_events"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meetings', 'manage')) AND (can_manage_meeting_resource('meetings'::text))))
WITH CHECK (((private.crm_has_permission('meetings', 'manage')) AND (can_manage_meeting_resource('meetings'::text))));

DROP POLICY IF EXISTS "meeting_question_events_view" ON public."meeting_question_events";
CREATE POLICY "meeting_question_events_view" ON public."meeting_question_events"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings', 'view')) AND (can_view_meeting_resource('meetings'::text))));

DROP POLICY IF EXISTS "meeting_question_meeting_history_manage" ON public."meeting_question_meeting_history";
CREATE POLICY "meeting_question_meeting_history_manage" ON public."meeting_question_meeting_history"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meetings', 'manage')) AND (can_manage_meeting_resource('meetings'::text))))
WITH CHECK (((private.crm_has_permission('meetings', 'manage')) AND (can_manage_meeting_resource('meetings'::text))));

DROP POLICY IF EXISTS "meeting_question_meeting_history_view" ON public."meeting_question_meeting_history";
CREATE POLICY "meeting_question_meeting_history_view" ON public."meeting_question_meeting_history"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings', 'view')) AND (can_view_meeting_resource('meetings'::text))));

DROP POLICY IF EXISTS "meeting_question_members_manage" ON public."meeting_question_members";
CREATE POLICY "meeting_question_members_manage" ON public."meeting_question_members"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meetings_agenda_pool', 'manage')) AND (can_manage_meeting_resource('meetings_agenda_pool'::text))))
WITH CHECK (((private.crm_has_permission('meetings_agenda_pool', 'manage')) AND (can_manage_meeting_resource('meetings_agenda_pool'::text))));

DROP POLICY IF EXISTS "meeting_question_members_view" ON public."meeting_question_members";
CREATE POLICY "meeting_question_members_view" ON public."meeting_question_members"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings_agenda_pool', 'view')) AND (can_view_meeting_resource('meetings_agenda_pool'::text))));

DROP POLICY IF EXISTS "meeting_question_outcomes_manage" ON public."meeting_question_outcomes";
CREATE POLICY "meeting_question_outcomes_manage" ON public."meeting_question_outcomes"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meetings', 'manage')) AND (can_manage_meeting_resource('meetings'::text))))
WITH CHECK (((private.crm_has_permission('meetings', 'manage')) AND (can_manage_meeting_resource('meetings'::text))));

DROP POLICY IF EXISTS "meeting_question_outcomes_view" ON public."meeting_question_outcomes";
CREATE POLICY "meeting_question_outcomes_view" ON public."meeting_question_outcomes"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings', 'view')) AND (can_view_meeting_resource('meetings'::text))));

DROP POLICY IF EXISTS "meeting_question_task_links_manage" ON public."meeting_question_task_links";
CREATE POLICY "meeting_question_task_links_manage" ON public."meeting_question_task_links"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meetings', 'manage')) AND (can_manage_meeting_resource('meetings'::text))))
WITH CHECK (((private.crm_has_permission('meetings', 'manage')) AND (can_manage_meeting_resource('meetings'::text))));

DROP POLICY IF EXISTS "meeting_question_task_links_view" ON public."meeting_question_task_links";
CREATE POLICY "meeting_question_task_links_view" ON public."meeting_question_task_links"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings', 'view')) AND (can_view_meeting_resource('meetings'::text))));

DROP POLICY IF EXISTS "meeting_question_templates_manage" ON public."meeting_question_templates";
CREATE POLICY "meeting_question_templates_manage" ON public."meeting_question_templates"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meeting_question_templates', 'manage')) AND (can_manage_meeting_resource('meeting_question_templates'::text))))
WITH CHECK (((private.crm_has_permission('meeting_question_templates', 'manage')) AND (can_manage_meeting_resource('meeting_question_templates'::text))));

DROP POLICY IF EXISTS "meeting_question_templates_view" ON public."meeting_question_templates";
CREATE POLICY "meeting_question_templates_view" ON public."meeting_question_templates"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meeting_question_templates', 'view')) AND (can_view_meeting_resource('meeting_question_templates'::text))));

DROP POLICY IF EXISTS "meeting_questions_manage" ON public."meeting_questions";
CREATE POLICY "meeting_questions_manage" ON public."meeting_questions"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meetings_agenda_pool', 'manage')) AND (can_manage_meeting_resource('meetings_agenda_pool'::text))))
WITH CHECK (((private.crm_has_permission('meetings_agenda_pool', 'manage')) AND (can_manage_meeting_resource('meetings_agenda_pool'::text))));

DROP POLICY IF EXISTS "meeting_questions_view" ON public."meeting_questions";
CREATE POLICY "meeting_questions_view" ON public."meeting_questions"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings_agenda_pool', 'view')) AND (can_view_meeting_resource('meetings_agenda_pool'::text))));

DROP POLICY IF EXISTS "meeting_recurrence_rules_modify" ON public."meeting_recurrence_rules";
CREATE POLICY "meeting_recurrence_rules_modify" ON public."meeting_recurrence_rules"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meeting_templates', 'manage')) AND ((private.crm_has_permission('meeting_templates', 'manage')))))
WITH CHECK (((private.crm_has_permission('meeting_templates', 'manage')) AND ((private.crm_has_permission('meeting_templates', 'manage')))));

DROP POLICY IF EXISTS "meeting_recurrence_rules_select" ON public."meeting_recurrence_rules";
CREATE POLICY "meeting_recurrence_rules_select" ON public."meeting_recurrence_rules"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meeting_templates', 'view')) AND ((auth.uid() IS NOT NULL))));

DROP POLICY IF EXISTS "meeting_rule_versions_manage" ON public."meeting_rule_versions";
CREATE POLICY "meeting_rule_versions_manage" ON public."meeting_rule_versions"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meeting_rules', 'manage')) AND (can_manage_meeting_resource('meeting_rules'::text))))
WITH CHECK (((private.crm_has_permission('meeting_rules', 'manage')) AND (can_manage_meeting_resource('meeting_rules'::text))));

DROP POLICY IF EXISTS "meeting_rule_versions_view" ON public."meeting_rule_versions";
CREATE POLICY "meeting_rule_versions_view" ON public."meeting_rule_versions"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meeting_rules', 'view')) AND (can_view_meeting_resource('meeting_rules'::text))));

DROP POLICY IF EXISTS "meeting_rules_manage" ON public."meeting_rules";
CREATE POLICY "meeting_rules_manage" ON public."meeting_rules"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meeting_rules', 'manage')) AND (can_manage_meeting_resource('meeting_rules'::text))))
WITH CHECK (((private.crm_has_permission('meeting_rules', 'manage')) AND (can_manage_meeting_resource('meeting_rules'::text))));

DROP POLICY IF EXISTS "meeting_rules_view" ON public."meeting_rules";
CREATE POLICY "meeting_rules_view" ON public."meeting_rules"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meeting_rules', 'view')) AND (can_view_meeting_resource('meeting_rules'::text))));

DROP POLICY IF EXISTS "meeting_schedule_exceptions_manage" ON public."meeting_schedule_exceptions";
CREATE POLICY "meeting_schedule_exceptions_manage" ON public."meeting_schedule_exceptions"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meetings', 'manage')) AND (can_manage_meeting_resource('meetings'::text))))
WITH CHECK (((private.crm_has_permission('meetings', 'manage')) AND (can_manage_meeting_resource('meetings'::text))));

DROP POLICY IF EXISTS "meeting_schedule_exceptions_view" ON public."meeting_schedule_exceptions";
CREATE POLICY "meeting_schedule_exceptions_view" ON public."meeting_schedule_exceptions"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings', 'view')) AND (can_view_meeting_resource('meetings'::text))));

DROP POLICY IF EXISTS "meeting_schedule_versions_manage" ON public."meeting_schedule_versions";
CREATE POLICY "meeting_schedule_versions_manage" ON public."meeting_schedule_versions"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meeting_templates', 'manage')) AND (can_manage_meeting_resource('meeting_templates'::text))))
WITH CHECK (((private.crm_has_permission('meeting_templates', 'manage')) AND (can_manage_meeting_resource('meeting_templates'::text))));

DROP POLICY IF EXISTS "meeting_schedule_versions_view" ON public."meeting_schedule_versions";
CREATE POLICY "meeting_schedule_versions_view" ON public."meeting_schedule_versions"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meeting_templates', 'view')) AND (can_view_meeting_resource('meeting_templates'::text))));

DROP POLICY IF EXISTS "meeting_system_rollout_events_manage" ON public."meeting_system_rollout_events";
CREATE POLICY "meeting_system_rollout_events_manage" ON public."meeting_system_rollout_events"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meeting_rules', 'manage')) AND (can_manage_meeting_resource('meeting_rules'::text))))
WITH CHECK (((private.crm_has_permission('meeting_rules', 'manage')) AND (can_manage_meeting_resource('meeting_rules'::text))));

DROP POLICY IF EXISTS "meeting_system_rollout_events_view" ON public."meeting_system_rollout_events";
CREATE POLICY "meeting_system_rollout_events_view" ON public."meeting_system_rollout_events"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meeting_rules', 'view')) AND (can_view_meeting_resource('meeting_rules'::text))));

DROP POLICY IF EXISTS "meeting_telegram_reminders_manage_directors" ON public."meeting_telegram_reminders";
CREATE POLICY "meeting_telegram_reminders_manage_directors" ON public."meeting_telegram_reminders"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))))
WITH CHECK (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))));

DROP POLICY IF EXISTS "meeting_telegram_reminders_select_directors" ON public."meeting_telegram_reminders";
CREATE POLICY "meeting_telegram_reminders_select_directors" ON public."meeting_telegram_reminders"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings', 'view')) AND ((private.crm_has_permission('meetings', 'view')))));

DROP POLICY IF EXISTS "meeting_template_participants_manage" ON public."meeting_template_participants";
CREATE POLICY "meeting_template_participants_manage" ON public."meeting_template_participants"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meeting_templates', 'manage')) AND (can_manage_meeting_resource('meeting_templates'::text))))
WITH CHECK (((private.crm_has_permission('meeting_templates', 'manage')) AND (can_manage_meeting_resource('meeting_templates'::text))));

DROP POLICY IF EXISTS "meeting_template_participants_view" ON public."meeting_template_participants";
CREATE POLICY "meeting_template_participants_view" ON public."meeting_template_participants"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meeting_templates', 'view')) AND (can_view_meeting_resource('meeting_templates'::text))));

DROP POLICY IF EXISTS "meeting_template_questions_manage" ON public."meeting_template_questions";
CREATE POLICY "meeting_template_questions_manage" ON public."meeting_template_questions"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meeting_question_templates', 'manage')) AND (can_manage_meeting_resource('meeting_question_templates'::text))))
WITH CHECK (((private.crm_has_permission('meeting_question_templates', 'manage')) AND (can_manage_meeting_resource('meeting_question_templates'::text))));

DROP POLICY IF EXISTS "meeting_template_questions_view" ON public."meeting_template_questions";
CREATE POLICY "meeting_template_questions_view" ON public."meeting_template_questions"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meeting_question_templates', 'view')) AND (can_view_meeting_resource('meeting_question_templates'::text))));

DROP POLICY IF EXISTS "meeting_templates_manage" ON public."meeting_templates";
CREATE POLICY "meeting_templates_manage" ON public."meeting_templates"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meeting_templates', 'manage')) AND (can_manage_meeting_resource('meeting_templates'::text))))
WITH CHECK (((private.crm_has_permission('meeting_templates', 'manage')) AND (can_manage_meeting_resource('meeting_templates'::text))));

DROP POLICY IF EXISTS "meeting_templates_view" ON public."meeting_templates";
CREATE POLICY "meeting_templates_view" ON public."meeting_templates"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meeting_templates', 'view')) AND (can_view_meeting_resource('meeting_templates'::text))));

DROP POLICY IF EXISTS "meeting_types_modify" ON public."meeting_types";
CREATE POLICY "meeting_types_modify" ON public."meeting_types"
FOR ALL TO authenticated
USING (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))))
WITH CHECK (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))));

DROP POLICY IF EXISTS "meeting_types_select" ON public."meeting_types";
CREATE POLICY "meeting_types_select" ON public."meeting_types"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings', 'view')) AND ((auth.uid() IS NOT NULL))));

DROP POLICY IF EXISTS "meetings_delete" ON public."meetings";
CREATE POLICY "meetings_delete" ON public."meetings"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))));

DROP POLICY IF EXISTS "meetings_insert" ON public."meetings";
CREATE POLICY "meetings_insert" ON public."meetings"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))));

DROP POLICY IF EXISTS "meetings_select" ON public."meetings";
CREATE POLICY "meetings_select" ON public."meetings"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('meetings', 'view')) AND ((auth.uid() IS NOT NULL))));

DROP POLICY IF EXISTS "meetings_update" ON public."meetings";
CREATE POLICY "meetings_update" ON public."meetings"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('meetings', 'manage')) AND ((private.crm_has_permission('meetings', 'manage')))));

DROP POLICY IF EXISTS "Nesting managers delete nesting batch items" ON public."nesting_batch_items";
CREATE POLICY "Nesting managers delete nesting batch items" ON public."nesting_batch_items"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))));

DROP POLICY IF EXISTS "Nesting managers insert nesting batch items" ON public."nesting_batch_items";
CREATE POLICY "Nesting managers insert nesting batch items" ON public."nesting_batch_items"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))));

DROP POLICY IF EXISTS "Nesting managers read nesting batch items" ON public."nesting_batch_items";
CREATE POLICY "Nesting managers read nesting batch items" ON public."nesting_batch_items"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('nesting', 'view')) AND (((private.crm_has_permission('nesting', 'view'))))));

DROP POLICY IF EXISTS "Nesting managers update nesting batch items" ON public."nesting_batch_items";
CREATE POLICY "Nesting managers update nesting batch items" ON public."nesting_batch_items"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))))
WITH CHECK (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))));

DROP POLICY IF EXISTS "Nesting managers delete nesting batches" ON public."nesting_batches";
CREATE POLICY "Nesting managers delete nesting batches" ON public."nesting_batches"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))));

DROP POLICY IF EXISTS "Nesting managers insert nesting batches" ON public."nesting_batches";
CREATE POLICY "Nesting managers insert nesting batches" ON public."nesting_batches"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))));

DROP POLICY IF EXISTS "Nesting managers read nesting batches" ON public."nesting_batches";
CREATE POLICY "Nesting managers read nesting batches" ON public."nesting_batches"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('nesting', 'view')) AND (((private.crm_has_permission('nesting', 'view'))))));

DROP POLICY IF EXISTS "Nesting managers update nesting batches" ON public."nesting_batches";
CREATE POLICY "Nesting managers update nesting batches" ON public."nesting_batches"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))))
WITH CHECK (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))));

DROP POLICY IF EXISTS "Nesting managers delete precut parts" ON public."nesting_precut_parts";
CREATE POLICY "Nesting managers delete precut parts" ON public."nesting_precut_parts"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))));

DROP POLICY IF EXISTS "Nesting managers insert precut parts" ON public."nesting_precut_parts";
CREATE POLICY "Nesting managers insert precut parts" ON public."nesting_precut_parts"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))));

DROP POLICY IF EXISTS "Nesting managers read precut parts" ON public."nesting_precut_parts";
CREATE POLICY "Nesting managers read precut parts" ON public."nesting_precut_parts"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('nesting', 'view')) AND (((private.crm_has_permission('nesting', 'view'))))));

DROP POLICY IF EXISTS "Nesting managers update precut parts" ON public."nesting_precut_parts";
CREATE POLICY "Nesting managers update precut parts" ON public."nesting_precut_parts"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))))
WITH CHECK (((private.crm_has_permission('nesting', 'manage')) AND (((private.crm_has_permission('nesting', 'manage'))))));

DROP POLICY IF EXISTS "Authenticated read product files" ON public."product_files";
CREATE POLICY "Authenticated read product files" ON public."product_files"
FOR SELECT TO authenticated
USING ((private.crm_has_permission('products', 'view')));

DROP POLICY IF EXISTS "Catalog managers delete product files" ON public."product_files";
CREATE POLICY "Catalog managers delete product files" ON public."product_files"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('products', 'manage')) AND (((private.crm_has_permission('products', 'manage'))))));

DROP POLICY IF EXISTS "Catalog managers insert product files" ON public."product_files";
CREATE POLICY "Catalog managers insert product files" ON public."product_files"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('products', 'manage')) AND (((private.crm_has_permission('products', 'manage'))))));

DROP POLICY IF EXISTS "Authenticated read product project files" ON public."product_project_files";
CREATE POLICY "Authenticated read product project files" ON public."product_project_files"
FOR SELECT TO authenticated
USING ((private.crm_has_permission('product_projects', 'view')));

DROP POLICY IF EXISTS "Catalog managers delete product project files" ON public."product_project_files";
CREATE POLICY "Catalog managers delete product project files" ON public."product_project_files"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('product_projects', 'manage')) AND (((private.crm_has_permission('product_projects', 'manage'))))));

DROP POLICY IF EXISTS "Catalog managers insert product project files" ON public."product_project_files";
CREATE POLICY "Catalog managers insert product project files" ON public."product_project_files"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('product_projects', 'manage')) AND (((private.crm_has_permission('product_projects', 'manage'))))));

DROP POLICY IF EXISTS "product_project_mail_messages_manager_insert" ON public."product_project_mail_messages";
CREATE POLICY "product_project_mail_messages_manager_insert" ON public."product_project_mail_messages"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('product_projects', 'manage')) AND (((linked_by = ( SELECT auth.uid() AS uid)) AND can_manage_product_projects() AND current_user_owns_mail_message(message_id)))));

DROP POLICY IF EXISTS "product_project_mail_messages_manager_update" ON public."product_project_mail_messages";
CREATE POLICY "product_project_mail_messages_manager_update" ON public."product_project_mail_messages"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('product_projects', 'manage')) AND (can_manage_product_projects())))
WITH CHECK (((private.crm_has_permission('product_projects', 'manage')) AND ((can_manage_product_projects() AND ((unlinked_at IS NULL) OR (unlinked_by = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "product_project_mail_messages_reader" ON public."product_project_mail_messages";
CREATE POLICY "product_project_mail_messages_reader" ON public."product_project_mail_messages"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('product_projects', 'view')) AND (can_view_product_projects())));

DROP POLICY IF EXISTS "product_project_mail_links_manager_insert" ON public."product_project_mail_threads";
CREATE POLICY "product_project_mail_links_manager_insert" ON public."product_project_mail_threads"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('product_projects', 'manage')) AND (((linked_by = ( SELECT auth.uid() AS uid)) AND can_manage_product_projects() AND current_user_owns_mail_thread(thread_id)))));

DROP POLICY IF EXISTS "product_project_mail_links_manager_update" ON public."product_project_mail_threads";
CREATE POLICY "product_project_mail_links_manager_update" ON public."product_project_mail_threads"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('product_projects', 'manage')) AND (can_manage_product_projects())))
WITH CHECK (((private.crm_has_permission('product_projects', 'manage')) AND ((can_manage_product_projects() AND ((unlinked_at IS NULL) OR (unlinked_by = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "product_project_mail_links_reader" ON public."product_project_mail_threads";
CREATE POLICY "product_project_mail_links_reader" ON public."product_project_mail_threads"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('product_projects', 'view')) AND (can_view_product_projects())));

DROP POLICY IF EXISTS "Authenticated read product project versions" ON public."product_project_versions";
CREATE POLICY "Authenticated read product project versions" ON public."product_project_versions"
FOR SELECT TO authenticated
USING ((private.crm_has_permission('product_projects', 'view')));

DROP POLICY IF EXISTS "Catalog managers insert product project versions" ON public."product_project_versions";
CREATE POLICY "Catalog managers insert product project versions" ON public."product_project_versions"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('product_projects', 'manage')) AND (((private.crm_has_permission('product_projects', 'manage'))))));

DROP POLICY IF EXISTS "Catalog managers update product project versions" ON public."product_project_versions";
CREATE POLICY "Catalog managers update product project versions" ON public."product_project_versions"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('product_projects', 'manage')) AND (((private.crm_has_permission('product_projects', 'manage'))))));

DROP POLICY IF EXISTS "Authenticated read product projects" ON public."product_projects";
CREATE POLICY "Authenticated read product projects" ON public."product_projects"
FOR SELECT TO authenticated
USING ((private.crm_has_permission('product_projects', 'view')));

DROP POLICY IF EXISTS "Catalog managers insert product projects" ON public."product_projects";
CREATE POLICY "Catalog managers insert product projects" ON public."product_projects"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('product_projects', 'manage')) AND (((private.crm_has_permission('product_projects', 'manage'))))));

DROP POLICY IF EXISTS "Catalog managers update product projects" ON public."product_projects";
CREATE POLICY "Catalog managers update product projects" ON public."product_projects"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('product_projects', 'manage')) AND (((private.crm_has_permission('product_projects', 'manage'))))));

DROP POLICY IF EXISTS "Authenticated read product versions" ON public."product_versions";
CREATE POLICY "Authenticated read product versions" ON public."product_versions"
FOR SELECT TO authenticated
USING ((private.crm_has_permission('products', 'view')));

DROP POLICY IF EXISTS "Catalog managers insert product versions" ON public."product_versions";
CREATE POLICY "Catalog managers insert product versions" ON public."product_versions"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('products', 'manage')) AND (((private.crm_has_permission('products', 'manage'))))));

DROP POLICY IF EXISTS "Catalog managers update product versions" ON public."product_versions";
CREATE POLICY "Catalog managers update product versions" ON public."product_versions"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('products', 'manage')) AND (((private.crm_has_permission('products', 'manage'))))));

DROP POLICY IF EXISTS "production_fact_sections_insert" ON public."production_fact_sections";
CREATE POLICY "production_fact_sections_insert" ON public."production_fact_sections"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_factory_permission('production_fact', 'manage', factory_id)) AND (((private.crm_has_permission('production_fact', 'manage')) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (factory_id = get_user_factory_id()))))));

DROP POLICY IF EXISTS "production_fact_sections_select" ON public."production_fact_sections";
CREATE POLICY "production_fact_sections_select" ON public."production_fact_sections"
FOR SELECT TO authenticated
USING (((private.crm_has_factory_permission('production_fact', 'view', factory_id)) AND (((private.crm_has_permission('production_fact', 'view')) OR (((private.crm_has_permission('production_fact', 'view'))) AND (factory_id = get_user_factory_id()))))));

DROP POLICY IF EXISTS "production_fact_sections_update" ON public."production_fact_sections";
CREATE POLICY "production_fact_sections_update" ON public."production_fact_sections"
FOR UPDATE TO authenticated
USING (((private.crm_has_factory_permission('production_fact', 'manage', factory_id)) AND (((private.crm_has_permission('production_fact', 'manage')) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (factory_id = get_user_factory_id()))))))
WITH CHECK (((private.crm_has_factory_permission('production_fact', 'manage', factory_id)) AND (((private.crm_has_permission('production_fact', 'manage')) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (factory_id = get_user_factory_id()))))));

DROP POLICY IF EXISTS "production_machine_facts_delete" ON public."production_machine_facts";
CREATE POLICY "production_machine_facts_delete" ON public."production_machine_facts"
FOR DELETE TO authenticated
USING (((private.crm_has_factory_permission('production_fact', 'manage', factory_id)) AND (((private.crm_has_permission('production_fact', 'manage')) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (factory_id = get_user_factory_id()))))));

DROP POLICY IF EXISTS "production_machine_facts_insert" ON public."production_machine_facts";
CREATE POLICY "production_machine_facts_insert" ON public."production_machine_facts"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_factory_permission('production_fact', 'manage', factory_id)) AND (((private.crm_has_permission('production_fact', 'manage')) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (factory_id = get_user_factory_id()))))));

DROP POLICY IF EXISTS "production_machine_facts_select" ON public."production_machine_facts";
CREATE POLICY "production_machine_facts_select" ON public."production_machine_facts"
FOR SELECT TO authenticated
USING (((private.crm_has_factory_permission('production_fact', 'view', factory_id)) AND (((private.crm_has_permission('production_fact', 'view')) OR (((private.crm_has_permission('production_fact', 'view'))) AND (factory_id = get_user_factory_id()))))));

DROP POLICY IF EXISTS "production_machine_facts_update" ON public."production_machine_facts";
CREATE POLICY "production_machine_facts_update" ON public."production_machine_facts"
FOR UPDATE TO authenticated
USING (((private.crm_has_factory_permission('production_fact', 'manage', factory_id)) AND (((private.crm_has_permission('production_fact', 'manage')) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (factory_id = get_user_factory_id()))))))
WITH CHECK (((private.crm_has_factory_permission('production_fact', 'manage', factory_id)) AND (((private.crm_has_permission('production_fact', 'manage')) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (factory_id = get_user_factory_id()))))));

DROP POLICY IF EXISTS "production_machine_item_facts_select" ON public."production_machine_item_facts";
CREATE POLICY "production_machine_item_facts_select" ON public."production_machine_item_facts"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('production_fact', 'view')) AND ((EXISTS ( SELECT 1
   FROM production_machine_facts fact
  WHERE ((fact.id = production_machine_item_facts.production_machine_fact_id) AND ((private.crm_has_permission('production_fact', 'view')) OR (((private.crm_has_permission('production_fact', 'view'))) AND (fact.factory_id = get_user_factory_id()))))))) AND (EXISTS (
      SELECT 1 FROM public.production_machine_facts AS scope_fact
      WHERE scope_fact.id = production_machine_item_facts.production_machine_fact_id
        AND (private.crm_has_factory_permission('production_fact', 'view', scope_fact.factory_id))
    ))));

DROP POLICY IF EXISTS "production_month_plans_select" ON public."production_month_plans";
CREATE POLICY "production_month_plans_select" ON public."production_month_plans"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('production', 'view')) AND (
true)));

DROP POLICY IF EXISTS "production_plan_date_change_request_items_select" ON public."production_plan_date_change_request_items";
CREATE POLICY "production_plan_date_change_request_items_select" ON public."production_plan_date_change_request_items"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('production', 'view')) AND ((EXISTS ( SELECT 1
   FROM production_plan_date_change_requests r
  WHERE ((r.id = production_plan_date_change_request_items.request_id) AND ((r.requested_by = auth.uid()) OR (EXISTS ( SELECT 1
           FROM tasks t
          WHERE ((t.id = r.task_id) AND (t.assigned_to = auth.uid())))) OR (EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR (EXISTS ( SELECT 1
           FROM machines m
          WHERE ((m.id = r.machine_id) AND ((private.crm_has_permission('production', 'view'))) AND (m.factory_id = get_user_factory_id())))))))))));

DROP POLICY IF EXISTS "production_plan_date_change_requests_select" ON public."production_plan_date_change_requests";
CREATE POLICY "production_plan_date_change_requests_select" ON public."production_plan_date_change_requests"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('production', 'view')) AND (((requested_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = production_plan_date_change_requests.task_id) AND (t.assigned_to = auth.uid())))) OR (EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR (EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = production_plan_date_change_requests.machine_id) AND ((private.crm_has_permission('production', 'view'))) AND (m.factory_id = get_user_factory_id()))))))));

DROP POLICY IF EXISTS "production_stage_intervals_select" ON public."production_stage_intervals";
CREATE POLICY "production_stage_intervals_select" ON public."production_stage_intervals"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('production', 'view')) AND ((EXISTS ( SELECT 1
   FROM (production_stages ps
     JOIN machines m ON ((m.id = ps.machine_id)))
  WHERE ((ps.id = production_stage_intervals.production_stage_id) AND
        true))))));

DROP POLICY IF EXISTS "Production Stages - Insert staff" ON public."production_stages";
CREATE POLICY "Production Stages - Insert staff" ON public."production_stages"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('production', 'manage')) AND (((private.crm_has_permission('production', 'manage'))))));

DROP POLICY IF EXISTS "Production Stages - Update staff" ON public."production_stages";
CREATE POLICY "Production Stages - Update staff" ON public."production_stages"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('production', 'manage')) AND (((private.crm_has_permission('production', 'manage'))))));

DROP POLICY IF EXISTS "production_stages_select" ON public."production_stages";
CREATE POLICY "production_stages_select" ON public."production_stages"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('production', 'view')) AND ((EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = production_stages.machine_id) AND
        true))))));

DROP POLICY IF EXISTS "production_tonnage_facts_delete" ON public."production_tonnage_facts";
CREATE POLICY "production_tonnage_facts_delete" ON public."production_tonnage_facts"
FOR DELETE TO authenticated
USING (((private.crm_has_factory_permission('production_fact', 'manage', factory_id)) AND (((private.crm_has_permission('production_fact', 'manage')) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (factory_id = get_user_factory_id()))))));

DROP POLICY IF EXISTS "production_tonnage_facts_insert" ON public."production_tonnage_facts";
CREATE POLICY "production_tonnage_facts_insert" ON public."production_tonnage_facts"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_factory_permission('production_fact', 'manage', factory_id)) AND (((private.crm_has_permission('production_fact', 'manage')) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (factory_id = get_user_factory_id()))))));

DROP POLICY IF EXISTS "production_tonnage_facts_select" ON public."production_tonnage_facts";
CREATE POLICY "production_tonnage_facts_select" ON public."production_tonnage_facts"
FOR SELECT TO authenticated
USING (((private.crm_has_factory_permission('production_fact', 'view', factory_id)) AND (((private.crm_has_permission('production_fact', 'view')) OR (((private.crm_has_permission('production_fact', 'view'))) AND (factory_id = get_user_factory_id()))))));

DROP POLICY IF EXISTS "production_tonnage_facts_update" ON public."production_tonnage_facts";
CREATE POLICY "production_tonnage_facts_update" ON public."production_tonnage_facts"
FOR UPDATE TO authenticated
USING (((private.crm_has_factory_permission('production_fact', 'manage', factory_id)) AND (((private.crm_has_permission('production_fact', 'manage')) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (factory_id = get_user_factory_id()))))))
WITH CHECK (((private.crm_has_factory_permission('production_fact', 'manage', factory_id)) AND (((private.crm_has_permission('production_fact', 'manage')) OR (((private.crm_has_permission('production_fact', 'manage'))) AND (factory_id = get_user_factory_id()))))));

DROP POLICY IF EXISTS "Authenticated read products" ON public."products";
CREATE POLICY "Authenticated read products" ON public."products"
FOR SELECT TO authenticated
USING ((private.crm_has_permission('products', 'view')));

DROP POLICY IF EXISTS "Catalog managers insert products" ON public."products";
CREATE POLICY "Catalog managers insert products" ON public."products"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('products', 'manage')) AND (((private.crm_has_permission('products', 'manage'))))));

DROP POLICY IF EXISTS "Catalog managers update products" ON public."products";
CREATE POLICY "Catalog managers update products" ON public."products"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('products', 'manage')) AND (((private.crm_has_permission('products', 'manage'))))));

DROP POLICY IF EXISTS "Request chain cord delete request roles" ON public."request_chain_cord";
CREATE POLICY "Request chain cord delete request roles" ON public."request_chain_cord"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "Request chain cord insert request roles" ON public."request_chain_cord";
CREATE POLICY "Request chain cord insert request roles" ON public."request_chain_cord"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "Request chain cord read request roles" ON public."request_chain_cord";
CREATE POLICY "Request chain cord read request roles" ON public."request_chain_cord"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND ((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')))));

DROP POLICY IF EXISTS "Request chain cord update request roles" ON public."request_chain_cord";
CREATE POLICY "Request chain cord update request roles" ON public."request_chain_cord"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))))
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_chain_cord";
CREATE POLICY "financial_supply_item_visibility" ON public."request_chain_cord"
AS RESTRICTIVE FOR ALL TO authenticated
USING ((fn_financial_supply_visibility(request_id)))
WITH CHECK ((fn_financial_supply_visibility(request_id)));

DROP POLICY IF EXISTS "Request circle delete request roles" ON public."request_circle";
CREATE POLICY "Request circle delete request roles" ON public."request_circle"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND (((private.crm_has_permission('technologist_requests', 'manage')) AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_circle.request_id) AND (NOT request.is_recalculation_staging))))))));

DROP POLICY IF EXISTS "Request circle insert request roles" ON public."request_circle";
CREATE POLICY "Request circle insert request roles" ON public."request_circle"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND (((private.crm_has_permission('technologist_requests', 'manage')) AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_circle.request_id) AND (NOT request.is_recalculation_staging))))))));

DROP POLICY IF EXISTS "Request circle read request roles" ON public."request_circle";
CREATE POLICY "Request circle read request roles" ON public."request_circle"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND (((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_circle.request_id) AND (NOT request.is_recalculation_staging))))))));

DROP POLICY IF EXISTS "Request circle update request roles" ON public."request_circle";
CREATE POLICY "Request circle update request roles" ON public."request_circle"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND (((private.crm_has_permission('technologist_requests', 'manage')) AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_circle.request_id) AND (NOT request.is_recalculation_staging))))))))
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND (((private.crm_has_permission('technologist_requests', 'manage')) AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_circle.request_id) AND (NOT request.is_recalculation_staging))))))));

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_circle";
CREATE POLICY "financial_supply_item_visibility" ON public."request_circle"
AS RESTRICTIVE FOR ALL TO authenticated
USING ((fn_financial_supply_visibility(request_id)))
WITH CHECK ((fn_financial_supply_visibility(request_id)));

DROP POLICY IF EXISTS "Request components delete request roles" ON public."request_components";
CREATE POLICY "Request components delete request roles" ON public."request_components"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "Request components insert request roles" ON public."request_components";
CREATE POLICY "Request components insert request roles" ON public."request_components"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "Request components read request roles" ON public."request_components";
CREATE POLICY "Request components read request roles" ON public."request_components"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND ((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')))));

DROP POLICY IF EXISTS "Request components update request roles" ON public."request_components";
CREATE POLICY "Request components update request roles" ON public."request_components"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))))
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_components";
CREATE POLICY "financial_supply_item_visibility" ON public."request_components"
AS RESTRICTIVE FOR ALL TO authenticated
USING ((fn_financial_supply_visibility(request_id)))
WITH CHECK ((fn_financial_supply_visibility(request_id)));

DROP POLICY IF EXISTS "Request knives delete request roles" ON public."request_knives";
CREATE POLICY "Request knives delete request roles" ON public."request_knives"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND (((private.crm_has_permission('technologist_requests', 'manage')) AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_knives.request_id) AND (NOT request.is_recalculation_staging))))))));

DROP POLICY IF EXISTS "Request knives insert request roles" ON public."request_knives";
CREATE POLICY "Request knives insert request roles" ON public."request_knives"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND (((private.crm_has_permission('technologist_requests', 'manage')) AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_knives.request_id) AND (NOT request.is_recalculation_staging))))))));

DROP POLICY IF EXISTS "Request knives read request roles" ON public."request_knives";
CREATE POLICY "Request knives read request roles" ON public."request_knives"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND (((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_knives.request_id) AND (NOT request.is_recalculation_staging))))))));

DROP POLICY IF EXISTS "Request knives update request roles" ON public."request_knives";
CREATE POLICY "Request knives update request roles" ON public."request_knives"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND (((private.crm_has_permission('technologist_requests', 'manage')) AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_knives.request_id) AND (NOT request.is_recalculation_staging))))))))
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND (((private.crm_has_permission('technologist_requests', 'manage')) AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_knives.request_id) AND (NOT request.is_recalculation_staging))))))));

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_knives";
CREATE POLICY "financial_supply_item_visibility" ON public."request_knives"
AS RESTRICTIVE FOR ALL TO authenticated
USING ((fn_financial_supply_visibility(request_id)))
WITH CHECK ((fn_financial_supply_visibility(request_id)));

DROP POLICY IF EXISTS "Request mesh delete request roles" ON public."request_mesh";
CREATE POLICY "Request mesh delete request roles" ON public."request_mesh"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "Request mesh insert request roles" ON public."request_mesh";
CREATE POLICY "Request mesh insert request roles" ON public."request_mesh"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "Request mesh read request roles" ON public."request_mesh";
CREATE POLICY "Request mesh read request roles" ON public."request_mesh"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND ((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')))));

DROP POLICY IF EXISTS "Request mesh update request roles" ON public."request_mesh";
CREATE POLICY "Request mesh update request roles" ON public."request_mesh"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))))
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_mesh";
CREATE POLICY "financial_supply_item_visibility" ON public."request_mesh"
AS RESTRICTIVE FOR ALL TO authenticated
USING ((fn_financial_supply_visibility(request_id)))
WITH CHECK ((fn_financial_supply_visibility(request_id)));

DROP POLICY IF EXISTS "Request paint delete request roles" ON public."request_paint";
CREATE POLICY "Request paint delete request roles" ON public."request_paint"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "Request paint insert request roles" ON public."request_paint";
CREATE POLICY "Request paint insert request roles" ON public."request_paint"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "Request paint read request roles" ON public."request_paint";
CREATE POLICY "Request paint read request roles" ON public."request_paint"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND ((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')))));

DROP POLICY IF EXISTS "Request paint update request roles" ON public."request_paint";
CREATE POLICY "Request paint update request roles" ON public."request_paint"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))))
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_paint";
CREATE POLICY "financial_supply_item_visibility" ON public."request_paint"
AS RESTRICTIVE FOR ALL TO authenticated
USING ((fn_financial_supply_visibility(request_id)))
WITH CHECK ((fn_financial_supply_visibility(request_id)));

DROP POLICY IF EXISTS "Request pipe delete request roles" ON public."request_pipe";
CREATE POLICY "Request pipe delete request roles" ON public."request_pipe"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND (((private.crm_has_permission('technologist_requests', 'manage')) AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_pipe.request_id) AND (NOT request.is_recalculation_staging))))))));

DROP POLICY IF EXISTS "Request pipe insert request roles" ON public."request_pipe";
CREATE POLICY "Request pipe insert request roles" ON public."request_pipe"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND (((private.crm_has_permission('technologist_requests', 'manage')) AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_pipe.request_id) AND (NOT request.is_recalculation_staging))))))));

DROP POLICY IF EXISTS "Request pipe read request roles" ON public."request_pipe";
CREATE POLICY "Request pipe read request roles" ON public."request_pipe"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND (((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_pipe.request_id) AND (NOT request.is_recalculation_staging))))))));

DROP POLICY IF EXISTS "Request pipe update request roles" ON public."request_pipe";
CREATE POLICY "Request pipe update request roles" ON public."request_pipe"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND (((private.crm_has_permission('technologist_requests', 'manage')) AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_pipe.request_id) AND (NOT request.is_recalculation_staging))))))))
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND (((private.crm_has_permission('technologist_requests', 'manage')) AND (EXISTS ( SELECT 1
   FROM technologist_requests request
  WHERE ((request.id = request_pipe.request_id) AND (NOT request.is_recalculation_staging))))))));

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_pipe";
CREATE POLICY "financial_supply_item_visibility" ON public."request_pipe"
AS RESTRICTIVE FOR ALL TO authenticated
USING ((fn_financial_supply_visibility(request_id)))
WITH CHECK ((fn_financial_supply_visibility(request_id)));

DROP POLICY IF EXISTS "Request round tube delete request roles" ON public."request_round_tube";
CREATE POLICY "Request round tube delete request roles" ON public."request_round_tube"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "Request round tube insert request roles" ON public."request_round_tube";
CREATE POLICY "Request round tube insert request roles" ON public."request_round_tube"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "Request round tube read request roles" ON public."request_round_tube";
CREATE POLICY "Request round tube read request roles" ON public."request_round_tube"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND ((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')))));

DROP POLICY IF EXISTS "Request round tube update request roles" ON public."request_round_tube";
CREATE POLICY "Request round tube update request roles" ON public."request_round_tube"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))))
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_round_tube";
CREATE POLICY "financial_supply_item_visibility" ON public."request_round_tube"
AS RESTRICTIVE FOR ALL TO authenticated
USING ((fn_financial_supply_visibility(request_id)))
WITH CHECK ((fn_financial_supply_visibility(request_id)));

DROP POLICY IF EXISTS "Request sheet metal delete request roles" ON public."request_sheet_metal";
CREATE POLICY "Request sheet metal delete request roles" ON public."request_sheet_metal"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "Request sheet metal insert request roles" ON public."request_sheet_metal";
CREATE POLICY "Request sheet metal insert request roles" ON public."request_sheet_metal"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "Request sheet metal read request roles" ON public."request_sheet_metal";
CREATE POLICY "Request sheet metal read request roles" ON public."request_sheet_metal"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND ((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')))));

DROP POLICY IF EXISTS "Request sheet metal update request roles" ON public."request_sheet_metal";
CREATE POLICY "Request sheet metal update request roles" ON public."request_sheet_metal"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))))
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND ((private.crm_has_permission('technologist_requests', 'manage')))));

DROP POLICY IF EXISTS "financial_supply_item_visibility" ON public."request_sheet_metal";
CREATE POLICY "financial_supply_item_visibility" ON public."request_sheet_metal"
AS RESTRICTIVE FOR ALL TO authenticated
USING ((fn_financial_supply_visibility(request_id)))
WITH CHECK ((fn_financial_supply_visibility(request_id)));

DROP POLICY IF EXISTS "role_permission_audit_insert_directors" ON public."role_permission_audit_log";
CREATE POLICY "role_permission_audit_insert_directors" ON public."role_permission_audit_log"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('access_settings', 'manage')) AND ((private.crm_has_permission('access_settings', 'manage')))));

DROP POLICY IF EXISTS "role_permission_audit_select_directors" ON public."role_permission_audit_log";
CREATE POLICY "role_permission_audit_select_directors" ON public."role_permission_audit_log"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('access_settings', 'view')) AND ((private.crm_has_permission('access_settings', 'view')))));

DROP POLICY IF EXISTS "role_permissions_modify_directors" ON public."role_permissions";
CREATE POLICY "role_permissions_modify_directors" ON public."role_permissions"
FOR ALL TO authenticated
USING (((private.crm_has_permission('access_settings', 'manage')) AND ((private.crm_has_permission('access_settings', 'manage')))))
WITH CHECK (((private.crm_has_permission('access_settings', 'manage')) AND ((private.crm_has_permission('access_settings', 'manage')))));

DROP POLICY IF EXISTS "role_permissions_select_authenticated" ON public."role_permissions";
CREATE POLICY "role_permissions_select_authenticated" ON public."role_permissions"
FOR SELECT TO authenticated
USING ((private.crm_has_permission('access_settings', 'view')));

DROP POLICY IF EXISTS "Steel types delete directors" ON public."steel_types";
CREATE POLICY "Steel types delete directors" ON public."steel_types"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('materials', 'manage') OR private.crm_has_permission('nesting_catalog', 'manage')) AND ((private.crm_has_permission('materials', 'manage') OR private.crm_has_permission('nesting_catalog', 'manage')))));

DROP POLICY IF EXISTS "Steel types insert nesting roles" ON public."steel_types";
CREATE POLICY "Steel types insert nesting roles" ON public."steel_types"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('materials', 'manage') OR private.crm_has_permission('nesting_catalog', 'manage')) AND (((private.crm_has_permission('materials', 'manage') OR private.crm_has_permission('nesting_catalog', 'manage')) OR (private.crm_has_permission('materials', 'manage') OR private.crm_has_permission('nesting_catalog', 'manage'))))));

DROP POLICY IF EXISTS "Steel types read nesting roles" ON public."steel_types";
CREATE POLICY "Steel types read nesting roles" ON public."steel_types"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('materials', 'view') OR private.crm_has_permission('nesting_catalog', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND (((private.crm_has_permission('materials', 'view') OR private.crm_has_permission('nesting_catalog', 'view') OR private.crm_has_permission('supply_orders', 'view')) OR (private.crm_has_permission('materials', 'view') OR private.crm_has_permission('nesting_catalog', 'view') OR private.crm_has_permission('supply_orders', 'view'))))));

DROP POLICY IF EXISTS "Steel types update nesting roles" ON public."steel_types";
CREATE POLICY "Steel types update nesting roles" ON public."steel_types"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('materials', 'manage') OR private.crm_has_permission('nesting_catalog', 'manage')) AND (((private.crm_has_permission('materials', 'manage') OR private.crm_has_permission('nesting_catalog', 'manage')) OR (private.crm_has_permission('materials', 'manage') OR private.crm_has_permission('nesting_catalog', 'manage'))))))
WITH CHECK (((private.crm_has_permission('materials', 'manage') OR private.crm_has_permission('nesting_catalog', 'manage')) AND (((private.crm_has_permission('materials', 'manage') OR private.crm_has_permission('nesting_catalog', 'manage')) OR (private.crm_has_permission('materials', 'manage') OR private.crm_has_permission('nesting_catalog', 'manage'))))));

DROP POLICY IF EXISTS "Supplier delivery days delete directors" ON public."supplier_delivery_days";
CREATE POLICY "Supplier delivery days delete directors" ON public."supplier_delivery_days"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('suppliers', 'manage')) AND ((private.crm_has_permission('suppliers', 'manage')))));

DROP POLICY IF EXISTS "Supplier delivery days insert directors" ON public."supplier_delivery_days";
CREATE POLICY "Supplier delivery days insert directors" ON public."supplier_delivery_days"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('suppliers', 'manage')) AND ((private.crm_has_permission('suppliers', 'manage')))));

DROP POLICY IF EXISTS "Supplier delivery days read supply roles" ON public."supplier_delivery_days";
CREATE POLICY "Supplier delivery days read supply roles" ON public."supplier_delivery_days"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('suppliers', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND ((private.crm_has_permission('suppliers', 'view') OR private.crm_has_permission('supply_orders', 'view')))));

DROP POLICY IF EXISTS "Supplier delivery days update directors" ON public."supplier_delivery_days";
CREATE POLICY "Supplier delivery days update directors" ON public."supplier_delivery_days"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('suppliers', 'manage')) AND ((private.crm_has_permission('suppliers', 'manage')))))
WITH CHECK (((private.crm_has_permission('suppliers', 'manage')) AND ((private.crm_has_permission('suppliers', 'manage')))));

DROP POLICY IF EXISTS "Supplier categories delete directors" ON public."supplier_material_categories";
CREATE POLICY "Supplier categories delete directors" ON public."supplier_material_categories"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('suppliers', 'manage')) AND ((private.crm_has_permission('suppliers', 'manage')))));

DROP POLICY IF EXISTS "Supplier categories insert directors" ON public."supplier_material_categories";
CREATE POLICY "Supplier categories insert directors" ON public."supplier_material_categories"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('suppliers', 'manage')) AND ((private.crm_has_permission('suppliers', 'manage')))));

DROP POLICY IF EXISTS "Supplier categories read supply roles" ON public."supplier_material_categories";
CREATE POLICY "Supplier categories read supply roles" ON public."supplier_material_categories"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('suppliers', 'view')) AND ((private.crm_has_permission('suppliers', 'view')))));

DROP POLICY IF EXISTS "Supplier categories update directors" ON public."supplier_material_categories";
CREATE POLICY "Supplier categories update directors" ON public."supplier_material_categories"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('suppliers', 'manage')) AND ((private.crm_has_permission('suppliers', 'manage')))))
WITH CHECK (((private.crm_has_permission('suppliers', 'manage')) AND ((private.crm_has_permission('suppliers', 'manage')))));

DROP POLICY IF EXISTS "Suppliers insert directors" ON public."suppliers";
CREATE POLICY "Suppliers insert directors" ON public."suppliers"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('suppliers', 'manage')) AND ((private.crm_has_permission('suppliers', 'manage')))));

DROP POLICY IF EXISTS "Suppliers read supply roles" ON public."suppliers";
CREATE POLICY "Suppliers read supply roles" ON public."suppliers"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('suppliers', 'view') OR private.crm_has_permission('supply_orders', 'view') OR private.crm_has_permission('inventory', 'view')) AND ((private.crm_has_permission('suppliers', 'view') OR private.crm_has_permission('supply_orders', 'view') OR private.crm_has_permission('inventory', 'view')))));

DROP POLICY IF EXISTS "Suppliers update directors" ON public."suppliers";
CREATE POLICY "Suppliers update directors" ON public."suppliers"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('suppliers', 'manage')) AND ((private.crm_has_permission('suppliers', 'manage')))))
WITH CHECK (((private.crm_has_permission('suppliers', 'manage')) AND ((private.crm_has_permission('suppliers', 'manage')))));

DROP POLICY IF EXISTS "Supply Items - Insert staff" ON public."supply_items";
CREATE POLICY "Supply Items - Insert staff" ON public."supply_items"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('supply', 'manage') OR private.crm_has_permission('supply_material_requests', 'manage')) AND (((private.crm_has_permission('supply', 'manage') OR private.crm_has_permission('supply_material_requests', 'manage'))))));

DROP POLICY IF EXISTS "Supply Items - Update staff" ON public."supply_items";
CREATE POLICY "Supply Items - Update staff" ON public."supply_items"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('supply', 'manage') OR private.crm_has_permission('supply_material_requests', 'manage')) AND (((private.crm_has_permission('supply', 'manage') OR private.crm_has_permission('supply_material_requests', 'manage'))))));

DROP POLICY IF EXISTS "supply_items_select" ON public."supply_items";
CREATE POLICY "supply_items_select" ON public."supply_items"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('supply', 'view') OR private.crm_has_permission('sales_plan', 'view') OR private.crm_has_permission('production', 'view')) AND ((EXISTS ( SELECT 1
   FROM machines m
  WHERE ((m.id = supply_items.machine_id) AND
        true))))));

DROP POLICY IF EXISTS "Supply schedule changes insert supply roles" ON public."supply_order_delivery_schedule_changes";
CREATE POLICY "Supply schedule changes insert supply roles" ON public."supply_order_delivery_schedule_changes"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('supply_orders', 'manage')) AND ((private.crm_has_permission('supply_orders', 'manage')))));

DROP POLICY IF EXISTS "Supply schedule changes read supply roles" ON public."supply_order_delivery_schedule_changes";
CREATE POLICY "Supply schedule changes read supply roles" ON public."supply_order_delivery_schedule_changes"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('supply_orders', 'view')) AND ((private.crm_has_permission('supply_orders', 'view')))));

DROP POLICY IF EXISTS "Supply schedules insert supply roles" ON public."supply_order_delivery_schedules";
CREATE POLICY "Supply schedules insert supply roles" ON public."supply_order_delivery_schedules"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('supply_orders', 'manage')) AND ((private.crm_has_permission('supply_orders', 'manage')))));

DROP POLICY IF EXISTS "Supply schedules read supply roles" ON public."supply_order_delivery_schedules";
CREATE POLICY "Supply schedules read supply roles" ON public."supply_order_delivery_schedules"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('supply_orders', 'view')) AND ((private.crm_has_permission('supply_orders', 'view')))));

DROP POLICY IF EXISTS "Supply schedules update supply roles" ON public."supply_order_delivery_schedules";
CREATE POLICY "Supply schedules update supply roles" ON public."supply_order_delivery_schedules"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('supply_orders', 'manage')) AND ((private.crm_has_permission('supply_orders', 'manage')))))
WITH CHECK (((private.crm_has_permission('supply_orders', 'manage')) AND ((private.crm_has_permission('supply_orders', 'manage')))));

DROP POLICY IF EXISTS "supply_position_revisions_select" ON public."supply_position_revisions";
CREATE POLICY "supply_position_revisions_select" ON public."supply_position_revisions"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('technologist_request_results', 'view') OR private.crm_has_permission('supply_material_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND (((requested_by = ( SELECT auth.uid() AS uid)) OR (assigned_to = ( SELECT auth.uid() AS uid)) OR (private.crm_has_permission('technologist_request_results', 'view') OR private.crm_has_permission('supply_material_requests', 'view') OR private.crm_has_permission('supply_orders', 'view'))))));

DROP POLICY IF EXISTS "task_delegations_select_involved" ON public."task_delegations";
CREATE POLICY "task_delegations_select_involved" ON public."task_delegations"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('tasks', 'view')) AND (((delegated_by = auth.uid()) OR (delegated_from = auth.uid()) OR (delegated_to = auth.uid()) OR (EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  ))))));

DROP POLICY IF EXISTS "Tasks insert own or directors" ON public."tasks";
CREATE POLICY "Tasks insert own or directors" ON public."tasks"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('tasks', 'manage')) AND (((assigned_to = auth.uid()) OR (EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  ))))));

DROP POLICY IF EXISTS "Tasks read app roles" ON public."tasks";
CREATE POLICY "Tasks read app roles" ON public."tasks"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('tasks', 'view')) AND ((private.crm_has_permission('tasks', 'view')))));

DROP POLICY IF EXISTS "Tasks update own or directors" ON public."tasks";
CREATE POLICY "Tasks update own or directors" ON public."tasks"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('tasks', 'manage')) AND (((assigned_to = auth.uid()) OR (EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  ))))))
WITH CHECK (((private.crm_has_permission('tasks', 'manage')) AND (((assigned_to = auth.uid()) OR (EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  ))))));

DROP POLICY IF EXISTS "Technologist requests insert request roles" ON public."technologist_requests";
CREATE POLICY "Technologist requests insert request roles" ON public."technologist_requests"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND (((NOT is_recalculation_staging) AND (private.crm_has_permission('technologist_requests', 'manage'))))));

DROP POLICY IF EXISTS "Technologist requests read request roles" ON public."technologist_requests";
CREATE POLICY "Technologist requests read request roles" ON public."technologist_requests"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view')) AND (((NOT is_recalculation_staging) AND (private.crm_has_permission('technologist_requests', 'view') OR private.crm_has_permission('supply_orders', 'view'))))));

DROP POLICY IF EXISTS "Technologist requests update request roles" ON public."technologist_requests";
CREATE POLICY "Technologist requests update request roles" ON public."technologist_requests"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('technologist_requests', 'manage')) AND (((NOT is_recalculation_staging) AND (private.crm_has_permission('technologist_requests', 'manage'))))))
WITH CHECK (((private.crm_has_permission('technologist_requests', 'manage')) AND (((NOT is_recalculation_staging) AND (private.crm_has_permission('technologist_requests', 'manage'))))));

DROP POLICY IF EXISTS "financial_request_insert_state" ON public."technologist_requests";
CREATE POLICY "financial_request_insert_state" ON public."technologist_requests"
AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK ((((status)::text <> ALL (ARRAY['pending_financial_approval'::text, 'submitted_to_supply'::text, 'completed'::text]))));

DROP POLICY IF EXISTS "financial_supply_request_visibility" ON public."technologist_requests";
CREATE POLICY "financial_supply_request_visibility" ON public."technologist_requests"
AS RESTRICTIVE FOR SELECT TO authenticated
USING ((fn_financial_supply_visibility(id)));

DROP POLICY IF EXISTS "transport_trip_date_items_select" ON public."transport_trip_date_change_items";
CREATE POLICY "transport_trip_date_items_select" ON public."transport_trip_date_change_items"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('supply_transport', 'view')) AND ((EXISTS ( SELECT 1
   FROM transport_trip_date_change_requests r
  WHERE ((r.id = transport_trip_date_change_items.request_id) AND ((r.requested_by = auth.uid()) OR (EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR (EXISTS ( SELECT 1
           FROM tasks t
          WHERE ((t.id = r.task_id) AND (t.assigned_to = auth.uid())))))))))));

DROP POLICY IF EXISTS "transport_trip_date_requests_select" ON public."transport_trip_date_change_requests";
CREATE POLICY "transport_trip_date_requests_select" ON public."transport_trip_date_change_requests"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('supply_transport', 'view')) AND (((requested_by = auth.uid()) OR (EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) OR (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = transport_trip_date_change_requests.task_id) AND (t.assigned_to = auth.uid()))))))));

DROP POLICY IF EXISTS "transport_trip_need_links_select" ON public."transport_trip_need_links";
CREATE POLICY "transport_trip_need_links_select" ON public."transport_trip_need_links"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('supply_transport', 'view')) AND ((( SELECT (EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) AS is_director) OR ((private.crm_has_permission('supply_transport', 'view')))))));

DROP POLICY IF EXISTS "transport_trip_stops_select" ON public."transport_trip_stops";
CREATE POLICY "transport_trip_stops_select" ON public."transport_trip_stops"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('supply_transport', 'view')) AND ((( SELECT (EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  )) AS is_director) OR ((private.crm_has_permission('supply_transport', 'view')))))));

DROP POLICY IF EXISTS "technologist_request_approval_versions_select" ON public."technologist_request_approval_versions";
CREATE POLICY "technologist_request_approval_versions_select" ON public."technologist_request_approval_versions"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('technologist_request_results', 'view')) AND ((submitted_by = auth.uid() OR private.crm_has_permission('technologist_request_results', 'manage')))));

DROP POLICY IF EXISTS "Users - Delete planning_director" ON public."users";
CREATE POLICY "Users - Delete planning_director" ON public."users"
FOR DELETE TO authenticated
USING (((private.crm_has_permission('admin_users', 'manage')) AND (((private.crm_has_permission('admin_users', 'manage'))))));

DROP POLICY IF EXISTS "Users - Insert planning_director" ON public."users";
CREATE POLICY "Users - Insert planning_director" ON public."users"
FOR INSERT TO authenticated
WITH CHECK (((private.crm_has_permission('admin_users', 'manage')) AND (((private.crm_has_permission('admin_users', 'manage'))))));

DROP POLICY IF EXISTS "Users - Update planning_director" ON public."users";
CREATE POLICY "Users - Update planning_director" ON public."users"
FOR UPDATE TO authenticated
USING (((private.crm_has_permission('admin_users', 'manage')) AND (((private.crm_has_permission('admin_users', 'manage'))))));

DROP POLICY IF EXISTS "users_select" ON public."users";
CREATE POLICY "users_select" ON public."users"
FOR SELECT TO authenticated
USING (((private.crm_has_permission('departments', 'view') OR private.crm_has_permission('admin_users', 'view')) AND ((((private.crm_has_permission('departments', 'view') OR private.crm_has_permission('admin_users', 'view'))) OR (id = auth.uid()) OR ((factory_id IS NOT NULL) AND (factory_id = get_user_factory_id()))))));


-- snapshot-sha256: cecf8e44145872742dd3ec36921d2aec2530af4d5649031b62daa27fd2cd1726
-- manifest-sha256: 71deefc9b21c28be7a4b97a38eec28b08b7d8f293a1960b042e5f7e8eb60d359
DO $invariants$
DECLARE
  v_legacy_policy_count integer;
  v_legacy_runtime_function_count integer;
  v_matrix_rows integer;
  v_resource_count integer;
BEGIN
  SELECT count(*) INTO v_legacy_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      COALESCE(qual, '') || ' ' || COALESCE(with_check, '')
    ) ~* '(get_user_role\s*\(|is_director\s*\(|security_has_role\s*\(|security_can_|role_permissions|\.role[[:space:]]*(=|<>|IN|=[[:space:]]*ANY))';
  IF v_legacy_policy_count <> 0 THEN
    RAISE EXCEPTION 'Cutover left % legacy authorization policies', v_legacy_policy_count;
  END IF;

  SELECT count(DISTINCT resource_key), count(*)
    INTO v_resource_count, v_matrix_rows
  FROM public.department_access_permissions;
  IF v_resource_count <> 64 THEN
    RAISE EXCEPTION 'Expected 64 matrix resources, found %', v_resource_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.department_access_permissions
    WHERE can_manage AND NOT can_view
  ) THEN
    RAISE EXCEPTION 'Matrix invariant failed: manage without view';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname IN ('public', 'private')
      AND procedure.prokind IN ('f', 'p')
      AND procedure.prosecdef
      AND has_function_privilege('anon', procedure.oid, 'EXECUTE')
      AND procedure.prosrc ~* '(users\.role|role_permissions|get_user_role\s*\(|is_director\s*\(|security_can_)'
  ) THEN
    RAISE EXCEPTION 'Anon can execute a SECURITY DEFINER function with legacy authorization';
  END IF;
  SELECT count(*) INTO v_legacy_runtime_function_count
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.prokind IN ('f', 'p')
    AND has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    AND procedure.proname <> ALL (ARRAY[
      'fn_notify_confirmation_change',
      'fn_notify_new_machine',
      'fn_approve_technologist_request',
      'fn_submit_technologist_request_for_approval',
      'fn_receive_supply_order_schedule_batch_v1',
      'fn_receive_supply_order_schedule_v2',
      'notify_production_managers_for_machine',
      'notify_users_by_role',
      'notify_users_by_role_in_factory',
      'resolve_machine_supply_task_assignee'
    ])
    AND procedure.prosrc ~* '(users\.role|role_permissions|get_user_role\s*\(|is_director\s*\(|security_can_|security_has_role\s*\()';
  IF v_legacy_runtime_function_count <> 0 THEN
    RAISE EXCEPTION 'Cutover left % authenticated legacy authorization functions', v_legacy_runtime_function_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'machines_with_totals'
      AND column_name = 'creation_year'
  ) THEN
    RAISE EXCEPTION 'machines_with_totals is missing creation_year';
  END IF;
END;
$invariants$;

COMMIT;
