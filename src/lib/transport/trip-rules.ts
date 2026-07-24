export type TransportRouteNeed = {
  sourcePointKey: string
  sourcePointLabel: string
  destinationPointLabel: string
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
