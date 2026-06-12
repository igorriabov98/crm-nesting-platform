'use server'

import { revalidatePath } from 'next/cache'
import { ROUTES } from '@/lib/constants/routes'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  ALL_USER_ROLES,
  PERMISSION_RESOURCES,
  RESOURCE_BY_KEY,
  SWITCHABLE_PERMISSION_RESOURCES,
  getDefaultPermission,
  isDirectorRole,
  isLockedResource,
  type PermissionState,
  type ResourceKey,
} from '@/lib/permissions/resources'
import { requireAccessSettingsPermission } from '@/lib/permissions/server'
import type { UserRole } from '@/lib/types'

type PermissionRow = {
  role: UserRole
  resource_key: string
  can_view: boolean
  can_manage: boolean
  updated_by?: string | null
  updated_at?: string | null
}

type AuditRow = {
  id: string
  role: UserRole
  resource_key: string
  old_can_view: boolean | null
  old_can_manage: boolean | null
  new_can_view: boolean
  new_can_manage: boolean
  changed_by: string | null
  changed_at: string
  user?: { full_name: string | null } | null
}

type DbResult<T = unknown> = {
  data: T | null
  error: { message?: string } | null
}

type LooseQuery<T = unknown> = PromiseLike<DbResult<T>> & {
  select: (columns?: string) => LooseQuery<T>
  eq: (column: string, value: unknown) => LooseQuery<T>
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery<T>
  limit: (count: number) => LooseQuery<T>
  upsert: (values: unknown, options?: { onConflict?: string }) => LooseQuery<T>
  insert: (values: unknown) => LooseQuery<T>
}

type LooseDb = {
  from: <T = unknown>(table: string) => LooseQuery<T>
}

export type RolePermissionInput = {
  role: UserRole
  resourceKey: ResourceKey
  canView: boolean
  canManage: boolean
}

export type RolePermissionsPageData = {
  roles: UserRole[]
  resources: Array<{
    key: ResourceKey
    label: string
    group: string
    locked: boolean
  }>
  permissions: RolePermissionInput[]
  auditLog: Array<{
    id: string
    role: UserRole
    resourceKey: ResourceKey
    oldCanView: boolean | null
    oldCanManage: boolean | null
    newCanView: boolean
    newCanManage: boolean
    changedAt: string
    changedByName: string | null
  }>
}

function rowKey(role: UserRole, resourceKey: ResourceKey) {
  return `${role}:${resourceKey}`
}

function normalizeState(input: Pick<RolePermissionInput, 'canView' | 'canManage'>): PermissionState {
  return {
    canView: input.canView || input.canManage,
    canManage: input.canManage,
  }
}

function getDefaultMatrix() {
  const map = new Map<string, PermissionState>()
  for (const role of ALL_USER_ROLES) {
    for (const resource of PERMISSION_RESOURCES) {
      map.set(rowKey(role, resource.key), getDefaultPermission(resource, role))
    }
  }
  return map
}

async function getPermissionRows(db: LooseDb) {
  const { data, error } = await db
    .from<PermissionRow[]>('role_permissions')
    .select('role, resource_key, can_view, can_manage, updated_by, updated_at')

  if (error) throw new Error(error.message || 'Не удалось загрузить права доступа')
  return Array.isArray(data) ? data : []
}

function buildMatrix(rows: PermissionRow[]) {
  const matrix = getDefaultMatrix()

  for (const row of rows) {
    if (!ALL_USER_ROLES.includes(row.role)) continue
    if (!(row.resource_key in RESOURCE_BY_KEY)) continue
    const resourceKey = row.resource_key as ResourceKey
    matrix.set(rowKey(row.role, resourceKey), {
      canView: row.can_view || row.can_manage,
      canManage: row.can_manage,
    })
  }

  for (const role of ALL_USER_ROLES) {
    for (const resource of PERMISSION_RESOURCES) {
      if (isLockedResource(resource)) {
        matrix.set(rowKey(role, resource.key), getDefaultPermission(resource, role))
      }
    }
  }

  return matrix
}

async function getAuditRows(db: LooseDb) {
  const { data, error } = await db
    .from<AuditRow[]>('role_permission_audit_log')
    .select('id, role, resource_key, old_can_view, old_can_manage, new_can_view, new_can_manage, changed_by, changed_at, user:users(full_name)')
    .order('changed_at', { ascending: false })
    .limit(30)

  if (error) return []
  return Array.isArray(data) ? data : []
}

export async function getRolePermissionsPageData(): Promise<{ data: RolePermissionsPageData | null; error: string | null }> {
  try {
    await requireAccessSettingsPermission()
    const supabase = await createServerSupabaseClient()
    const db = supabase as unknown as LooseDb
    const rows = await getPermissionRows(db)
    const matrix = buildMatrix(rows)
    const auditRows = await getAuditRows(db)

    return {
      data: {
        roles: [...ALL_USER_ROLES],
        resources: PERMISSION_RESOURCES.map((resource) => ({
          key: resource.key,
          label: resource.label,
          group: resource.group,
          locked: isLockedResource(resource),
        })),
        permissions: ALL_USER_ROLES.flatMap((role) =>
          PERMISSION_RESOURCES.map((resource) => {
            const state = matrix.get(rowKey(role, resource.key)) || getDefaultPermission(resource, role)
            return {
              role,
              resourceKey: resource.key,
              canView: state.canView,
              canManage: state.canManage,
            }
          })
        ),
        auditLog: auditRows
          .filter((row) => row.resource_key in RESOURCE_BY_KEY)
          .map((row) => ({
            id: row.id,
            role: row.role,
            resourceKey: row.resource_key as ResourceKey,
            oldCanView: row.old_can_view,
            oldCanManage: row.old_can_manage,
            newCanView: row.new_can_view,
            newCanManage: row.new_can_manage,
            changedAt: row.changed_at,
            changedByName: row.user?.full_name || null,
          })),
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить права доступа' }
  }
}

function validateInput(input: RolePermissionInput[]) {
  const validResources = new Set(SWITCHABLE_PERMISSION_RESOURCES.map((resource) => resource.key))
  const normalized: RolePermissionInput[] = []

  for (const item of input) {
    if (!ALL_USER_ROLES.includes(item.role)) continue
    if (!validResources.has(item.resourceKey)) continue

    const canManage = item.canManage === true
    normalized.push({
      role: item.role,
      resourceKey: item.resourceKey,
      canView: item.canView === true || canManage,
      canManage,
    })
  }

  return normalized
}

export async function saveRolePermissions(input: RolePermissionInput[]) {
  try {
    const context = await requireAccessSettingsPermission()
    const normalized = validateInput(input)
    const supabase = await createServerSupabaseClient()
    const db = supabase as unknown as LooseDb
    const existingRows = await getPermissionRows(db)
    const existing = buildMatrix(existingRows)

    const auditRows = normalized
      .map((item) => {
        const previous = existing.get(rowKey(item.role, item.resourceKey))
          || getDefaultPermission(RESOURCE_BY_KEY[item.resourceKey], item.role)
        const next = normalizeState(item)
        if (previous.canView === next.canView && previous.canManage === next.canManage) return null
        return {
          role: item.role,
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
      role: item.role,
      resource_key: item.resourceKey,
      can_view: item.canView || item.canManage,
      can_manage: item.canManage,
      updated_by: context.userId,
    }))

    if (upsertRows.length > 0) {
      const { error } = await db
        .from('role_permissions')
        .upsert(upsertRows, { onConflict: 'role,resource_key' })
      if (error) throw new Error(error.message || 'Не удалось сохранить права доступа')
    }

    if (auditRows.length > 0) {
      const { error } = await db.from('role_permission_audit_log').insert(auditRows)
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

export async function canManageAccessSettings() {
  try {
    const context = await requireAccessSettingsPermission()
    return isDirectorRole(context.role)
  } catch {
    return false
  }
}
