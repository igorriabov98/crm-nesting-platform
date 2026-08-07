'use server'

import { canManageDepartmentRequestTarget, type DepartmentRequestTarget } from '@/lib/department-requests'
import { getMaterialRequestQueue } from '@/lib/actions/material-request-queue'
import { getTransportWorkspace } from '@/lib/actions/transport-trips'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  countPendingMaterialRequests,
  countSelectableTransportNeeds,
  type SidebarWorkQueueCounts,
} from '@/lib/sidebar-work-queues'

export type { SidebarWorkQueueCounts } from '@/lib/sidebar-work-queues'

const EMPTY_COUNTS: SidebarWorkQueueCounts = {
  departmentRequests: {
    technologist: 0,
    supply: 0,
    production: 0,
    total: 0,
    unreadResults: 0,
  },
  transport: 0,
  outsourcingApprovals: 0,
  materialRequests: 0,
}

const TARGETS: DepartmentRequestTarget[] = ['technologist', 'supply', 'production']
const DIRECTORS = ['financial_director', 'commercial_director', 'planning_director']

async function loadDepartmentRequestCounts(context: Awaited<ReturnType<typeof requirePermission>>) {
  const memberships = context.permissionDetails.memberships.map((membership) => ({
    departmentName: membership.departmentName,
    positionName: membership.positionName,
  }))
  const manageableTargets = TARGETS.filter((target) => canManageDepartmentRequestTarget({
    target,
    role: context.role,
    memberships,
  }))

  const counts = { ...EMPTY_COUNTS.departmentRequests }
  const admin = createAdminClient()
  const unreadResultQuery = admin
    .from('department_requests')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', context.userId)
    .in('status', ['done', 'rejected'])
    .is('result_viewed_at', null)

  const [, unreadResult] = await Promise.all([
    Promise.all(manageableTargets.map(async (target) => {
      let query = admin
        .from('department_requests')
        .select('id', { count: 'exact', head: true })
        .eq('target_department', target)
        .eq('status', 'new')
        .is('assigned_to', null)

      if (target === 'production' && !DIRECTORS.includes(context.role) && context.factoryId) {
        query = query.eq('factory_id', context.factoryId)
      }

      const { count, error } = await query
      if (!error) counts[target] = count || 0
    })),
    unreadResultQuery,
  ])
  counts.total = TARGETS.reduce((total, target) => total + counts[target], 0)
  if (!unreadResult.error) counts.unreadResults = unreadResult.count || 0
  return counts
}

async function loadTransportCount() {
  const result = await getTransportWorkspace()
  if (result.error) return 0
  return countSelectableTransportNeeds(result.data.needs)
}

async function loadMaterialRequestCount() {
  const result = await getMaterialRequestQueue()
  if (result.error || !result.data) return 0
  return countPendingMaterialRequests(result.data.items)
}

async function loadOutsourcingApprovalCount() {
  const { count, error } = await createAdminClient()
    .from('machine_outsourcing_operations')
    .select('id', { count: 'exact', head: true })
    .eq('executor_type', 'supplier')
    .eq('responsible', 'supply')
    .is('archived_at', null)
    .is('actual_returned_at', null)
    .is('supply_terms_confirmed_at', null)
    .is('supply_taken_at', null)
  return error ? 0 : count || 0
}

export async function getSidebarWorkQueueCounts(): Promise<SidebarWorkQueueCounts> {
  try {
    const context = await requirePermission('department_requests', 'view')
    const permissions = context.permissionDetails.permissions
    const [departmentRequests, transport, outsourcingApprovals, materialRequests] = await Promise.all([
      loadDepartmentRequestCounts(context),
      permissions.supply_transport?.canView ? loadTransportCount() : Promise.resolve(0),
      permissions.supply_transport?.canView ? loadOutsourcingApprovalCount() : Promise.resolve(0),
      permissions.material_request_queue?.canView ? loadMaterialRequestCount() : Promise.resolve(0),
    ])

    return { departmentRequests, transport, outsourcingApprovals, materialRequests }
  } catch {
    return EMPTY_COUNTS
  }
}
