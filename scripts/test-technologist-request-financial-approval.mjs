import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile(new URL('../supabase/migrations/20260914120000_technologist_request_financial_approval.sql', import.meta.url), 'utf8')
const workflowMigration = await readFile(new URL('../supabase/migrations/20260917120000_technologist_approval_personal_workflow.sql', import.meta.url), 'utf8')
const requestCompletion = await readFile(new URL('../src/lib/actions/request-completion.ts', import.meta.url), 'utf8')
const supplyRequest = await readFile(new URL('../src/lib/actions/supply-request.ts', import.meta.url), 'utf8')

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

assert.ok(requestCompletion.includes("rpc('fn_submit_technologist_request_for_approval'"), 'wizard must submit approval version')
assert.match(
  requestCompletion,
  /const \{ userId, supabase \} = await requirePermission\('technologist_requests', 'manage'\)[\s\S]*?\(supabase as any\)\.rpc\('fn_submit_technologist_request_for_approval'/,
  'approval submission must preserve the authenticated actor for the RPC',
)
assert.ok(!requestCompletion.includes("rpc('fn_finalize_technologist_request_with_archives'"), 'wizard must not directly finalize request')
assert.ok(supplyRequest.includes("const visibleStatuses = ['pending_stock_check', 'stock_checked', 'submitted_to_supply', 'completed']"), 'supply direct-page allow-list changed unexpectedly')
assert.ok(supplyRequest.includes("const isSupplyOnly = hasPermission(permissions, 'supply_material_requests', 'view')"), 'supply-only visibility must come from the access matrix')
assert.ok(supplyRequest.includes("isSupplyOnly && request.status !== 'submitted_to_supply' && request.status !== 'completed'"), 'supply-only users must only see approved statuses')

console.log('technologist financial approval contract: OK')
