import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  getMaterialRequestQueueMonthOptions,
  sortMaterialRequestQueueItems,
} from '../src/lib/material-request-queue'
import type {
  MaterialRequestQueueItem,
  MaterialRequestQueueState,
} from '../src/lib/types/material-request-queue'

function item(
  machineName: string,
  state: MaterialRequestQueueState,
  deadline: string | null,
  productionMonth: string | null,
): MaterialRequestQueueItem {
  return {
    machineId: machineName,
    machineName,
    totalWeight: 0,
    productionMonth,
    deadline,
    taskStatus: null,
    completedAt: null,
    state,
    submittedRequestCount: state === 'submitted' ? 1 : 0,
    totalRequestCount: state === 'none' ? 0 : 1,
  }
}

const queue = [
  item('Без срока', 'none', null, null),
  item('Новая', 'in_progress', '2026-09-15', '2026-09-01'),
  item('Старая', 'none', '2026-07-01', '2026-07-01'),
  item('Готовая', 'submitted', '2026-08-01', '2026-08-01'),
]

assert.deepEqual(
  sortMaterialRequestQueueItems(queue, 'deadline_asc').map((row) => row.machineName),
  ['Старая', 'Готовая', 'Новая', 'Без срока'],
  'Сортировка по дедлайну должна идти от старого к новому, без срока — в конце',
)

assert.deepEqual(
  sortMaterialRequestQueueItems(queue, 'ready_first').map((row) => row.machineName),
  ['Готовая', 'Новая', 'Старая', 'Без срока'],
  'Сортировка по готовности должна идти от готовых заявок к отсутствующим',
)

assert.deepEqual(
  getMaterialRequestQueueMonthOptions(queue).map((option) => option.value),
  ['2026-07-01', '2026-08-01', '2026-09-01', 'unassigned'],
  'Фильтр месяца должен содержать месяцы плана и вариант для непривязанных машин',
)

async function main() {
  const actionSource = await readFile(
    new URL('../src/lib/actions/material-request-queue.ts', import.meta.url),
    'utf8',
  )

  assert.match(actionSource, /\.from\('machines_with_totals'\)/)
  assert.match(actionSource, /const machineIds = machines\.map/)
  assert.match(actionSource, /taskStatus: task\?\.status \|\| null/)
  assert.doesNotMatch(
    actionSource,
    /\.eq\('assigned_to'/,
    'Очередь не должна исчезать у технолога из-за отсутствия назначенной задачи',
  )

  console.log('Material request queue checks passed')
}

void main()
