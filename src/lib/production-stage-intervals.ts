import { differenceInCalendarDays, parseISO } from 'date-fns'

import { stageSupportsIntervals } from '@/lib/constants/stages'

export type ProductionStageIntervalValue = {
  id: string
  production_stage_id: string
  position: number
  date_start: string | null
  date_end: string | null
  workshop: number | null
  created_at?: string | null
  updated_at?: string | null
}

type StageWithIntervals = {
  id: string
  stage_type: string
  workshop: number | null
  date_start: string | null
  date_end: string | null
  intervals?: ProductionStageIntervalValue[] | null
}

export function getStageIntervals(stage: StageWithIntervals): ProductionStageIntervalValue[] {
  if (!stageSupportsIntervals(stage.stage_type)) return []

  const stored = [...(stage.intervals ?? [])].sort((a, b) => a.position - b.position)
  if (stored.length > 0) return stored
  if (!stage.date_start && !stage.date_end) return []

  return [{
    id: `legacy:${stage.id}`,
    production_stage_id: stage.id,
    position: 1,
    date_start: stage.date_start,
    date_end: stage.date_end,
    workshop: stage.stage_type === 'assembly' ? stage.workshop : null,
  }]
}

export function intervalActiveDays(interval: Pick<ProductionStageIntervalValue, 'date_start' | 'date_end'>) {
  if (!interval.date_start || !interval.date_end) return 0
  return Math.max(0, differenceInCalendarDays(parseISO(interval.date_end), parseISO(interval.date_start)) + 1)
}

export function stageActiveDays(stage: StageWithIntervals) {
  return getStageIntervals(stage).reduce((total, interval) => total + intervalActiveDays(interval), 0)
}

export function intervalOverlapDays(
  interval: Pick<ProductionStageIntervalValue, 'date_start' | 'date_end'>,
  periodStart: string,
  periodEnd: string,
) {
  if (!interval.date_start || !interval.date_end) return 0
  const start = interval.date_start > periodStart ? interval.date_start : periodStart
  const end = interval.date_end < periodEnd ? interval.date_end : periodEnd
  if (end < start) return 0
  return differenceInCalendarDays(parseISO(end), parseISO(start)) + 1
}

export function prorateStageIntervalsForPeriod(
  weight: number,
  intervals: Array<Pick<ProductionStageIntervalValue, 'date_start' | 'date_end'>>,
  periodStart: string,
  periodEnd: string,
) {
  const totalDays = intervals.reduce((total, interval) => total + intervalActiveDays(interval), 0)
  const overlapDays = intervals.reduce(
    (total, interval) => total + intervalOverlapDays(interval, periodStart, periodEnd),
    0,
  )
  return {
    totalDays,
    overlapDays,
    tons: totalDays > 0 ? weight * overlapDays / totalDays : 0,
  }
}

export function dateBelongsToStageInterval(stage: StageWithIntervals, date: string) {
  return getStageIntervals(stage).some((interval) =>
    Boolean(interval.date_start && interval.date_end && date >= interval.date_start && date <= interval.date_end),
  )
}

export function intervalPayloadEquals(
  left: ProductionStageIntervalValue | null | undefined,
  right: ProductionStageIntervalValue | null | undefined,
) {
  if (!left || !right) return left === right
  return left.id === right.id
    && left.production_stage_id === right.production_stage_id
    && left.position === right.position
    && left.date_start === right.date_start
    && left.date_end === right.date_end
    && left.workshop === right.workshop
}

export function getStageIntervalSequenceError(intervals: ProductionStageIntervalValue[]) {
  const ordered = [...intervals].sort((a, b) => a.position - b.position)
  if (new Set(ordered.map((interval) => interval.position)).size !== ordered.length) {
    return 'Номера подходов не должны повторяться'
  }
  for (const interval of ordered) {
    if (interval.date_start && interval.date_end && interval.date_end < interval.date_start) {
      return `У подхода ${interval.position} окончание раньше начала`
    }
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index]
    const previousWithEnd = [...ordered.slice(0, index)].reverse().find((interval) => interval.date_end)
    if (current.date_start && previousWithEnd?.date_end && current.date_start <= previousWithEnd.date_end) {
      return `Подход ${current.position} пересекается с предыдущим подходом`
    }
  }
  return null
}
