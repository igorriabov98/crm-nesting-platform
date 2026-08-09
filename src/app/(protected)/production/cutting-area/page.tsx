import { CuttingAreaPage } from '@/components/features/production/CuttingAreaPage'
import { getProductionCuttingAreaWorkspace } from '@/lib/actions/production-cutting-area'

export const metadata = { title: 'Участок заготовки — CRM LEDA' }
export const dynamic = 'force-dynamic'

export default async function ProductionCuttingAreaRoute() {
  const workspace = await getProductionCuttingAreaWorkspace()
  return <CuttingAreaPage workspace={workspace} />
}
