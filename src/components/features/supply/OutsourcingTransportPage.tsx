'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, Save, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  createOutsourcingTransportOrder,
  confirmOutsourcingServiceTerms,
  updateOutsourcingTransportOrder,
  type OutsourcingTransportWorkspace,
  type SupplyOutsourcingAgreement,
  type TransportWorkspaceNeed,
  type TransportWorkspaceOrder,
} from '@/lib/actions/outsourcing'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'

const directionLabels = {
  outbound: 'Туда',
  return: 'Обратно',
} as const

const statusLabels = {
  needed: 'Нужен транспорт',
  found: 'Найден',
  in_transit: 'В пути',
  completed: 'Выполнено',
  cancelled: 'Отменено',
} as const

type AgreementDraft = {
  plannedReturnDate: string
  serviceCostPlanned: string
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}

function needTone(need: TransportWorkspaceNeed) {
  if (need.plan_state === 'preliminary') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-blue-200 bg-blue-50 text-blue-900'
}

export function OutsourcingTransportPage({ workspace }: { workspace: OutsourcingTransportWorkspace }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectedNeedIds, setSelectedNeedIds] = useState<string[]>([])
  const [carrierSupplierId, setCarrierSupplierId] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [price, setPrice] = useState('')
  const [comment, setComment] = useState('')
  const [agreementDrafts, setAgreementDrafts] = useState<Record<string, AgreementDraft>>(() => Object.fromEntries(
    workspace.agreements.map((agreement) => [agreement.operation_id, {
      plannedReturnDate: agreement.planned_return_date || '',
      serviceCostPlanned: agreement.service_cost_planned == null ? '' : String(agreement.service_cost_planned),
    }]),
  ))
  const [orderDrafts, setOrderDrafts] = useState<Record<string, { status: string; carrierSupplierId: string; scheduledDate: string; price: string; comment: string }>>(() => Object.fromEntries(
    workspace.orders.map((order) => [order.id, {
      status: order.status,
      carrierSupplierId: order.carrier_supplier_id || '',
      scheduledDate: order.scheduled_date || '',
      price: order.price == null ? '' : String(order.price),
      comment: order.comment || '',
    }]),
  ))

  const selectedNeeds = useMemo(
    () => workspace.needs.filter((need) => selectedNeedIds.includes(need.id)),
    [selectedNeedIds, workspace.needs],
  )
  const selectedDirection = selectedNeeds[0]?.direction || null
  const canCreateOrder = selectedNeeds.length > 0
    && selectedNeeds.every((need) => need.plan_state === 'confirmed')
    && selectedNeeds.every((need) => need.direction === selectedDirection)

  const preliminaryNeeds = workspace.needs.filter((need) => need.plan_state === 'preliminary')
  const confirmedNeeds = workspace.needs.filter((need) => need.plan_state === 'confirmed')

  function updateAgreementDraft(operationId: string, patch: Partial<AgreementDraft>) {
    setAgreementDrafts((current) => ({
      ...current,
      [operationId]: { ...current[operationId], ...patch },
    }))
  }

  function confirmAgreement(agreement: SupplyOutsourcingAgreement) {
    const draft = agreementDrafts[agreement.operation_id]
    if (!draft?.plannedReturnDate) return

    startTransition(async () => {
      const result = await confirmOutsourcingServiceTerms({
        operationId: agreement.operation_id,
        plannedReturnDate: draft.plannedReturnDate,
        serviceCostPlanned: draft.serviceCostPlanned ? Number(draft.serviceCostPlanned) : null,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось подтвердить условия аутсорсинга')
        return
      }
      toast.success(agreement.supply_terms_confirmed_at ? 'Условия аутсорсинга обновлены' : 'Дата и стоимость подтверждены')
      router.refresh()
    })
  }

  function toggleNeed(need: TransportWorkspaceNeed) {
    if (need.plan_state !== 'confirmed') return
    setSelectedNeedIds((current) => current.includes(need.id)
      ? current.filter((id) => id !== need.id)
      : [...current, need.id])
  }

  function createOrder() {
    startTransition(async () => {
      const result = await createOutsourcingTransportOrder({
        needIds: selectedNeedIds,
        carrierSupplierId: carrierSupplierId || null,
        scheduledDate: scheduledDate || null,
        price: price ? Number(price) : null,
        comment: comment || null,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось создать рейс')
        return
      }
      toast.success('Рейс создан')
      setSelectedNeedIds([])
      setCarrierSupplierId('')
      setScheduledDate('')
      setPrice('')
      setComment('')
      router.refresh()
    })
  }

  function updateOrderDraft(orderId: string, patch: Partial<{ status: string; carrierSupplierId: string; scheduledDate: string; price: string; comment: string }>) {
    setOrderDrafts((current) => ({
      ...current,
      [orderId]: { ...current[orderId], ...patch },
    }))
  }

  function saveOrder(order: TransportWorkspaceOrder) {
    const draft = orderDrafts[order.id]
    if (!draft) return
    startTransition(async () => {
      const result = await updateOutsourcingTransportOrder({
        orderId: order.id,
        status: draft.status as TransportWorkspaceOrder['status'],
        carrierSupplierId: draft.carrierSupplierId || null,
        scheduledDate: draft.scheduledDate || null,
        price: draft.price ? Number(draft.price) : null,
        comment: draft.comment || null,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить рейс')
        return
      }
      toast.success(draft.status === 'completed' ? 'Рейс выполнен, факты проставлены' : 'Рейс сохранён')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-900 text-white">
            <Truck className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-blue-950">Транспорт аутсорсинга</h1>
            <div className="text-sm text-slate-500">Потребности на отправку и возврат продукции.</div>
          </div>
        </div>
        <Button variant="outline" onClick={() => router.push(ROUTES.SUPPLY)}>К снабжению</Button>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3">
          <div className="font-semibold text-blue-950">Согласование услуг аутсорсинга</div>
          <div className="text-sm text-slate-500">
            Проверьте ожидаемую дату возврата, при необходимости скорректируйте её и укажите стоимость услуги.
          </div>
        </div>

        {workspace.agreements.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
            Нет внешних операций аутсорсинга для согласования.
          </div>
        ) : (
          <div className="grid gap-3">
            {workspace.agreements.map((agreement) => {
              const draft = agreementDrafts[agreement.operation_id]
              const returnDateId = `outsourcing-return-${agreement.operation_id}`
              const serviceCostId = `outsourcing-cost-${agreement.operation_id}`
              return (
                <div key={agreement.operation_id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={agreement.supply_terms_confirmed_at ? 'secondary' : 'outline'}>
                          {agreement.supply_terms_confirmed_at ? 'Подтверждено' : 'Ожидает подтверждения'}
                        </Badge>
                        <span className="font-semibold text-slate-900">{agreement.machine_name}</span>
                        <span className="text-slate-600">{agreement.work_type_name}</span>
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {agreement.source_factory_name || 'Завод не указан'} · {agreement.supplier_name || 'Компания не указана'}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        Готовы отправить: {formatDate(agreement.planned_send_date)}
                      </div>
                    </div>

                    <div className="grid w-full gap-2 sm:grid-cols-[minmax(180px,1fr)_minmax(160px,1fr)_auto] lg:max-w-2xl">
                      <Label className="grid gap-1.5 text-sm text-slate-700" htmlFor={returnDateId}>
                        Ожидаем возврат
                        <Input
                          id={returnDateId}
                          type="date"
                          value={draft?.plannedReturnDate || ''}
                          onChange={(event) => updateAgreementDraft(agreement.operation_id, { plannedReturnDate: event.target.value })}
                        />
                      </Label>
                      <Label className="grid gap-1.5 text-sm text-slate-700" htmlFor={serviceCostId}>
                        Стоимость услуги
                        <Input
                          id={serviceCostId}
                          type="number"
                          min={0}
                          value={draft?.serviceCostPlanned || ''}
                          onChange={(event) => updateAgreementDraft(agreement.operation_id, { serviceCostPlanned: event.target.value })}
                        />
                      </Label>
                      <Button
                        disabled={isPending || !draft?.plannedReturnDate}
                        onClick={() => confirmAgreement(agreement)}
                        className="min-h-10 gap-2 sm:self-end"
                      >
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        {agreement.supply_terms_confirmed_at ? 'Сохранить' : 'Подтвердить'}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {preliminaryNeeds.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-3 font-semibold text-amber-900">Предварительные потребности</div>
          <NeedsList needs={preliminaryNeeds} selectedNeedIds={selectedNeedIds} onToggle={toggleNeed} readOnly />
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-semibold text-blue-950">Утверждённые потребности</div>
            <div className="text-sm text-slate-500">Выберите несколько строк одного направления и создайте один рейс.</div>
          </div>
          <Badge variant="outline" className="w-fit">{selectedNeeds.length} выбрано</Badge>
        </div>
        <NeedsList needs={confirmedNeeds} selectedNeedIds={selectedNeedIds} onToggle={toggleNeed} />

        <div className="mt-4 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(180px,1fr)_150px_130px_minmax(180px,1fr)_auto]">
          <Select value={carrierSupplierId} onValueChange={(value) => setCarrierSupplierId(value || '')}>
            <SelectTrigger className="h-10 w-full bg-white"><SelectValue placeholder="Перевозчик" /></SelectTrigger>
            <SelectContent>
              {workspace.carriers.map((carrier) => <SelectItem key={carrier.id} value={carrier.id}>{carrier.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} className="bg-white" />
          <Input type="number" min={0} placeholder="Цена перевозки" value={price} onChange={(event) => setPrice(event.target.value)} className="bg-white" />
          <Input placeholder="Комментарий" value={comment} onChange={(event) => setComment(event.target.value)} className="bg-white" />
          <Button disabled={!canCreateOrder || isPending} onClick={createOrder} className="min-h-10 gap-2">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Создать рейс
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 font-semibold text-blue-950">Рейсы</div>
        {workspace.orders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
            Рейсы пока не созданы.
          </div>
        ) : (
          <div className="grid gap-3">
            {workspace.orders.map((order) => {
              const draft = orderDrafts[order.id]
              return (
                <div key={order.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>{directionLabels[order.direction]}</Badge>
                        <span className="font-semibold text-slate-900">{order.carrier_name || 'Перевозчик не назначен'}</span>
                        <span className="text-sm text-slate-500">{statusLabels[order.status]}</span>
                      </div>
                      <div className="mt-2 grid gap-1 text-sm text-slate-600">
                        {order.needs.map((need) => (
                          <div key={need.id}>
                            {need.machine_name} · {need.work_type_name} · {formatDate(need.needed_date)}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="grid w-full gap-2 lg:max-w-2xl lg:grid-cols-[130px_minmax(160px,1fr)_140px_100px_auto]">
                      <Select value={draft?.status || order.status} onValueChange={(value) => value && updateOrderDraft(order.id, { status: value })}>
                        <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(statusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={draft?.carrierSupplierId || ''} onValueChange={(value) => updateOrderDraft(order.id, { carrierSupplierId: value || '' })}>
                        <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Перевозчик" /></SelectTrigger>
                        <SelectContent>
                          {workspace.carriers.map((carrier) => <SelectItem key={carrier.id} value={carrier.id}>{carrier.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input type="date" value={draft?.scheduledDate || ''} onChange={(event) => updateOrderDraft(order.id, { scheduledDate: event.target.value })} />
                      <Input type="number" min={0} value={draft?.price || ''} onChange={(event) => updateOrderDraft(order.id, { price: event.target.value })} placeholder="Цена перевозки" />
                      <Button size="sm" disabled={isPending} onClick={() => saveOrder(order)} className="h-10 gap-2">
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Сохранить
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={draft?.comment || ''}
                    onChange={(event) => updateOrderDraft(order.id, { comment: event.target.value })}
                    placeholder="Комментарий к рейсу"
                    className="mt-3 min-h-16"
                  />
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function NeedsList({
  needs,
  selectedNeedIds,
  onToggle,
  readOnly = false,
}: {
  needs: TransportWorkspaceNeed[]
  selectedNeedIds: string[]
  onToggle: (need: TransportWorkspaceNeed) => void
  readOnly?: boolean
}) {
  if (needs.length === 0) {
    return <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">Нет потребностей.</div>
  }

  return (
    <div className="grid gap-2">
      {needs.map((need) => (
        <button
          key={need.id}
          type="button"
          disabled={readOnly}
          onClick={() => onToggle(need)}
          className={cn(
            'w-full rounded-lg border p-3 text-left transition-colors',
            needTone(need),
            !readOnly && selectedNeedIds.includes(need.id) && 'ring-2 ring-blue-700',
          )}
        >
          <div className="flex gap-3">
            {!readOnly && <Checkbox checked={selectedNeedIds.includes(need.id)} className="mt-1 bg-white" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="bg-white">{directionLabels[need.direction]}</Badge>
                <span className="font-semibold">{need.machine_name}</span>
                <span>{need.work_type_name}</span>
                <span className="text-sm opacity-80">{formatDate(need.needed_date)}</span>
              </div>
              <div className="mt-1 text-sm opacity-80">
                {need.source_factory_name || 'Завод не указан'} · {need.executor_label}
              </div>
              {need.item_labels.length > 0 && (
                <div className="mt-1 truncate text-sm opacity-80">{need.item_labels.join(', ')}</div>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}
