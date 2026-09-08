import { ProductionLocalShipmentsPage } from '@/components/features/production/ProductionLocalShipmentsPage'
import { getProductionLocalShipmentsWorkspace } from '@/lib/actions/production-local-shipments'

export const metadata = { title: 'Локальные отгрузки — CRM LEDA' }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

export default async function ProductionLocalShipmentsRoute({
  searchParams,
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const params = await searchParams
  try {
    const workspace = await getProductionLocalShipmentsWorkspace({ factoryId: params?.factory })
    return <ProductionLocalShipmentsPage workspace={workspace} />
  } catch (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-900">
        Ошибка загрузки локальных отгрузок: {errorMessage(error)}
      </div>
    )
  }
}
