'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Building2, CalendarDays, CheckCircle2, Clock3, ExternalLink, FileText, Filter, Hand, Info, Loader2, PackageOpen, RotateCcw, Send } from 'lucide-react'
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
import { notifySidebarWorkQueuesChanged } from '@/lib/sidebar-work-queue-events'
import { markVrbCarrierDispatched, resolveVrbOrderChange } from '@/lib/actions/vrb-outsourcing'

type AgreementDraft = {
  supplierId: string
  plannedSendDate: string
  plannedReturnDate: string
  serviceCostPlanned: string
  deliveryMethod: 'own_transport' | 'carrier' | ''
  deliveryCarrierSupplierId: string
  deliveryCostPlanned: string
  trackingNumber: string
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
  carriers,
}: {
  agreements: SupplyOutsourcingAgreement[]
  suppliers: OutsourcingSupplierOption[]
  carriers: OutsourcingSupplierOption[]
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
      deliveryMethod: agreement.delivery_method || '',
      deliveryCarrierSupplierId: agreement.delivery_carrier_supplier_id || '',
      deliveryCostPlanned: agreement.delivery_cost_planned == null ? '' : String(agreement.delivery_cost_planned),
      trackingNumber: agreement.delivery_tracking_number || '',
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
      notifySidebarWorkQueuesChanged()
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
    const isVrb = agreement.operation_kind === 'vrb_mesh'
    if (!draft?.supplierId || !draft.plannedReturnDate || draft.serviceCostPlanned === '') return
    if (!isVrb && !draft.plannedSendDate) return
    if (isVrb && !draft.deliveryMethod) return
    if (isVrb && draft.deliveryMethod === 'carrier' && (
      !draft.deliveryCarrierSupplierId || draft.deliveryCostPlanned === ''
    )) return

    setPendingOperationId(agreement.operation_id)
    startTransition(async () => {
      const result = await confirmOutsourcingServiceTerms({
        operationId: agreement.operation_id,
        supplierId: draft.supplierId,
        plannedSendDate: draft.plannedSendDate,
        plannedReturnDate: draft.plannedReturnDate,
        serviceCostPlanned: Number(draft.serviceCostPlanned),
        deliveryMethod: isVrb ? draft.deliveryMethod || null : null,
        deliveryCarrierSupplierId: isVrb && draft.deliveryMethod === 'carrier'
          ? draft.deliveryCarrierSupplierId
          : null,
        deliveryCostPlanned: isVrb && draft.deliveryMethod === 'carrier'
          ? Number(draft.deliveryCostPlanned)
          : null,
      })
      setPendingOperationId(null)

      if (!result.success) {
        toast.error(result.error || 'Не удалось подтвердить запрос')
        return
      }

      toast.success(agreement.supply_terms_confirmed_at ? 'Условия запроса обновлены' : 'Запрос подтверждён')
      notifySidebarWorkQueuesChanged()
      router.refresh()
    })
  }

  function resolveChange(agreement: SupplyOutsourcingAgreement, decision: 'accepted' | 'kept_original') {
    setPendingOperationId(agreement.operation_id)
    startTransition(async () => {
      const result = await resolveVrbOrderChange({ operationId: agreement.operation_id, decision })
      setPendingOperationId(null)
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить решение')
        return
      }
      toast.success(decision === 'accepted' ? 'Состав VRB обновлён, условия сброшены' : 'Исходный состав VRB сохранён')
      router.refresh()
    })
  }

  function dispatchCarrier(agreement: SupplyOutsourcingAgreement) {
    const trackingNumber = drafts[agreement.operation_id]?.trackingNumber.trim()
    if (!trackingNumber) return
    setPendingOperationId(agreement.operation_id)
    startTransition(async () => {
      const result = await markVrbCarrierDispatched({ operationId: agreement.operation_id, trackingNumber })
      setPendingOperationId(null)
      if (!result.success) {
        toast.error(result.error || 'Не удалось зафиксировать отправку')
        return
      }
      toast.success('Отправка и трек-номер зафиксированы')
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
            <h1 className="text-xl font-bold text-blue-950 sm:text-2xl">Согласование аутсорсинга</h1>
            <p className="mt-1 text-sm text-slate-600">
              Согласуйте исполнителя, срок, стоимость и способ доставки. VRB следует той же очереди, но закрывается только складской приёмкой.
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
                        ? agreement.order_changed_at
                          ? 'bg-red-100 text-red-800 hover:bg-red-100'
                          : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
                        : agreement.supply_taken_at
                          ? 'bg-blue-100 text-blue-800 hover:bg-blue-100'
                          : 'bg-amber-100 text-amber-800 hover:bg-amber-100'}>
                        {agreement.order_changed_at
                          ? 'Заказ изменён'
                          : agreement.supply_terms_confirmed_at
                            ? agreement.delivery_dispatched_at ? 'Доставка' : 'Подтверждено'
                          : agreement.supply_taken_at
                            ? 'В работе'
                            : 'Ожидает снабжение'}
                      </Badge>
                      <span className="font-semibold text-blue-950">{agreement.machine_name}</span>
                      <span className="text-sm font-medium text-slate-700">{agreement.work_type_name}</span>
                      {agreement.parent_operation_id && (
                        <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-800">Дозаказ</Badge>
                      )}
                    </div>
                    <div className="mt-2 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
                      {agreement.operation_kind === 'vrb_mesh' ? (
                        <>
                          <span>Изготовитель: {agreement.supplier_name || 'компания не указана'}</span>
                          <span>Доставка на завод: <b>{formatDate(agreement.planned_return_date)}</b></span>
                          <span>Способ: <b>{agreement.delivery_method === 'own_transport' ? 'Наш транспорт' : agreement.delivery_method === 'carrier' ? 'Служба доставки' : 'не выбран'}</b></span>
                        </>
                      ) : (
                        <>
                          <span>Маршрут: {agreement.source_factory_name || 'завод не указан'} → {agreement.supplier_name || 'компания не указана'}</span>
                          <span>Желаемая отправка: <b>{formatDate(agreement.planned_send_date)}</b></span>
                        </>
                      )}
                      <span>Запрос создан: <b>{formatDate(agreement.created_at.slice(0, 10))}</b></span>
                    </div>
                    {agreement.order_changed_at && agreement.operation_kind === 'vrb_mesh' && (
                      <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-950" role="alert">
                        <div className="flex items-start gap-2 font-semibold">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          Состав подтверждённого заказа изменился
                        </div>
                        {agreement.change_diff.length > 0 && (
                          <ul className="mt-2 space-y-1 text-red-900">
                            {agreement.change_diff.map((item) => (
                              <li key={`${item.source_machine_item_id || item.drawing_number}-${item.product_name}`}>
                                {item.product_name}: было {item.requested_quantity}, сейчас {item.current_quantity}
                                {' '}({item.delta > 0 ? '+' : ''}{item.delta})
                                {item.details.length > 0 && (
                                  <span className="block text-xs text-red-800">{item.details.join(' · ')}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={isPending || Boolean(agreement.delivery_dispatched_at)}
                            onClick={() => resolveChange(agreement, 'accepted')}
                          >
                            Принять изменения
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() => resolveChange(agreement, 'kept_original')}
                          >
                            Оставить исходное
                          </Button>
                        </div>
                        {agreement.delivery_dispatched_at && (
                          <p className="mt-2 text-xs">После отправки увеличение оформляется отдельным дозаказом; уменьшение требует ручного решения.</p>
                        )}
                      </div>
                    )}
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
                  ) : agreement.operation_kind === 'vrb_mesh' ? (
                  <div className="grid w-full gap-3 sm:grid-cols-2 xl:max-w-4xl xl:grid-cols-4">
                    <Label className="grid gap-1.5 text-sm text-slate-700">
                      Изготовитель
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
                    <Label className="grid gap-1.5 text-sm text-slate-700" htmlFor={returnDateId}>
                      Доставка на завод
                      <Input
                        id={returnDateId}
                        type="date"
                        value={draft?.plannedReturnDate || ''}
                        onChange={(event) => updateDraft(agreement.operation_id, { plannedReturnDate: event.target.value })}
                      />
                    </Label>
                    <Label className="grid gap-1.5 text-sm text-slate-700" htmlFor={serviceCostId}>
                      Цена сетки
                      <Input
                        id={serviceCostId}
                        type="number"
                        min={0}
                        inputMode="decimal"
                        value={draft?.serviceCostPlanned || ''}
                        onChange={(event) => updateDraft(agreement.operation_id, { serviceCostPlanned: event.target.value })}
                      />
                    </Label>
                    <Label className="grid gap-1.5 text-sm text-slate-700">
                      Способ доставки
                      <Select
                        value={draft?.deliveryMethod || ''}
                        onValueChange={(value) => updateDraft(agreement.operation_id, {
                          deliveryMethod: value as AgreementDraft['deliveryMethod'],
                        })}
                      >
                        <SelectTrigger className="h-10 w-full">
                          <SelectValue>
                            {draft?.deliveryMethod === 'own_transport'
                              ? 'Наш транспорт'
                              : draft?.deliveryMethod === 'carrier'
                                ? 'Служба доставки'
                                : 'Выберите способ'}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="own_transport">Наш транспорт</SelectItem>
                          <SelectItem value="carrier">Служба доставки</SelectItem>
                        </SelectContent>
                      </Select>
                    </Label>
                    {draft?.deliveryMethod === 'carrier' && (
                      <>
                        <Label className="grid gap-1.5 text-sm text-slate-700">
                          Служба доставки
                          <Select
                            value={draft.deliveryCarrierSupplierId}
                            onValueChange={(value) => updateDraft(agreement.operation_id, { deliveryCarrierSupplierId: value || '' })}
                          >
                            <SelectTrigger className="h-10 w-full">
                              <SelectValue>
                                {carriers.find((carrier) => carrier.id === draft.deliveryCarrierSupplierId)?.name || 'Выберите компанию'}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {carriers.map((carrier) => (
                                <SelectItem key={carrier.id} value={carrier.id}>{carrier.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Label>
                        <Label className="grid gap-1.5 text-sm text-slate-700">
                          Цена доставки
                          <Input
                            type="number"
                            min={0}
                            inputMode="decimal"
                            value={draft.deliveryCostPlanned}
                            onChange={(event) => updateDraft(agreement.operation_id, { deliveryCostPlanned: event.target.value })}
                          />
                        </Label>
                      </>
                    )}
                    <Button
                      type="button"
                      disabled={isPending
                        || !draft?.supplierId
                        || !draft.plannedReturnDate
                        || draft.serviceCostPlanned === ''
                        || !draft.deliveryMethod
                        || (draft.deliveryMethod === 'carrier' && (
                          !draft.deliveryCarrierSupplierId || draft.deliveryCostPlanned === ''
                        ))}
                      onClick={() => confirmAgreement(agreement)}
                      className="min-h-11 gap-2 sm:self-end"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : agreement.supply_terms_confirmed_at
                        ? <CheckCircle2 className="h-4 w-4" />
                        : <Clock3 className="h-4 w-4" />}
                      {agreement.supply_terms_confirmed_at ? 'Сохранить' : 'Подтвердить'}
                    </Button>
                    {agreement.supply_terms_confirmed_at && draft?.deliveryMethod === 'carrier' && (
                      <div className="grid gap-1.5 sm:col-span-2 xl:col-span-3">
                        <Label htmlFor={`request-track-${agreement.operation_id}`} className="text-sm text-slate-700">Трек-номер после отправки</Label>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            id={`request-track-${agreement.operation_id}`}
                            value={draft.trackingNumber}
                            onChange={(event) => updateDraft(agreement.operation_id, { trackingNumber: event.target.value })}
                            placeholder="Введите трек-номер"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            disabled={isPending || !draft.trackingNumber.trim()}
                            onClick={() => dispatchCarrier(agreement)}
                            className="min-h-11 shrink-0 gap-2"
                          >
                            <Send className="h-4 w-4" />
                            Зафиксировать отправку
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
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
                      <Input type="date" value={draft?.plannedSendDate || ''} onChange={(event) => updateDraft(agreement.operation_id, { plannedSendDate: event.target.value })} />
                    </Label>
                    <Label className="grid gap-1.5 text-sm text-slate-700" htmlFor={returnDateId}>
                      Ожидаем возврат
                      <Input id={returnDateId} type="date" value={draft?.plannedReturnDate || ''} onChange={(event) => updateDraft(agreement.operation_id, { plannedReturnDate: event.target.value })} />
                    </Label>
                    <Label className="grid gap-1.5 text-sm text-slate-700" htmlFor={serviceCostId}>
                      Цена аутсорсинга
                      <Input id={serviceCostId} type="number" min={0} inputMode="decimal" value={draft?.serviceCostPlanned || ''} onChange={(event) => updateDraft(agreement.operation_id, { serviceCostPlanned: event.target.value })} />
                    </Label>
                    <Button
                      type="button"
                      disabled={isPending || !draft?.supplierId || !draft.plannedSendDate || !draft.plannedReturnDate || draft.serviceCostPlanned === ''}
                      onClick={() => confirmAgreement(agreement)}
                      className="min-h-11 gap-2 sm:self-end"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : agreement.supply_terms_confirmed_at ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
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
                    {detailsAgreement.operation_kind !== 'vrb_mesh' && (
                      <div>
                        <dt className="text-slate-500">Готовы отправить</dt>
                        <dd className="mt-1 font-semibold text-slate-900">{formatDate(detailsAgreement.planned_send_date)}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-slate-500">{detailsAgreement.operation_kind === 'vrb_mesh' ? 'Доставка на завод' : 'Ожидаем возврат'}</dt>
                      <dd className="mt-1 font-semibold text-slate-900">{formatDate(detailsAgreement.planned_return_date)}</dd>
                    </div>
                    {detailsAgreement.operation_kind === 'vrb_mesh' && (
                      <>
                        <div>
                          <dt className="text-slate-500">Способ доставки</dt>
                          <dd className="mt-1 font-semibold text-slate-900">
                            {detailsAgreement.delivery_method === 'own_transport'
                              ? 'Наш транспорт'
                              : detailsAgreement.delivery_method === 'carrier'
                                ? `Служба доставки${detailsAgreement.delivery_carrier_name ? ` · ${detailsAgreement.delivery_carrier_name}` : ''}`
                                : 'Не выбран'}
                          </dd>
                        </div>
                        {detailsAgreement.delivery_method === 'carrier' && (
                          <div>
                            <dt className="text-slate-500">Стоимость доставки</dt>
                            <dd className="mt-1 font-semibold text-slate-900">
                              {detailsAgreement.delivery_cost_planned == null
                                ? 'Не указана'
                                : detailsAgreement.delivery_cost_planned.toLocaleString('ru-RU')}
                            </dd>
                          </div>
                        )}
                        {detailsAgreement.delivery_tracking_number && (
                          <div>
                            <dt className="text-slate-500">Трек-номер</dt>
                            <dd className="mt-1 font-mono font-semibold text-slate-900">{detailsAgreement.delivery_tracking_number}</dd>
                          </div>
                        )}
                      </>
                    )}
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
                                {item.weight.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}
                                {' '}{detailsAgreement.operation_kind === 'vrb_mesh' ? 'кг' : 'т'}
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
