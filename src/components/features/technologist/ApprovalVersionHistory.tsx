'use client'

import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getTechnologistApprovalHistoryVersion } from '@/lib/actions/technologist-request-approvals'
import { formatApprovalVersion, type ApprovalSummarySnapshot, type ApprovalVersionDiff } from '@/lib/technologist-request-approval'
import { approvalBadgeClass } from '@/lib/technologist-approval-badge'
import { ApprovalSummary, ApprovalDiff } from './ApprovalSummary'

type Version = { id: string; revision_number: number; state: string; is_legacy: boolean }
type LoadedVersion = { summary: ApprovalSummarySnapshot | null; diff: ApprovalVersionDiff | null; reason: string | null }
const labels: Record<string, string> = { pending: 'На согласовании', returned: 'Возвращена', superseded: 'Заменена', approved: 'Одобрена' }

function HistoryEntry({ requestId, version }: { requestId: string; version: Version }) {
  const [data, setData] = useState<LoadedVersion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inFlight = useRef(false)

  async function load() {
    if (data || inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const result = await getTechnologistApprovalHistoryVersion(requestId, version.id)
      if (result.data) setData(result.data)
      else setError(result.error || 'Не удалось загрузить версию')
    } catch { setError('Не удалось загрузить версию') }
    finally { inFlight.current = false; setLoading(false) }
  }

  return <details className="group rounded-lg border bg-white open:shadow-sm" onToggle={(event) => {
    if (event.currentTarget.open && !error) void load()
  }}>
    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      <span className="font-medium">Версия {formatApprovalVersion(version.revision_number)}</span>
      <span className="flex flex-wrap items-center justify-end gap-2"><Badge variant="outline" className={approvalBadgeClass(version.state)}>{version.is_legacy ? 'Одобрена до согласования' : labels[version.state]}</Badge><span className="text-sm text-blue-700">Подробнее</span></span>
    </summary>
    <div className="space-y-4 border-t p-4" aria-busy={loading}>
      {loading && <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Загрузка версии…</p>}
      {error && <div role="alert" className="space-y-2 text-sm text-red-700"><p>{error}</p><Button variant="outline" disabled={loading} onClick={() => void load()}>Повторить</Button></div>}
      {data && <>
        {data.reason && <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-800"><strong>Причина возврата:</strong> {data.reason}</div>}
        <ApprovalDiff diff={data.diff} />
        <ApprovalSummary snapshot={data.summary} />
      </>}
    </div>
  </details>
}

export function ApprovalVersionHistory({ requestId, versions }: { requestId: string; versions: Version[] }) {
  return versions.length ? <>{versions.map((version) => <HistoryEntry key={version.id} requestId={requestId} version={version} />)}</> : <p className="text-sm text-slate-500">Версий пока нет.</p>
}
