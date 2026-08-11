import {
  RESOURCE_BY_KEY,
  getEmptyPermissionMap,
  type PermissionMap,
  type FactoryAccessScope,
  type ResourceKey,
} from '@/lib/permissions/resources'

export type DepartmentAccessSubjectScope = 'head' | 'member'

export type DepartmentAccessPermissionRow = {
  department_id: string
  subject_scope: DepartmentAccessSubjectScope
  resource_key: string
  can_view: boolean
  can_manage: boolean
  factory_scope?: FactoryAccessScope | null
}

export type DepartmentPermissionMembershipInput = {
  departmentId: string
  departmentName: string | null
  isDepartmentHead: boolean
}

export type FactoryAccessOperationScopes = {
  view: FactoryAccessScope
  manage: FactoryAccessScope
}

export type ResolvedDepartmentPermissions = {
  permissions: PermissionMap
  sources: Partial<Record<ResourceKey, string[]>>
  factoryScopes: Partial<Record<ResourceKey, FactoryAccessOperationScopes>>
  appliedDepartmentRows: number
}

export function shouldUseLegacyPermissionFallback(appliedDepartmentRows: number) {
  return appliedDepartmentRows === 0
}

function addSource(
  sources: Partial<Record<ResourceKey, string[]>>,
  resourceKey: ResourceKey,
  source: string,
) {
  sources[resourceKey] = Array.from(new Set([...(sources[resourceKey] || []), source]))
}

export function resolveDepartmentPermissions(
  memberships: readonly DepartmentPermissionMembershipInput[],
  accessRows: readonly DepartmentAccessPermissionRow[],
): ResolvedDepartmentPermissions {
  const permissions = getEmptyPermissionMap()
  const sources: Partial<Record<ResourceKey, string[]>> = {}
  const factoryScopes: Partial<Record<ResourceKey, FactoryAccessOperationScopes>> = {}
  let appliedDepartmentRows = 0

  for (const membership of memberships) {
    const scope: DepartmentAccessSubjectScope = membership.isDepartmentHead ? 'head' : 'member'
    const source = `${membership.departmentName || 'Отдел'} · ${scope === 'head' ? 'Начальник отдела' : 'Подчинённый'}`

    for (const row of accessRows) {
      if (row.department_id !== membership.departmentId || row.subject_scope !== scope) continue
      if (!(row.resource_key in RESOURCE_BY_KEY)) continue

      const resourceKey = row.resource_key as ResourceKey
      const current = permissions[resourceKey] || { canView: false, canManage: false }
      permissions[resourceKey] = {
        canView: current.canView || row.can_view || row.can_manage,
        canManage: current.canManage || row.can_manage,
      }
      if (row.can_view || row.can_manage) addSource(sources, resourceKey, source)
      const currentFactoryScopes = factoryScopes[resourceKey] || { view: 'own', manage: 'own' }
      factoryScopes[resourceKey] = {
        view: (row.can_view || row.can_manage) && row.factory_scope === 'all'
          ? 'all'
          : currentFactoryScopes.view,
        manage: row.can_manage && row.factory_scope === 'all'
          ? 'all'
          : currentFactoryScopes.manage,
      }
      appliedDepartmentRows += 1
    }
  }

  return { permissions, sources, factoryScopes, appliedDepartmentRows }
}
