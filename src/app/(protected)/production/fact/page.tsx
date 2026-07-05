import { redirect } from 'next/navigation'
import { ProductionFactPage } from '@/components/features/production/ProductionFactPage'
import { getProductionFactWorkspaceData } from '@/lib/actions/production-fact'

export const metadata = { title: 'Факт производства — CRM LEDA' }

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

export default async function ProductionFactRoute({
  searchParams,
}: {
  searchParams?: Promise<{
    factory?: string
    date?: string
    productionMonth?: string
  }>
}) {
  const params = await searchParams
  if (params?.productionMonth) {
    const nextParams = new URLSearchParams()
    if (params.factory) nextParams.set('factory', params.factory)
    if (params.date) nextParams.set('date', params.date)
    const query = nextParams.toString()
    redirect(query ? `/production/fact?${query}` : '/production/fact')
  }

  try {
    const data = await getProductionFactWorkspaceData({
      factoryId: params?.factory,
      date: params?.date,
    })

    return (
      <ProductionFactPage
        key={`${data.selectedFactoryId || 'none'}-${data.selectedDate}`}
        data={data}
      />
    )
  } catch (error) {
    return (
      <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-4 text-[#991B1B]">
        Ошибка загрузки факта производства: {getErrorMessage(error)}
      </div>
    )
  }
}
