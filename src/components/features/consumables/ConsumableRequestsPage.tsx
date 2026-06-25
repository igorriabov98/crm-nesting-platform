'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Barcode,
  CalendarDays,
  Clock3,
  ExternalLink,
  PackageCheck,
  PackageOpen,
  Plus,
  RefreshCcw,
  Send,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  IndustrialMetricCard,
  IndustrialSearchPicker,
  IndustrialSelectText,
  IndustrialStatusBadge,
  industrial,
  type IndustrialPickerOption,
} from '@/components/features/consumables/IndustrialConsumablesUI'
import {
  cancelConsumableRequest,
  closeConsumableRequestRemainder,
  createConsumableRequestDraft,
  getConsumableRequestDetails,
  receiveConsumableRequest,
  startConsumableDelivery,
  submitConsumableRequest,
  takeConsumableInvoice,
  updateConsumableRequestDraft,
  updateOtherDeliveryEta,
} from '@/lib/actions/consumables'
import { createClient } from '@/lib/supabase/client'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'
import type {
  ConsumablePriority,
  ConsumableRequest,
  ConsumableRequestStatus,
  ConsumableStockRow,
  FactorySummary,
  UserRole,
} from '@/lib/types'

type Props = {
  mode: 'production' | 'supply'
  role: UserRole
  isCrmAdmin?: boolean
  factories: FactorySummary[]
  selectedFactoryId: string
  requests: ConsumableRequest[]
  stock: ConsumableStockRow[]
}

const STATUS_LABELS: Record<ConsumableRequestStatus, string> = {
  draft: 'Черновик',
  new: 'Новая',
  invoice_taken: 'Взят счёт',
  delivery: 'Доставка',
  received: 'Получено',
  received_partial: 'Получено частично',
  cancelled: 'Отменено',
}

const PRIORITY_LABELS: Record<ConsumablePriority, string> = {
  standard: 'Стандартная',
  high: 'Высокая',
}

const PRIORITY_FULL_LABELS: Record<ConsumablePriority, string> = {
  standard: 'Стандартная · срок 7 дней',
  high: 'Высокая · срок 4 дня',
}

const PRIORITY_DEADLINE_DAYS: Record<ConsumablePriority, number> = {
  standard: 7,
  high: 4,
}

const DELIVERY_LABELS: Record<'nova_poshta' | 'other', string> = {
  nova_poshta: 'Новая почта',
  other: 'Другой перевозчик',
}

const STATUS_TONES: Record<ConsumableRequestStatus, 'default' | 'warning' | 'success' | 'critical' | 'info' | 'premium'> = {
  draft: 'default',
  new: 'info',
  invoice_taken: 'premium',
  delivery: 'warning',
  received: 'success',
  received_partial: 'success',
  cancelled: 'critical',
}

const HISTORY_STATUSES: ConsumableRequestStatus[] = ['received', 'received_partial', 'cancelled']

function isHistoryRequest(status: ConsumableRequestStatus) {
  return HISTORY_STATUSES.includes(status)
}

function qty(value: number | string, unit?: string) {
  const text = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(Number(value || 0))
  return unit ? `${text} ${unit}` : text
}

function getKyivDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value || '1970'
  const month = parts.find((part) => part.type === 'month')?.value || '01'
  const day = parts.find((part) => part.type === 'day')?.value || '01'
  return `${year}-${month}-${day}`
}

function addCalendarDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

function formatDateString(dateString: string) {
  const [year, month, day] = dateString.split('-')
  return `${day}.${month}.${year}`
}

function staleTracking(value: string | null) {
  if (!value) return true
  return Date.now() - new Date(value).getTime() > 15 * 60 * 1000
}

export function ConsumableRequestsPage({ mode, role, isCrmAdmin = false, factories, selectedFactoryId, requests, stock }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [statusFilter, setStatusFilter] = useState<'all' | ConsumableRequestStatus>('all')
  const [search, setSearch] = useState('')
  const [draftOpen, setDraftOpen] = useState(false)
  const [editingDraft, setEditingDraft] = useState<ConsumableRequest | null>(null)
  const [draftConsumableId, setDraftConsumableId] = useState(stock[0]?.consumable_id || '')
  const [draftQuantity, setDraftQuantity] = useState('')
  const [draftPriority, setDraftPriority] = useState<ConsumablePriority>('standard')
  const [draftNotes, setDraftNotes] = useState('')
  const [deliveryRequest, setDeliveryRequest] = useState<ConsumableRequest | null>(null)
  const [deliveryMethod, setDeliveryMethod] = useState<'nova_poshta' | 'other'>('nova_poshta')
  const [ttn, setTtn] = useState('')
  const [carrierName, setCarrierName] = useState('')
  const [carrierEta, setCarrierEta] = useState('')
  const [receiptRequest, setReceiptRequest] = useState<ConsumableRequest | null>(null)
  const [receiptQuantity, setReceiptQuantity] = useState('')
  const [cancelRequest, setCancelRequest] = useState<ConsumableRequest | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [remainderRequest, setRemainderRequest] = useState<ConsumableRequest | null>(null)
  const [remainderReason, setRemainderReason] = useState('')
  const [details, setDetails] = useState<ConsumableRequest | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)

  const canSupply = isCrmAdmin || ['supply_manager', 'procurement_head', 'financial_director', 'commercial_director', 'planning_director'].includes(role)
  const canProduction = isCrmAdmin || ['production_manager', 'financial_director', 'commercial_director', 'planning_director'].includes(role)

  const factoryOptions = useMemo<IndustrialPickerOption[]>(() => [
    ...(mode === 'supply' ? [{ value: 'all', label: 'Все заводы', description: 'Берегово и Ужгород' }] : []),
    ...factories.map((factory) => ({ value: factory.id, label: factory.name, description: 'Завод' })),
  ], [factories, mode])

  const stockOptions = useMemo<IndustrialPickerOption[]>(() => stock.map((item) => ({
    value: item.consumable_id,
    label: item.name || 'Расходник не найден',
    description: `${item.article} · ${item.category_name}`,
    badge: `остаток ${qty(item.current_quantity, item.unit)}`,
    search: `${item.name} ${item.article} ${item.characteristics} ${item.category_name}`,
  })), [stock])

  const selectedFactoryLabel = factoryOptions.find((option) => option.value === selectedFactoryId)?.label
    || (selectedFactoryId === 'all' ? 'Все заводы' : 'Завод не найден')
  const selectedStatusLabel = statusFilter === 'all' ? 'Все статусы' : STATUS_LABELS[statusFilter]
  const selectedPriorityLabel = PRIORITY_FULL_LABELS[draftPriority]
  const selectedDeliveryLabel = DELIVERY_LABELS[deliveryMethod]
  const draftRequestDatePreview = getKyivDateString()
  const draftNeedByDatePreview = addCalendarDays(draftRequestDatePreview, PRIORITY_DEADLINE_DAYS[draftPriority])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return requests.filter((request) => {
      if (statusFilter !== 'all' && request.status !== statusFilter) return false
      if (!term) return true
      return [
        request.consumable?.name,
        request.consumable?.article,
        request.factory?.name,
        request.nova_poshta_ttn,
      ].some((value) => value?.toLowerCase().includes(term))
    })
  }, [requests, search, statusFilter])
  const activeRequests = filtered.filter((request) => !isHistoryRequest(request.status))
  const historyRequests = filtered.filter((request) => isHistoryRequest(request.status))
  const requestSections = [
    {
      key: 'active',
      title: 'Активные',
      description: 'Черновики, новые заявки, взятые счета и доставка.',
      empty: 'Активных заявок по выбранным фильтрам нет.',
      items: activeRequests,
    },
    {
      key: 'history',
      title: 'История',
      description: 'Полученные, частично полученные и отменённые заявки.',
      empty: 'Истории по выбранным фильтрам нет.',
      items: historyRequests,
    },
  ]

  useEffect(() => {
    const requestId = searchParams.get('request')
    if (requestId && details?.id !== requestId && !detailsLoading) {
      void openDetails(requestId)
    }
  }, [details?.id, detailsLoading, searchParams])

  function refresh() {
    startTransition(() => router.refresh())
  }

  function switchFactory(value: string | null) {
    if (!value) return
    const route = mode === 'supply' ? ROUTES.SUPPLY_CONSUMABLE_REQUESTS : ROUTES.PRODUCTION_CONSUMABLE_REQUESTS
    startTransition(() => router.push(`${route}?factory=${value}`))
  }

  function openNewDraft() {
    setEditingDraft(null)
    setDraftConsumableId(stock[0]?.consumable_id || '')
    setDraftQuantity('')
    setDraftPriority('standard')
    setDraftNotes('')
    setDraftOpen(true)
  }

  function openEditDraft(request: ConsumableRequest) {
    setEditingDraft(request)
    setDraftConsumableId(request.consumable_id)
    setDraftQuantity(String(request.requested_quantity))
    setDraftPriority(request.priority)
    setDraftNotes(request.notes || '')
    setDraftOpen(true)
  }

  async function saveDraft() {
    const result = editingDraft
      ? await updateConsumableRequestDraft(editingDraft.id, {
          quantity: Number(draftQuantity),
          priority: draftPriority,
          notes: draftNotes,
        })
      : await createConsumableRequestDraft({
          consumableId: draftConsumableId,
          quantity: Number(draftQuantity),
          priority: draftPriority,
          notes: draftNotes,
        })
    if (!result.success) return toast.error(result.error)
    toast.success(editingDraft ? 'Черновик обновлен' : 'Черновик создан')
    setDraftOpen(false)
    refresh()
  }

  async function runAction(action: () => Promise<{ success: boolean; error: string | null }>, success: string) {
    const result = await action()
    if (!result.success) return toast.error(result.error)
    toast.success(success)
    setDetails(null)
    refresh()
  }

  async function openDetails(requestId: string) {
    setDetailsLoading(true)
    try {
      const loaded = await getConsumableRequestDetails(requestId)
      setDetails(loaded)
      if (loaded.status === 'delivery' && loaded.delivery_method === 'nova_poshta' && staleTracking(loaded.tracking_last_checked_at)) {
        const supabase = createClient()
        await supabase.functions.invoke('consumable-tracking', { body: { requestId } })
        setDetails(await getConsumableRequestDetails(requestId))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось загрузить заявку')
    } finally {
      setDetailsLoading(false)
    }
  }

  async function saveDelivery() {
    if (!deliveryRequest) return
    const result = await startConsumableDelivery({
      requestId: deliveryRequest.id,
      method: deliveryMethod,
      ttn,
      carrierName,
      carrierEta,
    })
    if (!result.success) return toast.error(result.error)
    toast.success('Доставка начата')
    setDeliveryRequest(null)
    refresh()
  }

  async function saveReceipt() {
    if (!receiptRequest) return
    const result = await receiveConsumableRequest(receiptRequest.id, Number(receiptQuantity))
    if (!result.success) return toast.error(result.error)
    toast.success('Получение сохранено')
    setReceiptRequest(null)
    refresh()
  }

  async function saveCancel() {
    if (!cancelRequest) return
    const reason = cancelRequest.status === 'new' ? cancelReason.trim() : ''
    if (cancelRequest.status === 'new' && reason.length < 3) {
      toast.error('Укажите причину отмены')
      return
    }
    await runAction(() => cancelConsumableRequest(cancelRequest.id, reason), 'Заявка отменена')
    setCancelRequest(null)
    setCancelReason('')
  }

  async function saveCloseRemainder() {
    if (!remainderRequest) return
    const reason = remainderReason.trim()
    if (reason.length < 3) {
      toast.error('Укажите причину закрытия остатка')
      return
    }
    await runAction(() => closeConsumableRequestRemainder(remainderRequest.id, reason), 'Остаток заявки закрыт')
    setRemainderRequest(null)
    setRemainderReason('')
  }

  async function refreshTracking(requestId: string) {
    const supabase = createClient()
    const { error } = await supabase.functions.invoke('consumable-tracking', { body: { requestId } })
    if (error) return toast.error(error.message)
    toast.success('Статус доставки обновлен')
    setDetails(await getConsumableRequestDetails(requestId))
    refresh()
  }

  return (
    <div className={industrial.shell}>
      <section className={industrial.hero}>
        <div className={industrial.heroGlow} />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className={industrial.eyebrow}>{mode === 'supply' ? 'Supply operations' : 'Production needs'}</div>
            <h1 className={industrial.title}>
              {mode === 'supply' ? 'Заявки производства' : 'Заявки на расходники'}
            </h1>
            <p className={industrial.description}>
              {mode === 'supply'
                ? 'Обработка заявок Берегово и Ужгорода, доставка и контроль недопоставок.'
                : 'Создание заявок, контроль сроков и подтверждение фактического получения.'}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {factories.length > 1 && (
              <Select value={selectedFactoryId} onValueChange={switchFactory}>
                <SelectTrigger className={industrial.selectTrigger}>
                  <IndustrialSelectText>{selectedFactoryLabel}</IndustrialSelectText>
                </SelectTrigger>
                <SelectContent>
                  {mode === 'supply' && <SelectItem value="all">Все заводы</SelectItem>}
                  {factories.map((factory) => <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {mode === 'production' && (
              <Button className={industrial.primary} onClick={openNewDraft} disabled={stock.length === 0}><Plus className="mr-2 h-4 w-4" />Новая заявка</Button>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <IndustrialMetricCard label="Активные" value={requests.filter((request) => !isHistoryRequest(request.status)).length} icon={<Clock3 className="h-5 w-5" />} />
        <IndustrialMetricCard label="В доставке" value={requests.filter((request) => request.status === 'delivery').length} icon={<Truck className="h-5 w-5" />} tone="warning" />
        <IndustrialMetricCard label="История" value={requests.filter((request) => isHistoryRequest(request.status)).length} icon={<PackageCheck className="h-5 w-5" />} tone="success" />
      </div>

      <Card className={industrial.panel}>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по названию, артикулу или ТТН" className={cn('sm:max-w-sm', industrial.input)} />
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger className={cn('sm:w-52', industrial.selectTrigger)}>
              <IndustrialSelectText>{selectedStatusLabel}</IndustrialSelectText>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card className={industrial.panel}><CardContent className="py-16 text-center text-sm text-slate-500">Заявок по выбранным фильтрам нет.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {requestSections.map((section) => (
            <Card key={section.key} className={cn('overflow-hidden', industrial.panel)}>
              <CardContent className="p-0">
                <div className="flex flex-col gap-2 border-b border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">{section.title}</h2>
                    <p className="mt-1 text-sm text-slate-500">{section.description}</p>
                  </div>
                  <span className={cn('inline-flex w-fit items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-semibold text-[#1B3A6B]', industrial.mono)}>
                    {section.items.length}
                  </span>
                </div>
                {section.items.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-slate-500">{section.empty}</div>
                ) : (
                  <>
                    <div className="hidden grid-cols-[minmax(220px,1.3fr)_minmax(180px,0.8fr)_minmax(220px,1fr)_minmax(180px,auto)] gap-4 border-b border-slate-200 bg-slate-50/90 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 lg:grid">
                      <div>Расходник</div>
                      <div>Количество</div>
                      <div>Сроки / доставка</div>
                      <div className="text-right">Действия</div>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {section.items.map((request) => {
                        const remaining = Number(request.requested_quantity) - Number(request.received_quantity)
                        const progress = Math.round((Number(request.received_quantity) / Number(request.requested_quantity)) * 100)
                        return (
                          <div key={request.id} className="p-4 transition-colors hover:bg-slate-50/80">
                            <div className="grid gap-4 lg:grid-cols-[minmax(220px,1.3fr)_minmax(180px,0.8fr)_minmax(220px,1fr)_minmax(180px,auto)] lg:items-start">
                              <div className="min-w-0">
                                <button type="button" onClick={() => openDetails(request.id)} className="text-left text-base font-semibold text-slate-950 transition hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/30">
                                  {request.consumable?.name || 'Расходник не найден'}
                                </button>
                                <div className="mt-1 text-xs text-slate-500">
                                  {request.factory?.name || 'Завод не найден'} · <span className={industrial.mono}>{request.consumable?.article || 'без артикула'}</span> · {request.consumable?.category?.name || 'Категория не найдена'}
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <IndustrialStatusBadge tone={STATUS_TONES[request.status]}>{STATUS_LABELS[request.status]}</IndustrialStatusBadge>
                                  <IndustrialStatusBadge tone={request.priority === 'high' ? 'critical' : 'default'}>{PRIORITY_LABELS[request.priority]}</IndustrialStatusBadge>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-3 text-sm sm:max-w-sm lg:grid-cols-1 lg:gap-2">
                                <Info label="Запрошено" value={qty(request.requested_quantity, request.consumable?.unit)} />
                                <Info label="Получено" value={qty(request.received_quantity, request.consumable?.unit)} />
                                {Number(request.received_quantity) > 0 && (
                                  <div className="col-span-2 space-y-1 lg:col-span-1">
                                    <div className="flex justify-between text-xs text-slate-500">
                                      <span>Получение</span>
                                      <span className={industrial.mono}>{progress}% · осталось {qty(remaining, request.consumable?.unit)}</span>
                                    </div>
                                    <Progress value={progress} />
                                  </div>
                                )}
                              </div>

                              <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                  <Info label="Дата заявки" value={request.request_date ? new Date(`${request.request_date}T00:00:00`).toLocaleDateString('ru-RU') : 'Черновик'} />
                                  <Info label="Нужно до" value={request.need_by_date ? new Date(`${request.need_by_date}T00:00:00`).toLocaleDateString('ru-RU') : '—'} />
                                </div>

                                {request.status === 'delivery' && <DeliveryPreview request={request} />}
                              </div>

                              <div className="flex flex-wrap gap-2 lg:justify-end">
                                <Button className={industrial.action} variant="outline" size="sm" onClick={() => openDetails(request.id)} disabled={detailsLoading}><ExternalLink className="mr-1 h-4 w-4" />Подробнее</Button>
                                {mode === 'production' && request.status === 'draft' && (
                                  <><Button className={industrial.action} variant="outline" size="sm" onClick={() => openEditDraft(request)}>Изменить</Button><Button className={industrial.primary} size="sm" onClick={() => runAction(() => submitConsumableRequest(request.id, request.priority), 'Заявка отправлена')}><Send className="mr-1 h-4 w-4" />Отправить</Button></>
                                )}
                                {mode === 'production' && ['draft', 'new'].includes(request.status) && (
                                  <Button className={industrial.danger} variant="outline" size="sm" onClick={() => {
                                    setCancelRequest(request)
                                    setCancelReason('')
                                  }}>Отменить</Button>
                                )}
                                {canSupply && request.status === 'new' && <Button className={industrial.primary} size="sm" onClick={() => runAction(() => takeConsumableInvoice(request.id), 'Статус обновлен')}>Взять счёт</Button>}
                                {canSupply && request.status === 'invoice_taken' && <Button className={industrial.primary} size="sm" onClick={() => { setDeliveryRequest(request); setDeliveryMethod('nova_poshta'); setTtn(''); setCarrierName(''); setCarrierEta('') }}><Truck className="mr-1 h-4 w-4" />Доставка</Button>}
                                {canProduction && request.status === 'delivery' && <Button className={industrial.primary} size="sm" onClick={() => { setReceiptRequest(request); setReceiptQuantity(String(remaining)) }}><PackageOpen className="mr-1 h-4 w-4" />Получить</Button>}
                                {canProduction && request.status === 'delivery' && Number(request.received_quantity) > 0 && (
                                  <Button className={industrial.action} variant="outline" size="sm" onClick={() => {
                                    setRemainderRequest(request)
                                    setRemainderReason('')
                                  }}>Закрыть остаток</Button>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
        <DialogContent className="border-slate-200 bg-white sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingDraft ? 'Изменить черновик' : 'Новая заявка'}</DialogTitle><DialogDescription>Дата и срок будут зафиксированы автоматически при отправке.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <Field label="Расходник *">
              <IndustrialSearchPicker
                disabled={Boolean(editingDraft)}
                value={draftConsumableId}
                options={stockOptions}
                placeholder="Выберите расходник"
                searchPlaceholder="Поиск по названию, артикулу или категории"
                emptyText="Расходник не найден"
                onValueChange={setDraftConsumableId}
              />
            </Field>
            <Field label="Количество *"><Input className={cn(industrial.input, industrial.mono)} type="number" min="0.001" step="0.001" value={draftQuantity} onChange={(event) => setDraftQuantity(event.target.value)} /></Field>
            <Field label="Степень реакции *">
              <Select value={draftPriority} onValueChange={(value) => setDraftPriority(value as ConsumablePriority)}>
                <SelectTrigger className={industrial.selectTrigger}>
                  <IndustrialSelectText>{selectedPriorityLabel}</IndustrialSelectText>
                </SelectTrigger>
                <SelectContent><SelectItem value="standard">Стандартная · срок 7 дней</SelectItem><SelectItem value="high">Высокая · срок 4 дня</SelectItem></SelectContent>
              </Select>
            </Field>
            <div className="rounded-2xl border border-blue-200 bg-blue-50/80 p-3 text-sm text-blue-900">
              <div className="font-semibold text-blue-950">Если оформить заявку сейчас</div>
              <div className="mt-1">
                Дата заявки: <span className={industrial.mono}>{formatDateString(draftRequestDatePreview)}</span> · привезти до:{' '}
                <span className={industrial.mono}>{formatDateString(draftNeedByDatePreview)}</span>
              </div>
              <div className="mt-1 text-xs text-blue-700">
                Срок пересчитывается автоматически по выбранной степени реакции.
              </div>
            </div>
            <Field label="Комментарий"><Textarea className="border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:border-[#1B3A6B] focus-visible:ring-[#1B3A6B]/10" value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} /></Field>
          </div>
          <DialogFooter><Button className={industrial.action} variant="outline" onClick={() => setDraftOpen(false)}>Отмена</Button><Button className={industrial.primary} onClick={saveDraft}>Сохранить черновик</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deliveryRequest)} onOpenChange={(open) => !open && setDeliveryRequest(null)}>
        <DialogContent className="border-slate-200 bg-white sm:max-w-lg">
          <DialogHeader><DialogTitle>Начать доставку</DialogTitle><DialogDescription>{deliveryRequest?.consumable?.name}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <Field label="Способ доставки *"><Select value={deliveryMethod} onValueChange={(value) => setDeliveryMethod(value as typeof deliveryMethod)}><SelectTrigger className={industrial.selectTrigger}><IndustrialSelectText>{selectedDeliveryLabel}</IndustrialSelectText></SelectTrigger><SelectContent><SelectItem value="nova_poshta">Новая почта</SelectItem><SelectItem value="other">Другой перевозчик</SelectItem></SelectContent></Select></Field>
            {deliveryMethod === 'nova_poshta' ? <Field label="ТТН Новой почты *"><Input className={cn(industrial.input, industrial.mono)} inputMode="numeric" maxLength={14} value={ttn} onChange={(event) => setTtn(event.target.value.replace(/\D/g, ''))} /></Field> : <><Field label="Перевозчик / способ *"><Input className={industrial.input} value={carrierName} onChange={(event) => setCarrierName(event.target.value)} /></Field><Field label="Ожидаемая дата *"><Input className={industrial.input} type="date" value={carrierEta} onChange={(event) => setCarrierEta(event.target.value)} /></Field></>}
          </div>
          <DialogFooter><Button className={industrial.action} variant="outline" onClick={() => setDeliveryRequest(null)}>Отмена</Button><Button className={industrial.primary} onClick={saveDelivery}>Сохранить</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(receiptRequest)} onOpenChange={(open) => !open && setReceiptRequest(null)}>
        <DialogContent className="border-slate-200 bg-white sm:max-w-lg">
          <DialogHeader><DialogTitle>Подтвердить получение</DialogTitle><DialogDescription>Остаток увеличится на фактически полученное количество.</DialogDescription></DialogHeader>
          <Field label={`Получено, ${receiptRequest?.consumable?.unit || ''} *`}><Input className={cn(industrial.input, industrial.mono)} type="number" min="0.001" step="0.001" max={receiptRequest ? Number(receiptRequest.requested_quantity) - Number(receiptRequest.received_quantity) : undefined} value={receiptQuantity} onChange={(event) => setReceiptQuantity(event.target.value)} /></Field>
          <DialogFooter><Button className={industrial.action} variant="outline" onClick={() => setReceiptRequest(null)}>Отмена</Button><Button className={industrial.primary} onClick={saveReceipt}>Подтвердить</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cancelRequest)} onOpenChange={(open) => {
        if (!open) {
          setCancelRequest(null)
          setCancelReason('')
        }
      }}>
        <DialogContent className="border-slate-200 bg-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Отменить заявку</DialogTitle>
            <DialogDescription>
              {cancelRequest?.status === 'new'
                ? 'Для отправленной заявки укажите причину отмены.'
                : 'Черновик будет отменен без влияния на остатки.'}
            </DialogDescription>
          </DialogHeader>
          {cancelRequest?.status === 'new' && (
            <Field label="Причина отмены *">
              <Textarea className="border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:border-[#1B3A6B] focus-visible:ring-[#1B3A6B]/10" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Например: расходник больше не требуется" />
            </Field>
          )}
          <DialogFooter>
            <Button className={industrial.action} variant="outline" onClick={() => setCancelRequest(null)}>Назад</Button>
            <Button className={industrial.danger} variant="outline" onClick={saveCancel} disabled={cancelRequest?.status === 'new' && cancelReason.trim().length < 3}>Отменить заявку</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(remainderRequest)} onOpenChange={(open) => {
        if (!open) {
          setRemainderRequest(null)
          setRemainderReason('')
        }
      }}>
        <DialogContent className="border-slate-200 bg-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Закрыть недопоставленный остаток</DialogTitle>
            <DialogDescription>Заявка будет отображаться как полученная частично. Причина обязательна.</DialogDescription>
          </DialogHeader>
          <Field label="Причина закрытия остатка *">
            <Textarea className="border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:border-[#1B3A6B] focus-visible:ring-[#1B3A6B]/10" value={remainderReason} onChange={(event) => setRemainderReason(event.target.value)} placeholder="Например: остаток заменён другой поставкой" />
          </Field>
          <DialogFooter>
            <Button className={industrial.action} variant="outline" onClick={() => setRemainderRequest(null)}>Назад</Button>
            <Button className={industrial.primary} onClick={saveCloseRemainder} disabled={remainderReason.trim().length < 3}>Закрыть остаток</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(details)} onOpenChange={(open) => !open && setDetails(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-slate-200 bg-white sm:max-w-2xl">
          {details && <RequestDetails request={details} canSupply={canSupply} onRefreshTracking={async (requestId) => {
            await refreshTracking(requestId)
          }} onUpdateEta={async (date) => {
            const result = await updateOtherDeliveryEta(details.id, date)
            if (!result.success) {
              toast.error(result.error)
              return
            }
            toast.success('Ожидаемая дата обновлена')
            setDetails(await getConsumableRequestDetails(details.id))
            refresh()
          }} />}
        </DialogContent>
      </Dialog>

      {isPending && <span className="sr-only" aria-live="polite">Обновление данных</span>}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</div><div className={cn('mt-1 font-medium tabular-nums text-slate-900', industrial.mono)}>{value}</div></div>
}

function deliveryDateLabel(value: string | null | undefined) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU') : 'Дата уточняется'
}

function DeliveryPreview({ request }: { request: ConsumableRequest }) {
  const isNovaPoshta = request.delivery_method === 'nova_poshta'
  const carrierLabel = isNovaPoshta ? 'Новая почта' : request.carrier_name || 'Перевозчик'
  const trackingStatus = isNovaPoshta
    ? request.tracking_status || 'Ожидается обновление статуса'
    : request.carrier_eta
      ? `Ожидается ${deliveryDateLabel(request.carrier_eta)}`
      : 'Дата доставки уточняется'
  const deliveryDate = isNovaPoshta ? request.tracking_estimated_delivery_date : request.carrier_eta

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs shadow-none">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-[#1B3A6B]">
          <Truck className="h-4 w-4 shrink-0" />
          <span className="truncate">{carrierLabel}</span>
        </span>
        {isNovaPoshta && request.nova_poshta_ttn && (
          <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-blue-200 bg-white px-2 py-0.5 font-semibold text-blue-800 shadow-sm', industrial.mono)}>
            <Barcode className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{request.nova_poshta_ttn}</span>
          </span>
        )}
        <span className={cn('inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2 py-0.5 font-semibold text-[#1B3A6B] shadow-sm', industrial.mono)}>
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-nowrap">Ориентир: {deliveryDateLabel(deliveryDate)}</span>
        </span>
      </div>
      <div className={cn('mt-1.5 line-clamp-2 break-words text-[13px] leading-5 [overflow-wrap:anywhere]', request.tracking_error ? 'text-red-700' : 'text-slate-600')}>
        <span className="font-medium text-slate-700">Статус: </span>
        {request.tracking_error || trackingStatus}
      </div>
    </div>
  )
}

function NovaPoshtaDetails({
  request,
  onRefreshTracking,
}: {
  request: ConsumableRequest
  onRefreshTracking: (requestId: string) => Promise<void>
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-inner">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#1B3A6B] text-white shadow-sm">
            <Truck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-blue-950">Новая почта</div>
            <div className={cn('mt-1 inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs text-blue-800', industrial.mono)}>
              <Barcode className="h-3.5 w-3.5" />
              {request.nova_poshta_ttn || 'ТТН не указан'}
            </div>
          </div>
        </div>
        <Button className={industrial.action} variant="outline" size="sm" onClick={() => onRefreshTracking(request.id)}>
          <RefreshCcw className="mr-1 h-4 w-4" />Обновить
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="rounded-xl border border-blue-100 bg-white/80 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Статус Новой почты</div>
          <div className={cn('mt-1 text-sm leading-5', request.tracking_error ? 'text-red-700' : 'text-blue-950')}>
            {request.tracking_error || request.tracking_status || 'Статус еще не получен'}
          </div>
          {request.tracking_last_checked_at && (
            <div className="mt-2 text-xs text-slate-500">Проверено: {new Date(request.tracking_last_checked_at).toLocaleString('ru-RU')}</div>
          )}
        </div>
        <div className="rounded-xl border border-blue-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Ориентир доставки</div>
          <div className={cn('mt-2 flex items-center gap-2 text-lg font-semibold text-[#1B3A6B]', industrial.mono)}>
            <CalendarDays className="h-5 w-5" />
            {deliveryDateLabel(request.tracking_estimated_delivery_date)}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label className={industrial.label}>{label}</Label>{children}</div>
}

function RequestDetails({
  request,
  canSupply,
  onRefreshTracking,
  onUpdateEta,
}: {
  request: ConsumableRequest
  canSupply: boolean
  onRefreshTracking: (requestId: string) => Promise<void>
  onUpdateEta: (date: string) => Promise<void>
}) {
  const [eta, setEta] = useState(request.carrier_eta || '')
  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-slate-950">{request.consumable?.name || 'Расходник не найден'}</DialogTitle>
        <DialogDescription>{request.factory?.name || 'Завод не найден'} · {request.consumable?.article || 'без артикула'} · {request.consumable?.characteristics || 'характеристика не указана'}</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:grid-cols-4">
        <Info label="Статус" value={STATUS_LABELS[request.status]} />
        <Info label="Приоритет" value={PRIORITY_LABELS[request.priority]} />
        <Info label="Запрошено" value={qty(request.requested_quantity, request.consumable?.unit)} />
        <Info label="Получено" value={qty(request.received_quantity, request.consumable?.unit)} />
      </div>
      {request.status === 'delivery' && request.delivery_method === 'nova_poshta' && (
        <NovaPoshtaDetails request={request} onRefreshTracking={onRefreshTracking} />
      )}
      {request.status === 'delivery' && request.delivery_method === 'other' && (
        <div className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-inner">
          <div className="font-semibold text-blue-950">{request.carrier_name}</div>
          <div className="flex flex-col gap-2 sm:flex-row"><Input className={industrial.input} type="date" value={eta} onChange={(event) => setEta(event.target.value)} disabled={!canSupply} />{canSupply && <Button className={industrial.action} variant="outline" onClick={() => onUpdateEta(eta)}>Обновить дату</Button>}</div>
        </div>
      )}
      {request.receipts && request.receipts.length > 0 && (
        <div className="space-y-2"><h3 className="font-semibold text-slate-950">Получения</h3>{request.receipts.map((receipt) => <div key={receipt.id} className="flex justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm"><span className="text-slate-600">{new Date(receipt.received_at).toLocaleString('ru-RU')} · {receipt.receiver?.full_name || 'Пользователь'}</span><span className={cn('font-semibold text-slate-950', industrial.mono)}>{qty(receipt.quantity, request.consumable?.unit)}</span></div>)}</div>
      )}
      {request.events && request.events.length > 0 && (
        <div className="space-y-2"><h3 className="font-semibold text-slate-950">История заявки</h3>{request.events.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map((event) => <div key={event.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm"><div className="flex items-center justify-between gap-3"><span className="font-medium text-slate-800">{event.event_type === 'submitted' ? 'Заявка отправлена' : event.event_type === 'status_changed' ? 'Статус изменен' : event.event_type === 'receipt' ? 'Получение' : event.event_type === 'remainder_closed' ? 'Остаток закрыт' : event.event_type === 'carrier_eta_changed' ? 'Дата доставки изменена' : 'Заявка отменена'}</span><span className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString('ru-RU')}</span></div>{event.author?.full_name && <div className="mt-1 text-xs text-slate-500">{event.author.full_name}</div>}</div>)}</div>
      )}
      <DialogFooter showCloseButton />
    </>
  )
}
