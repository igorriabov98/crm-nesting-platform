import type {
  PlanningPersonalItem,
  PlanningSupplyRisk,
  PlanningTonnageMetric,
  PlanningTodayOrder,
} from './types'

const DAY_MS = 86_400_000

export function parseDateOnly(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(Date.UTC(year, month - 1, day))
}
export function daysBetween(start: string, end: string) {
  const startDate = parseDateOnly(start)
  const endDate = parseDateOnly(end)
  if (!startDate || !endDate) return 0
  return Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / DAY_MS))
}

export function prorateWeightForPeriod(
  weightTons: number,
  rangeStartValue: string | null,
  rangeEndValue: string | null,
  periodStartValue: string,
  periodEndValue: string,
) {
  const rawStart = parseDateOnly(rangeStartValue)
  const rawEnd = parseDateOnly(rangeEndValue) || rawStart
  const periodStart = parseDateOnly(periodStartValue)
  const periodEnd = parseDateOnly(periodEndValue)
  if (!rawStart || !rawEnd || !periodStart || !periodEnd || weightTons <= 0) return 0

  const rangeStart = rawStart <= rawEnd ? rawStart : rawEnd
  const rangeEnd = rawStart <= rawEnd ? rawEnd : rawStart
  const overlapStart = new Date(Math.max(rangeStart.getTime(), periodStart.getTime()))
  const overlapEnd = new Date(Math.min(rangeEnd.getTime(), periodEnd.getTime()))
  if (overlapEnd < overlapStart) return 0

  const totalDays = Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS) + 1
  const overlapDays = Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / DAY_MS) + 1
  return weightTons * (overlapDays / Math.max(totalDays, 1))
}

export function buildTonnageMetric(plan: number, fact: number): PlanningTonnageMetric {
  const normalizedPlan = Math.max(0, plan)
  const normalizedFact = Math.max(0, fact)
  return {
    plan: normalizedPlan,
    fact: normalizedFact,
    percent: normalizedPlan > 0 ? (normalizedFact / normalizedPlan) * 100 : null,
    deviation: normalizedFact - normalizedPlan,
  }
}

export function sortPersonalItems(items: PlanningPersonalItem[], today: string) {
  return [...items].sort((left, right) => {
    const leftGroup = !left.deadline ? 2 : left.deadline < today ? 0 : 1
    const rightGroup = !right.deadline ? 2 : right.deadline < today ? 0 : 1
    if (leftGroup !== rightGroup) return leftGroup - rightGroup
    if (left.deadline && right.deadline && left.deadline !== right.deadline) {
      return left.deadline.localeCompare(right.deadline)
    }
    return left.title.localeCompare(right.title, 'ru')
  })
}

export function mergeTodayOrders(
  rows: Array<{ id: string; name: string; plannedKg: number; href: string }>,
): PlanningTodayOrder[] {
  const byOrder = new Map<string, PlanningTodayOrder>()
  for (const row of rows) {
    const current = byOrder.get(row.id)
    byOrder.set(row.id, {
      id: row.id,
      name: row.name,
      plannedKg: (current?.plannedKg || 0) + Math.max(0, row.plannedKg),
      href: row.href,
    })
  }
  return Array.from(byOrder.values()).sort((left, right) => (
    right.plannedKg - left.plannedKg || left.name.localeCompare(right.name, 'ru')
  ))
}

export function splitSupplyRisks(items: PlanningSupplyRisk[], today: string) {
  const overdue = items
    .filter((item) => Boolean(item.dueDate) && item.dueDate! < today)
    .map((item) => ({ ...item, overdueDays: daysBetween(item.dueDate!, today) }))
    .sort((left, right) => (
      (right.overdueDays || 0) - (left.overdueDays || 0) || left.title.localeCompare(right.title, 'ru')
    ))
  const undated = items
    .filter((item) => !item.dueDate)
    .sort((left, right) => left.title.localeCompare(right.title, 'ru'))
  return { overdue, undated }
}
