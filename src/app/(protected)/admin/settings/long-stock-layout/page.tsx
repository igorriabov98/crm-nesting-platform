import { AccessDenied } from '@/components/ui/AccessDenied'
import { LongStockLayoutSettingsPage } from '@/components/features/settings/LongStockLayoutSettingsPage'
import { getLongStockLayoutSettings } from '@/lib/actions/long-stock-layout-settings'
import { requirePermission } from '@/lib/permissions/server'

export const metadata = { title: 'Раскладка хлыстов — CRM Завода' }
export const dynamic = 'force-dynamic'

export default async function LongStockLayoutSettingsRoute() {
  const context = await requirePermission('long_stock_layout_settings', 'view').catch(() => null)
  if (!context?.permissionDetails.isAdminPosition) return <AccessDenied />
  return <LongStockLayoutSettingsPage initial={await getLongStockLayoutSettings()} />
}
