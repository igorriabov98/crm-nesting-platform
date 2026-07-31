import { ROUTES } from '@/lib/constants/routes'
import type { DepartmentRequestTarget } from '@/lib/department-requests'

export type SidebarWorkQueueCounts = {
  departmentRequests: Record<DepartmentRequestTarget, number> & {
    total: number
    unreadResults: number
  }
  transport: number
  outsourcingApprovals: number
  materialRequests: number
}

export function countPendingMaterialRequests(
  items: Array<{ taskStatus: string | null; state: string }>,
) {
  return items.filter((item) => item.taskStatus === 'pending' && item.state !== 'submitted').length
}

export function countSelectableTransportNeeds(items: Array<{ selectable: boolean }>) {
  return items.filter((item) => item.selectable).length
}

export function getSidebarWorkQueueCount(href: string, counts: SidebarWorkQueueCounts) {
  if (href === ROUTES.REQUESTS) {
    return counts.departmentRequests.total + counts.departmentRequests.unreadResults
  }
  if (href === ROUTES.TECHNOLOGIST_DEPARTMENT_REQUESTS) return counts.departmentRequests.technologist
  if (href === ROUTES.SUPPLY_DEPARTMENT_REQUESTS) return counts.departmentRequests.supply
  if (href === ROUTES.PRODUCTION_DEPARTMENT_REQUESTS) return counts.departmentRequests.production
  if (href === ROUTES.SUPPLY_TRANSPORT) return counts.transport
  if (href === ROUTES.SUPPLY_OUTSOURCING_REQUESTS) return counts.outsourcingApprovals
  if (href === ROUTES.MATERIAL_REQUESTS) return counts.materialRequests
  return 0
}
