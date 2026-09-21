import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile(new URL('../supabase/migrations/20260914120000_technologist_request_financial_approval.sql', import.meta.url), 'utf8')
const workflowMigration = await readFile(new URL('../supabase/migrations/20260917120000_technologist_approval_personal_workflow.sql', import.meta.url), 'utf8')
const followupMigration = await readFile(new URL('../supabase/migrations/20260917180000_approval_revision_contract_scope.sql', import.meta.url), 'utf8')
const jwtContextMigration = await readFile(new URL('../supabase/migrations/20260918130000_finance_approval_jwt_context.sql', import.meta.url), 'utf8')
const cleanupActorMigration = await readFile(new URL('../supabase/migrations/20260918160000_finance_approval_draft_cleanup_actor.sql', import.meta.url), 'utf8')
const accessProgramsMigration = await readFile(new URL('../supabase/migrations/20260921082107_access_programs_admin_and_layouts.sql', import.meta.url), 'utf8')
const requestCompletion = await readFile(new URL('../src/lib/actions/request-completion.ts', import.meta.url), 'utf8')
const supplyRequest = await readFile(new URL('../src/lib/actions/supply-request.ts', import.meta.url), 'utf8')
const approvalActions = await readFile(new URL('../src/lib/actions/technologist-request-approvals.ts', import.meta.url), 'utf8')
const requestActions = await readFile(new URL('../src/lib/actions/technologist-requests.ts', import.meta.url), 'utf8')

for (const expected of [
  "'pending_financial_approval'",
  "'technologist_request_approval'",
  "state in ('pending', 'returned', 'superseded', 'approved')",
  "v_request.status <> 'pending_financial_approval'",
  "role = 'financial_director'",
  "p.name = 'Администратор CRM'",
  'cardinality(v_recipients) = 0',
  "start_date, deadline",
  "set state = 'approved'",
  "set state = 'returned'",
  "set state = 'superseded'",
  'for update',
  "from authenticated",
]) assert.ok(migration.toLowerCase().includes(expected.toLowerCase()), `migration contract is missing: ${expected}`)

for (const expected of [
  "'technologist_request_revision'",
  "'finance'",
  'technologist_approval_version_id',
  'technologist_request_revision_drafts',
  "fn_technologist_approval_department_head('Финансовый отдел')",
  "fn_technologist_approval_work_item(",
  "(now() at time zone 'Europe/Kyiv')::date",
  "request_kind = 'technologist_revision'",
  "task_type = 'technologist_request_revision'",
  'Задача завершается после повторной отправки заявки',
  'Restore work items for versions that were already returned',
]) assert.ok(workflowMigration.toLowerCase().includes(expected.toLowerCase()), `personal workflow migration contract is missing: ${expected}`)

for (const expected of [
  "'fn_technologist_approval_department_head(''Технический отдел'')'",
  'fn_restore_technologist_revision_positions',
  'jsonb_populate_recordset',
  'on conflict (id) do nothing',
  'get diagnostics v_created = row_count',
  "p_resource_key in ('my_orders', 'client_identity', 'client_prices', 'contracts'",
  "private.crm_has_company_permission('contracts', 'view', client_id)",
  "lower(department.name) like '%продаж%'",
]) assert.ok(followupMigration.toLowerCase().includes(expected.toLowerCase()), `follow-up migration contract is missing: ${expected}`)

for (const expected of [
  "current_setting(''request.jwt.claims'', true)",
  "jsonb_set(",
  "''{sub}''",
  'v_request.created_by::text',
  'v_original_claims',
]) assert.ok(jwtContextMigration.toLowerCase().includes(expected.toLowerCase()), `approval JWT context migration is missing: ${expected}`)

for (const expected of [
  "current_setting('app.financial_approval_request', true) = new.id::text",
  'then new.created_by',
  'fn_discard_long_stock_request_item_drafts_v1(new.id, v_actor, null, null)',
]) assert.ok(cleanupActorMigration.toLowerCase().includes(expected.toLowerCase()), `approval draft cleanup actor migration is missing: ${expected}`)

for (const expected of [
  'crm_can_work_technologist_request',
  "private.crm_has_factory_permission('inventory', p_inventory_operation",
  'Для заявки с листовым металлом загрузите программу порезки',
  'public.crm_user_is_admin(p_actor)',
  "to authenticated, service_role",
]) assert.ok(accessProgramsMigration.toLowerCase().includes(expected.toLowerCase()), `access/program/admin migration contract is missing: ${expected}`)

assert.ok(approvalActions.includes("requirePermission('technologist_request_results', 'view')"), 'finance head decisions must use exact-head RPC authorization')
assert.ok(!approvalActions.includes("hasPermission(permissions, 'technologist_request_results', 'manage') && head.data === userId"), 'finance head UI must not depend on a stale member/head flag')
assert.ok(requestActions.includes('loadRequestItemPresence'), 'draft visibility must check whether the draft contains positions')
assert.ok(requestActions.includes("request.status === 'draft' || revisionDraftIds.has(request.id)"), 'regular and rework drafts must share the non-empty visibility rule')

assert.ok(requestCompletion.includes("rpc('fn_submit_technologist_request_for_approval'"), 'wizard must submit approval version')
assert.match(
  requestCompletion,
  /const access = await requireTechnologistRequestAccess\([\s\S]*?const \{ userId, supabase \} = access[\s\S]*?\(supabase as any\)\.rpc\('fn_submit_technologist_request_for_approval'/,
  'approval submission must preserve the authenticated actor for the RPC',
)
assert.ok(!requestCompletion.includes("rpc('fn_finalize_technologist_request_with_archives'"), 'wizard must not directly finalize request')
assert.ok(supplyRequest.includes("const visibleStatuses = ['pending_stock_check', 'stock_checked', 'submitted_to_supply', 'completed']"), 'supply direct-page allow-list changed unexpectedly')
assert.ok(supplyRequest.includes("const isSupplyOnly = hasPermission(permissions, 'supply_material_requests', 'view')"), 'supply-only visibility must come from the access matrix')
assert.ok(supplyRequest.includes("isSupplyOnly && request.status !== 'submitted_to_supply' && request.status !== 'completed'"), 'supply-only users must only see approved statuses')

console.log('technologist financial approval contract: OK')
