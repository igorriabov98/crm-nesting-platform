export type ReportFactory = { id: string; name: string }
export type ReportMembership = { departmentId: string; isDepartmentHead: boolean }
export type ReportFactoryGrant = {
  department_id: string
  subject_scope: string
  factory_id: string
  can_view: boolean
  can_manage: boolean
}
export type ReportMatrixPermission = {
  department_id: string
  subject_scope: string
  can_view: boolean
  can_manage: boolean
}

/** Factory grants are explicit and intentionally ignore the employee profile factory. */
export function resolveSupplyDeadlineFactoryAccess(
  factories: ReportFactory[], memberships: ReportMembership[],
  grants: ReportFactoryGrant[], matrix: ReportMatrixPermission[], isAdmin: boolean,
) {
  if (isAdmin) return { factories, canManageFactoryIds: factories.map((factory) => factory.id) }
  const membershipKeys = new Set(memberships.map((member) =>
    `${member.departmentId}:${member.isDepartmentHead ? 'head' : 'member'}`))
  const viewKeys = new Set(matrix.filter((row) => row.can_view || row.can_manage)
    .map((row) => `${row.department_id}:${row.subject_scope}`))
  const manageKeys = new Set(matrix.filter((row) => row.can_manage)
    .map((row) => `${row.department_id}:${row.subject_scope}`))
  const viewIds = new Set(grants.filter((grant) => grant.can_view
    && membershipKeys.has(`${grant.department_id}:${grant.subject_scope}`)
    && viewKeys.has(`${grant.department_id}:${grant.subject_scope}`)).map((grant) => grant.factory_id))
  const manageIds = new Set(grants.filter((grant) => grant.can_manage
    && membershipKeys.has(`${grant.department_id}:${grant.subject_scope}`)
    && manageKeys.has(`${grant.department_id}:${grant.subject_scope}`)).map((grant) => grant.factory_id))
  return {
    factories: factories.filter((factory) => viewIds.has(factory.id)),
    canManageFactoryIds: factories.filter((factory) => manageIds.has(factory.id)).map((factory) => factory.id),
  }
}
