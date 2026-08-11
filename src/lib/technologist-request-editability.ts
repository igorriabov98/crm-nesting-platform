import type { RequestStatus } from '@/lib/types'

const EDITABLE_REQUEST_STATUSES = new Set<RequestStatus>([
  'draft',
  'pending_stock_check',
  'stock_checked',
])

export function isTechnologistRequestEditable(status: RequestStatus) {
  return EDITABLE_REQUEST_STATUSES.has(status)
}

export function assertTechnologistRequestEditable(status: RequestStatus) {
  if (isTechnologistRequestEditable(status)) return
  throw new Error('Заявка уже передана в снабжение и доступна только для просмотра')
}
