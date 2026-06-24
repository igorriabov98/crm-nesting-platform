'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
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
import { Badge } from '@/components/ui/badge'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
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

const STATUS_STYLES: Record<ConsumableRequestStatus, string> = {
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
  new: 'border-blue-200 bg-blue-50 text-blue-700',
  invoice_taken: 'border-violet-200 bg-violet-50 text-violet-700',
  delivery: 'border-amber-200 bg-amber-50 text-amber-800',
  received: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  received_partial: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  cancelled: 'border-red-200 bg-red-50 text-red-700',
}

const PRIORITY_LABELS: Record<ConsumablePriority, string> = {
  standard: 'Стандартная',
  high: 'Высокая',
}

function qty(value: number | string, unit?: string) {
  const text = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(Number(value || 0))
  return unit ? `${text} ${unit}` : text
}

function staleTracking(value: string | null) {
  if (!value) return true
  return Date.now() - new Date(value).getTime() > 15 * 60 * 1000
}

export function ConsumableRequestsPage({ mode, role, factories, selectedFactoryId, requests, stock }: Props) {
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
  const [details, setDetails] = useState<ConsumableRequest | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)

  const canSupply = ['supply_manager', 'procurement_head', 'financial_director', 'commercial_director', 'planning_director'].includes(role)
  const canProduction = ['production_manager', 'financial_director', 'commercial_director', 'planning_director'].includes(role)

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

  async function refreshTracking(requestId: string) {
    const supabase = createClient()
    const { error } = await supabase.functions.invoke('consumable-tracking', { body: { requestId } })
    if (error) return toast.error(error.message)
    toast.success('Статус доставки обновлен')
    setDetails(await getConsumableRequestDetails(requestId))
    refresh()
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[#E8ECF0] bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#1B3A6B]">
              {mode === 'supply' ? 'Заявки производства' : 'Заявки на расходники'}
            </h1>
            <p className="mt-1 text-sm text-[#6B7280]">
              {mode === 'supply'
                ? 'Обработка заявок Берегово и Ужгорода, доставка и контроль недопоставок.'
                : 'Создание заявок, контроль сроков и подтверждение фактического получения.'}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {factories.length > 1 && (
              <Select value={selectedFactoryId} onValueChange={switchFactory}>
                <SelectTrigger className="min-w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {mode === 'supply' && <SelectItem value="all">Все заводы</SelectItem>}
                  {factories.map((factory) => <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {mode === 'production' && (
              <Button onClick={openNewDraft} disabled={stock.length === 0}><Plus className="mr-2 h-4 w-4" />Новая заявка</Button>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Открытые" value={requests.filter((request) => ['new', 'invoice_taken', 'delivery'].includes(request.status)).length} icon={<Clock3 className="h-5 w-5" />} />
        <Metric label="В доставке" value={requests.filter((request) => request.status === 'delivery').length} icon={<Truck className="h-5 w-5" />} />
        <Metric label="Получено" value={requests.filter((request) => ['received', 'received_partial'].includes(request.status)).length} icon={<PackageCheck className="h-5 w-5" />} />
      </div>

      <Card className="bg-white">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по названию, артикулу или ТТН" className="sm:max-w-sm" />
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger className="sm:w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card className="bg-white"><CardContent className="py-16 text-center text-sm text-[#6B7280]">Заявок по выбранным фильтрам нет.</CardContent></Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {filtered.map((request) => {
            const remaining = Number(request.requested_quantity) - Number(request.received_quantity)
            const progress = Math.round((Number(request.received_quantity) / Number(request.requested_quantity)) * 100)
            return (
              <Card key={request.id} className="bg-white">
                <CardContent className="space-y-4 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <button type="button" onClick={() => openDetails(request.id)} className="text-left text-base font-semibold text-[#1B3A6B] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]">
                        {request.consumable?.name || 'Расходник'}
                      </button>
                      <div className="mt-1 text-xs text-[#6B7280]">
                        {request.factory?.name} · {request.consumable?.article} · {request.consumable?.category?.name}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className={STATUS_STYLES[request.status]}>{STATUS_LABELS[request.status]}</Badge>
                      <Badge className={request.priority === 'high' ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-700'}>{PRIORITY_LABELS[request.priority]}</Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <Info label="Запрошено" value={qty(request.requested_quantity, request.consumable?.unit)} />
                    <Info label="Получено" value={qty(request.received_quantity, request.consumable?.unit)} />
                    <Info label="Дата заявки" value={request.request_date ? new Date(`${request.request_date}T00:00:00`).toLocaleDateString('ru-RU') : 'Черновик'} />
                    <Info label="Нужно до" value={request.need_by_date ? new Date(`${request.need_by_date}T00:00:00`).toLocaleDateString('ru-RU') : '—'} />
                  </div>

                  {Number(request.received_quantity) > 0 && (
                    <div className="space-y-1"><div className="flex justify-between text-xs text-[#6B7280]"><span>Получение</span><span>{progress}% · осталось {qty(remaining, request.consumable?.unit)}</span></div><Progress value={progress} /></div>
                  )}

                  {request.status === 'delivery' && (
                    <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3 text-sm">
                      {request.delivery_method === 'nova_poshta' ? (
                        <><div className="font-medium text-amber-900">Новая почта · {request.nova_poshta_ttn}</div><div className="mt-1 text-amber-800">{request.tracking_status || 'Ожидается обновление статуса'}{request.tracking_estimated_delivery_date && ` · ориентировочно ${new Date(`${request.tracking_estimated_delivery_date}T00:00:00`).toLocaleDateString('ru-RU')}`}</div>{request.tracking_error && <div className="mt-1 text-red-700">{request.tracking_error}</div>}</>
                      ) : (
                        <><div className="font-medium text-amber-900">{request.carrier_name}</div><div className="mt-1 text-amber-800">Ожидается {request.carrier_eta ? new Date(`${request.carrier_eta}T00:00:00`).toLocaleDateString('ru-RU') : '—'}</div></>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 border-t border-[#E8ECF0] pt-3">
                    <Button variant="outline" size="sm" onClick={() => openDetails(request.id)} disabled={detailsLoading}><ExternalLink className="mr-1 h-4 w-4" />Подробнее</Button>
                    {mode === 'production' && request.status === 'draft' && (
                      <><Button variant="outline" size="sm" onClick={() => openEditDraft(request)}>Изменить</Button><Button size="sm" onClick={() => runAction(() => submitConsumableRequest(request.id, request.priority), 'Заявка отправлена')}><Send className="mr-1 h-4 w-4" />Отправить</Button></>
                    )}
                    {mode === 'production' && ['draft', 'new'].includes(request.status) && (
                      <Button variant="outline" size="sm" onClick={() => {
                        const reason = request.status === 'new' ? window.prompt('Причина отмены заявки') || '' : ''
                        if (request.status === 'new' && !reason) return
                        void runAction(() => cancelConsumableRequest(request.id, reason), 'Заявка отменена')
                      }}>Отменить</Button>
                    )}
                    {canSupply && request.status === 'new' && <Button size="sm" onClick={() => runAction(() => takeConsumableInvoice(request.id), 'Статус обновлен')}>Взять счёт</Button>}
                    {canSupply && request.status === 'invoice_taken' && <Button size="sm" onClick={() => { setDeliveryRequest(request); setDeliveryMethod('nova_poshta'); setTtn(''); setCarrierName(''); setCarrierEta('') }}><Truck className="mr-1 h-4 w-4" />Доставка</Button>}
                    {canProduction && request.status === 'delivery' && <Button size="sm" onClick={() => { setReceiptRequest(request); setReceiptQuantity(String(remaining)) }}><PackageOpen className="mr-1 h-4 w-4" />Получить</Button>}
                    {canProduction && request.status === 'delivery' && Number(request.received_quantity) > 0 && (
                      <Button variant="outline" size="sm" onClick={() => {
                        const reason = window.prompt('Почему оставшееся количество больше не требуется?') || ''
                        if (reason.trim().length < 3) return
                        void runAction(() => closeConsumableRequestRemainder(request.id, reason), 'Остаток заявки закрыт')
                      }}>Закрыть остаток</Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingDraft ? 'Изменить черновик' : 'Новая заявка'}</DialogTitle><DialogDescription>Дата и срок будут зафиксированы автоматически при отправке.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <Field label="Расходник *">
              <Select
                disabled={Boolean(editingDraft)}
                value={draftConsumableId}
                onValueChange={(value) => {
                  if (value) setDraftConsumableId(value)
                }}
              >
                <SelectTrigger><SelectValue placeholder="Выберите расходник" /></SelectTrigger>
                <SelectContent>{stock.map((item) => <SelectItem key={item.consumable_id} value={item.consumable_id}>{item.name} · остаток {qty(item.current_quantity, item.unit)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Количество *"><Input type="number" min="0.001" step="0.001" value={draftQuantity} onChange={(event) => setDraftQuantity(event.target.value)} /></Field>
            <Field label="Степень реакции *">
              <Select value={draftPriority} onValueChange={(value) => setDraftPriority(value as ConsumablePriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="standard">Стандартная · срок 7 дней</SelectItem><SelectItem value="high">Высокая · срок 4 дня</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="Комментарий"><Textarea value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} /></Field>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDraftOpen(false)}>Отмена</Button><Button onClick={saveDraft}>Сохранить черновик</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deliveryRequest)} onOpenChange={(open) => !open && setDeliveryRequest(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Начать доставку</DialogTitle><DialogDescription>{deliveryRequest?.consumable?.name}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <Field label="Способ доставки *"><Select value={deliveryMethod} onValueChange={(value) => setDeliveryMethod(value as typeof deliveryMethod)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="nova_poshta">Новая почта</SelectItem><SelectItem value="other">Другой перевозчик</SelectItem></SelectContent></Select></Field>
            {deliveryMethod === 'nova_poshta' ? <Field label="ТТН Новой почты *"><Input inputMode="numeric" maxLength={14} value={ttn} onChange={(event) => setTtn(event.target.value.replace(/\D/g, ''))} /></Field> : <><Field label="Перевозчик / способ *"><Input value={carrierName} onChange={(event) => setCarrierName(event.target.value)} /></Field><Field label="Ожидаемая дата *"><Input type="date" value={carrierEta} onChange={(event) => setCarrierEta(event.target.value)} /></Field></>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDeliveryRequest(null)}>Отмена</Button><Button onClick={saveDelivery}>Сохранить</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(receiptRequest)} onOpenChange={(open) => !open && setReceiptRequest(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Подтвердить получение</DialogTitle><DialogDescription>Остаток увеличится на фактически полученное количество.</DialogDescription></DialogHeader>
          <Field label={`Получено, ${receiptRequest?.consumable?.unit || ''} *`}><Input type="number" min="0.001" step="0.001" max={receiptRequest ? Number(receiptRequest.requested_quantity) - Number(receiptRequest.received_quantity) : undefined} value={receiptQuantity} onChange={(event) => setReceiptQuantity(event.target.value)} /></Field>
          <DialogFooter><Button variant="outline" onClick={() => setReceiptRequest(null)}>Отмена</Button><Button onClick={saveReceipt}>Подтвердить</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(details)} onOpenChange={(open) => !open && setDetails(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
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

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <Card className="bg-white"><CardContent className="flex items-center gap-3 p-4"><div className="rounded-lg bg-[#1B3A6B]/10 p-2 text-[#1B3A6B]">{icon}</div><div><div className="text-2xl font-semibold tabular-nums text-[#1B3A6B]">{value}</div><div className="text-xs text-[#6B7280]">{label}</div></div></CardContent></Card>
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-[#6B7280]">{label}</div><div className="mt-0.5 font-medium tabular-nums text-[#374151]">{value}</div></div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
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
        <DialogTitle>{request.consumable?.name}</DialogTitle>
        <DialogDescription>{request.factory?.name} · {request.consumable?.article} · {request.consumable?.characteristics}</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-[#E8ECF0] p-4 sm:grid-cols-4">
        <Info label="Статус" value={STATUS_LABELS[request.status]} />
        <Info label="Приоритет" value={PRIORITY_LABELS[request.priority]} />
        <Info label="Запрошено" value={qty(request.requested_quantity, request.consumable?.unit)} />
        <Info label="Получено" value={qty(request.received_quantity, request.consumable?.unit)} />
      </div>
      {request.status === 'delivery' && request.delivery_method === 'nova_poshta' && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start justify-between gap-3"><div><div className="font-medium text-amber-950">Новая почта · {request.nova_poshta_ttn}</div><div className="mt-1 text-sm text-amber-900">{request.tracking_status || 'Статус еще не получен'}</div></div><Button variant="outline" size="sm" onClick={() => onRefreshTracking(request.id)}><RefreshCcw className="mr-1 h-4 w-4" />Обновить</Button></div>
          {request.tracking_estimated_delivery_date && <div className="text-sm text-amber-900">Ориентировочная доставка: {new Date(`${request.tracking_estimated_delivery_date}T00:00:00`).toLocaleDateString('ru-RU')}</div>}
          {request.tracking_last_checked_at && <div className="text-xs text-amber-800">Проверено: {new Date(request.tracking_last_checked_at).toLocaleString('ru-RU')}</div>}
          {request.tracking_error && <div className="text-sm text-red-700">{request.tracking_error}</div>}
        </div>
      )}
      {request.status === 'delivery' && request.delivery_method === 'other' && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="font-medium text-amber-950">{request.carrier_name}</div>
          <div className="flex flex-col gap-2 sm:flex-row"><Input type="date" value={eta} onChange={(event) => setEta(event.target.value)} disabled={!canSupply} />{canSupply && <Button variant="outline" onClick={() => onUpdateEta(eta)}>Обновить дату</Button>}</div>
        </div>
      )}
      {request.receipts && request.receipts.length > 0 && (
        <div className="space-y-2"><h3 className="font-semibold text-[#1B3A6B]">Получения</h3>{request.receipts.map((receipt) => <div key={receipt.id} className="flex justify-between rounded-lg border border-[#E8ECF0] p-3 text-sm"><span>{new Date(receipt.received_at).toLocaleString('ru-RU')} · {receipt.receiver?.full_name || 'Пользователь'}</span><span className="font-medium">{qty(receipt.quantity, request.consumable?.unit)}</span></div>)}</div>
      )}
      {request.events && request.events.length > 0 && (
        <div className="space-y-2"><h3 className="font-semibold text-[#1B3A6B]">История заявки</h3>{request.events.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map((event) => <div key={event.id} className="rounded-lg border border-[#E8ECF0] p-3 text-sm"><div className="flex items-center justify-between gap-3"><span className="font-medium text-[#374151]">{event.event_type === 'submitted' ? 'Заявка отправлена' : event.event_type === 'status_changed' ? 'Статус изменен' : event.event_type === 'receipt' ? 'Получение' : event.event_type === 'remainder_closed' ? 'Остаток закрыт' : event.event_type === 'carrier_eta_changed' ? 'Дата доставки изменена' : 'Заявка отменена'}</span><span className="text-xs text-[#6B7280]">{new Date(event.created_at).toLocaleString('ru-RU')}</span></div>{event.author?.full_name && <div className="mt-1 text-xs text-[#6B7280]">{event.author.full_name}</div>}</div>)}</div>
      )}
      <DialogFooter showCloseButton />
    </>
  )
}
