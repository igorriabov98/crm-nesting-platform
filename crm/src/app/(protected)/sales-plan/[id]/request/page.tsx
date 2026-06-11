import { notFound, redirect } from 'next/navigation'
import { TechnologistRequestPage } from '@/components/features/requests/TechnologistRequestPage'
import { CreateRequestPanel } from '@/components/features/requests/CreateRequestPanel'
import { getMachine } from '@/app/(protected)/sales-plan/actions'
import { getRequest } from '@/lib/actions/technologist-requests'
import { getSteelTypes } from '@/lib/actions/steel-types'
import { getRolePermissionMap } from '@/lib/permissions/server'
import { hasResourcePermission } from '@/lib/permissions/resources'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/types'

export const metadata = {
  title: 'Заявка на материалы | CRM Завода',
}

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = (profile as unknown as { role: UserRole } | null)?.role
  if (!role) redirect('/login')

  const [{ data: machine, error }, { data: requestData }, steelTypes, permissions] = await Promise.all([
    getMachine(id),
    getRequest(id),
    getSteelTypes(),
    getRolePermissionMap(role),
  ])
  if (error || !machine) notFound()

  if (!requestData) {
    const canManageRequest = hasResourcePermission(role, permissions, 'technologist_requests', 'manage')
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
      canManage={hasResourcePermission(role, permissions, 'technologist_requests', 'manage')}
      steelTypes={steelTypes}
    />
  )
}
