'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  Factory,
  FileCheck2,
  PackageCheck,
  Scale,
  Settings2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  confirmFutureDetailing,
  correctFutureDetailingPlan,
  type FutureDetailingPageBatch,
  type FutureDetailingPageData,
  type FutureDetailingStatus,
} from '@/lib/actions/future-inventory'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'

type Draft = { quantity: string; reason: string }

const statusMeta: Record<FutureDetailingStatus, { label: string; className: string }> = {
  planned: { label: 'Ожидает заготовку', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  awaiting_confirmation: { label: 'Требует подтверждения', className: 'border-blue-200 bg-blue-50 text-blue-800' },
  confirmed: { label: 'На обычном складе', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  cancelled: { label: 'Не планировалась', className: 'border-slate-200 bg-slate-100 text-slate-700' },
}

const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })
const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })

export function FutureDetailingPage({ data }: { data: FutureDetailingPageData }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [planReasons, setPlanReasons] = useState<Record<string, string>>({})
  const activeBatches = data.batches.filter((batch) => ['planned', 'awaiting_confirmation'].includes(batch.status))
  const historyBatches = data.batches.filter((batch) => ['confirmed', 'cancelled'].includes(batch.status))
  const plannedPieces = activeBatches.reduce((sum, batch) => sum + batchPieceCount(batch, 'planned'), 0)
  const availablePieces = historyBatches.reduce((sum, batch) => sum + batchPieceCount(batch, 'actual'), 0)
  const nearestAvailability = activeBatches
    .map((batch) => batch.plannedAvailabilityDate)
    .filter((value): value is string => Boolean(value))
    .sort()[0] || null
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize))

  function updateDraft(itemId: string, values: Partial<Draft>, fallbackQuantity: number) {
    setDrafts((current) => ({
      ...current,
      [itemId]: {
        quantity: current[itemId]?.quantity ?? String(fallbackQuantity),
        reason: current[itemId]?.reason ?? '',
        ...values,
      },
    }))
  }

  function confirm(batch: FutureDetailingPageBatch) {
    const items = batch.items.map((item) => ({
      itemId: item.id,
      actualQuantity: Number(drafts[item.id]?.quantity ?? item.planned_quantity),
      reason: drafts[item.id]?.reason || '',
    }))
    startTransition(async () => {
      const result = await confirmFutureDetailing(batch.id, items)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Фактическая деталировка принята на склад')
      router.refresh()
    })
  }

  function correctPlan(batch: FutureDetailingPageBatch) {
    const items = batch.items
      .filter((item) => item.status === 'planned')
      .map((item) => ({
        itemId: item.id,
        quantity: Number(drafts[item.id]?.quantity ?? item.planned_quantity),
      }))
    startTransition(async () => {
      const result = await correctFutureDetailingPlan(batch.id, items, planReasons[batch.id] || '')
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('План будущей деталировки скорректирован')
      router.refresh()
    })
  }

  return (
    <main className="space-y-6" aria-busy={pending}>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid gap-6 bg-[linear-gradient(120deg,#eef4ff_0%,#f8fafc_58%,#ecfdf5_100%)] p-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:p-7">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-blue-800">
              <Boxes className="h-4 w-4" aria-hidden="true" />
              Склад · план поступления
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Будущая деталировка</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              План автоматически и целиком поступит в обычную деталировку после первого факта этапа «Заготовка» по машине.
            </p>
          </div>
          <div className="self-end">
            <Label htmlFor="future-detailing-factory" className="text-sm font-semibold text-slate-800">Завод</Label>
            <Select
              value={data.selectedFactory || undefined}
              onValueChange={(value) => {
                if (value) router.push(`${ROUTES.INVENTORY_FUTURE_DETAILING}?factory=${encodeURIComponent(value)}`)
              }}
            >
              <SelectTrigger id="future-detailing-factory" className="mt-2 h-11 w-full border-slate-300 bg-white">
                <SelectValue>{data.selectedFactoryName || 'Выберите завод'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {data.factories.map((factory) => <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ol className="grid border-t border-slate-200 md:grid-cols-3" aria-label="Как деталировка становится доступной">
          <WorkflowStep number="1" icon={FileCheck2} title="План создан" description="Технолог задаёт состав и количество." />
          <WorkflowStep number="2" icon={Settings2} title="Первый факт заготовки" description="Система фиксирует начало изготовления." />
          <WorkflowStep number="3" icon={PackageCheck} title="Обычная деталировка" description="Весь план сразу доступен на складе." last />
        </ol>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Сводка будущей деталировки">
        <Metric icon={Clock3} label="Активных планов" value={numberFormatter.format(activeBatches.length)} note="ожидают первый факт" tone="amber" />
        <Metric icon={Boxes} label="Запланировано деталей" value={`${numberFormatter.format(plannedPieces)} шт.`} note="в показанных планах" tone="blue" />
        <Metric icon={CalendarClock} label="Ближайшая доступность" value={nearestAvailability ? formatDate(nearestAvailability) : 'Не назначена'} note="по плану заготовки" tone="violet" />
        <Metric icon={PackageCheck} label="Уже принято" value={`${numberFormatter.format(availablePieces)} шт.`} note="в показанной истории" tone="emerald" />
      </section>

      <section aria-labelledby="active-future-detailing-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="active-future-detailing-title" className="text-xl font-bold text-slate-950">Ожидают заготовку</h2>
            <p className="mt-1 text-sm text-slate-600">Доступность рассчитывается по плановой дате начала этапа «Заготовка».</p>
          </div>
          <Badge variant="outline" className="rounded-full border-slate-200 bg-white px-3 py-1 text-slate-700">
            {activeBatches.length} {pluralizePlan(activeBatches.length)}
          </Badge>
        </div>
        <div className="grid gap-4">
          {activeBatches.map((batch) => (
            <FutureBatchCard
              key={batch.id}
              batch={batch}
              drafts={drafts}
              planReason={planReasons[batch.id] || ''}
              pending={pending}
              onDraftChange={updateDraft}
              onPlanReasonChange={(value) => setPlanReasons((current) => ({ ...current, [batch.id]: value }))}
              onCorrect={() => correctPlan(batch)}
              onConfirm={() => confirm(batch)}
            />
          ))}
          {activeBatches.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" aria-hidden="true" />
              <h3 className="mt-3 font-semibold text-slate-950">Нет планов, ожидающих заготовку</h3>
              <p className="mt-1 text-sm text-slate-600">Новые планы появятся здесь после завершения заявки технолога.</p>
            </div>
          )}
        </div>
      </section>

      {historyBatches.length > 0 && (
        <section aria-labelledby="future-detailing-history-title">
          <div className="mb-3">
            <h2 id="future-detailing-history-title" className="text-xl font-bold text-slate-950">История планов</h2>
            <p className="mt-1 text-sm text-slate-600">Уже принятые и отменённые планы на этой странице.</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {historyBatches.map((batch) => <HistoryBatchCard key={batch.id} batch={batch} />)}
          </div>
        </section>
      )}

      {pageCount > 1 && (
        <nav className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4" aria-label="Страницы будущей деталировки">
          <PaginationLink data={data} page={data.page - 1} disabled={data.page === 0} direction="previous" />
          <span className="text-sm font-medium tabular-nums text-slate-600">Страница {data.page + 1} из {pageCount}</span>
          <PaginationLink data={data} page={data.page + 1} disabled={data.page + 1 >= pageCount} direction="next" />
        </nav>
      )}

      <span className="sr-only" aria-live="polite">{pending ? 'Сохраняем изменения' : ''}</span>
    </main>
  )
}

function FutureBatchCard({
  batch,
  drafts,
  planReason,
  pending,
  onDraftChange,
  onPlanReasonChange,
  onCorrect,
  onConfirm,
}: {
  batch: FutureDetailingPageBatch
  drafts: Record<string, Draft>
  planReason: string
  pending: boolean
  onDraftChange: (itemId: string, values: Partial<Draft>, fallbackQuantity: number) => void
  onPlanReasonChange: (value: string) => void
  onCorrect: () => void
  onConfirm: () => void
}) {
  const pieces = batchPieceCount(batch, 'planned')
  const weightKg = batch.items.reduce((sum, item) => (
    sum + item.planned_quantity * Number(item.detailing_parts?.unit_weight_kg || 0)
  ), 0)
  const canCorrect = batch.status === 'planned' && batch.isOwner
  const needsLegacyConfirmation = batch.status === 'awaiting_confirmation' && batch.isOwner

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="grid gap-4 border-b border-slate-200 bg-slate-50/80 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-900 text-white">
            <Factory className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-slate-950">{batch.machineName}</h3>
              <StatusBadge status={batch.status} />
            </div>
            <p className="mt-1 text-sm text-slate-600">План создал: {batch.authorName} · {formatDate(batch.created_at)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <SummaryChip icon={Boxes} label={`${numberFormatter.format(pieces)} шт.`} />
          <SummaryChip icon={Scale} label={`${numberFormatter.format(weightKg)} кг`} />
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:p-5">
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-800">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
              Плановая доступность
            </div>
            <p className="mt-2 text-lg font-bold text-slate-950">
              {batch.plannedAvailabilityDate ? formatDate(batch.plannedAvailabilityDate) : 'Дата не назначена'}
            </p>
            <p className="mt-1 text-sm leading-5 text-amber-950">
              После первого факта «Заготовка» по машине «{batch.machineName}».
            </p>
          </div>
          {batch.isOwner && (
            <Link
              href={`/technologist/requests/${batch.request_id}/correction`}
              className="flex min-h-11 items-center justify-between rounded-xl border border-slate-300 px-3 text-sm font-semibold text-blue-900 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
              Отходность и время <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="font-semibold text-slate-950">Состав деталировки</h4>
            <span className="text-xs font-medium text-slate-500">{batch.items.length} поз.</span>
          </div>
          <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
            {batch.items.map((item) => {
              const changed = Number(drafts[item.id]?.quantity ?? item.planned_quantity) !== item.planned_quantity
              return (
                <div key={item.id} className="grid gap-3 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_140px] sm:items-center">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-950">{item.detailing_parts?.name || 'Деталь'}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      Чертёж {item.detailing_parts?.drawing_number || 'не указан'} · {numberFormatter.format(Number(item.detailing_parts?.unit_weight_kg || 0))} кг/шт. · Габариты: {item.detailing_parts && [item.detailing_parts.width_mm, item.detailing_parts.height_mm, item.detailing_parts.thickness_mm].every((value) => value != null) ? `${item.detailing_parts.width_mm} × ${item.detailing_parts.height_mm} × ${item.detailing_parts.thickness_mm} мм` : 'Не указаны'}
                    </p>
                  </div>
                  {canCorrect ? (
                    <div>
                      <Label htmlFor={`future-quantity-${item.id}`} className="text-xs font-medium text-slate-600">План, шт.</Label>
                      <Input
                        id={`future-quantity-${item.id}`}
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        className="mt-1 h-11 tabular-nums"
                        value={drafts[item.id]?.quantity ?? String(item.planned_quantity)}
                        onChange={(event) => onDraftChange(item.id, { quantity: event.target.value }, item.planned_quantity)}
                      />
                    </div>
                  ) : needsLegacyConfirmation ? (
                    <div>
                      <Label htmlFor={`future-fact-${item.id}`} className="text-xs font-medium text-slate-600">Факт, шт.</Label>
                      <Input
                        id={`future-fact-${item.id}`}
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        className="mt-1 h-11 tabular-nums"
                        value={drafts[item.id]?.quantity ?? String(item.planned_quantity)}
                        onChange={(event) => onDraftChange(item.id, { quantity: event.target.value }, item.planned_quantity)}
                      />
                      {changed && (
                        <Input
                          aria-label={`Причина изменения количества для ${item.detailing_parts?.name || 'детали'}`}
                          className="mt-2 h-11"
                          placeholder="Причина изменения"
                          value={drafts[item.id]?.reason || ''}
                          onChange={(event) => onDraftChange(item.id, { reason: event.target.value }, item.planned_quantity)}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-right">
                      <span className="block text-xs text-slate-500">Запланировано</span>
                      <strong className="tabular-nums text-slate-950">{numberFormatter.format(item.planned_quantity)} шт.</strong>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {canCorrect && (
            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div>
                <Label htmlFor={`future-reason-${batch.id}`} className="text-sm font-semibold text-slate-800">Причина корректировки</Label>
                <Input
                  id={`future-reason-${batch.id}`}
                  className="mt-2 h-11"
                  placeholder="Почему изменился план"
                  value={planReason}
                  onChange={(event) => onPlanReasonChange(event.target.value)}
                />
              </div>
              <Button className="h-11" disabled={pending || !planReason.trim()} onClick={onCorrect}>
                {pending ? 'Сохраняем…' : 'Сохранить план'}
              </Button>
            </div>
          )}
          {needsLegacyConfirmation && (
            <div className="mt-4 flex justify-end">
              <Button className="h-11" disabled={pending} onClick={onConfirm}>
                {pending ? 'Подтверждаем…' : 'Подтвердить поступление'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function HistoryBatchCard({ batch }: { batch: FutureDetailingPageBatch }) {
  const pieces = batchPieceCount(batch, batch.status === 'confirmed' ? 'actual' : 'planned')
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-slate-950">{batch.machineName}</p>
          <p className="mt-1 text-sm text-slate-600">
            {batch.status === 'confirmed'
              ? `Доступно с ${formatDate(batch.confirmed_at || batch.created_at)}`
              : `План от ${formatDate(batch.created_at)}`}
          </p>
        </div>
        <StatusBadge status={batch.status} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <SummaryChip icon={Boxes} label={`${numberFormatter.format(pieces)} шт.`} />
        <span className="text-slate-500">{batch.items.length > 0 ? `${batch.items.length} поз.` : 'Без позиций'}</span>
      </div>
    </article>
  )
}

function WorkflowStep({ number, icon: Icon, title, description, last = false }: {
  number: string
  icon: typeof Boxes
  title: string
  description: string
  last?: boolean
}) {
  return (
    <li className={cn('relative flex gap-3 p-4 lg:p-5', !last && 'border-b border-slate-200 md:border-b-0 md:border-r')}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-blue-900">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Шаг {number}</p>
        <p className="mt-0.5 font-semibold text-slate-950">{title}</p>
        <p className="mt-1 text-sm leading-5 text-slate-600">{description}</p>
      </div>
      {!last && <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 rounded-full border border-slate-200 bg-white p-1 text-slate-400 md:block" aria-hidden="true" />}
    </li>
  )
}

function Metric({ icon: Icon, label, value, note, tone }: {
  icon: typeof Boxes
  label: string
  value: string
  note: string
  tone: 'amber' | 'blue' | 'violet' | 'emerald'
}) {
  const tones = {
    amber: 'bg-amber-50 text-amber-800',
    blue: 'bg-blue-50 text-blue-800',
    violet: 'bg-violet-50 text-violet-800',
    emerald: 'bg-emerald-50 text-emerald-800',
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tones[tone])}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 truncate text-lg font-bold tabular-nums text-slate-950" title={value}>{value}</p>
          <p className="mt-0.5 text-xs text-slate-500">{note}</p>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: FutureDetailingStatus }) {
  const meta = statusMeta[status]
  return (
    <Badge variant="outline" className={cn('shrink-0 rounded-full font-semibold', meta.className)}>
      <CircleDot className="mr-1 h-3 w-3" aria-hidden="true" />
      {meta.label}
    </Badge>
  )
}

function SummaryChip({ icon: Icon, label }: { icon: typeof Boxes; label: string }) {
  return (
    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-semibold tabular-nums text-slate-800">
      <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" /> {label}
    </span>
  )
}

function PaginationLink({ data, page, disabled, direction }: {
  data: FutureDetailingPageData
  page: number
  disabled: boolean
  direction: 'previous' | 'next'
}) {
  const label = direction === 'previous' ? 'Назад' : 'Вперёд'
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight
  const href = `${ROUTES.INVENTORY_FUTURE_DETAILING}?factory=${encodeURIComponent(data.selectedFactory || '')}&page=${page}`
  return disabled ? (
    <span aria-disabled="true" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-400">
      {direction === 'previous' && <Icon className="h-4 w-4" aria-hidden="true" />}
      {label}
      {direction === 'next' && <Icon className="h-4 w-4" aria-hidden="true" />}
    </span>
  ) : (
    <Link scroll={false} href={href} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-blue-900 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 motion-reduce:transition-none">
      {direction === 'previous' && <Icon className="h-4 w-4" aria-hidden="true" />}
      {label}
      {direction === 'next' && <Icon className="h-4 w-4" aria-hidden="true" />}
    </Link>
  )
}

function batchPieceCount(batch: FutureDetailingPageBatch, source: 'planned' | 'actual') {
  return batch.items.reduce((sum, item) => (
    sum + (source === 'actual' ? Number(item.actual_quantity || 0) : item.planned_quantity)
  ), 0)
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? 'Дата не указана' : dateFormatter.format(date)
}

function pluralizePlan(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'план'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'плана'
  return 'планов'
}
