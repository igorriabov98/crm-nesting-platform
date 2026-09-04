import Link from 'next/link'
import { ArrowLeft, Settings2 } from 'lucide-react'

import { ProductionReportSettingsClient } from '@/components/features/reports/ProductionReportSettingsClient'
import { Button } from '@/components/ui/button'
import { getProductionReportSettingsData } from '@/lib/actions/production-reports'
import { ROUTES } from '@/lib/constants/routes'

export const metadata = { title: 'Настройки производственной аналитики — CRM Завода' }
export const dynamic = 'force-dynamic'

export default async function ProductionReportSettingsPage({ searchParams }: { searchParams?: Promise<{ factory?: string }> }) {
  const params = await searchParams
  const data = await getProductionReportSettingsData(params?.factory)
  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-[#12315F]"><Settings2 className="size-6 text-[#1E40AF]" />Настройки производственной аналитики</h1>
          <p className="mt-1 text-sm text-[#64748B]">Календарные исключения завода и эффективные периоды мощности участков.</p>
        </div>
        <Button render={<Link href={ROUTES.REPORTS_PRODUCTION} />} variant="outline" className="min-h-9"><ArrowLeft />К отчёту</Button>
      </header>
      <ProductionReportSettingsClient key={data.selectedFactoryId || 'none'} data={data} />
    </div>
  )
}
