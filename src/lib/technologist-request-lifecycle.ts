import type { OrderItemStatus, RequestStatus } from '@/lib/types'

export type RequestLifecycleStatus =
  | 'draft'
  | 'stock_check'
  | 'submitted_to_supply'
  | 'delivery'
  | 'received'
  | 'cancelled'

export const REQUEST_LIFECYCLE_LABELS: Record<RequestLifecycleStatus, string> = {
  draft: 'Черновик',
  stock_check: 'Проверка склада',
  submitted_to_supply: 'Отправлена в снабжение',
  delivery: 'Доставка',
  received: 'Принята на склад',
  cancelled: 'Отменена',
}

export function deriveRequestLifecycleStatus(
  request: { status: RequestStatus },
  orderStatuses: OrderItemStatus[],
): RequestLifecycleStatus {
  if (request.status === 'cancelled') return 'cancelled'
  if (request.status === 'draft') return 'draft'
  if (request.status === 'pending_stock_check' || request.status === 'stock_checked') return 'stock_check'
  if (request.status === 'completed') return 'received'

  if (orderStatuses.length > 0 && orderStatuses.every((status) => status === 'cancelled')) {
    return 'cancelled'
  }

  const activeOrderStatuses = orderStatuses.filter((status) => status !== 'cancelled')
  if (activeOrderStatuses.length > 0 && activeOrderStatuses.every((status) => status === 'delivered')) {
    return 'received'
  }
  if (activeOrderStatuses.some((status) => status === 'ordered' || status === 'delivered')) {
    return 'delivery'
  }
  return 'submitted_to_supply'
}
