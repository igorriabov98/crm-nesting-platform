export function dateOnlyValue(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) return null
  return value.slice(0, 10)
}

export function normalizeNightShiftDates(
  dates: readonly (string | null | undefined)[] | null | undefined,
  legacyDate?: string | null
) {
  const result = new Set<string>()

  for (const value of dates || []) {
    const date = dateOnlyValue(value)
    if (date) result.add(date)
  }

  if (result.size === 0) {
    const date = dateOnlyValue(legacyDate)
    if (date) result.add(date)
  }

  return Array.from(result).sort((a, b) => a.localeCompare(b))
}

export function primaryNightShiftDate(
  dates: readonly (string | null | undefined)[] | null | undefined,
  legacyDate?: string | null
) {
  return normalizeNightShiftDates(dates, legacyDate)[0] ?? null
}

export function formatShortDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-')
  if (!year || !month || !day) return value
  return `${day}.${month}`
}

export function formatNightShiftDates(
  dates: readonly (string | null | undefined)[] | null | undefined,
  legacyDate?: string | null
) {
  return normalizeNightShiftDates(dates, legacyDate).map(formatShortDate).join(', ')
}
