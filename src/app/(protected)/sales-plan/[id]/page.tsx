import { notFound } from 'next/navigation'
import { MachineDetail } from '@/components/features/machines/MachineDetail'
import { getMachine } from '@/app/(protected)/sales-plan/actions'
import { getTasksByMachine } from '@/lib/actions/tasks'
import { getRequest } from '@/lib/actions/technologist-requests'
import { getMachineItemNestingStates } from '@/lib/actions/machine-item-nesting'
import { getMachineLayout } from '@/lib/actions/machine-layout'
import { getMachineCutting } from '@/lib/actions/machine-cutting'
import { getMachineActivity, type MachineActivityPayload } from '@/lib/actions/machine-activity'
import { getMachineOutsourcingData } from '@/lib/actions/outsourcing'
import { getCurrentUserContext } from '@/lib/auth/current-user'
import { getCurrentUserPermissions } from '@/lib/permissions/server'
import { hasPermission } from '@/lib/permissions/resources'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getMachineVrbMeshStatus } from '@/lib/actions/vrb-outsourcing'

export const metadata = {
  title: 'Карточка машины | CRM Завода',
}

export default async function MachineDetailPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { user } = await getCurrentUserContext()
  const permissionDetails = await getCurrentUserPermissions(user.id)
  const permissions = permissionDetails.permissions
  const canViewMachineCutting = hasPermission(permissions, 'machine_cutting', 'view')
  const canManageMachineCutting = hasPermission(permissions, 'machine_cutting', 'manage')
  const [
    { data: machine, error, invoiceAccess },
    { data: requestData },
    layoutResult,
    nestingStatesResult,
    activityResult,
    outsourcingResult,
    { data: factories },
    { data: tasks },
    cuttingResult,
    vrbStatus,
  ] = await Promise.all([
    getMachine(id),
    getRequest(id),
    getMachineLayout(id),
    getMachineItemNestingStates(id),
    getMachineActivity(id),
    getMachineOutsourcingData(id),
    supabase.from('factories').select('id, name'),
    getTasksByMachine(id),
    canViewMachineCutting
      ? getMachineCutting(id)
      : Promise.resolve({ success: true as const, data: null, error: null }),
    getMachineVrbMeshStatus(id),
  ])

  if (error || !machine) {
    notFound()
  }

  const activity: MachineActivityPayload = activityResult.data || {
    updates: [],
    messages: [],
    mentionUsers: [],
    canManageUpdates: false,
    canSendChat: false,
  }

  return (
    <div className="w-full">
      <MachineDetail
        machine={machine}
        factories={factories || []}
        tasks={tasks || []}
        requestData={requestData}
        layoutData={layoutResult.success ? layoutResult.data || null : null}
        cuttingData={cuttingResult.success ? cuttingResult.data : null}
        cuttingError={cuttingResult.error}
        nestingStates={nestingStatesResult.success ? nestingStatesResult.data || [] : []}
        activity={activity}
        outsourcingData={outsourcingResult.data}
        vrbStatus={vrbStatus}
        canManageTechnologistRequests={hasPermission(permissions, 'technologist_requests', 'manage')}
        canViewSupplyRequest={hasPermission(permissions, 'supply', 'view')}
        canManageNesting={hasPermission(permissions, 'nesting', 'manage')}
        canViewMachineCutting={canViewMachineCutting}
        canManageMachineCutting={canManageMachineCutting}
        canViewInvoice={invoiceAccess.canView}
        canManageInvoice={invoiceAccess.canManage}
      />
    </div>
  )
}
