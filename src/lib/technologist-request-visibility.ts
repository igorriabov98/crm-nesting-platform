import type { RequestStatus } from '@/lib/types'
import { hasPermission, type PermissionMap } from '@/lib/permissions/resources'

export const REQUEST_SECTION_TABLES = [
  'request_sheet_metal', 'request_round_tube', 'request_circle', 'request_pipe',
  'request_knives', 'request_components', 'request_paint', 'request_mesh', 'request_chain_cord',
] as const

export function isRequestVisibleForPermissions(request: { status: RequestStatus }, permissions: PermissionMap) {
  const isSupplyOnly = hasPermission(permissions, 'supply_material_requests', 'view')
    && !hasPermission(permissions, 'technologist_requests', 'manage')
  return !isSupplyOnly || request.status === 'submitted_to_supply' || request.status === 'completed'
}

export function isListedTechnologistRequest(
  request: { id: string; status: RequestStatus; is_recalculation_staging?: boolean | null },
  itemPresence: ReadonlySet<string>,
  revisionDraftIds: ReadonlySet<string>,
) {
  if (request.is_recalculation_staging) return false
  const isDraft = request.status === 'draft' || revisionDraftIds.has(request.id)
  return !isDraft || itemPresence.has(request.id)
}
