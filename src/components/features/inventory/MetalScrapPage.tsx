'use client'

import { type FormEvent, useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  ArrowDownToLine,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Factory,
  FileText,
  History,
  Info,
  Loader2,
  PackageOpen,
  Recycle,
  RefreshCw,
  Scale,
  ShieldAlert,
  UserRound,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cancelMetalScrapSale, reviewMetalScrapLot, sellMetalScrap } from '@/lib/actions/future-inventory'
import { ROUTES } from '@/lib/constants/routes'
import {
  formatMetalScrapMaterialName,
  formatFactoryDateInput,
  isMetalScrapSaleWeightValid,
  metalScrapReviewNeedsReason,
  type MetalScrapStatus,
  normalizeMetalScrapStatus,
} from '@/lib/metal-scrap'
import { cn } from '@/lib/utils'

type FactoryOption = {
  id: string
  name: string
}

type MetalScrapLot = {
  id: string
  source_type: string
  source_inventory_id: string | null
  request_id: string | null
  machine_id: string | null
  factory_id: string
  created_by: string | null
  material_name: string
  material_grade: string | null
  expected_weight_kg: number | string
  available_weight_kg: number | string
  blocked_weight_kg: number | string
  sold_weight_kg: number | string
  status: MetalScrapStatus
  promoted_stage_end: string | null
  machines: { name: string } | null
  can_review: boolean
}

type MetalScrapSale = {
  id: string
  sale_date: string
  total_weight_kg: number | string
  amount_uah: number | string
  average_price_per_kg: number | string
  buyer: string | null
  document_number: string | null
  comment: string | null
  status: 'completed' | 'cancelled'
  cancellation_reason: string | null
}

type MetalScrapPageData = {
  factories: FactoryOption[]
  selectedFactory: string
  status: MetalScrapStatus
  canManageScrap: boolean
  canManageSales: boolean
  statusPages: Record<MetalScrapStatus, {
    lots: MetalScrapLot[]
    total: number
    page: number
  }>
  pageSize: number
  sales: MetalScrapSale[]
  aggregates: {
    future: number
    available: number
    blocked: number
    sold: number
  }
}

const weightFormatter = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const statusTabs: Array<{ value: MetalScrapStatus; label: string; helper: string }> = [
  { value: 'future', label: 'Ожидается', helper: 'Будущие партии' },
  { value: 'available', label: 'Доступно', helper: 'Можно сдавать' },
  { value: 'review_required', label: 'Проверить', helper: 'Вес заблокирован' },
]

function formatWeight(value: number | string) {
  return `${weightFormatter.format(Number(value) || 0)} кг`
}

function formatMoney(value: number | string) {
  return `${moneyFormatter.format(Number(value) || 0)} UAH`
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}.${month}.${year}` : value
}

function lotSource(lot: MetalScrapLot) {
  if (lot.source_type === 'inventory_conversion') {
    return 'Источник: складской деловой остаток'
  }
  return lot.machines?.name
    ? `Источник: заявка технолога по машине «${lot.machines.name}»`
    : 'Источник: заявка технолога (машина не указана)'
}

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  hint: string
  icon: typeof Clock3
  tone: 'blue' | 'green' | 'amber' | 'slate'
}) {
  const styles = {
    blue: 'border-blue-200/80 bg-blue-50/70 text-blue-800',
    green: 'border-emerald-200/80 bg-emerald-50/70 text-emerald-800',
    amber: 'border-amber-200/80 bg-amber-50/70 text-amber-800',
    slate: 'border-slate-200 bg-white text-slate-800',
  }[tone]

  return (
    <Card className={cn('gap-3 border py-4 shadow-sm ring-0', styles)}>
      <CardContent className="flex items-start justify-between gap-3 px-4">
        <div className="min-w-0">
          <p className="text-sm font-medium opacity-80">{label}</p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums sm:text-2xl">{formatWeight(value)}</p>
          <p className="mt-1 text-xs opacity-70">{hint}</p>
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/70 shadow-sm" aria-hidden="true">
          <Icon className="size-5" />
        </span>
      </CardContent>
    </Card>
  )
}

function EmptyState({ status }: { status: MetalScrapStatus }) {
  const copy = {
    future: {
      title: 'Ожидаемых партий нет',
      description: 'Будущие партии появятся после расчёта отходов по заявкам.',
      icon: Clock3,
    },
    available: {
      title: 'Нет металлолома для сдачи',
      description: 'Все доступные партии уже сданы или ожидают перепроверки.',
      icon: CheckCircle2,
    },
    review_required: {
      title: 'Перепроверка не требуется',
      description: 'Сейчас нет партий с заблокированным весом.',
      icon: RefreshCw,
    },
  }[status]
  const Icon = copy.icon

  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-10 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200" aria-hidden="true">
        <Icon className="size-6" />
      </span>
      <p className="font-semibold text-slate-900">{copy.title}</p>
      <p className="mt-1 max-w-md text-sm leading-6 text-slate-600">{copy.description}</p>
    </div>
  )
}

export function MetalScrapPage({ data }: { data: MetalScrapPageData }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [weights, setWeights] = useState<Record<string, string>>({})
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({})
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => formatFactoryDateInput())
  const [buyer, setBuyer] = useState('')
  const [document, setDocument] = useState('')
  const [comment, setComment] = useState('')
  const [cancellationSale, setCancellationSale] = useState<MetalScrapSale | null>(null)
  const [cancellationReason, setCancellationReason] = useState('')
  const activeStatus = normalizeMetalScrapStatus(searchParams.get('status'), data.status)
  const activePage = data.statusPages[activeStatus]
  const lots = activePage.lots
  const total = activePage.total
  const page = activePage.page

  const invalidSaleWeightIds = useMemo(() => new Set(
    lots
      .filter((lot) => !isMetalScrapSaleWeightValid(weights[lot.id] || '', Number(lot.available_weight_kg)))
      .map((lot) => lot.id),
  ), [lots, weights])

  const selected = useMemo(() => lots
    .map((lot) => ({ lotId: lot.id, weightKg: Number(weights[lot.id] || 0) }))
    .filter((item) => Number.isFinite(item.weightKg) && item.weightKg > 0), [lots, weights])

  const totalWeight = selected.reduce((sum, item) => sum + item.weightKg, 0)
  const amountValue = Number(amount)
  const saleReady = selected.length > 0
    && invalidSaleWeightIds.size === 0
    && date !== ''
    && amount !== ''
    && Number.isFinite(amountValue)
    && amountValue >= 0
  const averagePrice = totalWeight > 0 && Number.isFinite(amountValue) ? amountValue / totalWeight : 0
  const activeFactory = data.factories.find((factory) => factory.id === data.selectedFactory)
  const totalPages = Math.max(1, Math.ceil(total / data.pageSize))
  const rangeStart = total === 0 ? 0 : page * data.pageSize + 1
  const rangeEnd = Math.min(total, (page + 1) * data.pageSize)

  function href(factory = data.selectedFactory, status = activeStatus, nextPage = 0) {
    const params = new URLSearchParams({ factory, status })
    if (nextPage > 0) params.set('page', String(nextPage))
    return `${ROUTES.INVENTORY_METAL_SCRAP}?${params.toString()}`
  }

  function navigate(factory: string, status: MetalScrapStatus, page = 0) {
    startTransition(() => router.push(href(factory, status, page)))
  }

  function selectStatus(status: MetalScrapStatus) {
    if (status === activeStatus) return
    setWeights({})
    setReviewReasons({})
    setAmount('')
    setDate(formatFactoryDateInput())
    setBuyer('')
    setDocument('')
    setComment('')
    window.history.pushState(null, '', href(data.selectedFactory, status))
  }

  function setLotWeight(lotId: string, value: string) {
    setWeights((current) => ({ ...current, [lotId]: value }))
  }

  function selectAllAvailable() {
    setWeights(Object.fromEntries(lots
      .filter((lot) => Number(lot.available_weight_kg) > 0)
      .map((lot) => [lot.id, Number(lot.available_weight_kg).toFixed(3)])))
  }

  function submitSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!saleReady) {
      toast.error('Проверьте выбранный вес, дату и общую сумму')
      return
    }

    startTransition(async () => {
      const result = await sellMetalScrap({
        factoryId: data.selectedFactory,
        saleDate: date,
        amountUah: amountValue,
        buyer,
        document,
        comment,
        items: selected,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Сдача проведена, финансовый приход создан')
      setWeights({})
      setAmount('')
      setBuyer('')
      setDocument('')
      setComment('')
      router.refresh()
    })
  }

  function submitReview(event: FormEvent<HTMLFormElement>, lot: MetalScrapLot) {
    event.preventDefault()
    if (!lot.can_review) return

    const actualWeight = Number(weights[lot.id] ?? lot.expected_weight_kg)
    const expectedWeight = Number(lot.expected_weight_kg)
    const soldWeight = Number(lot.sold_weight_kg)
    const needsReason = metalScrapReviewNeedsReason(actualWeight, expectedWeight)
    const reason = reviewReasons[lot.id]?.trim() || ''

    if (!Number.isFinite(actualWeight) || actualWeight < soldWeight) {
      toast.error('Фактический вес не может быть меньше уже сданного')
      return
    }
    if (needsReason && reason === '') {
      toast.error('Укажите причину изменения веса')
      return
    }

    startTransition(async () => {
      const result = await reviewMetalScrapLot(lot.id, actualWeight, reason)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Остаток перепроверен и разблокирован')
      router.refresh()
    })
  }

  function submitCancellation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!cancellationSale || cancellationReason.trim() === '') return

    startTransition(async () => {
      const result = await cancelMetalScrapSale(cancellationSale.id, cancellationReason.trim())
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Сдача отменена, вес возвращён')
      setCancellationSale(null)
      setCancellationReason('')
      router.refresh()
    })
  }

  return (
    <div className="space-y-6 pb-8">
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 px-5 py-6 text-white shadow-lg shadow-slate-900/10 sm:px-6 lg:px-8">
        <div className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full bg-blue-500/20 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20" aria-hidden="true">
                <Recycle className="size-6" />
              </span>
              <Badge className="border-white/20 bg-white/10 text-white">Складской учёт</Badge>
            </div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Металлолом</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
              Контролируйте ожидаемый и фактический вес партий, оформляйте сдачу и отслеживайте финансовый результат.
            </p>
          </div>

          <div className="w-full rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm lg:w-72">
            <Label htmlFor="metal-scrap-factory" className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-300">
              <Factory className="size-4" aria-hidden="true" />
              Завод
            </Label>
            <Select value={data.selectedFactory} onValueChange={(value) => value && navigate(value, activeStatus)}>
              <SelectTrigger id="metal-scrap-factory" className="min-h-11 w-full border-white/20 bg-white text-slate-950" aria-label="Выберите завод металлолома">
                <SelectValue>{activeFactory?.name || 'Выберите завод'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {data.factories.map((factory) => (
                  <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section aria-labelledby="scrap-summary-title">
        <h2 id="scrap-summary-title" className="sr-only">Сводка по весу металлолома</h2>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricCard label="Ожидается" value={data.aggregates.future} hint="Будет доступно после этапа" icon={Clock3} tone="blue" />
          <MetricCard label="К сдаче" value={data.aggregates.available} hint="Доступный фактический вес" icon={Scale} tone="green" />
          <MetricCard label="На проверке" value={data.aggregates.blocked} hint="Временно заблокированный вес" icon={ShieldAlert} tone="amber" />
          <MetricCard label="Сдано" value={data.aggregates.sold} hint="Накопительный итог" icon={CheckCircle2} tone="slate" />
        </div>
      </section>

      <section aria-labelledby="scrap-workspace-title" className="space-y-4">
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 id="scrap-workspace-title" className="font-heading text-lg font-semibold text-slate-950">Работа с партиями</h2>
            <p className="text-sm text-slate-600">Выберите состояние, чтобы увидеть соответствующие партии.</p>
          </div>
          <Tabs value={activeStatus} onValueChange={(value) => selectStatus(value as MetalScrapStatus)} className="w-full lg:w-auto">
            <TabsList className="grid h-auto w-full grid-cols-3 bg-slate-100 p-1 lg:w-[480px]">
              {statusTabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="min-h-11 flex-col gap-0 px-2 text-xs sm:text-sm">
                  <span>{tab.label}</span>
                  <span className="hidden text-[11px] font-normal text-slate-500 sm:block">{tab.helper}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className={cn('grid items-start gap-5', activeStatus === 'available' && data.canManageSales && 'xl:grid-cols-[minmax(0,1fr)_390px]')}>
          <Card className="border border-slate-200 py-0 shadow-sm ring-0">
            <CardHeader className="border-b border-slate-200 px-5 py-5 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-lg text-slate-950">
                    {activeStatus === 'future' && 'Ожидаемые партии'}
                    {activeStatus === 'available' && 'Партии для сдачи'}
                    {activeStatus === 'review_required' && 'Партии на перепроверке'}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {activeStatus === 'future' && 'Расчётный вес до завершения производственного этапа.'}
                    {activeStatus === 'available' && 'Укажите вес сдачи для одной или нескольких партий.'}
                    {activeStatus === 'review_required' && 'Подтвердите фактический вес или укажите причину корректировки.'}
                  </CardDescription>
                </div>
                <Badge variant="outline" className="h-7 border-slate-200 bg-slate-50 px-3 text-slate-700">
                  {total} {total === 1 ? 'партия' : 'партий'}
                </Badge>
              </div>
              {activeStatus === 'available' && data.canManageSales && lots.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="min-h-11" onClick={selectAllAvailable} disabled={pending}>
                    <ArrowDownToLine className="size-4" aria-hidden="true" />
                    Весь доступный вес
                  </Button>
                  {selected.length > 0 && (
                    <Button type="button" variant="ghost" className="min-h-11 text-slate-600" onClick={() => setWeights({})} disabled={pending}>
                      Очистить выбор
                    </Button>
                  )}
                </div>
              )}
            </CardHeader>

            <CardContent className="space-y-3 px-4 py-4 sm:px-6 sm:py-5">
              {lots.map((lot) => {
                const availableWeight = Number(lot.available_weight_kg)
                const soldWeight = Number(lot.sold_weight_kg)
                const expectedWeight = Number(lot.expected_weight_kg)
                const reviewWeight = Number(weights[lot.id] ?? lot.expected_weight_kg)
                const reviewNeedsReason = metalScrapReviewNeedsReason(reviewWeight, expectedWeight)
                const reviewInvalid = !Number.isFinite(reviewWeight) || reviewWeight < soldWeight
                const reviewReasonMissing = reviewNeedsReason && !reviewReasons[lot.id]?.trim()
                const weightErrorId = `weight-${lot.id}-error`

                return (
                  <article key={lot.id} className="rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm motion-reduce:transition-none sm:p-5">
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                              {lot.source_type === 'inventory_conversion' ? 'Со склада' : 'Из производства'}
                            </Badge>
                            {lot.material_grade && <Badge variant="secondary">{lot.material_grade}</Badge>}
                          </div>
                          <h3 className="text-base font-semibold text-slate-950">{formatMetalScrapMaterialName(lot.material_name)}</h3>
                          <p className="mt-1 text-sm leading-6 text-slate-600">{lotSource(lot)}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-5">
                          <div>
                            <p className="text-xs text-slate-500">Ожидаемый</p>
                            <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-800">{formatWeight(lot.expected_weight_kg)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Уже сдано</p>
                            <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-800">{formatWeight(lot.sold_weight_kg)}</p>
                          </div>
                        </div>
                      </div>

                      {activeStatus === 'future' && (
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-blue-50 px-3 py-3 text-sm text-blue-900">
                          <span className="flex items-center gap-2"><Clock3 className="size-4" aria-hidden="true" />Ожидается: <strong className="font-mono tabular-nums">{formatWeight(lot.expected_weight_kg)}</strong></span>
                          {lot.promoted_stage_end && <span>Плановая дата: {formatDate(lot.promoted_stage_end)}</span>}
                        </div>
                      )}

                      {activeStatus === 'available' && (
                        <div className="grid gap-4 rounded-xl bg-emerald-50/70 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,280px)] sm:items-end sm:p-4">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-emerald-800">Доступно к сдаче</p>
                            <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-950">{formatWeight(availableWeight)}</p>
                          </div>
                          {data.canManageSales ? (
                            <div>
                              <Label htmlFor={`weight-${lot.id}`} className="text-slate-800">Сдать из этой партии, кг</Label>
                              <div className="mt-1.5 flex gap-2">
                                <Input
                                  id={`weight-${lot.id}`}
                                  className="h-11 bg-white font-mono tabular-nums"
                                  type="number"
                                  inputMode="decimal"
                                  min="0.001"
                                  max={availableWeight}
                                  step="0.001"
                                  value={weights[lot.id] || ''}
                                  onChange={(event) => setLotWeight(lot.id, event.target.value)}
                                  aria-invalid={invalidSaleWeightIds.has(lot.id)}
                                  aria-describedby={invalidSaleWeightIds.has(lot.id) ? weightErrorId : undefined}
                                />
                                <Button type="button" variant="outline" className="min-h-11 bg-white px-3" onClick={() => setLotWeight(lot.id, availableWeight.toFixed(3))} disabled={pending}>
                                  Весь
                                </Button>
                              </div>
                              {invalidSaleWeightIds.has(lot.id) && (
                                <p id={weightErrorId} className="mt-1.5 text-xs text-destructive" role="alert">
                                  Введите вес от 0,001 до {weightFormatter.format(availableWeight)} кг.
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-emerald-900">Только просмотр: нет права оформлять сдачу.</p>
                          )}
                        </div>
                      )}

                      {activeStatus === 'review_required' && (
                        lot.can_review ? (
                          <form className="grid gap-4 rounded-xl bg-amber-50/80 p-3 sm:grid-cols-2 sm:p-4" onSubmit={(event) => submitReview(event, lot)}>
                            <div>
                              <Label htmlFor={`review-weight-${lot.id}`}>Фактический вес, кг</Label>
                              <Input
                                id={`review-weight-${lot.id}`}
                                className="mt-1.5 h-11 bg-white font-mono tabular-nums"
                                type="number"
                                inputMode="decimal"
                                min={soldWeight}
                                step="0.001"
                                value={weights[lot.id] ?? String(lot.expected_weight_kg)}
                                onChange={(event) => setLotWeight(lot.id, event.target.value)}
                                aria-invalid={reviewInvalid}
                              />
                              <p className="mt-1.5 text-xs text-amber-900">Заблокировано: {formatWeight(lot.blocked_weight_kg)}</p>
                              {reviewInvalid && <p className="mt-1 text-xs text-destructive" role="alert">Вес не может быть меньше уже сданного.</p>}
                            </div>
                            <div>
                              <Label htmlFor={`review-reason-${lot.id}`}>Причина изменения{reviewNeedsReason ? ' *' : ''}</Label>
                              <Input
                                id={`review-reason-${lot.id}`}
                                className="mt-1.5 h-11 bg-white"
                                value={reviewReasons[lot.id] || ''}
                                onChange={(event) => setReviewReasons((current) => ({ ...current, [lot.id]: event.target.value }))}
                                placeholder={reviewNeedsReason ? 'Обязательно укажите причину' : 'Не требуется без изменения веса'}
                                aria-invalid={reviewReasonMissing}
                              />
                            </div>
                            <div className="sm:col-span-2 sm:flex sm:justify-end">
                              <Button type="submit" className="min-h-11 w-full bg-amber-700 text-white hover:bg-amber-800 sm:w-auto" disabled={pending || reviewInvalid || reviewReasonMissing}>
                                {pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
                                Подтвердить вес
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                            <p>Партия доступна только для просмотра. Перепроверку выполняет ответственный сотрудник, создавший запись.</p>
                          </div>
                        )
                      )}
                    </div>
                  </article>
                )
              })}

              {lots.length === 0 && <EmptyState status={activeStatus} />}
            </CardContent>

            {totalPages > 1 && (
              <CardFooter className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:justify-between sm:px-6">
                <p className="text-sm text-slate-600">Показано {rangeStart}–{rangeEnd} из {total}</p>
                <div className="flex w-full gap-2 sm:w-auto">
                  <Button type="button" variant="outline" className="min-h-11 flex-1 bg-white sm:flex-none" disabled={pending || page === 0} onClick={() => navigate(data.selectedFactory, activeStatus, page - 1)}>
                    <ChevronLeft className="size-4" aria-hidden="true" />
                    Назад
                  </Button>
                  <Button type="button" variant="outline" className="min-h-11 flex-1 bg-white sm:flex-none" disabled={pending || page >= totalPages - 1} onClick={() => navigate(data.selectedFactory, activeStatus, page + 1)}>
                    Далее
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </CardFooter>
            )}
          </Card>

          {activeStatus === 'available' && data.canManageSales && (
            <Card className="border border-slate-200 py-0 shadow-sm ring-0 xl:sticky xl:top-6">
              <CardHeader className="border-b border-slate-200 px-5 py-5">
                <CardTitle className="flex items-center gap-2 text-lg text-slate-950">
                  <Banknote className="size-5 text-emerald-700" aria-hidden="true" />
                  Оформление сдачи
                </CardTitle>
                <CardDescription>Заполните данные по выбранному весу.</CardDescription>
              </CardHeader>
              <CardContent className="px-5 py-5">
                <div className="mb-5 grid grid-cols-2 gap-3 rounded-xl bg-slate-950 p-4 text-white" aria-live="polite">
                  <div>
                    <p className="text-xs text-slate-400">Выбрано партий</p>
                    <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{selected.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Общий вес</p>
                    <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{formatWeight(totalWeight)}</p>
                  </div>
                </div>

                <form className="space-y-4" onSubmit={submitSale}>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                    <div>
                      <Label htmlFor="scrap-sale-date">Дата сдачи *</Label>
                      <Input id="scrap-sale-date" className="mt-1.5 h-11" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
                    </div>
                    <div>
                      <Label htmlFor="scrap-sale-amount">Общая сумма, UAH *</Label>
                      <Input
                        id="scrap-sale-amount"
                        className="mt-1.5 h-11 font-mono tabular-nums"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        aria-invalid={amount !== '' && (!Number.isFinite(amountValue) || amountValue < 0)}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="scrap-sale-buyer">Покупатель</Label>
                    <div className="relative mt-1.5">
                      <UserRound className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" aria-hidden="true" />
                      <Input id="scrap-sale-buyer" className="h-11 pl-9" value={buyer} onChange={(event) => setBuyer(event.target.value)} placeholder="Компания или ФИО" />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="scrap-sale-document">Документ</Label>
                    <div className="relative mt-1.5">
                      <FileText className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" aria-hidden="true" />
                      <Input id="scrap-sale-document" className="h-11 pl-9" value={document} onChange={(event) => setDocument(event.target.value)} placeholder="Номер акта или накладной" />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="scrap-sale-comment">Комментарий</Label>
                    <Textarea id="scrap-sale-comment" className="mt-1.5 min-h-24 resize-y" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Дополнительная информация" />
                  </div>

                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
                    <p className="flex items-start gap-2"><Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />После проведения будет создан финансовый приход на выбранную дату.</p>
                  </div>

                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-600">Средняя цена</span>
                    <strong className="font-mono tabular-nums text-slate-950">{moneyFormatter.format(averagePrice)} UAH/кг</strong>
                  </div>

                  <Button type="submit" className="min-h-12 w-full bg-emerald-700 text-base text-white hover:bg-emerald-800" disabled={pending || !saleReady}>
                    {pending ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Recycle className="size-5" aria-hidden="true" />}
                    {pending ? 'Проводим сдачу…' : `Сдать ${formatWeight(totalWeight)}`}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      <section aria-labelledby="scrap-history-title">
        <Card className="border border-slate-200 py-0 shadow-sm ring-0">
          <CardHeader className="border-b border-slate-200 px-5 py-5 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle id="scrap-history-title" className="flex items-center gap-2 text-lg text-slate-950">
                  <History className="size-5 text-slate-600" aria-hidden="true" />
                  Последние сдачи
                </CardTitle>
                <CardDescription className="mt-1">Последние 25 операций выбранного завода.</CardDescription>
              </div>
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">{data.sales.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 px-4 py-4 sm:px-6 sm:py-5">
            {data.sales.map((sale) => (
              <article key={sale.id} className="rounded-xl border border-slate-200 p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="flex items-center gap-2 font-semibold text-slate-950">
                        <CalendarDays className="size-4 text-slate-500" aria-hidden="true" />
                        {formatDate(sale.sale_date)}
                      </p>
                      {sale.status === 'cancelled' ? (
                        <Badge variant="destructive"><XCircle className="size-3" aria-hidden="true" />Отменена</Badge>
                      ) : (
                        <Badge className="bg-emerald-100 text-emerald-800"><CheckCircle2 className="size-3" aria-hidden="true" />Проведена</Badge>
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                      <div>
                        <p className="text-xs text-slate-500">Вес</p>
                        <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900">{formatWeight(sale.total_weight_kg)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Сумма</p>
                        <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900">{formatMoney(sale.amount_uah)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Цена за кг</p>
                        <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900">{moneyFormatter.format(Number(sale.average_price_per_kg))} UAH</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Покупатель</p>
                        <p className="mt-1 truncate text-sm font-medium text-slate-900" title={sale.buyer || undefined}>{sale.buyer || 'Не указан'}</p>
                      </div>
                    </div>

                    {(sale.document_number || sale.comment || sale.cancellation_reason) && (
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
                        {sale.document_number && <span>Документ: <strong className="font-medium text-slate-800">{sale.document_number}</strong></span>}
                        {sale.comment && <span>Комментарий: <strong className="font-medium text-slate-800">{sale.comment}</strong></span>}
                        {sale.cancellation_reason && <span className="text-destructive">Причина отмены: {sale.cancellation_reason}</span>}
                      </div>
                    )}
                  </div>

                  {sale.status === 'completed' && data.canManageSales && (
                    <Button type="button" variant="destructive" className="min-h-11 w-full lg:w-auto" disabled={pending} onClick={() => setCancellationSale(sale)}>
                      <XCircle className="size-4" aria-hidden="true" />
                      Отменить сдачу
                    </Button>
                  )}
                </div>
              </article>
            ))}

            {data.sales.length === 0 && (
              <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-5 py-8 text-center">
                <PackageOpen className="size-8 text-slate-400" aria-hidden="true" />
                <p className="mt-3 font-semibold text-slate-900">Сдач пока нет</p>
                <p className="mt-1 text-sm text-slate-600">Проведённые операции появятся в этом разделе.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Dialog open={Boolean(cancellationSale)} onOpenChange={(open) => {
        if (!open && !pending) {
          setCancellationSale(null)
          setCancellationReason('')
        }
      }}>
        <DialogContent className="border-slate-200 bg-white text-slate-950 sm:max-w-lg">
          <DialogHeader>
            <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-red-50 text-destructive" aria-hidden="true">
              <AlertTriangle className="size-5" />
            </div>
            <DialogTitle className="text-lg">Отменить сдачу металлолома?</DialogTitle>
            <DialogDescription className="leading-6">
              Вес {cancellationSale ? formatWeight(cancellationSale.total_weight_kg) : ''} будет возвращён в доступные партии, а финансовый приход — отменён.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCancellation}>
            <div className="py-2">
              <Label htmlFor="scrap-cancellation-reason">Причина отмены *</Label>
              <Textarea
                id="scrap-cancellation-reason"
                className="mt-1.5 min-h-28 resize-y"
                value={cancellationReason}
                onChange={(event) => setCancellationReason(event.target.value)}
                placeholder="Опишите причину отмены операции"
                required
                autoFocus
              />
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => {
                setCancellationSale(null)
                setCancellationReason('')
              }} disabled={pending}>
                Оставить без изменений
              </Button>
              <Button type="submit" variant="destructive" className="min-h-11" disabled={pending || cancellationReason.trim() === ''}>
                {pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <XCircle className="size-4" aria-hidden="true" />}
                Подтвердить отмену
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {pending && (
        <div className="sr-only" role="status" aria-live="polite">Обновляем данные страницы</div>
      )}
    </div>
  )
}
