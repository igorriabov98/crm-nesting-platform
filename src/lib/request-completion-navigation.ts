import { ROUTES, type AppRoute } from '@/lib/constants/routes'
import type { RequestStatus } from '@/lib/types'

type CompletionWorkspaceNavigation =
  | { kind: 'open' }
  | { kind: 'redirect'; href: AppRoute }
  | { kind: 'unavailable' }

export function resolveCompletionWorkspaceNavigation(status: RequestStatus): CompletionWorkspaceNavigation {
  if (status === 'pending_stock_check' || status === 'stock_checked') return { kind: 'open' }
  if (status === 'submitted_to_supply' || status === 'completed') {
    return { kind: 'redirect', href: ROUTES.MATERIAL_REQUESTS }
  }
  return { kind: 'unavailable' }
}
