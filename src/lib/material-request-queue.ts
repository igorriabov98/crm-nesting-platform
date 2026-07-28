import type {
  MaterialRequestQueueItem,
  MaterialRequestQueueSort,
  MaterialRequestQueueState,
} from '@/lib/types/material-request-queue'
import {
  formatProductionMonth,
  normalizeProductionMonthValue,
} from '@/lib/utils/production-months'

export type MaterialRequestQueueMonthOption = {
  value: string
  label: string
}

function statePriority(state: MaterialRequestQueueState) {
  if (state === 'submitted') return 0
  if (state === 'in_progress') return 1
  return 2
}

export function compareMaterialRequestDeadlines(left: string | null, right: string | null) {
  if (left && right) return left.localeCompare(right)
  if (left) return -1
  if (right) return 1
  return 0
}

export function sortMaterialRequestQueueItems(
  items: MaterialRequestQueueItem[],
  sort: MaterialRequestQueueSort,
) {
  return [...items].sort((left, right) => {
    if (sort === 'ready_first') {
      const stateDiff = statePriority(left.state) - statePriority(right.state)
      if (stateDiff !== 0) return stateDiff
    }

    const deadlineDiff = compareMaterialRequestDeadlines(left.deadline, right.deadline)
    if (deadlineDiff !== 0) return deadlineDiff
    return left.machineName.localeCompare(right.machineName, 'ru')
  })
}

export function getMaterialRequestQueueMonthOptions(items: MaterialRequestQueueItem[]) {
  const months = Array.from(new Set(
    items
      .map((item) => normalizeProductionMonthValue(item.productionMonth))
      .filter((value): value is string => Boolean(value)),
  ))
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: formatProductionMonth(value) }))

  if (items.some((item) => !normalizeProductionMonthValue(item.productionMonth))) {
    months.push({ value: 'unassigned', label: 'Без месяца' })
  }

  return months satisfies MaterialRequestQueueMonthOption[]
}
