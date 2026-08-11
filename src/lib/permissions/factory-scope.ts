import {
  DIRECTOR_ACCESS_ROLES,
  type PermissionOperation,
  type ResourceKey,
} from '@/lib/permissions/resources'
import type { FactoryAccessOperationScopes } from '@/lib/permissions/resolve'

export type FactoryScopedPermissionContext = {
  role: string
  factoryId: string | null
  permissionDetails: {
    isAdminPosition: boolean
    factoryScopes: Partial<Record<ResourceKey, FactoryAccessOperationScopes>>
  }
}

export function canAccessAllFactories(
  permission: FactoryScopedPermissionContext,
  resourceKey: ResourceKey,
  operation: PermissionOperation,
) {
  return permission.permissionDetails.isAdminPosition
    || (DIRECTOR_ACCESS_ROLES as readonly string[]).includes(permission.role)
    || permission.permissionDetails.factoryScopes[resourceKey]?.[operation] === 'all'
}

export function canAccessFactory(
  permission: FactoryScopedPermissionContext,
  resourceKey: ResourceKey,
  operation: PermissionOperation,
  factoryId: string | null | undefined,
) {
  if (!factoryId) return false
  return canAccessAllFactories(permission, resourceKey, operation) || permission.factoryId === factoryId
}

export function assertFactoryAccess(
  permission: FactoryScopedPermissionContext,
  resourceKey: ResourceKey,
  operation: PermissionOperation,
  factoryId: string | null | undefined,
) {
  if (canAccessFactory(permission, resourceKey, operation, factoryId)) return
  throw new Error('Недостаточно прав для выбранного завода')
}
