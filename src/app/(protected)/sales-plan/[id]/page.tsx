import { notFound } from 'next/navigation'
import { MachineDetail } from '@/components/features/machines/MachineDetail'
import { getMachine } from '@/app/(protected)/sales-plan/actions'
import { getTasksByMachine } from '@/lib/actions/tasks'
import { getRequest } from '@/lib/actions/technologist-requests'
import { getMachineItemNestingStates } from '@/lib/actions/machine-item-nesting'
import { getCurrentUserContext } from '@/lib/auth/current-user'
import { getRolePermissionMap } from '@/lib/permissions/server'
import { hasResourcePermission } from '@/lib/permissions/resources'
import { createServerSupabaseClient } from '@/lib/supabase/server'

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
  const { role } = await getCurrentUserContext()
  const permissions = await getRolePermissionMap(role)
  const [
    { data: machine, error },
    { data: tasks },
    { data: requestData },
    nestingStatesResult,
    { data: factories },
  ] = await Promise.all([
    getMachine(id),
    getTasksByMachine(id),
    getRequest(id),
    getMachineItemNestingStates(id),
    supabase.from('factories').select('id, name'),
  ])

  if (error || !machine) {
    notFound()
  }

  return (
    <div className="w-full">
      <MachineDetail
        machine={machine}
        factories={factories || []}
        tasks={tasks || []}
        requestData={requestData}
        nestingStates={nestingStatesResult.success ? nestingStatesResult.data || [] : []}
        canManageTechnologistRequests={hasResourcePermission(role, permissions, 'technologist_requests', 'manage')}
        canViewSupplyRequest={hasResourcePermission(role, permissions, 'supply', 'view')}
        canManageNesting={hasResourcePermission(role, permissions, 'nesting', 'manage')}
      />
    </div>
  )
}
