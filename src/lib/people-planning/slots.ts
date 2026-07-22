const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

export type PlanningHalf = 1 | 2

export function assertDateOnly(value: string) {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error('Некорректная дата планирования')
  }
  return value
}

export function addPlanningDays(value: string, days: number) {
  const timestamp = Date.parse(`${assertDateOnly(value)}T00:00:00Z`) + days * DAY_MS
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function dateToOrdinal(value: string) {
  return Math.floor(Date.parse(`${assertDateOnly(value)}T00:00:00Z`) / DAY_MS)
}

export function planningSlot(value: string, half: PlanningHalf) {
  return dateToOrdinal(value) * 2 + (half - 1)
}

export function slotToPlanningDate(slot: number) {
  if (!Number.isInteger(slot)) throw new Error('Некорректный слот планирования')
  const ordinal = Math.floor(slot / 2)
  return {
    workDate: new Date(ordinal * DAY_MS).toISOString().slice(0, 10),
    half: (Math.abs(slot % 2) + 1) as PlanningHalf,
  }
}

export function calculateRequiredHalfDays(remainingKg: number, kgPerDay: number) {
  if (!Number.isFinite(remainingKg) || remainingKg <= 0) return 0
  if (!Number.isFinite(kgPerDay) || kgPerDay <= 0) throw new Error('Ставка должна быть больше нуля')
  return Math.ceil(remainingKg / (kgPerDay / 2))
}

export function planningDateRange(startDate: string, mode: 'day' | 'week') {
  assertDateOnly(startDate)
  return Array.from({ length: mode === 'week' ? 7 : 1 }, (_, index) => addPlanningDays(startDate, index))
}

export function todayInUzhgorod(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Uzhgorod',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
