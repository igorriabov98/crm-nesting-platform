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

function stopId(index: number, pointKey: string) {
  return `stop-${index}-${pointKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function addMinutes(time: string, minutes: number) {
  const [hours = 0, currentMinutes = 0] = time.split(':').map(Number)
  const total = hours * 60 + currentMinutes + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Builds a stable topological route for ordinary multi-pickup trips. If the
 * selected needs contain a cycle (for example A -> B and B -> A), the route
 * falls back to a sequential chain and revisits a point when necessary.
 */
export function buildTransportStopPlan(needs: TransportRouteNeed[]): TransportStopPlan {
  const pointMeta = new Map<string, {
    label: string
    city: string | null
    address: string | null
    firstSeen: number
  }>()
  const edges = new Map<string, Set<string>>()
  const indegree = new Map<string, number>()

  const registerPoint = (
    key: string,
    label: string,
    city: string | null | undefined,
    address: string | null | undefined,
    firstSeen: number,
  ) => {
    if (!pointMeta.has(key)) pointMeta.set(key, { label, city: city || null, address: address || null, firstSeen })
    if (!edges.has(key)) edges.set(key, new Set())
    if (!indegree.has(key)) indegree.set(key, 0)
  }

  needs.forEach((need, index) => {
    const destinationKey = need.destinationPointKey || `destination:${need.destinationPointLabel}`
    registerPoint(need.sourcePointKey, need.sourcePointLabel, need.sourcePointCity, need.sourcePointAddress, index * 2)
    registerPoint(destinationKey, need.destinationPointLabel, need.destinationPointCity, need.destinationPointAddress, index * 2 + 1)
    if (!edges.get(need.sourcePointKey)!.has(destinationKey)) {
      edges.get(need.sourcePointKey)!.add(destinationKey)
      indegree.set(destinationKey, (indegree.get(destinationKey) || 0) + 1)
    }
  })

  const ready = Array.from(pointMeta.keys())
    .filter((key) => indegree.get(key) === 0)
    .sort((left, right) => pointMeta.get(left)!.firstSeen - pointMeta.get(right)!.firstSeen)
  const orderedKeys: string[] = []
  while (ready.length > 0) {
    const key = ready.shift()!
    orderedKeys.push(key)
    for (const target of edges.get(key) || []) {
      const nextDegree = (indegree.get(target) || 0) - 1
      indegree.set(target, nextDegree)
      if (nextDegree === 0) {
        ready.push(target)
        ready.sort((left, right) => pointMeta.get(left)!.firstSeen - pointMeta.get(right)!.firstSeen)
      }
    }
  }

  const makeStop = (key: string, index: number): TransportDraftStop => {
    const meta = pointMeta.get(key)!
    return {
      clientId: stopId(index, key),
      pointKey: key,
      pointLabel: meta.label,
      city: meta.city,
      address: meta.address,
      kind: 'service',
      plannedTime: addMinutes('08:00', (index + 1) * 60),
      serviceDurationMinutes: 30,
    }
  }

  if (orderedKeys.length === pointMeta.size) {
    const stops = orderedKeys.map(makeStop)
    const stopByPoint = new Map(stops.map((stop) => [stop.pointKey, stop.clientId]))
    return {
      stops,
      assignments: needs.map((need, index) => ({
        needKey: need.key || `need-${index}`,
        pickupStopClientId: stopByPoint.get(need.sourcePointKey)!,
        deliveryStopClientId: stopByPoint.get(need.destinationPointKey || `destination:${need.destinationPointLabel}`)!,
      })),
    }
  }

  const stops: TransportDraftStop[] = []
  const assignments: TransportDraftAssignment[] = []
  let cursor = -1
  needs.forEach((need, needIndex) => {
    const destinationKey = need.destinationPointKey || `destination:${need.destinationPointLabel}`
    let pickupIndex = stops.findIndex((stop, index) => index >= cursor && stop.pointKey === need.sourcePointKey)
    if (pickupIndex < 0) {
      pickupIndex = stops.length
      stops.push(makeStop(need.sourcePointKey, pickupIndex))
    }
    let deliveryIndex = stops.findIndex((stop, index) => index > pickupIndex && stop.pointKey === destinationKey)
    if (deliveryIndex < 0) {
      deliveryIndex = stops.length
      stops.push(makeStop(destinationKey, deliveryIndex))
    }
    cursor = pickupIndex
    assignments.push({
      needKey: need.key || `need-${needIndex}`,
      pickupStopClientId: stops[pickupIndex].clientId,
      deliveryStopClientId: stops[deliveryIndex].clientId,
    })
  })
  return { stops, assignments }
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
