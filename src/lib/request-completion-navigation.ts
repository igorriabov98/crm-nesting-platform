import { ROUTES, type AppRoute } from '@/lib/constants/routes'
import type { RequestStatus } from '@/lib/types'

type CompletionWorkspaceNavigation =
  | { kind: 'open' }
  | { kind: 'redirect'; href: AppRoute }
  | { kind: 'unavailable' }

export function resolveCompletionWorkspaceNavigation(status: RequestStatus, requestId?: string): CompletionWorkspaceNavigation {
  if (status === 'stock_checked') return { kind: 'open' }
  if (status === 'pending_stock_check' && requestId) {
    return { kind: 'redirect', href: `${ROUTES.SUPPLY_REQUEST}/${requestId}` as AppRoute }
  }
  if (status === 'pending_financial_approval' || status === 'submitted_to_supply' || status === 'completed') {
    return { kind: 'redirect', href: requestId
      ? `${ROUTES.TECHNOLOGIST_REQUEST_RESULTS}/${requestId}` as AppRoute
      : ROUTES.TECHNOLOGIST_REQUEST_RESULTS }
  }
  return { kind: 'unavailable' }
}
