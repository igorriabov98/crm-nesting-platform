import 'server-only'

import { cache } from 'react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getCurrentUserContext } from '@/lib/auth/current-user'
import {
  resolveDepartmentPermissions,
  shouldUseLegacyPermissionFallback,
  type DepartmentAccessPermissionRow,
} from '@/lib/permissions/resolve'
import {
  PERMISSION_RESOURCES,
  RESOURCE_BY_KEY,
  getDefaultPermission,
  getDefaultPermissionMap,
  getEmptyPermissionMap,
  getFullPermissionMap,
  getPermissionRequirementForPath,
  hasPermission,
  hasResourcePermission,
  isLockedResource,
  type PermissionMap,
  type PermissionOperation,
  type PermissionState,
  type ResourceKey,
} from '@/lib/permissions/resources'
import type { UserRole } from '@/lib/types'

export const CRM_ADMIN_POSITION_NAME = 'Администратор CRM'

type PermissionRow = {
  role: UserRole
  resource_key: string
  can_view: boolean
  can_manage: boolean
  updated_by?: string | null
  updated_at?: string | null
}

export type DepartmentPermissionMembership = {
  departmentId: string
  departmentName: string | null
  positionId: string | null
  positionName: string | null
  positionLevel: number | null
  isDepartmentHead: boolean
}

export type UserPermissionDetails = {
  permissions: PermissionMap
  isAdminPosition: boolean
  usedLegacyFallback: boolean
  memberships: DepartmentPermissionMembership[]
  sources: Partial<Record<ResourceKey, string[]>>
}

type PermissionQueryResult<T> = {
  data: T | null
  error: { message?: string } | null
}

type PermissionQuery = PromiseLike<PermissionQueryResult<unknown>> & {
  select: (columns?: string) => PermissionQuery
  eq: (column: string, value: unknown) => PermissionQuery
  in: (column: string, values: unknown[]) => PermissionQuery
  order: (column: string, options?: { ascending?: boolean }) => PermissionQuery
  limit: (count: number) => PermissionQuery
  maybeSingle: () => PermissionQuery
  upsert: (values: unknown, options?: { onConflict?: string }) => PermissionQuery
  insert: (values: unknown) => PermissionQuery
}

type PermissionDb = {
  from: (table: string) => PermissionQuery
}

type MembershipQueryRow = {
  department_id: string
  position_id?: string | null
  is_department_head: boolean
  department?: { id: string; name: string | null } | { id: string; name: string | null }[] | null
  position?: { id: string; name: string | null; level: number | null } | { id: string; name: string | null; level: number | null }[] | null
}

function normalizePermission(row: Pick<PermissionRow, 'can_view' | 'can_manage'>): PermissionState {
  return {
    canView: row.can_view || row.can_manage,
    canManage: row.can_manage,
  }
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function normalizeMembership(row: MembershipQueryRow): DepartmentPermissionMembership {
  const department = relationOne(row.department)
  const position = relationOne(row.position)
  return {
    departmentId: row.department_id,
    departmentName: department?.name ?? null,
    positionId: row.position_id ?? position?.id ?? null,
    positionName: position?.name ?? null,
    positionLevel: typeof position?.level === 'number' ? position.level : null,
    isDepartmentHead: Boolean(row.is_department_head),
  }
}

function makeFullAdminPermissionDetails(memberships: DepartmentPermissionMembership[]): UserPermissionDetails {
  const permissions = getFullPermissionMap()
  const sources: Partial<Record<ResourceKey, string[]>> = {}
  for (const resource of PERMISSION_RESOURCES) {
    sources[resource.key] = [CRM_ADMIN_POSITION_NAME]
  }
  return {
    permissions,
    isAdminPosition: true,
    usedLegacyFallback: false,
    memberships,
    sources,
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

export const getCurrentUserPermissions = cache(async (userId: string): Promise<UserPermissionDetails> => {
  const supabase = await createServerSupabaseClient()
  const db = supabase as unknown as PermissionDb

  const { data: userData, error: userError } = await db
    .from('users')
    .select('id, role, is_active')
    .eq('id', userId)
    .maybeSingle()

  const userRow = userData as { id: string; role: UserRole | null; is_active: boolean | null } | null
  if (userError || !userRow || userRow.is_active === false) {
    return {
      permissions: getEmptyPermissionMap(),
      isAdminPosition: false,
      usedLegacyFallback: false,
      memberships: [],
      sources: {},
    }
  }

  const { data: membershipData, error: membershipError } = await db
    .from('department_members')
    .select('department_id, position_id, is_department_head, department:departments(id, name), position:positions(id, name, level)')
    .eq('user_id', userId)

  if (membershipError) {
    throw new Error(membershipError.message || 'Не удалось проверить отделы пользователя')
  }

  const memberships = Array.isArray(membershipData)
    ? (membershipData as MembershipQueryRow[]).map(normalizeMembership)
    : []

  if (memberships.some((membership) => membership.positionName === CRM_ADMIN_POSITION_NAME)) {
    return makeFullAdminPermissionDetails(memberships)
  }

  const departmentIds = Array.from(new Set(memberships.map((membership) => membership.departmentId).filter(Boolean)))

  let accessRows: DepartmentAccessPermissionRow[] = []
  if (departmentIds.length > 0) {
    const { data: accessData, error: accessError } = await db
      .from('department_access_permissions')
      .select('department_id, subject_scope, resource_key, can_view, can_manage')
      .in('department_id', departmentIds)

    if (accessError) {
      throw new Error(accessError.message || 'Не удалось проверить матрицу доступов отделов')
    }

    accessRows = Array.isArray(accessData) ? (accessData as DepartmentAccessPermissionRow[]) : []
  }

  const { permissions, sources, appliedDepartmentRows } = resolveDepartmentPermissions(memberships, accessRows)

  if (shouldUseLegacyPermissionFallback(appliedDepartmentRows) && userRow.role) {
    const legacyPermissions = await getRolePermissionMap(userRow.role)
    const legacySources: Partial<Record<ResourceKey, string[]>> = {}
    for (const resource of PERMISSION_RESOURCES) {
      const permission = legacyPermissions[resource.key]
      if (!permission?.canView && !permission?.canManage) continue
      legacySources[resource.key] = ['Legacy role fallback']
    }
    return {
      permissions: legacyPermissions,
      isAdminPosition: false,
      usedLegacyFallback: true,
      memberships,
      sources: legacySources,
    }
  }

  return {
    permissions,
    isAdminPosition: false,
    usedLegacyFallback: false,
    memberships,
    sources,
  }
})

export async function canCurrentRoleAccessPath(role: UserRole, permissions: PermissionMap, pathname: string) {
  const requirement = getPermissionRequirementForPath(pathname)
  if (!requirement) return true
  return hasResourcePermission(role, permissions, requirement.resourceKey, requirement.operation)
}

export async function canCurrentUserAccessPath(permissions: PermissionMap, pathname: string) {
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

export async function requireAccessSettingsPermission() {
  return requirePermission('access_settings', 'manage')
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
