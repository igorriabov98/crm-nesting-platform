import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ACTIVE_OUTSOURCING_NEED_STATUSES,
  ACTIVE_TASK_STATUSES,
  ACTIVE_TRANSFER_STATUSES,
  buildNonArchivedOrUnscopedMachineFilter,
  isMachineWorkVisible,
} from '../src/lib/machine-work-visibility'

for (const status of ACTIVE_TASK_STATUSES) {
  assert.equal(isMachineWorkVisible(true, status, ACTIVE_TASK_STATUSES), false)
}
for (const status of ACTIVE_TRANSFER_STATUSES) {
  assert.equal(isMachineWorkVisible(true, status, ACTIVE_TRANSFER_STATUSES), false)
}
for (const status of ACTIVE_OUTSOURCING_NEED_STATUSES) {
  assert.equal(isMachineWorkVisible(true, status, ACTIVE_OUTSOURCING_NEED_STATUSES), false)
}
assert.equal(isMachineWorkVisible(false, 'pending', ACTIVE_TASK_STATUSES), true)
assert.equal(isMachineWorkVisible(true, 'completed', ACTIVE_TASK_STATUSES), true)
assert.equal(isMachineWorkVisible(true, 'received', ACTIVE_TRANSFER_STATUSES), true)
assert.equal(isMachineWorkVisible(true, 'completed', ACTIVE_OUTSOURCING_NEED_STATUSES), true)

assert.equal(buildNonArchivedOrUnscopedMachineFilter([]), null)
assert.equal(
  buildNonArchivedOrUnscopedMachineFilter(['machine-a', 'machine-b']),
  'machine_id.is.null,machine_id.not.in.(machine-a,machine-b)',
)

const source = (path: string) => readFileSync(resolve(path), 'utf8')
const archiveAction = source('src/app/(protected)/sales-plan/actions.ts')
const tasks = source('src/lib/actions/tasks.ts')
const detailing = source('src/lib/actions/detailing.ts')
const inventoryTransfers = source('src/lib/actions/inventory-transfers.ts')
const outsourcing = source('src/lib/actions/outsourcing.ts')
const transportTrips = source('src/lib/actions/transport-trips.ts')
const dashboard = source('src/lib/dashboard/planning-director/data.ts')
const taskNotifications = source('src/lib/services/task-notifications.ts')
const departmentRequests = source('src/lib/actions/department-requests.ts')
const sidebarQueues = source('src/lib/actions/sidebar-work-queues.ts')
const archiveQueueMigration = source('supabase/migrations/20260830120000_archive_machine_compact_production_queue.sql')

assert.match(archiveAction, /admin\.rpc\('archive_machine_and_compact_production_queue'/)
assert.match(archiveQueueMigration, /UPDATE public\.tasks[\s\S]*?status = 'cancelled'[\s\S]*?status IN \('pending', 'in_progress'\)/)
assert.match(archiveQueueMigration, /PARTITION BY m\.production_month, m\.factory_id, m\.production_workshop/)
assert.match(archiveQueueMigration, /COALESCE\(m\.is_archived, false\) = false/)
assert.match(archiveQueueMigration, /GRANT EXECUTE ON FUNCTION public\.archive_machine_and_compact_production_queue\(uuid, uuid, text\) TO service_role/)
for (const route of [
  'SUPPLY_TRANSPORT',
  'SUPPLY_OUTSOURCING_REQUESTS',
  'INVENTORY_RECEIVING',
  'DASHBOARD',
  'REQUESTS',
  'NOTIFICATIONS',
]) {
  assert.match(archiveAction, new RegExp(`revalidatePath\\(ROUTES\\.${route}\\)`))
}

assert.match(tasks, /isMachineWorkVisible\(task\.machine\.is_archived, task\.status, ACTIVE_TASK_STATUSES\)/)
assert.match(tasks, /item\.task && isActiveTaskStatus\(item\.task\.status\)/)
for (const transferSource of [detailing, inventoryTransfers]) {
  assert.match(transferSource, /select\('id, name, is_archived'\)/)
  assert.match(transferSource, /isMachineWorkVisible\(machine\?\.is_archived/)
}
assert.match(outsourcing, /\.eq\('machines\.is_archived', false\)/)
assert.match(outsourcing, /isMachineWorkVisible\(machine\?\.is_archived, need\.status/)
assert.match(outsourcing, /if \(!machine \|\| machine\.is_archived\) return \[\]/)
assert.match(transportTrips, /const visibleActiveNeedKeys = new Set<string>/)
assert.match(transportTrips, /const visibleLinks = links\.filter/)
assert.match(transportTrips, /isActiveTransfer\(order\.status\) && tripNeeds\.length === 0/)
assert.equal((dashboard.match(/is_archived', false/g) || []).length >= 4, true)
assert.match(dashboard, /visibleTasks[\s\S]*?is_archived !== true/)
assert.match(dashboard, /visibleRequests[\s\S]*?is_archived !== true/)
assert.match(taskNotifications, /task\.machine_id && task\.machine\?\.is_archived === true/)
assert.match(departmentRequests, /buildNonArchivedOrUnscopedMachineFilter\(archivedMachineIds\)/)
assert.match(sidebarQueues, /buildNonArchivedOrUnscopedMachineFilter/)
assert.match(sidebarQueues, /\.eq\('machines\.is_archived', false\)/)

// Existing production, supply and warehouse queues must keep their archive guards.
assert.match(source('src/lib/actions/supply-orders.ts'), /machine\.is_archived/)
assert.match(source('src/lib/actions/material-request-queue.ts'), /\.eq\('is_archived', false\)/)
assert.match(source('src/lib/actions/production-plan.ts'), /\.eq\('is_archived', false\)/)
assert.match(source('src/lib/actions/nesting-batches.ts'), /\.eq\('is_archived', false\)/)

console.log('archived machine active work visibility: ok')
