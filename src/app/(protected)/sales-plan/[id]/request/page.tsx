import { notFound } from 'next/navigation'
import { TechnologistRequestPage } from '@/components/features/requests/TechnologistRequestPage'
import { CreateRequestPanel } from '@/components/features/requests/CreateRequestPanel'
import { getMachine } from '@/app/(protected)/sales-plan/actions'
import { getRequest } from '@/lib/actions/technologist-requests'
import { getSteelTypes } from '@/lib/actions/steel-types'
import { getCurrentUserPermissions } from '@/lib/permissions/server'
import { hasPermission } from '@/lib/permissions/resources'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'

export const metadata = {
  title: 'Заявка на материалы | CRM Завода',
}

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user } = await getCurrentUserContextOrRedirect()
  const permissionDetails = await getCurrentUserPermissions(user.id)
  const permissions = permissionDetails.permissions

  const [{ data: machine, error }, { data: requestData }, steelTypes] = await Promise.all([
    getMachine(id),
    getRequest(id),
    getSteelTypes(),
  ])
  if (error || !machine) notFound()

  if (!requestData) {
    const canManageRequest = hasPermission(permissions, 'technologist_requests', 'manage')
    return (
      <CreateRequestPanel
        machineId={id}
        canCreate={canManageRequest}
      />
    )
  }

  return (
    <TechnologistRequestPage
      machine={{ id: machine.id, name: machine.name }}
      data={requestData}
      suppliers={{
        sheetMetal: [],
      }}
      canManage={hasPermission(permissions, 'technologist_requests', 'manage')}
      steelTypes={steelTypes}
    />
  )
}
