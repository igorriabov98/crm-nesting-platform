import 'server-only'

import { cache } from 'react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { AuthRequiredError, getCurrentUserContext } from '@/lib/auth/current-user'
import {
  resolveDepartmentPermissions,
  type DepartmentAccessPermissionRow,
  type CompanyAccessOperationScopes,
  type FactoryAccessOperationScopes,
} from '@/lib/permissions/resolve'
import {
  PERMISSION_RESOURCES,
  getEmptyPermissionMap,
  getFullPermissionMap,
  getPermissionRequirementForPath,
  hasPermission,
  type PermissionMap,
  type PermissionOperation,
  type ResourceKey,
} from '@/lib/permissions/resources'

export const CRM_ADMIN_POSITION_NAME = 'Администратор CRM'

export type DepartmentPermissionMembership = {
  departmentId: string
  departmentName: string | null
  positionId: string | null
  positionName: string | null
  positionLevel: number | null
  isDepartmentHead: boolean
  id?: string
  isPrimary?: boolean
}

export type UserPermissionDetails = {
  version?: string
  userId?: string
  permissions: PermissionMap
  isAdminPosition: boolean
  memberships: DepartmentPermissionMembership[]
  sources: Partial<Record<ResourceKey, string[]>>
  factoryScopes: Partial<Record<ResourceKey, FactoryAccessOperationScopes>>
  companyScopes: Partial<Record<ResourceKey, CompanyAccessOperationScopes>>
}

export type AccessSnapshotInput = {
  userId: string
  version: string
  isActive: boolean
  hasAdminStatus: boolean
  isAdmin: boolean
  fullName: string | null
  email: string
  memberships: DepartmentPermissionMembership[]
  accessRows: DepartmentAccessPermissionRow[]
}

export function resolveAccessSnapshot(snapshot: AccessSnapshotInput): UserPermissionDetails {
  const empty = { permissions: getEmptyPermissionMap(), isAdminPosition: false, memberships: snapshot.memberships,
    sources: {}, factoryScopes: {}, companyScopes: {}, version: snapshot.version, userId: snapshot.userId }
  if (!snapshot.isActive) return empty
  if (snapshot.isAdmin) return {
    ...empty, permissions: getFullPermissionMap(), isAdminPosition: true,
    sources: Object.fromEntries(PERMISSION_RESOURCES.map(r => [r.key, [CRM_ADMIN_POSITION_NAME]])),
    factoryScopes: Object.fromEntries(PERMISSION_RESOURCES.map(r => [r.key, {view: 'all', manage: 'all'}])),
    companyScopes: Object.fromEntries(PERMISSION_RESOURCES.map(r => [r.key, {view: 'all', manage: 'all'}])),
  }
  return { ...empty, ...resolveDepartmentPermissions(snapshot.memberships, snapshot.accessRows) }
}

export const getAccessSnapshot = cache(async (userId: string): Promise<AccessSnapshotInput> => {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await (supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{data: unknown; error: {message: string} | null}>
  }).rpc('crm_access_snapshot', {p_user_id: userId})
  if (error || !data) throw new Error(error?.message || 'Не удалось проверить доступ')
  return data as AccessSnapshotInput
})

export const getCurrentUserPermissions = cache(async (userId: string): Promise<UserPermissionDetails> =>
  resolveAccessSnapshot(await getAccessSnapshot(userId)))

export async function canCurrentUserAccessPath(permissions: PermissionMap, pathname: string) {
  if (pathname === '/admin/organization') return hasPermission(permissions, 'admin_users', 'view') || hasPermission(permissions, 'departments', 'view')
  const requirement = getPermissionRequirementForPath(pathname)
  if (!requirement) return true
  return hasPermission(permissions, requirement.resourceKey, requirement.operation)
}

export class PermissionDeniedError extends Error {
  readonly resourceKey: ResourceKey
  readonly operation: PermissionOperation

  constructor(resourceKey: ResourceKey, operation: PermissionOperation) {
    super('Недостаточно прав')
    this.name = 'PermissionDeniedError'
    this.resourceKey = resourceKey
    this.operation = operation
  }
}

type PermissionRequirement = {
  resourceKey: ResourceKey
  operation: PermissionOperation
}

export async function requireAnyPermission(requirements: readonly PermissionRequirement[]) {
  if (requirements.length === 0) throw new Error('Не задано ни одного требуемого права')
  const context = await getCurrentUserContext()
  const permissionDetails = await getCurrentUserPermissions(context.user.id)

  if (!requirements.some(({ resourceKey, operation }) =>
    hasPermission(permissionDetails.permissions, resourceKey, operation))) {
    throw new PermissionDeniedError(requirements[0].resourceKey, requirements[0].operation)
  }

  return {
    ...context,
    permissions: permissionDetails.permissions,
    permissionDetails,
  }
}

export async function requirePermission(resourceKey: ResourceKey, operation: PermissionOperation) {
  return requireAnyPermission([{ resourceKey, operation }])
}

// Read-only lookups need authorization, not the factory/UI profile context.
// Reuse the same live Auth validation and permission resolver as other actions.
export async function requireReadPermissionDataClient(resourceKey: ResourceKey) {
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new AuthRequiredError()
  const permissionDetails = await getCurrentUserPermissions(user.id)
  if (!hasPermission(permissionDetails.permissions, resourceKey, 'view')) {
    throw new PermissionDeniedError(resourceKey, 'view')
  }
  return { supabase, userId: user.id }
}

export async function requireAccessSettingsPermission() {
  return requirePermission('access_settings', 'manage')
}
