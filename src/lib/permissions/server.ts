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
}

export type UserPermissionDetails = {
  permissions: PermissionMap
  isAdminPosition: boolean
  memberships: DepartmentPermissionMembership[]
  sources: Partial<Record<ResourceKey, string[]>>
  factoryScopes: Partial<Record<ResourceKey, FactoryAccessOperationScopes>>
  companyScopes: Partial<Record<ResourceKey, CompanyAccessOperationScopes>>
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
  user_id: string
  department_id: string
  position_id?: string | null
  is_department_head: boolean
  department?: { id: string; name: string | null; head_user_id?: string | null } | { id: string; name: string | null; head_user_id?: string | null }[] | null
  position?: { id: string; name: string | null; level: number | null } | { id: string; name: string | null; level: number | null }[] | null
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
    isDepartmentHead: Boolean(row.is_department_head || (
      department?.head_user_id && department.head_user_id === row.user_id
    )),
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
    memberships,
    sources,
    factoryScopes: Object.fromEntries(PERMISSION_RESOURCES.map((resource) => [resource.key, { view: 'all', manage: 'all' }])) as Partial<Record<ResourceKey, FactoryAccessOperationScopes>>,
    companyScopes: Object.fromEntries(PERMISSION_RESOURCES.map((resource) => [resource.key, { view: 'all', manage: 'all' }])) as Partial<Record<ResourceKey, CompanyAccessOperationScopes>>,
  }
}

function getCurrentContextAdminPermissions(
  user: Pick<Awaited<ReturnType<typeof getCurrentUserContext>>['user'], 'department_memberships'>,
) {
  const memberships = (user.department_memberships || []).map((membership) => ({
    departmentId: membership.department?.id || '',
    departmentName: membership.department?.name ?? null,
    positionId: membership.position?.id ?? null,
    positionName: membership.position?.name ?? null,
    positionLevel: membership.position?.level ?? null,
    isDepartmentHead: Boolean(membership.is_department_head),
  }))

  if (!memberships.some((membership) => membership.positionName === CRM_ADMIN_POSITION_NAME)) return null
  return makeFullAdminPermissionDetails(memberships)
}

export const getCurrentUserPermissions = cache(async (userId: string): Promise<UserPermissionDetails> => {
  const supabase = await createServerSupabaseClient()
  const db = supabase as unknown as PermissionDb

  const [userResult, membershipResult] = await Promise.all([
    db.from('users').select('id, is_active').eq('id', userId).maybeSingle(),
    db.from('department_members')
      .select('user_id, department_id, position_id, is_department_head, department:departments(id, name, head_user_id), position:positions(id, name, level)')
      .eq('user_id', userId),
  ])
  const { data: userData, error: userError } = userResult

  const userRow = userData as { id: string; is_active: boolean | null } | null
  if (userError || !userRow || userRow.is_active === false) {
    return {
      permissions: getEmptyPermissionMap(),
      isAdminPosition: false,
      memberships: [],
      sources: {},
      factoryScopes: {},
      companyScopes: {},
    }
  }

  const { data: membershipData, error: membershipError } = membershipResult

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
      .select('department_id, subject_scope, resource_key, can_view, can_manage, factory_scope, company_view_scope, company_manage_scope')
      .in('department_id', departmentIds)

    if (accessError) {
      throw new Error(accessError.message || 'Не удалось проверить матрицу доступов отделов')
    }

    accessRows = Array.isArray(accessData) ? (accessData as DepartmentAccessPermissionRow[]) : []
  }

  const { permissions, sources, factoryScopes, companyScopes } = resolveDepartmentPermissions(memberships, accessRows)

  return {
    permissions,
    isAdminPosition: false,
    memberships,
    sources,
    factoryScopes,
    companyScopes,
  }
})

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
  const permissionDetails = getCurrentContextAdminPermissions(context.user)
    ?? await getCurrentUserPermissions(context.user.id)

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
