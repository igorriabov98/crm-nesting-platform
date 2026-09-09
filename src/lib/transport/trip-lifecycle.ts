const TRANSPORT_TIME_ZONE = 'Europe/Uzhgorod'

function dateKeyInTransportTimeZone(timestampMs: number) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: TRANSPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestampMs))
  const value = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value || ''
  )
  return `${value('year')}-${value('month')}-${value('day')}`
}

export function isTransportTripStartAvailable(
  scheduledDate: string | null,
  clockNow: number | null,
) {
  if (!scheduledDate || clockNow === null || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return false
  return dateKeyInTransportTimeZone(clockNow) >= scheduledDate
}
