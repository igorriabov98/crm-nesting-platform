'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, CheckCircle2, Clock3, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  confirmOutsourcingServiceTerms,
  type SupplyOutsourcingAgreement,
} from '@/lib/actions/outsourcing'

type AgreementDraft = {
  plannedReturnDate: string
  serviceCostPlanned: string
}

function formatDate(value: string | null) {
  if (!value) return 'не указана'
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}

export function SupplyOutsourcingRequestsPage({
  agreements,
}: {
  agreements: SupplyOutsourcingAgreement[]
}) {
  const router = useRouter()
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Record<string, AgreementDraft>>(() => Object.fromEntries(
    agreements.map((agreement) => [agreement.operation_id, {
      plannedReturnDate: agreement.planned_return_date || '',
      serviceCostPlanned: agreement.service_cost_planned == null ? '' : String(agreement.service_cost_planned),
    }]),
  ))

  function updateDraft(operationId: string, patch: Partial<AgreementDraft>) {
    setDrafts((current) => ({
      ...current,
      [operationId]: { ...current[operationId], ...patch },
    }))
  }

  function confirmAgreement(agreement: SupplyOutsourcingAgreement) {
    const draft = drafts[agreement.operation_id]
    if (!draft?.plannedReturnDate) return

    setPendingOperationId(agreement.operation_id)
    startTransition(async () => {
      const result = await confirmOutsourcingServiceTerms({
        operationId: agreement.operation_id,
        plannedReturnDate: draft.plannedReturnDate,
        serviceCostPlanned: draft.serviceCostPlanned ? Number(draft.serviceCostPlanned) : null,
      })
      setPendingOperationId(null)

      if (!result.success) {
        toast.error(result.error || 'Не удалось подтвердить запрос')
        return
      }

      toast.success(agreement.supply_terms_confirmed_at ? 'Условия запроса обновлены' : 'Запрос подтверждён')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <header className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-900 text-white">
            <Building2 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-blue-950 sm:text-2xl">Запросы на аутсорсинг</h1>
            <p className="mt-1 text-sm text-slate-600">
              Здесь собраны работы, которые должно выполнить внешнее предприятие. Снабжение подтверждает дату возврата и стоимость услуги.
            </p>
          </div>
        </div>
      </header>

      {agreements.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
          <div className="mt-3 font-semibold text-blue-950">Новых запросов нет</div>
          <div className="mt-1 text-sm text-slate-500">Все активные запросы внешним компаниям появятся на этой странице.</div>
        </div>
      ) : (
        <div className="grid gap-3">
          {agreements.map((agreement) => {
            const draft = drafts[agreement.operation_id]
            const returnDateId = `request-return-${agreement.operation_id}`
            const serviceCostId = `request-cost-${agreement.operation_id}`
            const saving = isPending && pendingOperationId === agreement.operation_id

            return (
              <article key={agreement.operation_id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={agreement.supply_terms_confirmed_at
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
                        : 'bg-amber-100 text-amber-800 hover:bg-amber-100'}>
                        {agreement.supply_terms_confirmed_at ? 'Подтверждено' : 'Ожидает снабжение'}
                      </Badge>
                      <span className="font-semibold text-blue-950">{agreement.machine_name}</span>
                      <span className="text-sm font-medium text-slate-700">{agreement.work_type_name}</span>
                    </div>
                    <div className="mt-2 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
                      <span>Маршрут: {agreement.source_factory_name || 'завод не указан'} → {agreement.supplier_name || 'компания не указана'}</span>
                      <span>Производство готово отправить: <b>{formatDate(agreement.planned_send_date)}</b></span>
                    </div>
                  </div>

                  <div className="grid w-full gap-3 sm:grid-cols-[minmax(190px,1fr)_minmax(160px,1fr)_auto] xl:max-w-2xl">
                    <Label className="grid gap-1.5 text-sm text-slate-700" htmlFor={returnDateId}>
                      Ожидаем возврат
                      <Input
                        id={returnDateId}
                        type="date"
                        value={draft?.plannedReturnDate || ''}
                        onChange={(event) => updateDraft(agreement.operation_id, { plannedReturnDate: event.target.value })}
                      />
                    </Label>
                    <Label className="grid gap-1.5 text-sm text-slate-700" htmlFor={serviceCostId}>
                      Стоимость услуги
                      <Input
                        id={serviceCostId}
                        type="number"
                        min={0}
                        inputMode="decimal"
                        value={draft?.serviceCostPlanned || ''}
                        onChange={(event) => updateDraft(agreement.operation_id, { serviceCostPlanned: event.target.value })}
                      />
                    </Label>
                    <Button
                      type="button"
                      disabled={isPending || !draft?.plannedReturnDate}
                      onClick={() => confirmAgreement(agreement)}
                      className="min-h-11 gap-2 sm:self-end"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : agreement.supply_terms_confirmed_at
                        ? <CheckCircle2 className="h-4 w-4" />
                        : <Clock3 className="h-4 w-4" />}
                      {agreement.supply_terms_confirmed_at ? 'Сохранить' : 'Подтвердить'}
                    </Button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
