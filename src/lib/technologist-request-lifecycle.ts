import type { OrderItemStatus, RequestStatus } from '@/lib/types'

export type RequestLifecycleStatus =
  | 'draft'
  | 'stock_check'
  | 'financial_approval'
  | 'returned'
  | 'submitted_to_supply'
  | 'delivery'
  | 'received'
  | 'cancelled'

export const REQUEST_LIFECYCLE_LABELS: Record<RequestLifecycleStatus, string> = {
  draft: 'Черновик',
  stock_check: 'Проверка склада',
  financial_approval: 'На финансовом согласовании',
  returned: 'Возвращена на доработку',
  submitted_to_supply: 'Отправлена в снабжение',
  delivery: 'Доставка',
  received: 'Принята на склад',
  cancelled: 'Отменена',
}

export function deriveRequestLifecycleStatus(
  request: { status: RequestStatus },
  orderStatuses: OrderItemStatus[],
  approvalState?: string | null,
): RequestLifecycleStatus {
  if (request.status === 'cancelled') return 'cancelled'
  if (request.status === 'draft') return 'draft'
  if (approvalState === 'returned' && (request.status === 'pending_stock_check' || request.status === 'stock_checked')) return 'returned'
  if (request.status === 'pending_financial_approval') return 'financial_approval'
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
