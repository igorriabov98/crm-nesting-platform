import { withPagePermission } from '@/lib/permissions/page-guard'
import { ConsumablesWorkspace } from '@/components/features/consumables/ConsumablesWorkspace'
import { getConsumablesWorkspaceData } from '@/lib/actions/consumables'

export const metadata = { title: 'Расходники производства — CRM Завода' }

async function ConsumablesPage({
  searchParams,
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const params = await searchParams
  const data = await getConsumablesWorkspaceData(params?.factory)

  if (!data.selectedFactoryId) {
    return <div className="rounded-xl border border-[#E8ECF0] bg-white p-6 text-sm text-[#6B7280]">Нет доступного завода.</div>
  }

  return <ConsumablesWorkspace {...data} selectedFactoryId={data.selectedFactoryId} />
}

export default withPagePermission('/production/consumables', ConsumablesPage)
