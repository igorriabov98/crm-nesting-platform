import { withPagePermission } from '@/lib/permissions/page-guard'
import Link from 'next/link'
import { ArrowRight, ClipboardCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getTechnologistApprovalList } from '@/lib/actions/technologist-request-approvals'
import { ROUTES } from '@/lib/constants/routes'
import { formatApprovalVersion } from '@/lib/technologist-request-approval'
import { approvalBadgeClass } from '@/lib/technologist-approval-badge'

const stateLabels: Record<string, string> = {
  pending: 'На согласовании', returned: 'Возвращена', superseded: 'Заменена', approved: 'Одобрена',
}

type ApprovalListRow = {
  id: string
  request_number: number
  display_revision_number: number
  machines: { name: string | null; material_type: string | null } | Array<{ name: string | null; material_type: string | null }> | null
  currentVersion: { revision_number: number; display_revision_number: number; state: string; material_type_snapshot?: string | null; sheetScrapSummary?: { quantity: number; weightKg: number } } | null
}

function machine(row: ApprovalListRow) {
  const order = Array.isArray(row.machines) ? row.machines[0] : row.machines
  return order ? { ...order, material_type: row.currentVersion?.material_type_snapshot || order.material_type } : null
}

export const metadata = { title: 'Итог по заявкам | CRM Завода' }

async function TechnologistRequestResultsPage() {
  const result = await getTechnologistApprovalList()
  if (result.error) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">{result.error}</div>
  const rows = result.data as ApprovalListRow[]
  return <main className="space-y-6">
    <header>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Итог по заявкам</h1>
      <p className="mt-1 text-sm text-slate-600">Версии заявок технолога и состояние финансового согласования.</p>
    </header>
    {rows.length === 0 ? <Card><CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
      <ClipboardCheck className="h-10 w-10 text-slate-400" />
      <div><p className="font-medium">Заявок пока нет</p><p className="text-sm text-slate-500">После отправки итогового мастера заявка появится здесь.</p></div>
    </CardContent></Card> : <>
      <div className="hidden overflow-hidden rounded-xl border bg-white md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600"><tr>
            <th className="px-4 py-3 font-medium">Номер заявки для заказа</th>
            <th className="px-4 py-3 font-medium">Заказ</th>
            <th className="px-4 py-3 font-medium">Тип материала</th>
            <th className="px-4 py-3 font-medium">Будущий листовой остаток</th>
            <th className="px-4 py-3 text-right font-medium">Подробнее</th>
          </tr></thead>
          <tbody className="divide-y">{rows.map((row) => {
            const current = row.currentVersion; const order = machine(row)
            return <tr key={row.id} className="hover:bg-slate-50/70">
              <td className="px-4 py-4 font-medium">№{row.request_number}<div className="mt-1"><Badge variant="outline" className={approvalBadgeClass(current?.state)}>{current ? `Версия ${formatApprovalVersion(current.display_revision_number, row.request_number)} · ${stateLabels[current.state] || current.state}` : row.display_revision_number > 0 ? `Черновик ${formatApprovalVersion(row.display_revision_number, row.request_number)}` : 'Черновик'}</Badge></div></td>
              <td className="px-4 py-4">{order?.name || 'Без названия'}</td>
              <td className="px-4 py-4">{order?.material_type === 'standard' ? 'Стандартный' : order?.material_type === 'non_standard' ? 'Нестандартный' : '—'}</td>
              <td className="px-4 py-4">{current?.sheetScrapSummary?.quantity ? `${current.sheetScrapSummary.quantity} шт. · ${current.sheetScrapSummary.weightKg.toFixed(3)} кг` : '—'}</td>
              <td className="px-4 py-4 text-right"><Link className={buttonVariants({ variant: 'outline' })} href={`${ROUTES.TECHNOLOGIST_REQUEST_RESULTS}/${row.id}`}>Подробнее<ArrowRight className="ml-2 h-4 w-4" /></Link></td>
            </tr>
          })}</tbody>
        </table>
      </div>
      <div className="grid gap-3 md:hidden">{rows.map((row) => {
        const current = row.currentVersion; const order = machine(row)
        return <Card key={row.id}><CardContent className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">№{row.request_number}</p><p className="mt-1 text-sm text-slate-600">{order?.name || 'Без названия'}</p></div><Badge variant="outline" className={approvalBadgeClass(current?.state)}>{current ? `Версия ${formatApprovalVersion(current.display_revision_number, row.request_number)} · ${stateLabels[current.state] || current.state}` : row.display_revision_number > 0 ? `Черновик ${formatApprovalVersion(row.display_revision_number, row.request_number)}` : 'Черновик'}</Badge></div>
          <div className="text-sm"><span className="text-slate-500">Тип материала: </span>{order?.material_type === 'standard' ? 'Стандартный' : order?.material_type === 'non_standard' ? 'Нестандартный' : '—'}</div>
          <div className="text-sm"><span className="text-slate-500">Будущий листовой остаток: </span>{current?.sheetScrapSummary?.quantity ? `${current.sheetScrapSummary.quantity} шт. · ${current.sheetScrapSummary.weightKg.toFixed(3)} кг` : '—'}</div>
          <Link className={buttonVariants({ variant: 'outline', className: 'min-h-11 w-full' })} href={`${ROUTES.TECHNOLOGIST_REQUEST_RESULTS}/${row.id}`}>Подробнее<ArrowRight className="ml-2 h-4 w-4" /></Link>
        </CardContent></Card>
      })}</div>
    </>}
  </main>
}

export default withPagePermission('/technologist/request-results', TechnologistRequestResultsPage)
