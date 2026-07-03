'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Factory, Loader2, Save, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { updateIncomingOutsourcingPlan, type ProductionOutsourcingSummary, type ProductionOutsourcingSummaryOperation } from '@/lib/actions/outsourcing'

type IncomingDraft = {
  incoming_production_month: string
  incoming_workshop: string
  incoming_queue_number: string
  incoming_date_start: string
  incoming_date_end: string
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}

function itemsLabel(operation: ProductionOutsourcingSummaryOperation) {
  if (operation.items.length === 0) return 'товары не выбраны'
  return operation.items.map((item) => `${item.product_name} (${item.quantity} шт.)`).join(', ')
}

function executorLabel(operation: ProductionOutsourcingSummaryOperation) {
  return operation.executor_factory_name || operation.supplier_name || 'Исполнитель не указан'
}

export function ProductionOutsourcingPanel({ summary }: { summary: ProductionOutsourcingSummary }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Record<string, IncomingDraft>>(() => Object.fromEntries(summary.incoming.map((operation) => [
    operation.id,
    {
      incoming_production_month: operation.incoming_production_month || '',
      incoming_workshop: operation.incoming_workshop ? String(operation.incoming_workshop) : '',
      incoming_queue_number: operation.incoming_queue_number ? String(operation.incoming_queue_number) : '',
      incoming_date_start: operation.incoming_date_start || '',
      incoming_date_end: operation.incoming_date_end || '',
    },
  ])))

  function updateDraft(operationId: string, patch: Partial<IncomingDraft>) {
    setDrafts((current) => ({
      ...current,
      [operationId]: { ...current[operationId], ...patch },
    }))
  }

  function saveIncoming(operationId: string) {
    const draft = drafts[operationId]
    if (!draft) return
    startTransition(async () => {
      const result = await updateIncomingOutsourcingPlan({
        operationId,
        incomingProductionMonth: draft.incoming_production_month || null,
        incomingWorkshop: draft.incoming_workshop ? Number(draft.incoming_workshop) : null,
        incomingQueueNumber: draft.incoming_queue_number ? Number(draft.incoming_queue_number) : null,
        incomingDateStart: draft.incoming_date_start || null,
        incomingDateEnd: draft.incoming_date_end || null,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить входящую работу')
        return
      }
      toast.success('Входящая работа сохранена')
      router.refresh()
    })
  }

  if (summary.outgoing.length === 0 && summary.incoming.length === 0) return null

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Truck className="h-5 w-5 text-blue-900" />
        <h2 className="text-base font-semibold text-blue-950">Аутсорсинг</h2>
      </div>

      {summary.outgoing.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-700">Отправляем с этого завода</div>
          <div className="grid gap-2">
            {summary.outgoing.map((operation) => (
              <div key={operation.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="bg-white">{operation.work_type_name}</Badge>
                  <span className="font-semibold text-slate-900">{operation.machine_name}</span>
                  <span className="text-slate-500">исполнитель: {executorLabel(operation)}</span>
                </div>
                <div className="mt-2 grid gap-2 text-slate-600 sm:grid-cols-3">
                  <span>Отправка: <b>{formatDate(operation.planned_send_date)}</b></span>
                  <span>Возврат: <b>{formatDate(operation.planned_return_date)}</b></span>
                  <span className="truncate">{itemsLabel(operation)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary.incoming.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Factory className="h-4 w-4" />
            Входящие работы этого завода
          </div>
          <div className="grid gap-2">
            {summary.incoming.map((operation) => {
              const draft = drafts[operation.id]
              return (
                <div key={operation.id} className="rounded-lg border border-blue-100 bg-blue-50/70 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-blue-900 text-white">{operation.work_type_name}</Badge>
                    <span className="font-semibold text-blue-950">{operation.machine_name}</span>
                    {operation.source_factory_name && <span className="text-slate-500">от {operation.source_factory_name}</span>}
                  </div>
                  <div className="mt-2 text-slate-600">{itemsLabel(operation)}</div>
                  <div className="mt-3 grid gap-2 md:grid-cols-5">
                    <Input type="date" value={draft?.incoming_production_month || ''} onChange={(event) => updateDraft(operation.id, { incoming_production_month: event.target.value })} />
                    <Input type="number" min={1} placeholder="Цех" value={draft?.incoming_workshop || ''} onChange={(event) => updateDraft(operation.id, { incoming_workshop: event.target.value })} />
                    <Input type="number" min={1} placeholder="Очередь" value={draft?.incoming_queue_number || ''} onChange={(event) => updateDraft(operation.id, { incoming_queue_number: event.target.value })} />
                    <Input type="date" value={draft?.incoming_date_start || ''} onChange={(event) => updateDraft(operation.id, { incoming_date_start: event.target.value })} />
                    <div className="flex gap-2">
                      <Input type="date" value={draft?.incoming_date_end || ''} onChange={(event) => updateDraft(operation.id, { incoming_date_end: event.target.value })} />
                      <Button size="sm" disabled={isPending} onClick={() => saveIncoming(operation.id)} className="h-10 shrink-0 gap-2">
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
