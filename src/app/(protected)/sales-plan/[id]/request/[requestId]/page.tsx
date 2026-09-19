import { withPagePermission } from '@/lib/permissions/page-guard'
import { notFound } from 'next/navigation'
import { TechnologistRequestPage } from '@/components/features/requests/TechnologistRequestPage'
import { getMachine } from '@/app/(protected)/sales-plan/actions'
import { getRequestById } from '@/lib/actions/technologist-requests'
import { getSteelTypes } from '@/lib/actions/steel-types'
import { getCurrentUserPermissions } from '@/lib/permissions/server'
import { hasPermission } from '@/lib/permissions/resources'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { ROUTES } from '@/lib/constants/routes'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata = {
  title: 'Заявка на материалы | CRM Завода',
}

async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>
}) {
  const { id, requestId } = await params
  const { user } = await getCurrentUserContextOrRedirect()
  const permissionDetails = await getCurrentUserPermissions(user.id)
  const permissions = permissionDetails.permissions

  const [{ data: machine, error }, { data: requestData }, steelTypes, revisionDraft, approvalVersions, requestNumbers] = await Promise.all([
    getMachine(id),
    getRequestById(id, requestId),
    getSteelTypes(),
    createAdminClient().from('technologist_request_revision_drafts').select('revision_number').eq('request_id', requestId).maybeSingle(),
    createAdminClient().from('technologist_request_approval_versions').select('state')
      .eq('request_id', requestId).order('revision_number', { ascending: false }).limit(1),
    createAdminClient().from('technologist_requests').select('id').eq('machine_id', id)
      .eq('is_recalculation_staging', false).order('created_at', { ascending: true }).order('id', { ascending: true }),
  ])
  if (error || !machine || !requestData) notFound()

  return (
    <TechnologistRequestPage
      machine={{ id: machine.id, name: machine.name }}
      data={requestData}
      revisionNumber={(revisionDraft.data as { revision_number: number } | null)?.revision_number || null}
      requestNumber={((requestNumbers.data || []) as Array<{ id: string }>).findIndex((row) => row.id === requestId) + 1}
      approvalState={(approvalVersions.data as Array<{ state: string }> | null)?.[0]?.state || null}
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

export default withPagePermission('/sales-plan/sample-id/request/sample-id', RequestDetailPage)
