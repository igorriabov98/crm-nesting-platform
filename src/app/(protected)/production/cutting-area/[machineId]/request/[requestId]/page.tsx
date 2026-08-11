import { notFound } from 'next/navigation'
import { TechnologistRequestPage } from '@/components/features/requests/TechnologistRequestPage'
import { getProductionCuttingAreaRequest } from '@/lib/actions/production-cutting-area'
import { ROUTES } from '@/lib/constants/routes'
import type { SteelType } from '@/lib/types/database'

export const metadata = { title: 'Заявка на материалы — Участок заготовки' }
export const dynamic = 'force-dynamic'

export default async function ProductionCuttingAreaRequestPage({
  params,
}: {
  params: Promise<{ machineId: string; requestId: string }>
}) {
  const { machineId, requestId } = await params
  const result = await getProductionCuttingAreaRequest(machineId, requestId)
  if (!result.success || !result.data) notFound()

  return (
    <TechnologistRequestPage
      machine={result.data.machine}
      data={result.data.request}
      suppliers={{ sheetMetal: [] }}
      canManage={false}
      steelTypes={result.data.steelTypes as SteelType[]}
      backHref={ROUTES.PRODUCTION_CUTTING_AREA}
      backLabel="Назад к участку заготовки"
      readOnlyMessage="Заявка открыта на участке заготовки. Состав и статусы доступны без возможности изменения."
    />
  )
}
