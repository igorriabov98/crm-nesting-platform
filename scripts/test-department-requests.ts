import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEPARTMENT_REQUEST_TARGETS,
  canManageDepartmentRequestTarget,
  isDepartmentRequestTarget,
} from '../src/lib/department-requests'
import { getNotificationDestination } from '../src/components/features/notifications/notification-model'

assert.equal(isDepartmentRequestTarget('technologist'), true)
assert.equal(isDepartmentRequestTarget('supply'), true)
assert.equal(isDepartmentRequestTarget('production'), true)
assert.equal(isDepartmentRequestTarget('sales'), false)

assert.equal(DEPARTMENT_REQUEST_TARGETS.technologist.route, '/requests/technologist')
assert.equal(DEPARTMENT_REQUEST_TARGETS.supply.route, '/requests/supply')
assert.equal(DEPARTMENT_REQUEST_TARGETS.production.route, '/requests/production')

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
  href: '/requests/supply?view=inbox#request-9e34f8c1-83c7-48a7-80e4-6f82cd2aeb2f',
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
  resolve('supabase/migrations/20260726103004_department_requests.sql'),
  'utf8',
)
assert.match(migration, /alter table public\.department_requests enable row level security/)
assert.match(migration, /created_by = \(select auth\.uid\(\)\)/)
assert.match(migration, /department_requests_author_created_idx/)
assert.match(migration, /department_requests_inbox_idx/)
assert.match(migration, /insert into public\.role_permissions/)
assert.match(migration, /insert into public\.department_access_permissions/)
assert.match(migration, /related_department_request_id/)
assert.match(migration, /notify_department_request_change/)

const sidebar = readFileSync(resolve('src/components/layout/Sidebar.tsx'), 'utf8')
assert.match(sidebar, /TECHNOLOGIST_DEPARTMENT_REQUESTS/)
assert.match(sidebar, /SUPPLY_DEPARTMENT_REQUESTS/)
assert.match(sidebar, /PRODUCTION_DEPARTMENT_REQUESTS/)
assert.match(sidebar, /label: 'Аутсорсинг'/)

const requestPage = readFileSync(
  resolve('src/app/(protected)/requests/[department]/page.tsx'),
  'utf8',
)
assert.match(requestPage, /getDepartmentRequestWorkspace/)
assert.match(requestPage, /DepartmentRequestsPage/)

console.log('Department requests regression passed')
