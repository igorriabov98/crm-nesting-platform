'use server'

import { revalidatePath } from 'next/cache'
import { ROUTES } from '@/lib/constants/routes'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  PERMISSION_RESOURCES,
  RESOURCE_BY_KEY,
  getDefaultPermission,
  getDefaultPermissionMap,
  getEmptyPermissionMap,
  getFullPermissionMap,
  isLockedResource,
  type PermissionMap,
  type PermissionState,
  type ResourceKey,
} from '@/lib/permissions/resources'
import {
  CRM_ADMIN_POSITION_NAME,
  requireAccessSettingsPermission,
  type DepartmentPermissionMembership,
} from '@/lib/permissions/server'
import type { UserRole } from '@/lib/types'

export type DepartmentAccessSubjectScope = 'head' | 'member'

type DepartmentAccessRow = {
  department_id: string
  subject_scope: DepartmentAccessSubjectScope
  resource_key: string
  can_view: boolean
  can_manage: boolean
  updated_by?: string | null
  updated_at?: string | null
}

type LegacyPermissionRow = {
  role: UserRole
  resource_key: string
  can_view: boolean
  can_manage: boolean
}

type DepartmentRow = {
  id: string
  name: string
  is_active: boolean
  sort_order?: number | null
}

type PositionRow = {
  id: string
  name: string
  level: number | null
  is_active: boolean
}

type UserRow = {
  id: string
  full_name: string | null
  email: string
  role: UserRole | null
  is_active: boolean | null
}

type MembershipRow = {
  id: string
  user_id: string
  department_id: string
  position_id: string | null
  is_department_head: boolean
  department?: { id: string; name: string | null } | { id: string; name: string | null }[] | null
  position?: { id: string; name: string | null; level: number | null } | { id: string; name: string | null; level: number | null }[] | null
  user?: { id: string; full_name: string | null; email: string; is_active: boolean | null } | { id: string; full_name: string | null; email: string; is_active: boolean | null }[] | null
}

type AuditRow = {
  id: string
  department_id: string
  subject_scope: DepartmentAccessSubjectScope
  resource_key: string
  old_can_view: boolean | null
  old_can_manage: boolean | null
  new_can_view: boolean
  new_can_manage: boolean
  changed_by: string | null
  changed_at: string
  user?: { full_name: string | null } | { full_name: string | null }[] | null
  department?: { name: string | null } | { name: string | null }[] | null
}

type DbResult<T = unknown> = {
  data: T | null
  error: { message?: string } | null
}

type LooseQuery<T = unknown> = PromiseLike<DbResult<T>> & {
  select: (columns?: string) => LooseQuery<T>
  eq: (column: string, value: unknown) => LooseQuery<T>
  in: (column: string, values: unknown[]) => LooseQuery<T>
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery<T>
  limit: (count: number) => LooseQuery<T>
  maybeSingle: () => LooseQuery<T>
  upsert: (values: unknown, options?: { onConflict?: string }) => LooseQuery<T>
  insert: (values: unknown) => LooseQuery<T>
}

type LooseDb = {
  from: <T = unknown>(table: string) => LooseQuery<T>
}

type LooseAuthAdminClient = LooseDb & {
  auth: {
    admin: {
      listUsers: (params: { page: number; perPage: number }) => Promise<{
        data: { users: Array<{ id: string }> }
        error: { message?: string } | null
      }>
    }
  }
}

export type DepartmentAccessPermissionInput = {
  departmentId: string
  subjectScope: DepartmentAccessSubjectScope
  resourceKey: ResourceKey
  canView: boolean
  canManage: boolean
}

export type RolePermissionInput = DepartmentAccessPermissionInput

export type AccessUserSummary = {
  id: string
  fullName: string | null
  email: string
  isActive: boolean
  departments: string[]
  positions: string[]
  isDepartmentHead: boolean
  isAdminPosition: boolean
}

export type UserAccessPreview = {
  userId: string
  fullName: string | null
  email: string
  isActive: boolean
  isAdminPosition: boolean
  usedLegacyFallback: boolean
  memberships: DepartmentPermissionMembership[]
  permissions: Array<{
    resourceKey: ResourceKey
    label: string
    group: string
    canView: boolean
    canManage: boolean
    sources: string[]
  }>
}

export type RolePermissionsPageData = {
  departments: Array<{
    id: string
    name: string
    isActive: boolean
  }>
  resources: Array<{
    key: ResourceKey
    label: string
    description?: string
    group: string
  }>
  permissions: DepartmentAccessPermissionInput[]
  auditLog: Array<{
    id: string
    departmentId: string
    departmentName: string | null
    subjectScope: DepartmentAccessSubjectScope
    resourceKey: ResourceKey
    oldCanView: boolean | null
    oldCanManage: boolean | null
    newCanView: boolean
    newCanManage: boolean
    changedAt: string
    changedByName: string | null
  }>
  adminUsers: AccessUserSummary[]
  previewUsers: AccessUserSummary[]
}

function accessKey(departmentId: string, subjectScope: DepartmentAccessSubjectScope, resourceKey: ResourceKey) {
  return `${departmentId}:${subjectScope}:${resourceKey}`
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function normalizeState(input: Pick<DepartmentAccessPermissionInput, 'canView' | 'canManage'>): PermissionState {
  return {
    canView: input.canView || input.canManage,
    canManage: input.canManage,
  }
}

function normalizeMembership(row: MembershipRow): DepartmentPermissionMembership {
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

function normalizeLegacyPermission(row: Pick<LegacyPermissionRow, 'can_view' | 'can_manage'>): PermissionState {
  return {
    canView: row.can_view || row.can_manage,
    canManage: row.can_manage,
  }
}

async function getDepartments(db: LooseDb) {
  const { data, error } = await db
    .from<DepartmentRow[]>('departments')
    .select('id, name, is_active, sort_order')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw new Error(error.message || 'Не удалось загрузить отделы')
  return Array.isArray(data) ? data : []
}

async function getAuthUserIds(client: LooseAuthAdminClient) {
  const authUserIds = new Set<string>()
  const perPage = 1000
  let page = 1

  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(error.message || 'Не удалось загрузить пользователей авторизации')

    for (const authUser of data.users) {
      authUserIds.add(authUser.id)
    }

    if (data.users.length < perPage) break
    page += 1
  }

  return authUserIds
}

async function getUsers(client: LooseAuthAdminClient) {
  const [{ data, error }, authUserIds] = await Promise.all([
    client
      .from<UserRow[]>('users')
      .select('id, full_name, email, role, is_active')
      .order('full_name', { ascending: true }),
    getAuthUserIds(client),
  ])

  if (error) throw new Error(error.message || 'Не удалось загрузить пользователей')
  return Array.isArray(data) ? data.filter((user) => authUserIds.has(user.id)) : []
}

async function getMembershipRows(db: LooseDb) {
  const { data, error } = await db
    .from<MembershipRow[]>('department_members')
    .select('id, user_id, department_id, position_id, is_department_head, department:department_id(id, name), position:position_id(id, name, level), user:user_id(id, full_name, email, is_active)')

  if (error) throw new Error(error.message || 'Не удалось загрузить назначения пользователей')
  return Array.isArray(data) ? data : []
}

async function getAccessRows(db: LooseDb) {
  const { data, error } = await db
    .from<DepartmentAccessRow[]>('department_access_permissions')
    .select('department_id, subject_scope, resource_key, can_view, can_manage, updated_by, updated_at')

  if (error) throw new Error(error.message || 'Не удалось загрузить права доступа отделов')
  return Array.isArray(data) ? data : []
}

async function getAuditRows(db: LooseDb) {
  const { data, error } = await db
    .from<AuditRow[]>('department_access_audit_log')
    .select('id, department_id, subject_scope, resource_key, old_can_view, old_can_manage, new_can_view, new_can_manage, changed_by, changed_at, user:users(full_name), department:departments(name)')
    .order('changed_at', { ascending: false })
    .limit(30)

  if (error) return []
  return Array.isArray(data) ? data : []
}

function buildAccessInputs(departments: DepartmentRow[], rows: DepartmentAccessRow[]) {
  const matrix = new Map<string, PermissionState>()
  for (const row of rows) {
    if (!(row.resource_key in RESOURCE_BY_KEY)) continue
    matrix.set(accessKey(row.department_id, row.subject_scope, row.resource_key as ResourceKey), {
      canView: row.can_view || row.can_manage,
      canManage: row.can_manage,
    })
  }

  return departments.flatMap((department) =>
    (['head', 'member'] as const).flatMap((subjectScope) =>
      PERMISSION_RESOURCES.map((resource) => {
        const state = matrix.get(accessKey(department.id, subjectScope, resource.key)) || {
          canView: false,
          canManage: false,
        }
        return {
          departmentId: department.id,
          subjectScope,
          resourceKey: resource.key,
          canView: state.canView,
          canManage: state.canManage,
        }
      })
    )
  )
}

function buildUserSummaries(users: UserRow[], memberships: MembershipRow[]) {
  const byUser = new Map<string, AccessUserSummary>()
  for (const user of users) {
    byUser.set(user.id, {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      isActive: user.is_active !== false,
      departments: [],
      positions: [],
      isDepartmentHead: false,
      isAdminPosition: false,
    })
  }

  for (const membership of memberships) {
    const user = byUser.get(membership.user_id)
    if (!user) continue
    const department = relationOne(membership.department)
    const position = relationOne(membership.position)
    if (department?.name && !user.departments.includes(department.name)) {
      user.departments.push(department.name)
    }
    if (position?.name && !user.positions.includes(position.name)) {
      user.positions.push(position.name)
    }
    user.isDepartmentHead = user.isDepartmentHead || Boolean(membership.is_department_head)
    user.isAdminPosition = user.isAdminPosition || position?.name === CRM_ADMIN_POSITION_NAME
  }

  return Array.from(byUser.values()).sort((a, b) =>
    (a.fullName || a.email).localeCompare(b.fullName || b.email, 'ru')
  )
}

async function getLegacyPermissionMap(db: LooseDb, role: UserRole): Promise<PermissionMap> {
  const defaults = getDefaultPermissionMap(role)
  const { data } = await db
    .from<LegacyPermissionRow[]>('role_permissions')
    .select('role, resource_key, can_view, can_manage')
    .eq('role', role)

  const map: PermissionMap = { ...defaults }
  if (Array.isArray(data)) {
    for (const row of data) {
      if (row.resource_key in RESOURCE_BY_KEY) {
        map[row.resource_key as ResourceKey] = normalizeLegacyPermission(row)
      }
    }
  }

  for (const resource of PERMISSION_RESOURCES) {
    if (isLockedResource(resource)) {
      map[resource.key] = getDefaultPermission(resource, role)
    }
  }

  return map
}

function addSource(
  sources: Partial<Record<ResourceKey, string[]>>,
  resourceKey: ResourceKey,
  source: string,
) {
  sources[resourceKey] = Array.from(new Set([...(sources[resourceKey] || []), source]))
}

async function buildUserAccessPreview(db: LooseDb, userId: string): Promise<UserAccessPreview> {
  const { data: userData, error: userError } = await db
    .from<UserRow>('users')
    .select('id, full_name, email, role, is_active')
    .eq('id', userId)
    .maybeSingle()

  if (userError || !userData) {
    throw new Error(userError?.message || 'Пользователь не найден')
  }

  const { data: membershipData } = await db
    .from<MembershipRow[]>('department_members')
    .select('id, user_id, department_id, position_id, is_department_head, department:departments(id, name), position:positions(id, name, level)')
    .eq('user_id', userId)

  const memberships = Array.isArray(membershipData)
    ? membershipData.map(normalizeMembership)
    : []

  const isAdminPosition = memberships.some((membership) => membership.positionName === CRM_ADMIN_POSITION_NAME)
  let usedLegacyFallback = false
  let permissions = isAdminPosition ? getFullPermissionMap() : getEmptyPermissionMap()
  const sources: Partial<Record<ResourceKey, string[]>> = {}

  if (isAdminPosition) {
    for (const resource of PERMISSION_RESOURCES) {
      sources[resource.key] = [CRM_ADMIN_POSITION_NAME]
    }
  } else if (userData.is_active === false) {
    permissions = getEmptyPermissionMap()
  } else {
    const departmentIds = Array.from(new Set(memberships.map((membership) => membership.departmentId).filter(Boolean)))
    let appliedDepartmentRows = 0

    if (departmentIds.length > 0) {
      const { data: accessData } = await db
        .from<DepartmentAccessRow[]>('department_access_permissions')
        .select('department_id, subject_scope, resource_key, can_view, can_manage')
        .in('department_id', departmentIds)

      const rows = Array.isArray(accessData) ? accessData : []
      for (const membership of memberships) {
        const subjectScope: DepartmentAccessSubjectScope = membership.isDepartmentHead ? 'head' : 'member'
        const source = `${membership.departmentName || 'Отдел'} · ${subjectScope === 'head' ? 'Начальник отдела' : 'Подчинённый'}`
        for (const row of rows) {
          if (row.department_id !== membership.departmentId || row.subject_scope !== subjectScope) continue
          if (!(row.resource_key in RESOURCE_BY_KEY)) continue
          const resourceKey = row.resource_key as ResourceKey
          const current = permissions[resourceKey] || { canView: false, canManage: false }
          permissions[resourceKey] = {
            canView: current.canView || row.can_view || row.can_manage,
            canManage: current.canManage || row.can_manage,
          }
          if (row.can_view || row.can_manage) addSource(sources, resourceKey, source)
          appliedDepartmentRows += 1
        }
      }
    }

    if (appliedDepartmentRows === 0 && userData.role) {
      permissions = await getLegacyPermissionMap(db, userData.role)
      usedLegacyFallback = true
      for (const resource of PERMISSION_RESOURCES) {
        const state = permissions[resource.key]
        if (state?.canView || state?.canManage) {
          sources[resource.key] = ['Legacy role fallback']
        }
      }
    }
  }

  return {
    userId,
    fullName: userData.full_name,
    email: userData.email,
    isActive: userData.is_active !== false,
    isAdminPosition,
    usedLegacyFallback,
    memberships,
    permissions: PERMISSION_RESOURCES.map((resource) => {
      const state = permissions[resource.key] || { canView: false, canManage: false }
      return {
        resourceKey: resource.key,
        label: resource.label,
        group: resource.group,
        canView: state.canView,
        canManage: state.canManage,
        sources: sources[resource.key] || [],
      }
    }),
  }
}

export async function getRolePermissionsPageData(): Promise<{ data: RolePermissionsPageData | null; error: string | null }> {
  try {
    await requireAccessSettingsPermission()
    const db = createAdminClient() as unknown as LooseAuthAdminClient
    const [departments, users, memberships, accessRows, auditRows] = await Promise.all([
      getDepartments(db),
      getUsers(db),
      getMembershipRows(db),
      getAccessRows(db),
      getAuditRows(db),
    ])
    const userSummaries = buildUserSummaries(users, memberships)

    return {
      data: {
        departments: departments.map((department) => ({
          id: department.id,
          name: department.name,
          isActive: department.is_active,
        })),
        resources: PERMISSION_RESOURCES.map((resource) => ({
          key: resource.key,
          label: resource.label,
          description: 'description' in resource ? resource.description : undefined,
          group: resource.group,
        })),
        permissions: buildAccessInputs(departments, accessRows),
        auditLog: auditRows
          .filter((row) => row.resource_key in RESOURCE_BY_KEY)
          .map((row) => ({
            id: row.id,
            departmentId: row.department_id,
            departmentName: relationOne(row.department)?.name || null,
            subjectScope: row.subject_scope,
            resourceKey: row.resource_key as ResourceKey,
            oldCanView: row.old_can_view,
            oldCanManage: row.old_can_manage,
            newCanView: row.new_can_view,
            newCanManage: row.new_can_manage,
            changedAt: row.changed_at,
            changedByName: relationOne(row.user)?.full_name || null,
          })),
        adminUsers: userSummaries.filter((user) => user.isAdminPosition),
        previewUsers: userSummaries,
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить права доступа' }
  }
}

function validateInput(input: DepartmentAccessPermissionInput[], departmentIds: Set<string>) {
  const validResources = new Set(PERMISSION_RESOURCES.map((resource) => resource.key))
  const normalized: DepartmentAccessPermissionInput[] = []

  for (const item of input) {
    if (!departmentIds.has(item.departmentId)) continue
    if (item.subjectScope !== 'head' && item.subjectScope !== 'member') continue
    if (!validResources.has(item.resourceKey)) continue

    const canManage = item.canManage === true
    normalized.push({
      departmentId: item.departmentId,
      subjectScope: item.subjectScope,
      resourceKey: item.resourceKey,
      canView: item.canView === true || canManage,
      canManage,
    })
  }

  return normalized
}

export async function saveDepartmentAccessPermissions(input: DepartmentAccessPermissionInput[]) {
  try {
    const context = await requireAccessSettingsPermission()
    const db = createAdminClient() as unknown as LooseDb
    const departments = await getDepartments(db)
    const normalized = validateInput(input, new Set(departments.map((department) => department.id)))
    const existingRows = await getAccessRows(db)
    const existing = new Map<string, PermissionState>()

    for (const row of existingRows) {
      if (!(row.resource_key in RESOURCE_BY_KEY)) continue
      existing.set(accessKey(row.department_id, row.subject_scope, row.resource_key as ResourceKey), {
        canView: row.can_view || row.can_manage,
        canManage: row.can_manage,
      })
    }

    const auditRows = normalized
      .map((item) => {
        const previous = existing.get(accessKey(item.departmentId, item.subjectScope, item.resourceKey)) || {
          canView: false,
          canManage: false,
        }
        const next = normalizeState(item)
        if (previous.canView === next.canView && previous.canManage === next.canManage) return null
        return {
          department_id: item.departmentId,
          subject_scope: item.subjectScope,
          resource_key: item.resourceKey,
          old_can_view: previous.canView,
          old_can_manage: previous.canManage,
          new_can_view: next.canView,
          new_can_manage: next.canManage,
          changed_by: context.userId,
        }
      })
      .filter(Boolean)

    const upsertRows = normalized.map((item) => ({
      department_id: item.departmentId,
      subject_scope: item.subjectScope,
      resource_key: item.resourceKey,
      can_view: item.canView || item.canManage,
      can_manage: item.canManage,
      updated_by: context.userId,
    }))

    if (upsertRows.length > 0) {
      const { error } = await db
        .from('department_access_permissions')
        .upsert(upsertRows, { onConflict: 'department_id,subject_scope,resource_key' })
      if (error) throw new Error(error.message || 'Не удалось сохранить права доступа')
    }

    if (auditRows.length > 0) {
      const { error } = await db.from('department_access_audit_log').insert(auditRows)
      if (error) throw new Error(error.message || 'Не удалось сохранить историю изменений')
    }

    revalidatePath('/', 'layout')
    revalidatePath(ROUTES.ADMIN_SETTINGS)
    revalidatePath(ROUTES.ADMIN_ACCESS_SETTINGS)

    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось сохранить права доступа',
    }
  }
}

export async function getAccessPreviewForUser(userId: string) {
  try {
    await requireAccessSettingsPermission()
    const db = createAdminClient() as unknown as LooseDb
    const data = await buildUserAccessPreview(db, userId)
    return { data, error: null }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Не удалось проверить доступ пользователя',
    }
  }
}

export async function canManageAccessSettings() {
  try {
    await requireAccessSettingsPermission()
    return true
  } catch {
    return false
  }
}
