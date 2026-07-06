import { notFound } from 'next/navigation'
import { RequestListPage } from '@/components/features/requests/RequestListPage'
import { getMachine } from '@/app/(protected)/sales-plan/actions'
import { getRequestsForMachine } from '@/lib/actions/technologist-requests'
import { getCurrentUserPermissions } from '@/lib/permissions/server'
import { hasPermission } from '@/lib/permissions/resources'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'

export const metadata = {
  title: 'Заявки на материалы | CRM Завода',
}

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user } = await getCurrentUserContextOrRedirect()
  const permissionDetails = await getCurrentUserPermissions(user.id)
  const permissions = permissionDetails.permissions

  const [{ data: machine, error }, { data: requests }] = await Promise.all([
    getMachine(id),
    getRequestsForMachine(id),
  ])
  if (error || !machine) notFound()

  return (
    <RequestListPage
      machine={{ id: machine.id, name: machine.name }}
      requests={requests || []}
      canCreate={hasPermission(permissions, 'technologist_requests', 'manage')}
    />
  )
}
