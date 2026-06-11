import { format, differenceInCalendarDays, addDays, startOfWeek, startOfMonth, endOfMonth, isWeekend as fnsIsWeekend, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval } from 'date-fns'
import { ru } from 'date-fns/locale'

export type GanttScale = 'day' | 'week' | 'month'

export interface DateScaleItem {
  date: Date
  label: string
  isWeekend: boolean
  isToday: boolean
}

export interface MonthScaleItem {
  label: string     // "Январь 2025"
  spanUnits: number // how many scale units this month spans
}

/** Number of calendar days between two dates (inclusive) */
export function daysBetween(start: Date, end: Date): number {
  return differenceInCalendarDays(end, start) + 1
}

/** Offset in days from rangeStart to date */
export function dayOffset(date: Date, rangeStart: Date): number {
  return differenceInCalendarDays(date, rangeStart)
}

/** Check if date is weekend */
export function isWeekend(date: Date): boolean {
  return fnsIsWeekend(date)
}

/** Format date as DD.MM.YYYY */
export function formatDate(date: Date): string {
  return format(date, 'dd.MM.yyyy', { locale: ru })
}

/** Format date as DD.MM */
export function formatShortDate(date: Date): string {
  return format(date, 'dd.MM', { locale: ru })
}

/** Pixel width per unit for each scale */
export const SCALE_UNIT_WIDTH: Record<GanttScale, number> = {
  day: 40,
  week: 40,
  month: 40,
}

/**
 * Generate scale units (columns) for the timeline
 * Day → each day
 * Week → each week start (Mon)
 * Month → each month start
 */
export function generateDateScale(
  start: Date,
  end: Date,
  scale: GanttScale
): DateScaleItem[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (scale === 'day') {
    return eachDayOfInterval({ start, end }).map((date) => ({
      date,
      label: format(date, 'd', { locale: ru }),
      isWeekend: fnsIsWeekend(date),
      isToday: differenceInCalendarDays(date, today) === 0,
    }))
  }

  if (scale === 'week') {
    const weeksStart = startOfWeek(start, { weekStartsOn: 1 })
    return eachWeekOfInterval(
      { start: weeksStart, end },
      { weekStartsOn: 1 }
    ).map((weekStart, i) => ({
      date: weekStart,
      label: `Н${i + 1}`,
      isWeekend: false,
      isToday: differenceInCalendarDays(weekStart, today) <= 0 && 
               differenceInCalendarDays(addDays(weekStart, 6), today) >= 0,
    }))
  }

  // month
  return eachMonthOfInterval({ start, end }).map((monthStart) => ({
    date: monthStart,
    label: format(monthStart, 'LLL', { locale: ru }), // "янв", "фев" ...
    isWeekend: false,
    isToday: format(monthStart, 'yyyy-MM') === format(today, 'yyyy-MM'),
  }))
}

/**
 * Generate month header items — spans multiple scale units
 */
export function generateMonthScale(
  scaleItems: DateScaleItem[],
  scale: GanttScale
): MonthScaleItem[] {
  if (scale === 'month') {
    // Each item is already a month
    return scaleItems.map((item) => ({
      label: format(item.date, 'LLLL yyyy', { locale: ru }),
      spanUnits: 1,
    }))
  }

  const result: MonthScaleItem[] = []
  let currentMonth = ''
  let span = 0

  for (const item of scaleItems) {
    const m = format(item.date, 'LLLL yyyy', { locale: ru })
    if (m !== currentMonth) {
      if (currentMonth) result.push({ label: currentMonth, spanUnits: span })
      currentMonth = m
      span = 1
    } else {
      span++
    }
  }
  if (currentMonth) result.push({ label: currentMonth, spanUnits: span })
  return result
}

/**
 * Convert a date to pixel offset from rangeStart, given scale
 * For day scale: offset in days × dayWidth
 * For week scale: offset in full weeks × weekWidth
 * For month scale: proportional within months × monthWidth
 */
export function dateToPixel(date: Date, rangeStart: Date, scale: GanttScale, unitWidth: number): number {
  if (scale === 'day') {
    return dayOffset(date, rangeStart) * unitWidth
  }
  if (scale === 'week') {
    const days = dayOffset(date, rangeStart)
    return (days / 7) * unitWidth
  }
  // month
  const days = dayOffset(date, rangeStart)
  const totalDays = daysBetween(rangeStart, addDays(rangeStart, 365)) // rough
  return days * (unitWidth / 30) // approx 30 days per month
}

/**
 * Given two dates (start/end of a bar), return pixel left and width
 */
export function barGeometry(
  start: Date,
  end: Date,
  rangeStart: Date,
  scale: GanttScale,
  unitWidth: number
): { left: number; width: number } {
  const left = dateToPixel(start, rangeStart, scale, unitWidth)
  const endPx = dateToPixel(addDays(end, 1), rangeStart, scale, unitWidth)
  return { left, width: Math.max(endPx - left, unitWidth / 4) }
}
