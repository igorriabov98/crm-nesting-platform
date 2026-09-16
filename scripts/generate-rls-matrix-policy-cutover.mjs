import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const migrationPath = join(root, 'supabase/migrations/20260916090000_department_rls_matrix_cutover.sql')
const marker = '-- Remaining policy/RPC replacements and the transactional invariants are\n-- generated below from the checked-in production catalog snapshot.'
const lockStart = '-- generated-cutover-locks:start'
const lockEnd = '-- generated-cutover-locks:end'
let migration = readFileSync(migrationPath, 'utf8')

const manifest = JSON.parse(readFileSync(join(root, 'config/rls-resource-manifest.json'), 'utf8'))
const snapshot = JSON.parse(readFileSync(join(root, 'supabase/reports/rls_dependency_affected_tables_policy_snapshot.json'), 'utf8'))
const legacyFunctions = JSON.parse(readFileSync(join(root, 'supabase/reports/rls_legacy_function_snapshot.json'), 'utf8'))

const quoteIdent = (value) => `"${String(value).replaceAll('"', '""')}"`
const quoteLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`
const tables = Object.keys(manifest.tables).sort()
const lockSql = `DO $locks$\nDECLARE v_table text;\nBEGIN\n  FOREACH v_table IN ARRAY ARRAY[\n${tables.map((table) => `    ${quoteLiteral(table)}`).join(',\n')}\n  ] LOOP\n    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', v_table);\n  END LOOP;\nEND;\n$locks$;`
const lockStartIndex = migration.indexOf(lockStart)
const lockEndIndex = migration.indexOf(lockEnd)
if (lockStartIndex < 0 || lockEndIndex < lockStartIndex) throw new Error('Migration lock generator markers not found')
migration = `${migration.slice(0, lockStartIndex)}${lockStart}\n${lockSql}\n${lockEnd}${migration.slice(lockEndIndex + lockEnd.length)}`
const markerIndex = migration.indexOf(marker)
if (markerIndex < 0) throw new Error('Migration generator marker not found')
const COMPANY_SCOPED_RESOURCES = new Set([
  'my_orders',
  'client_identity',
  'client_prices',
  'invoices',
  'client_payments',
])

function rolesSql(roles) {
  const values = roles.slice(1, -1).split(',').filter(Boolean)
  if (values.includes('service_role')) return 'service_role'
  return 'authenticated'
}

function inferScopedColumn(expression, column, table, allowQualifiedAlias = false) {
  const matches = [...String(expression || '').matchAll(
    new RegExp(`(?<![a-z0-9_.])(?:[a-z_][a-z0-9_]*\\.)?${column}(?![a-z0-9_])`, 'gi'),
  )]
  return matches
    .map((match) => match[0])
    .find((value) => {
      if (value.startsWith('p_')) return false
      if (!value.includes('.')) return true
      const qualifier = value.slice(0, value.indexOf('.'))
      return qualifier === table || allowQualifiedAlias
    }) || null
}

function basePermission(mapping, operation) {
  const resources = mapping[operation] || []
  return resources
    .map((resource) => `private.crm_has_permission(${quoteLiteral(resource)}, ${quoteLiteral(operation)})`)
    .join(' OR ')
}

function scopedPermission(table, mapping, operation, expression, allowQualifiedAlias = false) {
  const base = basePermission(mapping, operation)
  if (mapping.scope === 'factory') {
    const factory = inferScopedColumn(expression, 'factory_id', table, allowQualifiedAlias)
    return factory
      ? mapping[operation].map((resource) =>
        `private.crm_has_factory_permission(${quoteLiteral(resource)}, ${quoteLiteral(operation)}, ${factory})`).join(' OR ')
      : base
  }
  if (mapping.scope === 'company') {
    const client = inferScopedColumn(expression, 'client_id', table, allowQualifiedAlias)
    return client
      ? mapping[operation].map((resource) => COMPANY_SCOPED_RESOURCES.has(resource)
        ? `private.crm_has_company_permission(${quoteLiteral(resource)}, ${quoteLiteral(operation)}, ${client})`
        : `private.crm_has_permission(${quoteLiteral(resource)}, ${quoteLiteral(operation)})`).join(' OR ')
      : base
  }
  return base
}

function replaceRoleChecks(expression, table, mapping, operation) {
  if (!expression) return null
  const viewPermission = `(${basePermission(mapping, 'view')})`
  const managePermission = `(${basePermission(mapping, 'manage')})`
  const operationPermission = operation === 'view' ? viewPermission : managePermission
  const adminPosition = `(EXISTS (
    SELECT 1
    FROM public.department_members AS crm_admin_member
    JOIN public.positions AS crm_admin_position ON crm_admin_position.id = crm_admin_member.position_id
    WHERE crm_admin_member.user_id = auth.uid()
      AND crm_admin_position.is_active IS TRUE
      AND crm_admin_position.name = 'Администратор CRM'
  ))`
  const pureDirectorGate = /^\(*\s*(?:SELECT\s+)?(?:public\.)?is_director\(\)(?:\s+AS\s+is_director)?\s*\)*$/i.test(expression.trim())
  const hasFactoryParentScope = ['employee_assignments', 'employee_rates', 'employee_vacations',
    'machine_outsourcing_operation_items', 'machine_outsourcing_operations',
    'machine_outsourcing_transport_needs', 'machine_outsourcing_vrb_items',
    'production_machine_item_facts'].includes(table)
  const directorReplacement = mapping.scope.startsWith('factory') || hasFactoryParentScope || pureDirectorGate
    ? operationPermission
    : adminPosition
  let value = expression

  // Old role-sensitive CASE branches are superseded by the scoped matrix
  // predicate that is added outside the preserved row/lifecycle expression.
  value = value.replace(/CASE\s+WHEN\s+\([^)]*get_user_role\(\)[\s\S]*?ELSE\s+true\s+END/gi, 'true')
  value = value.replace(/CASE\s+public\.get_user_role\(\)[\s\S]*?END/gi, operationPermission)

  value = value.replace(/(?:public\.)?is_director\(\)/gi, directorReplacement)
  value = value.replace(/(?:public\.)?security_has_role\(ARRAY\[[\s\S]*?\]\)/gi, operationPermission)
  value = value.replace(/(?:public\.)?detailing_role_allowed\(ARRAY\[[\s\S]*?\]\)/gi, viewPermission)
  value = value.replace(/(?:public\.)?inventory_transfer_role_allowed\(ARRAY\[[\s\S]*?\]\)/gi, viewPermission)
  // The enclosing policy command is authoritative. A legacy helper named
  // `security_can_manage_*` inside a SELECT policy was historically also used
  // as its read gate; carrying the helper name across as `manage` would make
  // view-only matrix permissions return an empty result set.
  value = value.replace(/(?:public\.)?security_can_manage_catalog\(\)/gi, operationPermission)
  value = value.replace(/(?:public\.)?security_can_manage_nesting_catalog\(\)/gi, operationPermission)
  value = value.replace(/(?:public\.)?security_can_view_request_materials\(\)/gi, operationPermission)
  value = value.replace(/(?:public\.)?security_can_manage_request_materials\(\)/gi, operationPermission)
  value = value.replace(/(?:public\.)?security_can_manage_supply\(\)/gi, operationPermission)

  // The legacy finance policies granted a special path to the
  // `supply_manager` business label. That label is routing metadata after the
  // cutover, so preserve the intent through the dedicated matrix resource.
  value = value.replace(
    /\(?EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+(?:public\.)?users\s+u\s+WHERE\s*\(\(u\.id\s*=\s*auth\.uid\(\)\)\s+AND\s+\(u\.role\s*=\s*'supply_manager'::(?:public\.)?user_role\)\)\s*\)\)?/gi,
    `(private.crm_has_permission('supply_finance', '${operation}'))`,
  )

  const selectedRole = String.raw`(?:\(\s*SELECT\s+)?(?:public\.)?get_user_role\(\)(?:\s+AS\s+get_user_role\s*\))?`
  value = value.replace(new RegExp(`${selectedRole}\\s*=\\s*ANY\\s*\\(ARRAY\\[[\\s\\S]*?\\]\\)`, 'gi'), operationPermission)
  value = value.replace(new RegExp(`${selectedRole}\\s*(?:=|<>)\\s*'[^']+'::(?:public\\.)?user_role`, 'gi'), operationPermission)
  value = value.replace(new RegExp(`'[^']+'::(?:public\\.)?user_role\\s*(?:=|<>)\\s*${selectedRole}`, 'gi'), operationPermission)

  value = value.replace(
    /(?:public\.)?crm_user_has_resource_permission\([^,]+,\s*'([^']+)'::text,\s*(true|false)\)/gi,
    (_match, resource, manage) => `private.crm_has_permission(${quoteLiteral(resource)}, ${quoteLiteral(manage === 'true' ? 'manage' : 'view')})`,
  )
  return value
}

function parentScopePredicate(table, mapping, operation) {
  const resourcePredicate = (factoryExpression) => mapping[operation]
    .map((resource) =>
      `private.crm_has_factory_permission(${quoteLiteral(resource)}, ${quoteLiteral(operation)}, ${factoryExpression})`)
    .join(' OR ')

  if (['employee_assignments', 'employee_rates', 'employee_vacations'].includes(table)) {
    return `EXISTS (
      SELECT 1 FROM public.employees AS scope_employee
      WHERE scope_employee.id = ${quoteIdent(table)}.employee_id
        AND (${resourcePredicate('scope_employee.factory_id')})
    )`
  }
  if (table === 'production_machine_item_facts') {
    return `EXISTS (
      SELECT 1 FROM public.production_machine_facts AS scope_fact
      WHERE scope_fact.id = production_machine_item_facts.production_machine_fact_id
        AND (${resourcePredicate('scope_fact.factory_id')})
    )`
  }
  if (table === 'machine_outsourcing_operations') {
    return `EXISTS (
      SELECT 1 FROM public.machines AS scope_machine
      WHERE scope_machine.id = machine_outsourcing_operations.machine_id
        AND (${resourcePredicate('scope_machine.factory_id')})
    )`
  }
  if (['machine_outsourcing_operation_items', 'machine_outsourcing_transport_needs', 'machine_outsourcing_vrb_items'].includes(table)) {
    const foreignKey = table === 'machine_outsourcing_operation_items'
      ? 'operation_id'
      : table === 'machine_outsourcing_transport_needs'
        ? 'operation_id'
        : 'operation_id'
    return `EXISTS (
      SELECT 1
      FROM public.machine_outsourcing_operations AS scope_operation
      JOIN public.machines AS scope_machine ON scope_machine.id = scope_operation.machine_id
      WHERE scope_operation.id = ${quoteIdent(table)}.${foreignKey}
        AND (${resourcePredicate('scope_machine.factory_id')})
    )`
  }
  return null
}

function overrideExpression(policy, expression) {
  if (!expression) return expression
  if (policy.tablename === 'machines' && policy.policyname === 'machines_select') {
    return `
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
      )`
  }
  if (policy.tablename === 'technologist_request_approval_versions' && policy.policyname === 'technologist_request_approval_versions_select') {
    return `(submitted_by = auth.uid() OR private.crm_has_permission('technologist_request_results', 'manage'))`
  }
  if (policy.tablename === 'mail_messages' && policy.policyname === 'mail_messages_owner_or_crm_reader') {
    return `
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
      )`
  }
  if (policy.tablename === 'mail_threads' && policy.policyname === 'mail_threads_owner_or_crm_reader') {
    return `
      EXISTS (SELECT 1 FROM public.mail_accounts account WHERE account.id = mail_threads.account_id AND account.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.product_project_mail_threads link WHERE link.thread_id = mail_threads.id AND link.unlinked_at IS NULL AND private.crm_has_permission('product_projects', 'view'))
      OR EXISTS (
        SELECT 1 FROM public.department_request_mail_threads link
        JOIN public.department_requests request ON request.id = link.department_request_id
        WHERE link.thread_id = mail_threads.id AND link.unlinked_at IS NULL
          AND (request.created_by = auth.uid() OR public.can_manage_department_request_target(request.target_department, request.factory_id))
      )`
  }
  return expression
}

function policySql(policy) {
  if (rolesSql(policy.roles) === 'service_role') return ''
  const mapping = manifest.tables[policy.tablename]
  if (!mapping) throw new Error(`Missing manifest mapping for ${policy.tablename}`)
  const operation = policy.cmd === 'SELECT' ? 'view' : 'manage'
  const original = `${policy.qual || ''}\n${policy.with_check || ''}`
  const gate = scopedPermission(policy.tablename, mapping, operation, original)
  if (!gate) throw new Error(`Missing ${operation} resource for ${policy.tablename}`)

  const isRestrictive = policy.permissive === 'RESTRICTIVE'
  const transform = (expression) => {
    // Restrictive policies only narrow rows that a permissive policy already
    // granted. Adding another resource gate here turns lifecycle guards into
    // accidental deny rules for consumers such as supply_orders/view.
    if (isRestrictive) {
      if (!expression || /^true$/i.test(expression.trim())) return 'true'
      const overridden = overrideExpression(policy, expression)
      return `(${replaceRoleChecks(overridden, policy.tablename, mapping, operation)})`
    }
    if (!expression || /^true$/i.test(expression.trim())) return `(${gate})`
    const overridden = overrideExpression(policy, expression)
    const preserved = replaceRoleChecks(overridden, policy.tablename, mapping, operation)
    const parentScope = parentScopePredicate(policy.tablename, mapping, operation)
    return `((${gate}) AND (${preserved})${parentScope ? ` AND (${parentScope})` : ''})`
  }

  const command = policy.cmd === 'ALL' ? 'ALL' : policy.cmd
  const permissive = isRestrictive ? 'AS RESTRICTIVE ' : ''
  const using = policy.qual ? `\nUSING (${transform(policy.qual)})` : ''
  const check = policy.with_check ? `\nWITH CHECK (${transform(policy.with_check)})` : ''
  return `DROP POLICY IF EXISTS ${quoteIdent(policy.policyname)} ON public.${quoteIdent(policy.tablename)};\nCREATE POLICY ${quoteIdent(policy.policyname)} ON public.${quoteIdent(policy.tablename)}\n${permissive}FOR ${command} TO authenticated${using}${check};\n`
}

function matrixPeopleFunctionSql(entry) {
  const operation = /(?:planning_period|vacations_period)/.test(entry.function_name) ? 'view' : 'manage'
  let definition = entry.definition
    .replace(/SET search_path TO 'public', 'pg_temp'/gi, "SET search_path TO ''")
    .replace(/\n\s*v_role public\.user_role;/g, '')
    .replace(/\n\s*v_actor_factory uuid;/g, '')
    .replace(/\n\s*v_role := public\.get_user_role\(\);/g, '')
    .replace(/\n\s*v_actor_factory := public\.get_user_factory_id\(\);/g, '')
    .replace(
      /\n\s*IF v_role IS NULL OR v_role NOT IN \([\s\S]*?\) THEN\s*RAISE EXCEPTION 'People planning access denied';\s*END IF;/gi,
      `\n  IF NOT private.crm_has_permission('people_planning', '${operation}') THEN\n    RAISE EXCEPTION 'People planning access denied' USING ERRCODE = '42501';\n  END IF;`,
    )
    .replace(
      /\n\s*IF v_role = 'production_manager'::public\.user_role[\s\S]*?THEN\s*RAISE EXCEPTION '[^']+';\s*END IF;/gi,
      '',
    )
  if (/get_user_role\s*\(|\bv_role\b|\bv_actor_factory\b/i.test(definition)) {
    throw new Error(`Could not remove legacy people authorization from ${entry.function_name}`)
  }
  const cleanDefinition = definition.replace(/[ \t]+$/gm, '').trim()
  return `${cleanDefinition};\n\nREVOKE ALL ON FUNCTION public.${entry.function_name}(${entry.identity_arguments}) FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public.${entry.function_name}(${entry.identity_arguments}) TO authenticated, service_role;`
}

const peopleFunctionNames = new Set([
  'fn_people_cancel_employee_day',
  'fn_people_confirm_assignment',
  'fn_people_copy_previous_day',
  'fn_people_planning_period',
  'fn_people_schedule_assignment',
  'fn_people_vacations_period',
])
const functionOverridesSql = legacyFunctions.functions
  .filter((entry) => peopleFunctionNames.has(entry.function_name))
  .map(matrixPeopleFunctionSql)
  .join('\n\n')

if ([...peopleFunctionNames].some((name) => !legacyFunctions.functions.some((entry) => entry.function_name === name))) {
  throw new Error('Legacy function snapshot is missing a people-planning function')
}

function technologistApprovalFunctionSql(entry) {
  let definition = entry.definition
    .replace(/SET search_path TO 'public', 'storage', 'pg_temp'/gi, "SET search_path TO ''")
    .replace(/SET search_path TO 'public', 'pg_temp'/gi, "SET search_path TO ''")
  if (entry.function_name === 'fn_submit_technologist_request_for_approval') {
    definition = definition.replace(
      /if not exists \(select 1 from public\.users where id = p_actor and is_active\) then raise exception 'Недостаточно прав'; end if;/gi,
      "if p_actor is distinct from auth.uid() or not private.crm_has_permission('technologist_requests', 'manage') then raise exception 'Недостаточно прав' using errcode = '42501'; end if;",
    )
  } else {
    definition = definition.replace(
      /if p_actor is null then raise exception 'Недостаточно прав'; end if;\s*/gi,
      "if p_actor is distinct from auth.uid() or not private.crm_has_permission('technologist_request_results', 'manage') then raise exception 'Недостаточно прав' using errcode = '42501'; end if;\n  ",
    ).replace(
      /if not exists \(select 1 from public\.users u where u\.id = p_actor and u\.is_active and u\.role = 'financial_director'\)[\s\S]*?then raise exception '[^']+'; end if;/gi,
      '',
    )
  }
  const authorizationPrefix = entry.function_name === 'fn_submit_technologist_request_for_approval'
    ? definition.split("if jsonb_typeof(p_completion_payload)")[0]
    : definition.split('select r.* into v_request')[0]
  if (/get_user_role\s*\(|role_permissions|u\.role = 'financial_director'/i.test(authorizationPrefix)) {
    throw new Error(`Could not remove legacy approval authorization from ${entry.function_name}`)
  }
  const cleanDefinition = definition.replace(/[ \t]+$/gm, '').trim()
  return `${cleanDefinition};\n\nREVOKE ALL ON FUNCTION public.${entry.function_name}(${entry.identity_arguments}) FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public.${entry.function_name}(${entry.identity_arguments}) TO authenticated, service_role;`
}

const technologistApprovalNames = new Set([
  'fn_submit_technologist_request_for_approval',
  'fn_return_technologist_request_for_revision',
  'fn_approve_technologist_request',
])
const approvalFunctionOverridesSql = legacyFunctions.functions
  .filter((entry) => technologistApprovalNames.has(entry.function_name))
  .map(technologistApprovalFunctionSql)
  .join('\n\n')

const commercialHelperOverridesSql = `
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
`

function receivingFunctionSql(entry) {
  const guard = "IF p_performed_by IS DISTINCT FROM auth.uid() OR NOT private.crm_has_permission('inventory_receiving', 'manage') THEN RAISE EXCEPTION 'Недостаточно прав для приёмки' USING ERRCODE = '42501'; END IF;"
  const definition = entry.definition
    .replace(/SET search_path TO 'public'/gi, "SET search_path TO ''")
    .replace(/BEGIN\n/i, `BEGIN\n  ${guard}\n`)
  if (!definition.includes(guard)) throw new Error(`Could not protect ${entry.function_name}`)
  return `${definition.trim()};\n\nREVOKE ALL ON FUNCTION public.${entry.function_name}(${entry.identity_arguments}) FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public.${entry.function_name}(${entry.identity_arguments}) TO authenticated, service_role;`
}

const receivingFunctionNames = new Set([
  'fn_receive_supply_order_schedule_v2',
  'fn_receive_supply_order_schedule_batch_v1',
])
const receivingFunctionOverridesSql = legacyFunctions.functions
  .filter((entry) => receivingFunctionNames.has(entry.function_name))
  .map(receivingFunctionSql)
  .join('\n\n')

const scheduleReplacement = legacyFunctions.functions.find((entry) => entry.function_name === 'fn_replace_supply_order_delivery_schedules_v1')
if (!scheduleReplacement) throw new Error('Legacy function snapshot is missing schedule replacement')
const scheduleReplacementDefinition = scheduleReplacement.definition
  .replace(/SET search_path TO 'public', 'pg_temp'/gi, "SET search_path TO ''")
  .replace(/public\.security_can_manage_supply\(\)/gi, "private.crm_has_permission('supply_orders', 'manage')")
const scheduleReplacementOverrideSql = `${scheduleReplacementDefinition.trim()};

REVOKE ALL ON FUNCTION public.${scheduleReplacement.function_name}(${scheduleReplacement.identity_arguments}) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.${scheduleReplacement.function_name}(${scheduleReplacement.identity_arguments}) TO authenticated, service_role;`

const legacyHelperRevokesSql = `
-- Old authorization helpers remain available only to service-owned routing and
-- rollback code. Authenticated callers cannot use them as an access oracle.
REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_director() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.security_has_role(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_director() TO service_role;
GRANT EXECUTE ON FUNCTION public.security_has_role(text[]) TO service_role;
`

const policiesSql = snapshot.policies.map(policySql).filter(Boolean).join('\n')
const forbidden = /(?:get_user_role\s*\(|is_director\s*\(|security_has_role\s*\(|security_can_|FROM\s+(?:public\.)?role_permissions|\.role\s*(?:=|<>|IN\b|=\s*ANY))/i
if (forbidden.test(policiesSql)) {
  const match = policiesSql.match(forbidden)
  const index = match?.index || 0
  throw new Error(`Generated policies still contain legacy authorization near ${policiesSql.slice(Math.max(0, index - 240), index + 400)}`)
}

const snapshotChecksum = createHash('sha256')
  .update(readFileSync(join(root, 'supabase/reports/rls_dependency_affected_tables_policy_snapshot.json')))
  .digest('hex')
const manifestChecksum = createHash('sha256')
  .update(readFileSync(join(root, 'config/rls-resource-manifest.json')))
  .digest('hex')

const invariants = `
-- snapshot-sha256: ${snapshotChecksum}
-- manifest-sha256: ${manifestChecksum}
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
    ) ~* '(get_user_role\\s*\\(|is_director\\s*\\(|security_has_role\\s*\\(|security_can_|role_permissions|\\.role[[:space:]]*(=|<>|IN|=[[:space:]]*ANY))';
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
      AND procedure.prosrc ~* '(users\\.role|role_permissions|get_user_role\\s*\\(|is_director\\s*\\(|security_can_)'
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
    AND procedure.prosrc ~* '(users\\.role|role_permissions|get_user_role\\s*\\(|is_director\\s*\\(|security_can_|security_has_role\\s*\\()';
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
`

const generated = `${marker}\n\n${functionOverridesSql}\n\n${approvalFunctionOverridesSql}\n\n${commercialHelperOverridesSql}\n\n${receivingFunctionOverridesSql}\n\n${scheduleReplacementOverrideSql}\n\n${legacyHelperRevokesSql}\n${policiesSql}\n${invariants}`
writeFileSync(migrationPath, `${migration.slice(0, markerIndex)}${generated}`)
console.log(`Generated ${snapshot.policies.length} policy definitions for ${tables.length} tables`)
