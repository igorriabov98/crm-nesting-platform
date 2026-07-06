import { notFound } from 'next/navigation'
import { TechnologistRequestPage } from '@/components/features/requests/TechnologistRequestPage'
import { getMachine } from '@/app/(protected)/sales-plan/actions'
import { getRequestById } from '@/lib/actions/technologist-requests'
import { getSteelTypes } from '@/lib/actions/steel-types'
import { getCurrentUserPermissions } from '@/lib/permissions/server'
import { hasPermission } from '@/lib/permissions/resources'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { ROUTES } from '@/lib/constants/routes'

export const metadata = {
  title: 'Заявка на материалы | CRM Завода',
}

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>
}) {
  const { id, requestId } = await params
  const { user } = await getCurrentUserContextOrRedirect()
  const permissionDetails = await getCurrentUserPermissions(user.id)
  const permissions = permissionDetails.permissions

  const [{ data: machine, error }, { data: requestData }, steelTypes] = await Promise.all([
    getMachine(id),
    getRequestById(id, requestId),
    getSteelTypes(),
  ])
  if (error || !machine || !requestData) notFound()

  return (
    <TechnologistRequestPage
      machine={{ id: machine.id, name: machine.name }}
      data={requestData}
      suppliers={{
        sheetMetal: [],
      }}
      canManage={hasPermission(permissions, 'technologist_requests', 'manage')}
      steelTypes={steelTypes}
      backHref={`${ROUTES.SALES_PLAN}/${machine.id}/request`}
      backLabel="Назад к заявкам"
    />
  )
}
