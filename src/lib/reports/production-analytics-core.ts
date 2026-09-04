import {
  factoryWorkingDates,
  type FactoryCalendarExceptionValue,
  type ProductionStageIntervalValue,
} from '@/lib/production-stage-intervals'

export type QuantitativeStage = 'assembly' | 'cleaning' | 'painting' | 'packaging'

export type ProgressItem = {
  id: string
  quantity: number
  unitWeightKg: number
  coating: string
}

export function roundToThree(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000
}

export function lineWeightKg(quantity: number, unitWeightKg: number) {
  return roundToThree(quantity * unitWeightKg)
}

export function aggregateTonnage(lines: Array<{ quantity: number; unitWeightKg: number }>) {
  return roundToThree(lines.reduce((total, line) => total + lineWeightKg(line.quantity, line.unitWeightKg), 0) / 1000)
}

export function applicableWeightKg(items: readonly ProgressItem[], stage: QuantitativeStage) {
  return items
    .filter((item) => stage !== 'painting' || item.coating === 'powder_coating')
    .reduce((total, item) => total + item.quantity * item.unitWeightKg, 0)
}

export function weightedProgress(
  items: readonly ProgressItem[],
  facts: ReadonlyArray<{ itemId: string; totalWeightKg: number }>,
  stage: QuantitativeStage,
) {
  const applicableIds = new Set(
    items.filter((item) => stage !== 'painting' || item.coating === 'powder_coating').map((item) => item.id),
  )
  const denominatorKg = applicableWeightKg(items, stage)
  const completedKg = facts
    .filter((fact) => applicableIds.has(fact.itemId))
    .reduce((total, fact) => total + fact.totalWeightKg, 0)
  return {
    completedKg,
    applicableKg: denominatorKg,
    percent: denominatorKg > 0 ? completedKg / denominatorKg * 100 : null,
  }
}

export function productionProgressStatus(input: {
  applicableKg: number
  completedKg: number
  intervals: Array<Pick<ProductionStageIntervalValue, 'date_start' | 'date_end'>>
  today: string
  exceptions?: readonly FactoryCalendarExceptionValue[]
}) {
  const totalDays = input.intervals.reduce((total, interval) => total + (
    interval.date_start && interval.date_end
      ? factoryWorkingDates(interval.date_start, interval.date_end, input.exceptions).length
      : 0
  ), 0)
  if (input.intervals.length === 0 || totalDays === 0) return 'data_error' as const
  if (input.intervals.every((interval) => interval.date_start && interval.date_start > input.today)) return 'upcoming' as const
  const elapsedDays = input.intervals.reduce((total, interval) => total + (
    interval.date_start && interval.date_end
      ? factoryWorkingDates(interval.date_start, interval.date_end < input.today ? interval.date_end : input.today, input.exceptions).length
      : 0
  ), 0)
  const expectedKg = input.applicableKg * Math.min(1, elapsedDays / totalDays)
  if (input.completedKg + 0.001 < expectedKg) return 'late' as const
  if (input.completedKg > expectedKg + 0.001) return 'ahead' as const
  return 'on_plan' as const
}

export function capacityOverload(factTons: number, capacityTons: number | null) {
  return capacityTons === null ? null : factTons > capacityTons
}
