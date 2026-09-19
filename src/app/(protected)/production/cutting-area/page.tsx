import { withPagePermission } from '@/lib/permissions/page-guard'
import { CuttingAreaPage } from '@/components/features/production/CuttingAreaPage'
import { getProductionCuttingAreaWorkspace } from '@/lib/actions/production-cutting-area'

export const metadata = { title: 'Участок заготовки — CRM LEDA' }
export const dynamic = 'force-dynamic'

async function ProductionCuttingAreaRoute() {
  const workspace = await getProductionCuttingAreaWorkspace()
  return <CuttingAreaPage workspace={workspace} />
}

export default withPagePermission('/production/cutting-area', ProductionCuttingAreaRoute)
