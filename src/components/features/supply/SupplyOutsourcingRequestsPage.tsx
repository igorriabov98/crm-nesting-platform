'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, CalendarDays, CheckCircle2, Clock3, ExternalLink, FileText, Filter, Hand, Info, Loader2, PackageOpen, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  confirmOutsourcingServiceTerms,
  takeOutsourcingSupplyRequest,
  type OutsourcingSupplierOption,
  type SupplyOutsourcingAgreement,
} from '@/lib/actions/outsourcing'

type AgreementDraft = {
  supplierId: string
  plannedSendDate: string
  plannedReturnDate: string
  serviceCostPlanned: string
}

type RequestStatusFilter = 'all' | 'awaiting' | 'in_work' | 'confirmed'

function formatDate(value: string | null) {
  if (!value) return 'не указана'
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}

export function SupplyOutsourcingRequestsPage({
  agreements,
  suppliers,
}: {
  agreements: SupplyOutsourcingAgreement[]
  suppliers: OutsourcingSupplierOption[]
}) {
  const router = useRouter()
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(null)
  const [detailsAgreement, setDetailsAgreement] = useState<SupplyOutsourcingAgreement | null>(null)
  const [requestDateFrom, setRequestDateFrom] = useState('')
  const [requestDateTo, setRequestDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState<RequestStatusFilter>('all')
  const [isPending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Record<string, AgreementDraft>>(() => Object.fromEntries(
    agreements.map((agreement) => [agreement.operation_id, {
      supplierId: agreement.supplier_id || '',
      plannedSendDate: agreement.planned_send_date || '',
      plannedReturnDate: agreement.planned_return_date || '',
      serviceCostPlanned: agreement.service_cost_planned == null ? '' : String(agreement.service_cost_planned),
    }]),
  ))
  const visibleAgreements = useMemo(() => agreements.filter((agreement) => {
    const requestDate = agreement.created_at.slice(0, 10)
    if (requestDateFrom && requestDate < requestDateFrom) return false
    if (requestDateTo && requestDate > requestDateTo) return false
    const status: Exclude<RequestStatusFilter, 'all'> = agreement.supply_terms_confirmed_at
      ? 'confirmed'
      : agreement.supply_taken_at
        ? 'in_work'
        : 'awaiting'
    return statusFilter === 'all' || statusFilter === status
  }), [agreements, requestDateFrom, requestDateTo, statusFilter])

  function resetFilters() {
    setRequestDateFrom('')
    setRequestDateTo('')
    setStatusFilter('all')
  }

  function takeAgreement(agreement: SupplyOutsourcingAgreement) {
    setPendingOperationId(agreement.operation_id)
    startTransition(async () => {
      const result = await takeOutsourcingSupplyRequest({ operationId: agreement.operation_id })
      setPendingOperationId(null)
      if (!result.success) {
        toast.error(result.error || 'Не удалось взять запрос в работу')
        return
      }
      toast.success('Запрос взят в работу')
      router.refresh()
    })
  }

  function updateDraft(operationId: string, patch: Partial<AgreementDraft>) {
    setDrafts((current) => ({
      ...current,
      [operationId]: { ...current[operationId], ...patch },
    }))
  }

  function confirmAgreement(agreement: SupplyOutsourcingAgreement) {
    const draft = drafts[agreement.operation_id]
    if (!draft?.supplierId || !draft.plannedSendDate || !draft.plannedReturnDate || !draft.serviceCostPlanned) return

    setPendingOperationId(agreement.operation_id)
    startTransition(async () => {
      const result = await confirmOutsourcingServiceTerms({
        operationId: agreement.operation_id,
        supplierId: draft.supplierId,
        plannedSendDate: draft.plannedSendDate,
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
              Возьмите заявку в работу, выберите исполнителя, подтвердите обе даты и стоимость. После подтверждения она появится в транспорте.
            </p>
          </div>
        </div>
      </header>

      {agreements.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Фильтры запросов">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Label className="grid gap-1.5 text-sm text-slate-700">
                Дата запроса с
                <Input
                  type="date"
                  value={requestDateFrom}
                  onChange={(event) => setRequestDateFrom(event.target.value)}
                />
              </Label>
              <Label className="grid gap-1.5 text-sm text-slate-700">
                Дата запроса по
                <Input
                  type="date"
                  value={requestDateTo}
                  onChange={(event) => setRequestDateTo(event.target.value)}
                />
              </Label>
              <Label className="grid gap-1.5 text-sm text-slate-700">
                Статус аутсорсинга
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as RequestStatusFilter)}>
                  <SelectTrigger className="h-10 w-full">
                    <Filter className="h-4 w-4 text-slate-500" />
                    <SelectValue>
                      {{
                        all: 'Все статусы',
                        awaiting: 'Ожидает снабжение',
                        in_work: 'В работе',
                        confirmed: 'Подтверждено',
                      }[statusFilter]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все статусы</SelectItem>
                    <SelectItem value="awaiting">Ожидает снабжение</SelectItem>
                    <SelectItem value="in_work">В работе</SelectItem>
                    <SelectItem value="confirmed">Подтверждено</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
            </div>
            <div className="flex items-center justify-between gap-3 lg:justify-end">
              <span className="text-sm text-slate-500">
                Показано {visibleAgreements.length} из {agreements.length}
              </span>
              <Button type="button" variant="outline" onClick={resetFilters} className="min-h-11 gap-2">
                <RotateCcw className="h-4 w-4" />
                Сбросить
              </Button>
            </div>
          </div>
        </section>
      )}

      {agreements.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
          <div className="mt-3 font-semibold text-blue-950">Новых запросов нет</div>
          <div className="mt-1 text-sm text-slate-500">Все активные запросы внешним компаниям появятся на этой странице.</div>
        </div>
      ) : visibleAgreements.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <Filter className="mx-auto h-8 w-8 text-blue-700" />
          <div className="mt-3 font-semibold text-blue-950">По выбранным фильтрам заявок нет</div>
          <div className="mt-1 text-sm text-slate-500">Измените даты или статус, чтобы увидеть другие заявки.</div>
          <Button type="button" variant="outline" onClick={resetFilters} className="mt-4 min-h-11 gap-2">
            <RotateCcw className="h-4 w-4" />
            Сбросить фильтры
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {visibleAgreements.map((agreement) => {
            const draft = drafts[agreement.operation_id]
            const returnDateId = `request-return-${agreement.operation_id}`
            const serviceCostId = `request-cost-${agreement.operation_id}`
            const saving = isPending && pendingOperationId === agreement.operation_id

            return (
              <article key={agreement.operation_id} data-focus-id={agreement.operation_id} tabIndex={-1} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm focus:outline-none data-[focus-active=true]:ring-2 data-[focus-active=true]:ring-blue-600">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={agreement.supply_terms_confirmed_at
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
                        : agreement.supply_taken_at
                          ? 'bg-blue-100 text-blue-800 hover:bg-blue-100'
                          : 'bg-amber-100 text-amber-800 hover:bg-amber-100'}>
                        {agreement.supply_terms_confirmed_at
                          ? 'Подтверждено'
                          : agreement.supply_taken_at
                            ? 'В работе'
                            : 'Ожидает снабжение'}
                      </Badge>
                      <span className="font-semibold text-blue-950">{agreement.machine_name}</span>
                      <span className="text-sm font-medium text-slate-700">{agreement.work_type_name}</span>
                    </div>
                    <div className="mt-2 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
                      <span>Маршрут: {agreement.source_factory_name || 'завод не указан'} → {agreement.supplier_name || 'компания не указана'}</span>
                      <span>Желаемая отправка: <b>{formatDate(agreement.planned_send_date)}</b></span>
                      <span>Запрос создан: <b>{formatDate(agreement.created_at.slice(0, 10))}</b></span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDetailsAgreement(agreement)}
                      className="mt-3 gap-2"
                    >
                      <Info className="h-4 w-4" />
                      Подробнее
                    </Button>
                  </div>

                  {!agreement.supply_taken_at ? (
                    <Button
                      type="button"
                      disabled={isPending}
                      onClick={() => takeAgreement(agreement)}
                      className="min-h-11 gap-2 xl:self-end"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hand className="h-4 w-4" />}
                      Взять в работу
                    </Button>
                  ) : (
                  <div className="grid w-full gap-3 sm:grid-cols-2 xl:max-w-3xl xl:grid-cols-5">
                    <Label className="grid gap-1.5 text-sm text-slate-700">
                      Компания
                      <Select
                        value={draft?.supplierId || ''}
                        onValueChange={(value) => value && updateDraft(agreement.operation_id, { supplierId: value })}
                      >
                        <SelectTrigger className="h-10 w-full">
                          <SelectValue>
                            {suppliers.find((supplier) => supplier.id === draft?.supplierId)?.name || 'Выберите компанию'}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {suppliers.map((supplier) => (
                            <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Label>
                    <Label className="grid gap-1.5 text-sm text-slate-700">
                      Готовы отправить
                      <Input
                        type="date"
                        value={draft?.plannedSendDate || ''}
                        onChange={(event) => updateDraft(agreement.operation_id, { plannedSendDate: event.target.value })}
                      />
                    </Label>
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
                      Цена аутсорсинга
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
                      disabled={isPending || !draft?.supplierId || !draft.plannedSendDate || !draft.plannedReturnDate || !draft.serviceCostPlanned}
                      onClick={() => confirmAgreement(agreement)}
                      className="min-h-11 gap-2 sm:self-end"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : agreement.supply_terms_confirmed_at
                        ? <CheckCircle2 className="h-4 w-4" />
                        : <Clock3 className="h-4 w-4" />}
                      {agreement.supply_terms_confirmed_at ? 'Сохранить' : 'Подтвердить'}
                    </Button>
                  </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      <Dialog open={Boolean(detailsAgreement)} onOpenChange={(open) => {
        if (!open) setDetailsAgreement(null)
      }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-3xl">
          {detailsAgreement && (
            <>
              <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-12 sm:px-6">
                <DialogTitle className="text-xl text-blue-950">
                  Заявка на аутсорсинг · {detailsAgreement.machine_name}
                </DialogTitle>
                <p className="text-sm text-slate-500">
                  Полная информация для принятия заявки в работу
                </p>
              </DialogHeader>

              <div className="grid gap-4 bg-slate-50/70 p-4 sm:p-6">
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-center gap-2 font-semibold text-blue-950">
                    <FileText className="h-4 w-4 text-blue-600" />
                    Тип работы
                  </div>
                  <div className="text-base font-medium text-slate-900">{detailsAgreement.work_type_name}</div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-center gap-2 font-semibold text-blue-950">
                    <CalendarDays className="h-4 w-4 text-blue-600" />
                    Сроки и примечание
                  </div>
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-slate-500">Готовы отправить</dt>
                      <dd className="mt-1 font-semibold text-slate-900">{formatDate(detailsAgreement.planned_send_date)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Ожидаем возврат</dt>
                      <dd className="mt-1 font-semibold text-slate-900">{formatDate(detailsAgreement.planned_return_date)}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-slate-500">Примечание</dt>
                      <dd className="mt-1 whitespace-pre-wrap text-slate-800">
                        {detailsAgreement.note || 'Примечание не добавлено'}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 font-semibold text-blue-950">
                      <PackageOpen className="h-4 w-4 text-blue-600" />
                      Продукция к отправке
                    </div>
                    <span className="text-xs font-medium text-slate-500">
                      Позиций: {detailsAgreement.items.length}
                    </span>
                  </div>

                  {detailsAgreement.items.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                      Продукция в заявке не указана.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full min-w-[620px] text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-3 py-2.5 font-semibold">Продукция</th>
                            <th className="px-3 py-2.5 font-semibold">Чертёж</th>
                            <th className="px-3 py-2.5 text-right font-semibold">Количество</th>
                            <th className="px-3 py-2.5 text-right font-semibold">Вес</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {detailsAgreement.items.map((item) => (
                            <tr key={item.id}>
                              <td className="px-3 py-3 font-medium text-slate-900">{item.product_name}</td>
                              <td className="px-3 py-3">
                                {item.drawing_url ? (
                                  <a
                                    href={item.drawing_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 font-medium text-blue-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                                    aria-label={`Открыть чертёж ${item.drawing_number} в новой вкладке`}
                                  >
                                    {item.drawing_number || 'Без номера'}
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                ) : (
                                  <span className="text-slate-600">{item.drawing_number || 'Не указан'}</span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right text-slate-700">{item.quantity} шт.</td>
                              <td className="px-3 py-3 text-right font-medium text-slate-900">
                                {item.weight.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} т
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
