'use server'

import { revalidatePath } from 'next/cache'
import { ROUTES } from '@/lib/constants/routes'
import { createAdminClient } from '@/lib/supabase/admin'
import { PERMISSION_RESOURCES, RESOURCE_BY_KEY, type PermissionState, type FactoryAccessScope, type CompanyAccessScope, type ResourceKey } from '@/lib/permissions/resources'
import { requireAccessSettingsPermission, requirePermission, requireAnyPermission, getAccessSnapshot, resolveAccessSnapshot, type DepartmentPermissionMembership } from '@/lib/permissions/server'
import { type DepartmentAccessPermissionRow } from '@/lib/permissions/resolve'

export type DepartmentAccessSubjectScope = 'head' | 'member'

type DepartmentAccessRow = DepartmentAccessPermissionRow & {
  department_id: string
  subject_scope: DepartmentAccessSubjectScope
  resource_key: string
  can_view: boolean
  can_manage: boolean
  factory_scope: FactoryAccessScope
  company_view_scope: CompanyAccessScope
  company_manage_scope: CompanyAccessScope
  revision?: string | number
  updated_by?: string | null
  updated_at?: string | null
}

type DepartmentRow = {
  id: string
  name: string
  is_active: boolean
  sort_order?: number | null
}

type UserRow = {
  id: string
  full_name: string | null
  email: string
  is_active: boolean | null
}

type MembershipRow = {
  id: string
  user_id: string
  department_id: string
  position_id: string | null
  is_department_head: boolean
  department?: { id: string; name: string | null; head_user_id?: string | null } | { id: string; name: string | null; head_user_id?: string | null }[] | null
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
  old_factory_scope: FactoryAccessScope | null
  new_factory_scope: FactoryAccessScope
  old_company_view_scope: CompanyAccessScope | null
  new_company_view_scope: CompanyAccessScope
  old_company_manage_scope: CompanyAccessScope | null
  new_company_manage_scope: CompanyAccessScope
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
  range: (from: number, to: number) => LooseQuery<T>
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

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown
    error: { message?: string; code?: string } | null
  }>
}

export type DepartmentAccessPermissionInput = {
  revision?: string
  expectedRevision?: string
  departmentId: string
  subjectScope: DepartmentAccessSubjectScope
  resourceKey: ResourceKey
  canView: boolean
  canManage: boolean
  factoryScope: FactoryAccessScope
  companyViewScope: CompanyAccessScope
  companyManageScope: CompanyAccessScope
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
  version: string
  userId: string
  fullName: string | null
  email: string
  isActive: boolean
  isAdminPosition: boolean
  memberships: DepartmentPermissionMembership[]
  permissions: Array<{
    resourceKey: ResourceKey
    label: string
    group: string
    canView: boolean
    canManage: boolean
    factoryViewScope: FactoryAccessScope
    factoryManageScope: FactoryAccessScope
    companyViewScope: CompanyAccessScope
    companyManageScope: CompanyAccessScope
    sources: string[]
  }>
}

export type RolePermissionsPageData = {
  currentUserId:string
  canManage: boolean
  canImpersonate: boolean
  memberships: Array<{userId: string; departmentId: string; isDepartmentHead: boolean}>
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
    supportsFactoryScope: boolean
    supportsCompanyScope: boolean
    viewOnly: boolean
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
    oldFactoryScope: FactoryAccessScope | null
    newFactoryScope: FactoryAccessScope
    oldCompanyViewScope: CompanyAccessScope | null
    newCompanyViewScope: CompanyAccessScope
    oldCompanyManageScope: CompanyAccessScope | null
    newCompanyManageScope: CompanyAccessScope
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

function normalizedFactoryScope(
  input: Pick<DepartmentAccessPermissionInput, 'canView' | 'canManage' | 'factoryScope'>,
  supportsFactoryScope: boolean,
): FactoryAccessScope {
  return supportsFactoryScope && (input.canView || input.canManage) && input.factoryScope === 'all'
    ? 'all'
    : 'own'
}

function normalizedCompanyScopes(
  input: Pick<DepartmentAccessPermissionInput, 'canView' | 'canManage' | 'companyViewScope' | 'companyManageScope'>,
  supportsCompanyScope: boolean,
) {
  if (!supportsCompanyScope) return { view: 'own' as const, manage: 'own' as const }
  const manage = input.canManage && input.companyManageScope === 'all' ? 'all' as const : 'own' as const
  return {
    view: input.canView && (input.companyViewScope === 'all' || manage === 'all') ? 'all' as const : 'own' as const,
    manage,
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
      .select('id, full_name, email, is_active')
      .order('full_name', { ascending: true }),
    getAuthUserIds(client),
  ])

  if (error) throw new Error(error.message || 'Не удалось загрузить пользователей')
  return Array.isArray(data) ? data.filter((user) => authUserIds.has(user.id)) : []
}

async function getMembershipRows(db: LooseDb) {
  const { data, error } = await db
    .from<MembershipRow[]>('department_members')
    .select('id, user_id, department_id, position_id, is_department_head, department:department_id(id, name, head_user_id), position:position_id(id, name, level), user:user_id(id, full_name, email, is_active)')

  if (error) throw new Error(error.message || 'Не удалось загрузить назначения пользователей')
  return Array.isArray(data) ? data : []
}

async function getAccessRows(db: LooseDb) {
  const pageSize = 1000
  const rows: DepartmentAccessRow[] = []

  while (true) {
    const from = rows.length
    const { data, error } = await db
      .from<DepartmentAccessRow[]>('department_access_permissions')
      .select('department_id, subject_scope, resource_key, can_view, can_manage, factory_scope, company_view_scope, company_manage_scope, revision, updated_by, updated_at')
      .order('department_id', { ascending: true })
      .order('subject_scope', { ascending: true })
      .order('resource_key', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(error.message || 'Не удалось загрузить права доступа отделов')
    const page = Array.isArray(data) ? data : []
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

async function getAuditRows(db: LooseDb) {
  const { data, error } = await db
    .from<AuditRow[]>('department_access_audit_log')
    .select('id, department_id, subject_scope, resource_key, old_can_view, old_can_manage, new_can_view, new_can_manage, old_factory_scope, new_factory_scope, old_company_view_scope, new_company_view_scope, old_company_manage_scope, new_company_manage_scope, changed_by, changed_at, user:users(full_name), department:departments(name)')
    .order('changed_at', { ascending: false })
    .limit(100)

  if (error) return []
  return Array.isArray(data) ? data : []
}

function buildAccessInputs(departments: DepartmentRow[], rows: DepartmentAccessRow[]) {
  const matrix = new Map<string, PermissionState & {
    factoryScope: FactoryAccessScope
    companyViewScope: CompanyAccessScope
    companyManageScope: CompanyAccessScope
  }>()
  for (const row of rows) {
    if (!(row.resource_key in RESOURCE_BY_KEY)) continue
    matrix.set(accessKey(row.department_id, row.subject_scope, row.resource_key as ResourceKey), {
      canView: row.can_view || row.can_manage,
      canManage: row.can_manage,
      factoryScope: row.factory_scope || 'own',
      companyViewScope: row.company_view_scope || 'own',
      companyManageScope: row.company_manage_scope || 'own',
    })
  }

  return departments.flatMap((department) =>
    (['head', 'member'] as const).flatMap((subjectScope) =>
      PERMISSION_RESOURCES.map((resource) => {
        const state = matrix.get(accessKey(department.id, subjectScope, resource.key)) || {
          canView: false,
          canManage: false,
          factoryScope: 'own' as const,
          companyViewScope: 'own' as const,
          companyManageScope: 'own' as const,
        }
        return {
          departmentId: department.id,
          subjectScope,
          resourceKey: resource.key,
          canView: state.canView,
          canManage: state.canManage,
          factoryScope: state.factoryScope,
          companyViewScope: state.companyViewScope,
          companyManageScope: state.companyManageScope,
        }
      })
    )
  )
}

function buildUserSummaries(users: UserRow[], memberships: MembershipRow[], adminIds: Set<string>) {
  const byUser = new Map<string, AccessUserSummary>()
  for (const user of users) {
    byUser.set(user.id, {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      isActive: user.is_active === true,
      departments: [],
      positions: [],
      isDepartmentHead: false,
      isAdminPosition: user.is_active === true && adminIds.has(user.id),
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
  }

  return Array.from(byUser.values()).sort((a, b) =>
    (a.fullName || a.email).localeCompare(b.fullName || b.email, 'ru')
  )
}

async function buildUserAccessPreview(_db: LooseDb, userId: string, afterRestore=false): Promise<UserAccessPreview> {
  const snapshot = await getAccessSnapshot(userId)
  const details = resolveAccessSnapshot(afterRestore?{...snapshot,isActive:true,isAdmin:snapshot.hasAdminStatus}:snapshot)
  return {
    version: snapshot.version, userId, fullName: snapshot.fullName, email: snapshot.email, isActive: afterRestore || snapshot.isActive,
    isAdminPosition: details.isAdminPosition, memberships: details.memberships,
    permissions: PERMISSION_RESOURCES.map(resource => ({
      resourceKey: resource.key, label: resource.label, group: resource.group,
      canView: details.permissions[resource.key]?.canView === true,
      canManage: details.permissions[resource.key]?.canManage === true,
      factoryViewScope: details.factoryScopes[resource.key]?.view || 'own',
      factoryManageScope: details.factoryScopes[resource.key]?.manage || 'own',
      companyViewScope: details.companyScopes[resource.key]?.view || 'own',
      companyManageScope: details.companyScopes[resource.key]?.manage || 'own',
      sources: details.sources[resource.key] || [],
    })),
  }
}

export async function getRolePermissionsPageData(): Promise<{ data: RolePermissionsPageData | null; error: string | null }> {
  try {
    const context = await requirePermission('access_settings', 'view')
    const db = createAdminClient() as unknown as LooseAuthAdminClient
    const [departments, users, memberships, accessRows, auditRows] = await Promise.all([
      getDepartments(db),
      getUsers(db),
      getMembershipRows(db),
      getAccessRows(db),
      getAuditRows(db),
    ])
    const {data: adminRows, error: adminError} = await db.from<Array<{user_id: string}>>('user_system_roles').select('user_id')
    if (adminError) throw new Error(adminError.message)
    const userSummaries = buildUserSummaries(users, memberships, new Set((adminRows || []).map(row => row.user_id)))

    return {
      data: {
        currentUserId:context.userId,
        canManage: context.permissions.access_settings?.canManage === true,
        canImpersonate: context.permissionDetails.isAdminPosition,
        memberships: memberships.map(row => ({userId: row.user_id, departmentId: row.department_id, isDepartmentHead: row.is_department_head})),
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
          supportsFactoryScope: 'supportsFactoryScope' in resource && resource.supportsFactoryScope === true,
          supportsCompanyScope: 'supportsCompanyScope' in resource && resource.supportsCompanyScope === true,
          viewOnly: 'viewOnly' in resource && resource.viewOnly === true,
        })),
        permissions: buildAccessInputs(departments, accessRows).map(row => ({...row,
          revision: String(accessRows.find(saved => saved.department_id === row.departmentId && saved.subject_scope === row.subjectScope && saved.resource_key === row.resourceKey)?.revision || 0),
        })),
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
            oldFactoryScope: row.old_factory_scope,
            newFactoryScope: row.new_factory_scope,
            oldCompanyViewScope: row.old_company_view_scope,
            newCompanyViewScope: row.new_company_view_scope,
            oldCompanyManageScope: row.old_company_manage_scope,
            newCompanyManageScope: row.new_company_manage_scope,
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
  const resourcesWithFactoryScope = new Set(PERMISSION_RESOURCES
    .filter((resource) => 'supportsFactoryScope' in resource && resource.supportsFactoryScope === true)
    .map((resource) => resource.key))
  const resourcesWithCompanyScope = new Set(PERMISSION_RESOURCES
    .filter((resource) => 'supportsCompanyScope' in resource && resource.supportsCompanyScope === true)
    .map((resource) => resource.key))
  const viewOnlyResources = new Set(PERMISSION_RESOURCES
    .filter((resource) => 'viewOnly' in resource && resource.viewOnly === true)
    .map((resource) => resource.key))
  const normalized: DepartmentAccessPermissionInput[] = []

  for (const item of input) {
    if (!departmentIds.has(item.departmentId)) continue
    if (item.subjectScope !== 'head' && item.subjectScope !== 'member') continue
    if (!validResources.has(item.resourceKey)) continue

    const canManage = !viewOnlyResources.has(item.resourceKey) && item.canManage === true
    const companyScopes = normalizedCompanyScopes(item, resourcesWithCompanyScope.has(item.resourceKey))
    normalized.push({
      departmentId: item.departmentId,
      subjectScope: item.subjectScope,
      resourceKey: item.resourceKey,
      canView: item.canView === true || canManage,
      canManage,
      factoryScope: normalizedFactoryScope(item, resourcesWithFactoryScope.has(item.resourceKey)),
      companyViewScope: companyScopes.view,
      companyManageScope: companyScopes.manage,
    })
  }

  return normalized
}

export async function saveDepartmentAccessPermissions(input: DepartmentAccessPermissionInput[]) {
  try {
    const context = await requireAccessSettingsPermission()
    const db = createAdminClient() as unknown as LooseDb
    const departments = await getDepartments(db)
    const normalized = validateInput(input, new Set(departments.map(department => department.id)))
    if (normalized.length !== input.length) throw new Error('Некорректные строки матрицы')
    const changes = normalized.map((row, index) => ({...row, expectedRevision: input[index].expectedRevision}))
    if (changes.some(row => !row.expectedRevision || !/^\d+$/.test(row.expectedRevision))) throw new Error('Обновите матрицу перед сохранением')
    const {data, error} = await (context.supabase as unknown as RpcClient).rpc('crm_save_matrix', {p_changes: changes})
    if (error) throw new Error(error.message || 'Не удалось сохранить права')
    const saved = data as DepartmentAccessPermissionInput[]
    const comparable = (row: DepartmentAccessPermissionInput) => JSON.stringify({
      departmentId: row.departmentId,
      subjectScope: row.subjectScope,
      resourceKey: row.resourceKey,
      canView: row.canView,
      canManage: row.canManage,
      factoryScope: row.factoryScope,
      companyViewScope: row.companyViewScope,
      companyManageScope: row.companyManageScope,
    })
    const expectedByKey = new Map(normalized.map((row) => [
      `${row.departmentId}:${row.subjectScope}:${row.resourceKey}`,
      comparable(row),
    ]))
    const confirmed = Array.isArray(saved)
      && saved.length === normalized.length
      && saved.every((row) => expectedByKey.get(`${row.departmentId}:${row.subjectScope}:${row.resourceKey}`) === comparable(row))
    if (!confirmed) {
      throw new Error('Сервер вернул другие значения доступа. Черновик сохранён — обновите матрицу и проверьте конфликт.')
    }
    revalidatePath('/', 'layout')
    revalidatePath(ROUTES.ADMIN_ACCESS_SETTINGS)
    return {success: true, error: null, permissions: saved}
  } catch (error) {
    return {success: false, error: error instanceof Error ? error.message : 'Не удалось сохранить права', permissions: null}
  }
}

export async function getAccessPreviewForUser(userId: string, afterRestore=false) {
  try {
    await requireAnyPermission([{resourceKey:'access_settings',operation:'view'},{resourceKey:'admin_users',operation:'view'}])
    const db = createAdminClient() as unknown as LooseDb
    if(afterRestore)await requirePermission('admin_users','manage')
    const data = await buildUserAccessPreview(db, userId, afterRestore)
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
