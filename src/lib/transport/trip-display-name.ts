type TransportTripNameStop = {
  kind?: string | null
  stop_kind?: string | null
  city?: string | null
  pointLabel?: string | null
  point_label?: string | null
  sequence?: number | null
  sequence_no?: number | null
}

type TransportTripNameInput = {
  scheduledDate?: string | null
  scheduled_date?: string | null
  stops?: TransportTripNameStop[] | null
}

function cityCode(value: string | null | undefined) {
  if (!value) return ''
  const normalized = value.trim().replace(/^м\.?\s+/iu, '')
  return (normalized.match(/\p{L}/gu) || []).slice(0, 2).join('').toLocaleUpperCase('uk-UA')
}

function stopSequence(stop: TransportTripNameStop) {
  return stop.sequence ?? stop.sequence_no ?? Number.MAX_SAFE_INTEGER
}

export function transportTripDisplayName(input: TransportTripNameInput) {
  const date = input.scheduledDate || input.scheduled_date || ''
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  const dateCode = dateParts ? `${dateParts[3]}${dateParts[2]}` : '0000'
  const citiesCode = [...(input.stops || [])]
    .filter((stop) => (stop.kind ?? stop.stop_kind) !== 'start')
    .sort((left, right) => stopSequence(left) - stopSequence(right))
    .map((stop) => cityCode(stop.city || stop.pointLabel || stop.point_label))
    .filter(Boolean)
    .join('')

  return `${dateCode}${citiesCode}`
}
