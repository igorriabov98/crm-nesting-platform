export type TransportRouteNeed = {
  key?: string
  sourcePointKey: string
  sourcePointLabel: string
  sourcePointCity?: string | null
  sourcePointAddress?: string | null
  destinationPointLabel: string
  destinationPointKey?: string
  destinationPointCity?: string | null
  destinationPointAddress?: string | null
  direction: 'outbound' | 'return'
}

export type TransportNeedConflict = 'source' | 'direction' | null

export function getTransportNeedConflict(
  anchor: TransportRouteNeed,
  candidate: TransportRouteNeed,
): TransportNeedConflict {
  if (anchor.sourcePointKey !== candidate.sourcePointKey) return 'source'
  if (anchor.direction !== candidate.direction) return 'direction'
  return null
}

export function buildTransportRoute(needs: TransportRouteNeed[]) {
  const firstNeed = needs[0]
  if (!firstNeed) return ''
  const destinations = Array.from(new Set(needs.map((need) => need.destinationPointLabel)))
  return `${firstNeed.sourcePointLabel} → ${destinations.join(' → ')}`
}

function normalizeRoutePoint(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru')
}

export function normalizeTransportCity(value: string | null | undefined) {
  return normalizeRoutePoint(value || '')
}

export function routeStartsAt(route: string, startPoint: string) {
  const firstPoint = route.split('→', 1)[0] || ''
  return normalizeRoutePoint(firstPoint) === normalizeRoutePoint(startPoint)
}

export function assertRouteStartsAt(route: string, startPoint: string) {
  if (!routeStartsAt(route, startPoint)) {
    throw new Error(`Маршрут должен начинаться с точки «${startPoint}»`)
  }
}

export type TransportDraftStop = {
  clientId: string
  pointKey: string
  pointLabel: string
  city: string | null
  address: string | null
  kind: 'start' | 'service' | 'finish'
  plannedTime: string
  serviceDurationMinutes: number
}

export type TransportDraftAssignment = {
  needKey: string
  pickupStopClientId: string
  deliveryStopClientId: string
}

export type TransportStopPlan = {
  stops: TransportDraftStop[]
  assignments: TransportDraftAssignment[]
}

function pointKeyForDestination(need: TransportRouteNeed) {
  return need.destinationPointKey || `destination:${need.destinationPointLabel}`
}

function stopId(index: number, pointKey: string) {
  return `stop-${index}-${pointKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function addMinutes(time: string, minutes: number) {
  const [hours = 0, currentMinutes = 0] = time.split(':').map(Number)
  const total = hours * 60 + currentMinutes + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function timeForInsertion(stops: TransportDraftStop[], index: number) {
  const minutes = (value: string) => {
    const [hours = 0, mins = 0] = value.split(':').map(Number)
    return hours * 60 + mins
  }
  const previous = stops[index - 1]?.plannedTime
  const next = stops[index]?.plannedTime
  if (previous && next) {
    const left = minutes(previous)
    const right = minutes(next)
    if (right - left > 1) return addMinutes(previous, Math.floor((right - left) / 2))
  }
  if (next) return addMinutes(next, -30)
  if (previous) return addMinutes(previous, 60)
  return '09:00'
}

/**
 * Builds a stable topological route for ordinary multi-pickup trips. If the
 * selected needs contain a cycle (for example A -> B and B -> A), the route
 * falls back to a sequential chain and revisits a point when necessary.
 */
export function buildTransportStopPlan(needs: TransportRouteNeed[]): TransportStopPlan {
  return reconcileTransportStopPlan([], [], needs)
}

/** Adds and removes needs without disturbing manually ordered existing stops. */
export function reconcileTransportStopPlan(
  currentStops: TransportDraftStop[],
  currentAssignments: TransportDraftAssignment[],
  needs: TransportRouteNeed[],
): TransportStopPlan {
  const needKeys = new Set(needs.map((need, index) => need.key || `need-${index}`))
  const assignments = currentAssignments.filter((item) => needKeys.has(item.needKey))
  const referencedIds = new Set(assignments.flatMap((item) => [item.pickupStopClientId, item.deliveryStopClientId]))
  const preservedFinish = currentStops.find((stop) => stop.kind === 'finish')
  const stops = currentStops.filter((stop) => stop.kind === 'service' && referencedIds.has(stop.clientId))
  const destinationIds = new Set(assignments.map((item) => item.deliveryStopClientId))

  const makeStop = (need: TransportRouteNeed, role: 'pickup' | 'delivery'): TransportDraftStop => {
    const key = role === 'pickup' ? need.sourcePointKey : pointKeyForDestination(need)
    const label = role === 'pickup' ? need.sourcePointLabel : need.destinationPointLabel
    const city = role === 'pickup' ? need.sourcePointCity : need.destinationPointCity
    const address = role === 'pickup' ? need.sourcePointAddress : need.destinationPointAddress
    return {
      clientId: stopId(stops.length + assignments.length, `${need.key || 'need'}-${role}-${key}`),
      pointKey: key,
      pointLabel: label,
      city: city || null,
      address: address || null,
      kind: 'service',
      plannedTime: addMinutes('08:00', (stops.length + 1) * 60),
      serviceDurationMinutes: 30,
    }
  }

  needs.forEach((need, needIndex) => {
    const key = need.key || `need-${needIndex}`
    if (assignments.some((item) => item.needKey === key)) return
    const destinationCity = normalizeTransportCity(need.destinationPointCity)
    const destinationKey = pointKeyForDestination(need)
    const deliveryBlockIndexes = stops
      .map((stop, index) => destinationIds.has(stop.clientId)
        && normalizeTransportCity(stop.city) === destinationCity ? index : -1)
      .filter((index) => index >= 0)
    let insertionIndex = deliveryBlockIndexes.length > 0 ? Math.min(...deliveryBlockIndexes) : stops.length
    let pickup = stops.find((stop, index) => stop.pointKey === need.sourcePointKey && index <= insertionIndex)
    if (!pickup) {
      pickup = makeStop(need, 'pickup')
      pickup.plannedTime = timeForInsertion(stops, insertionIndex)
      stops.splice(insertionIndex, 0, pickup)
      insertionIndex += 1
    } else {
      insertionIndex = Math.max(insertionIndex, stops.indexOf(pickup) + 1)
    }
    let delivery = stops.find((stop, index) => stop.pointKey === destinationKey && index >= insertionIndex)
    if (!delivery) {
      delivery = makeStop(need, 'delivery')
      const lastCityDelivery = stops.reduce((last, stop, index) => (
        destinationIds.has(stop.clientId) && normalizeTransportCity(stop.city) === destinationCity ? index : last
      ), -1)
      const deliveryIndex = lastCityDelivery >= insertionIndex ? lastCityDelivery + 1 : insertionIndex
      delivery.plannedTime = timeForInsertion(stops, deliveryIndex)
      stops.splice(deliveryIndex, 0, delivery)
    }
    assignments.push({ needKey: key, pickupStopClientId: pickup.clientId, deliveryStopClientId: delivery.clientId })
    destinationIds.add(delivery.clientId)
  })

  const resultStops = [...stops, ...(preservedFinish ? [preservedFinish] : [])]
  if (currentStops.length === 0) {
    resultStops.forEach((stop, index) => { stop.plannedTime = addMinutes('08:00', (index + 1) * 60) })
  }
  return { stops: resultStops, assignments }
}

export function getTransportStopOrderError(
  stops: Pick<TransportDraftStop, 'clientId' | 'plannedTime'>[],
  assignments: TransportDraftAssignment[],
) {
  const position = new Map(stops.map((stop, index) => [stop.clientId, index]))
  for (const assignment of assignments) {
    const pickup = position.get(assignment.pickupStopClientId)
    const delivery = position.get(assignment.deliveryStopClientId)
    if (pickup === undefined || delivery === undefined) return 'У потребности отсутствует точка забора или доставки'
    if (pickup >= delivery) return 'Доставка не может быть раньше забора'
  }
  for (let index = 1; index < stops.length; index += 1) {
    if (stops[index - 1].plannedTime && stops[index].plannedTime
      && stops[index - 1].plannedTime >= stops[index].plannedTime) {
      return 'Время остановок должно идти по порядку'
    }
  }
  return null
}
