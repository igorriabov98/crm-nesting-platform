import Link from 'next/link'
import { ArrowLeft, History } from 'lucide-react'
import { notFound } from 'next/navigation'
import { ApprovalDecisionActions } from '@/components/features/technologist/ApprovalDecisionActions'
import { ApprovalSummary } from '@/components/features/technologist/ApprovalSummary'
import { ApprovalVersionHistory } from '@/components/features/technologist/ApprovalVersionHistory'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getTechnologistApprovalDetail } from '@/lib/actions/technologist-request-approvals'
import { ROUTES } from '@/lib/constants/routes'
import {
  formatApprovalVersion,
} from '@/lib/technologist-request-approval'

const stateLabels: Record<string, string> = {
  pending: 'На согласовании', returned: 'Возвращена', superseded: 'Заменена', approved: 'Одобрена',
}
export default async function RequestResultDetailPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params
  const result = await getTechnologistApprovalDetail(requestId)
  if (!result.data) {
    if (result.error === 'Заявка не найдена') notFound()
    return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">{result.error}</div>
  }
  const { request, versions, canReview, canEdit, currentSnapshot, currentDraft } = result.data
  const order = Array.isArray(request.machines) ? request.machines[0] : request.machines
  type VersionView = {
    id: string
    revision_number: number
    state: string
    is_legacy: boolean
  }
  const typedVersions = versions as VersionView[]
  const current = typedVersions[0] || null
  return <main className="mx-auto max-w-6xl space-y-6 pb-16">
    <Link className={buttonVariants({ variant: 'ghost', className: '-ml-3' })} href={ROUTES.TECHNOLOGIST_REQUEST_RESULTS}><ArrowLeft className="mr-2 h-4 w-4" />К итогам</Link>
    <header className="flex flex-col justify-between gap-4 rounded-xl border bg-white p-5 sm:flex-row sm:items-start">
      <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold">Заявка №{request.request_number}</h1>{current && <Badge>{stateLabels[current.state] || current.state}</Badge>}</div><p className="mt-1 text-slate-600">{order?.name || 'Без названия'} · {order?.material_type === 'standard' ? 'Стандартный материал' : order?.material_type === 'non_standard' ? 'Нестандартный материал' : 'Тип не выбран'}</p></div>
    </header>
    <Card><CardHeader><CardTitle>{currentDraft ? 'Текущий черновик' : 'Текущая сводка'}{current && !currentDraft ? ` · Версия ${formatApprovalVersion(current.revision_number)}` : ''}</CardTitle></CardHeader><CardContent className="space-y-4">{currentDraft && <p className="text-sm text-slate-500">Состав и брони показаны на текущий момент. Отходность, время и будущая деталировка — по последней отправке; они обновятся после повторного итогового мастера.</p>}<ApprovalSummary snapshot={currentSnapshot || null} /></CardContent></Card>
    <ApprovalDecisionActions requestId={request.id} versionId={current?.id || null} canEdit={canEdit} canReview={canReview} pending={current?.state === 'pending'} />
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />История версий</CardTitle></CardHeader><CardContent className="space-y-3">
      <ApprovalVersionHistory requestId={requestId} versions={typedVersions} />
    </CardContent></Card>
  </main>
}
