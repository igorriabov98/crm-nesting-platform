import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEPARTMENT_REQUEST_TARGETS,
  DEPARTMENT_REQUEST_STATUS_LABELS,
  canManageDepartmentRequestTarget,
  isDepartmentRequestTarget,
} from '../src/lib/department-requests'
import { getNotificationDestination } from '../src/components/features/notifications/notification-model'
import {
  DEPARTMENT_REQUEST_FILE_MAX_BYTES,
  validateDepartmentRequestFile,
} from '../src/lib/department-request-files'

assert.equal(isDepartmentRequestTarget('technologist'), true)
assert.equal(isDepartmentRequestTarget('supply'), true)
assert.equal(isDepartmentRequestTarget('production'), true)
assert.equal(isDepartmentRequestTarget('sales'), false)

assert.equal(DEPARTMENT_REQUEST_TARGETS.technologist.route, '/requests/technologist')
assert.equal(DEPARTMENT_REQUEST_TARGETS.supply.route, '/requests/supply')
assert.equal(DEPARTMENT_REQUEST_TARGETS.production.route, '/requests/production')
assert.equal(DEPARTMENT_REQUEST_STATUS_LABELS.done, 'Решён')

assert.equal(canManageDepartmentRequestTarget({
  target: 'supply',
  role: 'supply_manager',
  memberships: [],
}), true)

assert.deepEqual(getNotificationDestination({
  id: 'notification-id',
  type: 'department_request_new_supply',
  title: 'Новый запрос',
  message: 'Тест',
  created_at: '2026-07-26T00:00:00.000Z',
  is_read: false,
  related_machine_id: null,
  consumable_request_id: null,
  related_department_request_id: '9e34f8c1-83c7-48a7-80e4-6f82cd2aeb2f',
}), {
  href: '/requests/detail/9e34f8c1-83c7-48a7-80e4-6f82cd2aeb2f',
  label: 'Открыть запрос',
})
assert.equal(canManageDepartmentRequestTarget({
  target: 'technologist',
  role: 'sales_manager',
  memberships: [{ departmentName: 'Технический отдел ' }],
}), true)
assert.equal(canManageDepartmentRequestTarget({
  target: 'production',
  role: 'sales_manager',
  memberships: [{ departmentName: 'Производство Берегово' }],
}), true)
assert.equal(canManageDepartmentRequestTarget({
  target: 'production',
  role: 'sales_manager',
  memberships: [{ departmentName: 'Отдел продаж' }],
}), false)
assert.equal(canManageDepartmentRequestTarget({
  target: 'supply',
  role: 'planning_director',
  memberships: [],
}), true)

const migration = readFileSync(
  resolve('supabase/migrations/20260726121851_unify_department_requests.sql'),
  'utf8',
)
assert.match(migration, /alter table public\.department_request_attachments enable row level security/)
assert.match(migration, /department_request_attachments/)
assert.match(migration, /department_request_events/)
assert.match(migration, /department-request-files/)
assert.match(migration, /department_requests_search_idx/)
assert.match(migration, /create_department_request/)
assert.match(migration, /claim_department_request/)
assert.match(migration, /complete_department_request/)
assert.match(migration, /reject_department_request/)
assert.match(migration, /cancel_department_request/)
assert.match(migration, /status = 'new'\s+and assigned_to is null/)
assert.match(migration, /revoke insert, update on public\.department_requests from authenticated/)
assert.match(migration, /notify_department_request_change/)
assert.match(migration, /log_department_request_event/)

const sidebar = readFileSync(resolve('src/components/layout/Sidebar.tsx'), 'utf8')
assert.match(sidebar, /TECHNOLOGIST_DEPARTMENT_REQUESTS/)
assert.match(sidebar, /SUPPLY_DEPARTMENT_REQUESTS/)
assert.match(sidebar, /PRODUCTION_DEPARTMENT_REQUESTS/)
assert.match(sidebar, /canManageDepartmentRequestTarget/)
assert.match(sidebar, /label: 'Аутсорсинг'/)

const personalPage = readFileSync(
  resolve('src/app/(protected)/requests/page.tsx'),
  'utf8',
)
assert.match(personalPage, /getMyDepartmentRequestWorkspace/)

const requestPage = readFileSync(
  resolve('src/app/(protected)/requests/[department]/page.tsx'),
  'utf8',
)
assert.match(requestPage, /getDepartmentRequestWorkspace/)
assert.match(requestPage, /DepartmentRequestsPage/)

const workspacePage = readFileSync(
  resolve('src/components/features/department-requests/DepartmentRequestsPage.tsx'),
  'utf8',
)
assert.match(workspacePage, /workspace\.mode === 'mine' && <CreateDepartmentRequestForm/)
assert.doesNotMatch(workspacePage, /Приоритет/)

assert.deepEqual(
  validateDepartmentRequestFile({ fileName: 'result.step', fileSize: 1024 }),
  { fileName: 'result.step', extension: '.step' },
)
assert.throws(
  () => validateDepartmentRequestFile({ fileName: 'danger.exe', fileSize: 1024 }),
  /формат/,
)
assert.throws(
  () => validateDepartmentRequestFile({ fileName: 'large.pdf', fileSize: DEPARTMENT_REQUEST_FILE_MAX_BYTES + 1 }),
  /25 МБ/,
)

console.log('Department requests regression passed')
