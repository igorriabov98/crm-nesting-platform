import { ROUTES } from '@/lib/constants/routes'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isBusinessScrapReservationStatus(status: string) {
  return status === 'pending_stock_check' || status === 'stock_checked'
}

export function isSupplyWarehouseReservationStatus(status: string) {
  return status === 'submitted_to_supply'
}

export function normalizeSupplyRequestId(value: string | null | undefined) {
  const requestId = value?.trim() || ''
  return UUID_PATTERN.test(requestId) ? requestId : null
}

export function getSupplyOrdersForRequestHref(requestId: string) {
  const params = new URLSearchParams({
    view: 'details',
    request: requestId,
  })
  return `${ROUTES.SUPPLY_ORDERS}?${params.toString()}`
}
