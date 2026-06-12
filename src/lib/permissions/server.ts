import 'server-only'

import { cache } from 'react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getCurrentUserContext } from '@/lib/auth/current-user'
import {
  PERMISSION_RESOURCES,
  RESOURCE_BY_KEY,
  SWITCHABLE_PERMISSION_RESOURCES,
  getDefaultPermission,
  getDefaultPermissionMap,
  getPermissionRequirementForPath,
  hasResourcePermission,
  isDirectorRole,
  isLockedResource,
  type PermissionMap,
  type PermissionOperation,
  type PermissionState,
  type ResourceKey,
} from '@/lib/permissions/resources'
import type { UserRole } from '@/lib/types'

type PermissionRow = {
  role: UserRole
  resource_key: string
  can_view: boolean
  can_manage: boolean
  updated_by?: string | null
  updated_at?: string | null
}

type PermissionQueryResult<T> = {
  data: T | null
  error: { message?: string } | null
}

type PermissionQuery = PromiseLike<PermissionQueryResult<unknown>> & {
  select: (columns?: string) => PermissionQuery
  eq: (column: string, value: unknown) => PermissionQuery
  order: (column: string, options?: { ascending?: boolean }) => PermissionQuery
  limit: (count: number) => PermissionQuery
  upsert: (values: unknown, options?: { onConflict?: string }) => PermissionQuery
  insert: (values: unknown) => PermissionQuery
}

type PermissionDb = {
  from: (table: string) => PermissionQuery
}

function normalizePermission(row: Pick<PermissionRow, 'can_view' | 'can_manage'>): PermissionState {
  return {
    canView: row.can_view || row.can_manage,
    canManage: row.can_manage,
  }
}

export const getRolePermissionMap = cache(async (role: UserRole): Promise<PermissionMap> => {
  const defaults = getDefaultPermissionMap(role)
  const supabase = await createServerSupabaseClient()
  const db = supabase as unknown as PermissionDb

  const { data, error } = await db
    .from('role_permissions')
    .select('role, resource_key, can_view, can_manage')
    .eq('role', role)

  if (error || !Array.isArray(data)) {
    return defaults
  }

  const map: PermissionMap = { ...defaults }
  for (const row of data as PermissionRow[]) {
    if (row.resource_key in RESOURCE_BY_KEY) {
      map[row.resource_key as ResourceKey] = normalizePermission(row)
    }
  }

  for (const resource of PERMISSION_RESOURCES) {
    if (isLockedResource(resource)) {
      map[resource.key] = getDefaultPermission(resource, role)
    }
  }

  return map
})

export async function canCurrentRoleAccessPath(role: UserRole, permissions: PermissionMap, pathname: string) {
  const requirement = getPermissionRequirementForPath(pathname)
  if (!requirement) return true
  return hasResourcePermission(role, permissions, requirement.resourceKey, requirement.operation)
}

export async function requirePermission(resourceKey: ResourceKey, operation: PermissionOperation) {
  const context = await getCurrentUserContext()
  const permissions = await getRolePermissionMap(context.role)

  if (!hasResourcePermission(context.role, permissions, resourceKey, operation)) {
    throw new Error('Недостаточно прав')
  }

  return context
}

export async function requireAccessSettingsPermission() {
  const context = await getCurrentUserContext()
  if (!isDirectorRole(context.role)) {
    throw new Error('Недостаточно прав для управления матрицей доступа')
  }
  return context
}

export async function getAllRolePermissionRows() {
  const supabase = await createServerSupabaseClient()
  const db = supabase as unknown as PermissionDb
  const { data, error } = await db
    .from('role_permissions')
    .select('role, resource_key, can_view, can_manage, updated_by, updated_at')

  if (error || !Array.isArray(data)) {
    return []
  }

  return data as PermissionRow[]
}

export function buildPermissionMatrix(rows: PermissionRow[]) {
  const matrix = new Map<string, PermissionState>()
  for (const row of rows) {
    matrix.set(`${row.role}:${row.resource_key}`, normalizePermission(row))
  }
  return matrix
}
