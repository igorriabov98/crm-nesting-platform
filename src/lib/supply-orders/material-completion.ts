export type MaterialCompletionItem = {
  status: 'open' | 'delivered' | 'cancelled'
  completionDates?: Array<unknown>
}

function dateOnly(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 10) : null
}

export function resolveActualMaterialDate(
  items: MaterialCompletionItem[],
  fallbackDate: string | null = null,
) {
  if (items.length === 0 || items.some((item) => item.status === 'open')) return null

  const completionDates = items
    .flatMap((item) => item.completionDates || [])
    .map(dateOnly)
    .filter((value): value is string => Boolean(value))
    .sort()

  return completionDates.at(-1) || dateOnly(fallbackDate)
}
