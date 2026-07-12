import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { BusinessScrapWorkspaceView } from '@/components/features/business-scrap/BusinessScrapWorkspace'
import { getBusinessScrapMachineEntry } from '@/lib/actions/business-scrap-corrections'
import { ROUTES } from '@/lib/constants/routes'

export default async function BusinessScrapMachinePage({ params }: { params: Promise<{ machineId: string }> }) {
  const { machineId } = await params
  const result = await getBusinessScrapMachineEntry(machineId)
  if (!result.data || result.error) {
    return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">Ошибка загрузки: {result.error || 'Неизвестная ошибка'}</div>
  }
  if (result.data.workspace) return <BusinessScrapWorkspaceView workspace={result.data.workspace} />

  const request = result.data.request
  return (
    <div className="space-y-5">
      <Link href={ROUTES.BUSINESS_SCRAP_RESERVATIONS} className="inline-flex items-center gap-2 text-sm text-slate-600"><ArrowLeft className="h-4 w-4" /> К списку машин</Link>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-bold text-[#1B3A6B]">{result.data.machine.name}</h1>
        <p className="mt-3 text-slate-600">
          {request ? 'Сначала завершите заполнение заявки на материалы, затем станет доступна бронь делового остатка.' : 'Для машины ещё не создана заявка на материалы.'}
        </p>
        <Link href={ROUTES.SALES_PLAN + '/' + machineId + '/request'} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[#1B3A6B] px-5 text-sm font-semibold text-white">
          {request ? 'Продолжить заявку' : 'Создать заявку'}
        </Link>
      </section>
    </div>
  )
}
