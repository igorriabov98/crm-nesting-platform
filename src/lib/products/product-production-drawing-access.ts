import 'server-only'

import { hasPermission, type PermissionOperation } from '@/lib/permissions/resources'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'

export async function requireProductProductionDrawingAccess(operation: PermissionOperation) {
  const context = await requirePermission('products', 'view')
  if (!hasPermission(context.permissions, 'product_production_drawings', operation)) {
    throw new PermissionDeniedError('product_production_drawings', operation)
  }
  return context
}
