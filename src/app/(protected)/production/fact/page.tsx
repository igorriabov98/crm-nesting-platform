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

  try {
    const data = await getProductionFactWorkspaceData({
      factoryId: params?.factory,
      date: params?.date || params?.productionMonth,
      productionMonth: params?.productionMonth,
    })

    return (
      <ProductionFactPage
        key={`${data.selectedFactoryId || 'none'}-${data.selectedDate}-${data.productionMonth}`}
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
