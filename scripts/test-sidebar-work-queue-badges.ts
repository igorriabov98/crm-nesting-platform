import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROUTES } from '../src/lib/constants/routes'
import {
  countPendingMaterialRequests,
  countSelectableTransportNeeds,
  getSidebarWorkQueueCount,
  type SidebarWorkQueueCounts,
} from '../src/lib/sidebar-work-queues'

const counts: SidebarWorkQueueCounts = {
  departmentRequests: {
    technologist: 2,
    supply: 3,
    production: 4,
    total: 9,
    unreadResults: 2,
  },
  transport: 5,
  materialRequests: 6,
}

assert.equal(getSidebarWorkQueueCount(ROUTES.REQUESTS, counts), 11)
assert.equal(getSidebarWorkQueueCount(ROUTES.SUPPLY_DEPARTMENT_REQUESTS, counts), 3)
assert.equal(getSidebarWorkQueueCount(ROUTES.SUPPLY_TRANSPORT, counts), 5)
assert.equal(getSidebarWorkQueueCount(ROUTES.MATERIAL_REQUESTS, counts), 6)
assert.equal(getSidebarWorkQueueCount(ROUTES.DASHBOARD, counts), 0)

assert.equal(countSelectableTransportNeeds([
  { selectable: true },
  { selectable: false },
  { selectable: true },
]), 2)

assert.equal(countPendingMaterialRequests([
  { taskStatus: 'pending', state: 'none' },
  { taskStatus: 'pending', state: 'in_progress' },
  { taskStatus: 'in_progress', state: 'none' },
  { taskStatus: 'pending', state: 'submitted' },
]), 2)

const sidebarSource = readFileSync(resolve('src/components/layout/Sidebar.tsx'), 'utf8')
assert.match(sidebarSource, /SIDEBAR_QUEUE_POLL_INTERVAL_MS = 15_000/)
assert.match(sidebarSource, /setInterval\(\(\) => void refresh\(true\), SIDEBAR_QUEUE_POLL_INTERVAL_MS\)/)
assert.match(sidebarSource, /table: 'department_requests'/)

console.log('sidebar work queue badges: ok')
