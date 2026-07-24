'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarRange, Factory, Loader2, Route, Save } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  updateIncomingOutsourcingPlan,
  type ProductionOutsourcingSummaryOperation,
} from '@/lib/actions/outsourcing'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'
import type { FactorySummary } from '@/lib/types'

type IncomingDraft = {
  incomingProductionMonth: string
  incomingWorkshop: string
  incomingQueueNumber: string
  incomingDateStart: string
  incomingDateEnd: string
}

function initialDraft(operation: ProductionOutsourcingSummaryOperation): IncomingDraft {
  return {
    incomingProductionMonth: operation.incoming_production_month?.slice(0, 7) || '',
    incomingWorkshop: operation.incoming_workshop ? String(operation.incoming_workshop) : '',
    incomingQueueNumber: operation.incoming_queue_number ? String(operation.incoming_queue_number) : '',
    incomingDateStart: operation.incoming_date_start || '',
    incomingDateEnd: operation.incoming_date_end || '',
  }
}

function formatDate(value: string | null) {
  if (!value) return 'не указана'
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}

function itemSummary(operation: ProductionOutsourcingSummaryOperation) {
  if (operation.items.length === 0) return 'Состав заказа не указан'
  return operation.items
    .map((item) => `${item.product_name} — ${item.quantity} шт.`)
    .join('; ')
}

export function ProductionOutsourcingRequestsPage({
  factories,
  activeFactoryId,
  operations,
  canManage,
}: {
  factories: FactorySummary[]
  activeFactoryId: string
  operations: ProductionOutsourcingSummaryOperation[]
  canManage: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [savingOperationId, setSavingOperationId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, IncomingDraft>>(() => Object.fromEntries(
    operations.map((operation) => [operation.id, initialDraft(operation)]),
  ))

  function updateDraft(operationId: string, patch: Partial<IncomingDraft>) {
    setDrafts((current) => ({
      ...current,
      [operationId]: { ...current[operationId], ...patch },
    }))
  }

  function save(operation: ProductionOutsourcingSummaryOperation) {
    const draft = drafts[operation.id]
    if (!draft) return

    setSavingOperationId(operation.id)
    startTransition(async () => {
      const result = await updateIncomingOutsourcingPlan({
        operationId: operation.id,
        incomingProductionMonth: draft.incomingProductionMonth ? `${draft.incomingProductionMonth}-01` : null,
        incomingWorkshop: draft.incomingWorkshop ? Number(draft.incomingWorkshop) : null,
        incomingQueueNumber: draft.incomingQueueNumber ? Number(draft.incomingQueueNumber) : null,
        incomingDateStart: draft.incomingDateStart || null,
        incomingDateEnd: draft.incomingDateEnd || null,
      })
      setSavingOperationId(null)

      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить даты производства')
        return
      }

      toast.success('Даты подтверждены, запрос на транспорт создан')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <header className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-900 text-white">
              <Factory className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-xl font-bold text-blue-950 sm:text-2xl">Запросы производства</h1>
              <p className="mt-1 text-sm text-slate-600">
                Желаемые даты задаёт отправляющее производство. Принимающий завод подтверждает свой месяц, цех, очередь и фактический период работ.
              </p>
            </div>
          </div>

          {factories.length > 1 && (
            <nav className="flex max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1" aria-label="Выбор завода">
              {factories.map((factory) => (
                <Link
                  key={factory.id}
                  href={`${ROUTES.PRODUCTION_OUTSOURCING_REQUESTS}?factory=${factory.id}`}
                  aria-current={factory.id === activeFactoryId ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-10 shrink-0 items-center rounded-md px-3 text-sm font-medium transition-colors',
                    factory.id === activeFactoryId
                      ? 'bg-blue-900 text-white'
                      : 'text-slate-600 hover:bg-slate-200 hover:text-blue-950',
                  )}
                >
                  {factory.name}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>

      {operations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <CalendarRange className="mx-auto h-8 w-8 text-slate-400" />
          <div className="mt-3 font-semibold text-blue-950">Входящих запросов нет</div>
          <div className="mt-1 text-sm text-slate-500">Запросы, где исполнителем выбран этот завод, появятся здесь.</div>
        </div>
      ) : (
        <div className="grid gap-4">
          {operations.map((operation) => {
            const draft = drafts[operation.id]
            const planned = Boolean(
              operation.incoming_production_month
              && operation.incoming_workshop
              && operation.incoming_queue_number
              && operation.incoming_date_start
              && operation.incoming_date_end,
            )
            const readyToSave = Boolean(
              draft?.incomingProductionMonth
              && draft.incomingWorkshop
              && draft.incomingQueueNumber
              && draft.incomingDateStart
              && draft.incomingDateEnd,
            )
            const saving = isPending && savingOperationId === operation.id

            return (
              <article key={operation.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={planned
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
                        : 'bg-amber-100 text-amber-800 hover:bg-amber-100'}>
                        {planned ? 'Запланировано' : 'Ожидает даты'}
                      </Badge>
                      <span className="font-semibold text-blue-950">{operation.machine_name}</span>
                      <span className="text-sm font-medium text-slate-700">{operation.work_type_name}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
                      <span>Отправитель: <b>{operation.source_factory_name || 'не указан'}</b></span>
                      <span>Исполнитель: <b>{operation.executor_factory_name || 'не указан'}</b></span>
                    </div>
                    <div className="mt-2 text-sm text-slate-600">{itemSummary(operation)}</div>
                    {operation.note && <div className="mt-1 text-sm text-slate-500">Описание: {operation.note}</div>}
                  </div>

                  <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-950">
                    <div className="flex items-center gap-2 font-semibold">
                      <Route className="h-4 w-4" />
                      Желаемые даты отправителя
                    </div>
                    <div className="mt-1">
                      {formatDate(operation.planned_send_date)} — {formatDate(operation.planned_return_date)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(150px,0.8fr)_110px_110px_minmax(160px,1fr)_minmax(160px,1fr)_auto]">
                  <Label className="grid gap-1.5 text-sm text-slate-700">
                    Месяц производства
                    <Input
                      type="month"
                      disabled={!canManage}
                      value={draft?.incomingProductionMonth || ''}
                      onChange={(event) => updateDraft(operation.id, { incomingProductionMonth: event.target.value })}
                    />
                  </Label>
                  <Label className="grid gap-1.5 text-sm text-slate-700">
                    Цех
                    <Input
                      type="number"
                      min={1}
                      disabled={!canManage}
                      value={draft?.incomingWorkshop || ''}
                      onChange={(event) => updateDraft(operation.id, { incomingWorkshop: event.target.value })}
                    />
                  </Label>
                  <Label className="grid gap-1.5 text-sm text-slate-700">
                    Очередь
                    <Input
                      type="number"
                      min={1}
                      disabled={!canManage}
                      value={draft?.incomingQueueNumber || ''}
                      onChange={(event) => updateDraft(operation.id, { incomingQueueNumber: event.target.value })}
                    />
                  </Label>
                  <Label className="grid gap-1.5 text-sm text-slate-700">
                    Начало у исполнителя
                    <Input
                      type="date"
                      disabled={!canManage}
                      value={draft?.incomingDateStart || ''}
                      onChange={(event) => {
                        const start = event.target.value
                        updateDraft(operation.id, {
                          incomingDateStart: start,
                          incomingProductionMonth: draft?.incomingProductionMonth || start.slice(0, 7),
                        })
                      }}
                    />
                  </Label>
                  <Label className="grid gap-1.5 text-sm text-slate-700">
                    Конец у исполнителя
                    <Input
                      type="date"
                      disabled={!canManage}
                      value={draft?.incomingDateEnd || ''}
                      onChange={(event) => updateDraft(operation.id, { incomingDateEnd: event.target.value })}
                    />
                  </Label>
                  <Button
                    type="button"
                    disabled={!canManage || !readyToSave || isPending}
                    onClick={() => save(operation)}
                    className="min-h-11 gap-2 xl:self-end"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Подтвердить
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
