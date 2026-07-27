import assert from 'node:assert/strict'
import {
  buildTonnageMetric,
  mergeTodayOrders,
  prorateWeightForPeriod,
  sortPersonalItems,
  splitSupplyRisks,
} from '../src/lib/dashboard/planning-director/calculations'
import type { PlanningPersonalItem, PlanningSupplyRisk } from '../src/lib/dashboard/planning-director/types'

function closeTo(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 0.000_001, `${actual} ≠ ${expected}`)
}

closeTo(prorateWeightForPeriod(31, '2026-07-01', '2026-07-31', '2026-07-01', '2026-07-31'), 31)
closeTo(prorateWeightForPeriod(31, '2026-07-16', '2026-08-15', '2026-07-01', '2026-07-31'), 16)
closeTo(prorateWeightForPeriod(10, '2026-07-27', '2026-07-27', '2026-07-27', '2026-07-27'), 10)
closeTo(prorateWeightForPeriod(10, '2026-08-01', '2026-08-10', '2026-07-01', '2026-07-31'), 0)

assert.deepEqual(buildTonnageMetric(0, 3), { plan: 0, fact: 3, percent: null, deviation: 3 })
assert.equal(buildTonnageMetric(10, 8).percent, 80)

const queue: PlanningPersonalItem[] = [
  { id: 'no-date', kind: 'task', title: 'Без срока', status: 'pending', deadline: null, machineName: null, href: '#' },
  { id: 'future', kind: 'task', title: 'Будущее', status: 'pending', deadline: '2026-07-28', machineName: null, href: '#' },
  { id: 'overdue', kind: 'request', title: 'Просрочка', status: 'in_progress', deadline: '2026-07-26', machineName: null, href: '#' },
]
assert.deepEqual(sortPersonalItems(queue, '2026-07-27').map((item) => item.id), ['overdue', 'future', 'no-date'])

assert.deepEqual(
  mergeTodayOrders([
    { id: 'm1', name: 'Заказ 1', plannedKg: 200, href: '#' },
    { id: 'm1', name: 'Заказ 1', plannedKg: 300, href: '#' },
    { id: 'm2', name: 'Заказ 2', plannedKg: 100, href: '#' },
  ]),
  [
    { id: 'm1', name: 'Заказ 1', plannedKg: 500, href: '#' },
    { id: 'm2', name: 'Заказ 2', plannedKg: 100, href: '#' },
  ],
)

const supply: PlanningSupplyRisk[] = [
  { id: 'late', category: 'materials', title: 'Лист', context: null, dueDate: '2026-07-25', remainingQuantity: 2, unit: 'шт', overdueDays: null, href: '#' },
  { id: 'today', category: 'materials', title: 'Труба', context: null, dueDate: '2026-07-27', remainingQuantity: 1, unit: 'шт', overdueDays: null, href: '#' },
  { id: 'undated', category: 'consumables', title: 'Диск', context: null, dueDate: null, remainingQuantity: 3, unit: 'шт', overdueDays: null, href: '#' },
]
const split = splitSupplyRisks(supply, '2026-07-27')
assert.deepEqual(split.overdue.map((item) => [item.id, item.overdueDays]), [['late', 2]])
assert.deepEqual(split.undated.map((item) => item.id), ['undated'])

console.log('Planning director dashboard calculations: OK')
