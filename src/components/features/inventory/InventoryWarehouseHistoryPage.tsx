import Link from 'next/link'
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Factory,
  Filter,
  History,
  Minus,
  PackageCheck,
  PackageMinus,
  Paintbrush,
  ShieldCheck,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  CHAIN_CORD_SUBTYPE_LABELS,
  INVENTORY_TRANSACTION_LABELS,
  MATERIAL_CATEGORY_LABELS,
  PIPE_SUBTYPE_LABELS,
} from '@/lib/constants/procurement'
import { knifeBevelCharacteristicLabel } from '@/lib/materials/knife-bevel'
import { displayMaterialCategory } from '@/lib/materials/display-category'
import { formatKnifeProfileDimensions } from '@/lib/materials/knife-profile'
import { roundPipeOuterDiameterMm } from '@/lib/materials/pipe-profile'
import { groupWeightTrendByWeek, type WeightWeek } from '@/lib/inventory/warehouse-history'
import { ROUTES } from '@/lib/constants/routes'
import { PaintStockSheet } from './PaintStockSheet'
import type {
  InventoryFactory,
  InventoryTransactionWithRelations,
  InventoryWarehouseHistoryCategorySummary,
  InventoryWarehouseHistoryOverview,
  PaintStockPosition,
} from '@/lib/actions/inventory'
import type { InventoryTransactionType, MaterialCategory } from '@/lib/types'

type Props = {
  overview: InventoryWarehouseHistoryOverview
  rows: InventoryTransactionWithRelations[]
  factories: InventoryFactory[]
  activeFactoryId: string | null
  transactionType?: InventoryTransactionType | null
  category: MaterialCategory | null
  paintPositions: PaintStockPosition[]
  paintError: string | null
  page: number
  pageSize: number
  total: number
}

const TYPE_CLASSES: Record<InventoryTransactionType, string> = {
  receipt: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  reserve: 'border-blue-200 bg-blue-50 text-blue-700',
  unreserve: 'border-amber-200 bg-amber-50 text-amber-700',
  write_off: 'border-red-200 bg-red-50 text-red-700',
  adjustment: 'border-slate-200 bg-slate-100 text-slate-700',
  transfer_out: 'border-violet-200 bg-violet-50 text-violet-700',
  transfer_in: 'border-cyan-200 bg-cyan-50 text-cyan-700',
}

const TRANSACTION_TYPES: InventoryTransactionType[] = [
  'receipt',
  'reserve',
  'unreserve',
  'write_off',
  'adjustment',
  'transfer_out',
  'transfer_in',
]

export function InventoryWarehouseHistoryPage({
  overview,
  rows,
  factories,
  activeFactoryId,
  transactionType,
  category,
  paintPositions,
  paintError,
  page,
  pageSize,
  total,
}: Props) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentFrom = total === 0 ? 0 : page * pageSize + 1
  const currentTo = Math.min(total, (page + 1) * pageSize)
  const activeFactory = factories.find((factory) => factory.id === activeFactoryId) || null
  const trendState = overview.deltaWeightKg > 0 ? 'up' : overview.deltaWeightKg < 0 ? 'down' : 'flat'
  const paint = overview.categories.find((item) => item.category === 'paint')

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[#E0E7EF] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-[#5B6B82]">
              <History className="h-4 w-4 text-[#1B3A6B]" />
              История склада
            </div>
            <h2 className="mt-2 text-2xl font-bold text-[#1B3A6B]">
              {activeFactory ? activeFactory.name : 'Все заводы'}
            </h2>
            <p className="mt-1 text-sm text-[#6B7280]">
              {formatDate(overview.period.from)} - {formatDate(overview.period.to)}
            </p>
          </div>

          <form action={ROUTES.INVENTORY_HISTORY} className="grid gap-2 sm:grid-cols-[1fr_1fr_1.1fr_auto_auto] lg:min-w-[720px]">
            {activeFactoryId && <input type="hidden" name="factory" value={activeFactoryId} />}
            {category && <input type="hidden" name="category" value={category} />}
            <label className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">
              С
              <input
                type="date"
                name="from"
                defaultValue={overview.period.from}
                className="mt-1 h-10 w-full rounded-md border border-[#CED7E2] bg-white px-3 text-sm text-[#111827]"
              />
            </label>
            <label className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">
              По
              <input
                type="date"
                name="to"
                defaultValue={overview.period.to}
                className="mt-1 h-10 w-full rounded-md border border-[#CED7E2] bg-white px-3 text-sm text-[#111827]"
              />
            </label>
            <label className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">
              Операция
              <select
                name="type"
                defaultValue={transactionType || ''}
                className="mt-1 h-10 w-full rounded-md border border-[#CED7E2] bg-white px-3 text-sm text-[#111827]"
              >
                <option value="">Все операции</option>
                {TRANSACTION_TYPES.map((type) => (
                  <option key={type} value={type}>{INVENTORY_TRANSACTION_LABELS[type]}</option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#1B3A6B] px-4 text-sm font-semibold text-white hover:bg-[#16315C]"
            >
              <Filter className="h-4 w-4" />
              Применить
            </button>
            <Link
              href={baseHref(activeFactoryId)}
              className="mt-5 inline-flex h-10 items-center justify-center rounded-md border border-[#CED7E2] px-4 text-sm font-semibold text-[#1B3A6B] hover:bg-[#F3F6FA]"
            >
              Сбросить
            </Link>
          </form>
        </div>

        {factories.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {factories.map((factory) => (
              <Link
                key={factory.id}
                href={periodHref(overview, factory.id, transactionType, category)}
                className={factory.id === activeFactoryId
                  ? 'rounded-md bg-[#1B3A6B] px-3 py-2 text-sm font-semibold text-white'
                  : 'rounded-md border border-[#CED7E2] px-3 py-2 text-sm font-semibold text-[#1B3A6B] hover:bg-[#F3F6FA]'}
              >
                <Factory className="mr-2 inline h-4 w-4" />
                {factory.name}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <MetricCard
          icon={Boxes}
          label="Текущий вес металла"
          value={formatKg(overview.currentWeightKg)}
          note={`Было ${formatKg(overview.previousWeightKg)}`}
        />
        <MetricCard
          icon={trendState === 'up' ? ArrowUpRight : trendState === 'down' ? ArrowDownRight : Minus}
          label="Динамика периода"
          value={signedKg(overview.deltaWeightKg)}
          note={overview.deltaPercent === null ? 'Нет базы для процента' : signedPercent(overview.deltaPercent)}
          tone={trendState}
        />
        <MetricCard
          icon={PackageCheck}
          label="Приход металла"
          value={formatKg(overview.receiptWeightKg)}
          note={`${overview.transactionCount} операций с металлом`}
          tone="up"
        />
        <MetricCard
          icon={PackageMinus}
          label="Списание металла"
          value={formatKg(overview.writeOffWeightKg)}
          note={`Бронь ${formatKg(overview.reserveWeightKg)}`}
          tone="down"
        />
        <PaintStockSheet positions={paintPositions} error={paintError}>
          <MetricCard
            icon={Paintbrush}
            label="Краска на складе"
            value={formatKg(paint?.currentWeightKg || 0)}
            note={paintError ? 'Позиции временно недоступны' : `Доступно ${formatKg(paintPositions.reduce((total, position) => total + position.availableKg, 0))} · Показать позиции`}
          />
        </PaintStockSheet>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col rounded-xl border border-[#E0E7EF] bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-[#1B3A6B]">Динамика веса металла</h3>
              <p className="mt-1 text-sm text-[#6B7280]">Изменение веса листов, ножей, кругов и труб за выбранный период.</p>
            </div>
            <TrendBadge value={overview.deltaWeightKg} />
          </div>
          <TrendChart overview={overview} />
        </div>

        <div className="rounded-xl border border-[#E0E7EF] bg-white p-4 shadow-sm">
          <h3 className="text-lg font-semibold text-[#1B3A6B]">Категории</h3>
          <div className="mt-4 space-y-3">
            {overview.categories.map((item) => item.category === 'paint' ? (
              <PaintStockSheet key={item.category} positions={paintPositions} error={paintError}>
                <CategoryRow item={item} />
              </PaintStockSheet>
            ) : <CategoryRow key={item.category} item={item} />)}
            {overview.categories.length === 0 && (
              <div className="rounded-lg border border-dashed border-[#CED7E2] p-4 text-sm text-[#6B7280]">
                Нет складских остатков и операций за период.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[#E0E7EF] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[#E8ECF0] px-4 py-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-[#1B3A6B]">Журнал операций</h3>
            <p className="mt-1 text-sm text-[#6B7280]">
              Записи {currentFrom}-{currentTo} из {total}. Страница {page + 1} из {pageCount}.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <form action={ROUTES.INVENTORY_HISTORY} className="flex items-end gap-2">
              {activeFactoryId && <input type="hidden" name="factory" value={activeFactoryId} />}
              <input type="hidden" name="from" value={overview.period.from} />
              <input type="hidden" name="to" value={overview.period.to} />
              {transactionType && <input type="hidden" name="type" value={transactionType} />}
              <label className="min-w-0 text-xs font-medium text-[#475569]">
                Категория журнала
                <select name="category" defaultValue={category || ''} className="mt-1 h-10 w-full min-w-[180px] rounded-md border border-[#CED7E2] bg-white px-3 text-sm text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]">
                  <option value="">Все категории</option>
                  {(Object.keys(MATERIAL_CATEGORY_LABELS) as MaterialCategory[]).map((value) => (
                    <option key={value} value={value}>{categoryLabel(value)}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="inline-flex h-10 items-center justify-center rounded-md bg-[#1B3A6B] px-3 text-sm font-semibold text-white hover:bg-[#16315C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B] focus-visible:ring-offset-2">Показать</button>
            </form>
            <div className="flex gap-2">
              <Link
                href={pageHref(overview, activeFactoryId, transactionType, category, page)}
                aria-disabled={page <= 0}
                tabIndex={page <= 0 ? -1 : undefined}
                className={page <= 0 ? 'pointer-events-none rounded-md border border-[#CED7E2] px-3 py-2 text-sm font-semibold text-[#1B3A6B] opacity-50' : 'rounded-md border border-[#CED7E2] px-3 py-2 text-sm font-semibold text-[#1B3A6B] hover:bg-[#F3F6FA]'}
              >
                Назад
              </Link>
              <Link
                href={pageHref(overview, activeFactoryId, transactionType, category, page + 2)}
                aria-disabled={page + 1 >= pageCount}
                tabIndex={page + 1 >= pageCount ? -1 : undefined}
                className={page + 1 >= pageCount ? 'pointer-events-none rounded-md border border-[#CED7E2] px-3 py-2 text-sm font-semibold text-[#1B3A6B] opacity-50' : 'rounded-md border border-[#CED7E2] px-3 py-2 text-sm font-semibold text-[#1B3A6B] hover:bg-[#F3F6FA]'}
              >
                Вперед
              </Link>
            </div>
          </div>
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1260px] text-left text-sm">
            <thead className="bg-[#F8FAFC] text-xs uppercase tracking-wide text-[#64748B]">
              <tr>
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3">Операция</th>
                <th className="px-4 py-3">Материал</th>
                <th className="px-4 py-3">Категория</th>
                <th className="px-4 py-3">Характеристики</th>
                <th className="px-4 py-3">Количество</th>
                <th className="px-4 py-3">Вес, кг</th>
                <th className="px-4 py-3">Машина</th>
                <th className="px-4 py-3">Поставщик</th>
                <th className="px-4 py-3">Кто</th>
                <th className="px-4 py-3">Комментарий</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF0]">
              {rows.map((row) => (
                <tr key={row.id} className="align-top hover:bg-[#F8FAFC]">
                  <td className="px-4 py-3 text-[#64748B]">{formatDateTime(row.created_at)}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={TYPE_CLASSES[row.transaction_type]}>{INVENTORY_TRANSACTION_LABELS[row.transaction_type]}</Badge></td>
                  <td className="px-4 py-3 font-semibold text-[#111827]">{row.material_name || 'Материал'}</td>
                  <td className="px-4 py-3 text-[#475569]">{categoryLabel(displayMaterialCategory(row.material_category, row.variant?.pipe_type, row.unit))}</td>
                  <td className="px-4 py-3 text-[#64748B]">{variantSummary(row)}</td>
                  <td className={row.quantity < 0 ? 'px-4 py-3 font-semibold text-red-700' : 'px-4 py-3 font-semibold text-emerald-700'}>{quantityText(row)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums text-[#111827]">{weightText(row)}</td>
                  <td className="px-4 py-3">{machineCell(row)}</td>
                  <td className="px-4 py-3 text-[#475569]">{row.supplier_name || '—'}</td>
                  <td className="px-4 py-3 text-[#475569]">{row.user_name || '-'}</td>
                  <td className="px-4 py-3 text-[#64748B]">
                    {row.comment || '-'}
                    {row.transaction_type === 'write_off' && <WriteOffSource row={row} />}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-[#94A3B8]">Операций за выбранный период нет</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-[#E8ECF0] lg:hidden">
          {rows.map((row) => (
            <article key={row.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-[#64748B]">{formatDateTime(row.created_at)}</div>
                  <h4 className="mt-1 font-semibold text-[#111827]">{row.material_name || 'Материал'}</h4>
                  <div className="mt-1 text-sm text-[#64748B]">{categoryLabel(displayMaterialCategory(row.material_category, row.variant?.pipe_type, row.unit))}</div>
                </div>
                <Badge variant="outline" className={TYPE_CLASSES[row.transaction_type]}>{INVENTORY_TRANSACTION_LABELS[row.transaction_type]}</Badge>
              </div>
              <div className="mt-3 grid gap-2 text-sm">
                <InfoLine label="Характеристики" value={variantSummary(row)} />
                <InfoLine label="Количество" value={quantityText(row)} strong={row.quantity < 0 ? 'down' : 'up'} />
                <InfoLine label="Вес" value={weightText(row)} />
                <InfoLine label="Машина" value={row.machine_name || '-'} />
                <InfoLine label="Поставщик" value={row.supplier_name || '—'} />
                <InfoLine label="Кто" value={row.user_name || '-'} />
                <InfoLine label="Комментарий" value={row.comment || '-'} />
                {row.transaction_type === 'write_off' && <WriteOffSource row={row} />}
              </div>
            </article>
          ))}
          {rows.length === 0 && (
            <div className="p-8 text-center text-sm text-[#94A3B8]">Операций за выбранный период нет</div>
          )}
        </div>
      </section>
    </div>
  )
}

function WriteOffSource({ row }: { row: InventoryTransactionWithRelations }) {
  if (row.comment !== 'Автоматическое списание потребности по факту заготовки') return null
  const source = row.write_off_source
  return <div className="mt-1 text-xs leading-5 text-[#475569]">
    <span className="font-semibold">{source?.certainty === 'exact' ? 'Источник списания:'
      : source ? 'Возможные брони (связь не установлена):' : 'Источник списания не установлен'}</span>
    {source?.labels.map((label) => <span key={label} className="block">{label}</span>)}
  </div>
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
  tone = 'flat',
}: {
  icon: React.ElementType
  label: string
  value: string
  note: string
  tone?: 'up' | 'down' | 'flat'
}) {
  const toneClass = tone === 'up'
    ? 'bg-emerald-50 text-emerald-700'
    : tone === 'down'
      ? 'bg-red-50 text-red-700'
      : 'bg-[#F3F6FA] text-[#1B3A6B]'

  return (
    <div className="rounded-xl border border-[#E0E7EF] bg-white p-4 shadow-sm">
      <div className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${toneClass}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="mt-3 text-sm font-medium text-[#64748B]">{label}</div>
      <div className="mt-1 text-2xl font-bold text-[#111827]">{value}</div>
      <div className="mt-1 text-sm text-[#64748B]">{note}</div>
    </div>
  )
}

function TrendChart({ overview }: { overview: InventoryWarehouseHistoryOverview }) {
  const weeks = groupWeightTrendByWeek(overview.trend)
  const dailyOnDesktop = overview.trend.length <= 42

  return (
    <div className="mt-5 flex min-h-[420px] flex-1 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[#475569]">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600" />Рост веса</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-600" />Снижение веса</span>
        <span className="text-[#64748B]">Итог недели: изменение · вес на конец</span>
      </div>
      {(!dailyOnDesktop || overview.trend.length > 14) && <p className="mb-2 text-xs text-[#64748B] md:hidden">Листайте график вправо, чтобы увидеть остальные недели.</p>}
      {dailyOnDesktop && (
        <div className={overview.trend.length > 14 ? 'hidden min-h-0 flex-1 md:flex' : 'flex min-h-0 flex-1'}>
          <TrendBars weeks={weeks} mode="daily" />
        </div>
      )}
      {(!dailyOnDesktop || overview.trend.length > 14) && (
        <div className={dailyOnDesktop ? 'flex min-h-0 flex-1 md:hidden' : 'flex min-h-0 flex-1'}>
          <TrendBars weeks={weeks} mode="weekly" />
        </div>
      )}
      <details className="mt-3 text-sm text-[#1B3A6B]">
        <summary className="w-fit cursor-pointer rounded-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]">Таблица значений по дням</summary>
        <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-[#E0E7EF]">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="sticky top-0 bg-[#F8FAFC] text-[#475569]"><tr><th className="px-3 py-2">Дата</th><th className="px-3 py-2">Изменение</th><th className="px-3 py-2">Вес склада</th></tr></thead>
            <tbody className="divide-y divide-[#E8ECF0]">
              {overview.trend.map((point) => <tr key={point.date}><td className="px-3 py-2">{formatDate(point.date)}</td><td className="px-3 py-2">{signedKg(point.deltaWeightKg)}</td><td className="px-3 py-2">{formatKg(point.weightKg)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

function TrendBars({ weeks, mode }: { weeks: WeightWeek[]; mode: 'daily' | 'weekly' }) {
  const bars = mode === 'daily'
    ? weeks.flatMap((week) => week.days)
    : weeks.map((week) => ({ date: week.to, deltaWeightKg: week.deltaWeightKg, weightKg: week.closingWeightKg }))
  const positiveMax = Math.max(0, ...bars.map((point) => point.deltaWeightKg))
  const negativeMax = Math.max(0, ...bars.map((point) => -point.deltaWeightKg))
  const positiveShare = positiveMax === 0 && negativeMax === 0 ? 0.5
    : positiveMax === 0 ? 0.08 : negativeMax === 0 ? 0.92
    : Math.min(0.72, Math.max(0.28, positiveMax / (positiveMax + negativeMax)))
  const minWidth = mode === 'daily' ? Math.max(bars.length * 16, weeks.length * 104) : weeks.length * 112

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-x-auto rounded-lg border border-[#E0E7EF] bg-[#FBFCFE]" aria-label={mode === 'daily' ? 'Изменение веса металла по дням' : 'Изменение веса металла по неделям'}>
      <div className="flex min-h-[320px] w-full flex-1 flex-col" style={{ minWidth }}>
        <div className="relative flex min-h-[250px] flex-1">
          <div className="pointer-events-none absolute inset-x-0 z-10 border-t border-[#94A3B8]" style={{ top: `${positiveShare * 100}%` }} />
          {weeks.map((week, index) => {
            const points = mode === 'daily' ? week.days : [{ date: week.to, deltaWeightKg: week.deltaWeightKg, weightKg: week.closingWeightKg }]
            return <div key={week.from} className={`relative flex border-r border-[#CBD5E1] ${index % 2 ? 'bg-slate-50/80' : 'bg-white'}`} style={{ flex: mode === 'daily' ? week.days.length : 1, minWidth: mode === 'daily' ? 104 : 112 }}>
              {points.map((point) => {
                const positive = point.deltaWeightKg > 0
                const negative = point.deltaWeightKg < 0
                const height = positive ? positiveShare * point.deltaWeightKg / positiveMax * 100
                  : negative ? (1 - positiveShare) * -point.deltaWeightKg / negativeMax * 100 : 0
                const top = positive ? positiveShare * 100 - height : positiveShare * 100
                const tooltip = `${mode === 'daily' ? formatDate(point.date) : `${formatDate(week.from)}–${formatDate(week.to)}`}: ${signedKg(point.deltaWeightKg)}. Вес ${formatKg(point.weightKg)}`
                return <div key={point.date} role="img" tabIndex={0} aria-label={tooltip} title={tooltip} className="group relative min-w-0 flex-1 cursor-default focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]">
                  <div className={`absolute left-1/2 w-3/5 max-w-7 -translate-x-1/2 ${positive ? 'rounded-t-sm bg-emerald-600' : negative ? 'rounded-b-sm bg-red-600' : 'h-[2px] rounded bg-slate-400'}`} style={{ top: `${top}%`, height: positive || negative ? `${height}%` : 2 }} />
                  <span className="pointer-events-none absolute left-1/2 top-2 z-30 hidden min-w-max -translate-x-1/2 rounded-md border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-medium text-[#111827] shadow-sm group-hover:block group-focus:block">{tooltip}</span>
                </div>
              })}
            </div>
          })}
        </div>
        <div className="flex border-t border-[#CBD5E1]">
          {weeks.map((week, index) => <div key={week.from} className={`border-r border-[#CBD5E1] px-2 py-2 text-center text-xs tabular-nums ${index % 2 ? 'bg-slate-50/80' : 'bg-white'}`} style={{ flex: mode === 'daily' ? week.days.length : 1, minWidth: mode === 'daily' ? 104 : 112 }}>
            <div className="font-semibold text-[#334155]">{formatWeekRange(week)}</div>
            <div className={`mt-1 font-bold ${week.deltaWeightKg > 0 ? 'text-emerald-700' : week.deltaWeightKg < 0 ? 'text-red-700' : 'text-[#475569]'}`}>{signedKg(week.deltaWeightKg)}</div>
            <div className="mt-1 text-[#475569]">Вес {formatKg(week.closingWeightKg)}</div>
          </div>)}
        </div>
      </div>
    </div>
  )
}

function TrendBadge({ value }: { value: number }) {
  if (value > 0) {
    return <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-sm font-semibold text-emerald-700"><ArrowUpRight className="h-4 w-4" />Склад растет</span>
  }
  if (value < 0) {
    return <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-sm font-semibold text-red-700"><ArrowDownRight className="h-4 w-4" />Склад уменьшается</span>
  }
  return <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-700"><Minus className="h-4 w-4" />Без изменения</span>
}

function CategoryRow({ item }: { item: InventoryWarehouseHistoryCategorySummary }) {
  return (
    <div className="rounded-lg border border-[#E8ECF0] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-[#111827]">{categoryLabel(item.category)}</div>
          <div className="mt-1 text-sm text-[#64748B]">{formatKg(item.currentWeightKg)}</div>
        </div>
        <TrendBadge value={item.deltaWeightKg} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-[#64748B]">
        <div>
          <div>Приход</div>
          <div className="font-semibold text-emerald-700">{formatKg(item.receiptWeightKg)}</div>
        </div>
        <div>
          <div>Бронь</div>
          <div className="font-semibold text-blue-700">{formatKg(item.reserveWeightKg)}</div>
        </div>
        <div>
          <div>Списание</div>
          <div className="font-semibold text-red-700">{formatKg(item.writeOffWeightKg)}</div>
        </div>
      </div>
    </div>
  )
}

function InfoLine({ label, value, strong }: { label: string; value: string; strong?: 'up' | 'down' }) {
  const valueClass = strong === 'up' ? 'text-emerald-700' : strong === 'down' ? 'text-red-700' : 'text-[#111827]'
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3">
      <span className="text-[#64748B]">{label}</span>
      <span className={`font-medium ${valueClass}`}>{value}</span>
    </div>
  )
}

function machineCell(row: InventoryTransactionWithRelations) {
  if (!row.machine_id || !row.machine_name) return '-'
  return (
    <Link className="inline-flex items-center gap-1 font-semibold text-[#1B3A6B] hover:underline" href={`${ROUTES.SALES_PLAN}/${row.machine_id}/request`}>
      <ShieldCheck className="h-4 w-4" />
      {row.machine_name}
    </Link>
  )
}

function pageHref(
  overview: InventoryWarehouseHistoryOverview,
  factoryId: string | null,
  transactionType: InventoryTransactionType | null | undefined,
  category: MaterialCategory | null | undefined,
  page: number,
) {
  const params = new URLSearchParams()
  if (factoryId) params.set('factory', factoryId)
  params.set('from', overview.period.from)
  params.set('to', overview.period.to)
  if (transactionType) params.set('type', transactionType)
  if (category) params.set('category', category)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `${ROUTES.INVENTORY_HISTORY}?${query}` : ROUTES.INVENTORY_HISTORY
}

function periodHref(overview: InventoryWarehouseHistoryOverview, factoryId: string | null, transactionType: InventoryTransactionType | null | undefined, category: MaterialCategory | null | undefined) {
  const params = new URLSearchParams()
  if (factoryId) params.set('factory', factoryId)
  params.set('from', overview.period.from)
  params.set('to', overview.period.to)
  if (transactionType) params.set('type', transactionType)
  if (category) params.set('category', category)
  return `${ROUTES.INVENTORY_HISTORY}?${params.toString()}`
}

function baseHref(factoryId: string | null) {
  if (!factoryId) return ROUTES.INVENTORY_HISTORY
  return `${ROUTES.INVENTORY_HISTORY}?factory=${encodeURIComponent(factoryId)}`
}

function quantityText(row: InventoryTransactionWithRelations) {
  const primary = `${signedAmount(row.quantity)} ${row.unit || ''}`.trim()
  if (row.secondary_quantity === null || row.secondary_quantity === undefined) return primary
  return `${primary} / ${signedAmount(row.secondary_quantity)} ${row.secondary_unit || ''}`.trim()
}

function weightText(row: InventoryTransactionWithRelations) {
  if (row.weight_kg === null || row.weight_kg === undefined) return '-'
  return formatKg(row.weight_kg)
}

function variantSummary(row: InventoryTransactionWithRelations) {
  const variant = row.variant
  if (!variant) return '-'

  const values: Array<string | number | null | undefined> = []
  if (row.material_category === 'sheet_metal') values.push(variant.material_grade, variant.sheet_size, variant.thickness_mm ? `${variant.thickness_mm} мм` : null)
  else if (row.material_category === 'circle') values.push(variant.material_grade, variant.diameter_mm ? `Ø${variant.diameter_mm}` : null, variant.is_calibrated ? 'калибр.' : null)
  else if (row.material_category === 'pipe') {
    values.push(variant.pipe_type ? PIPE_SUBTYPE_LABELS[variant.pipe_type] ?? variant.pipe_type : null)
    if (variant.pipe_type === 'wire') values.push(variant.diameter_mm ? `Ø${variant.diameter_mm}` : null)
    else if (variant.pipe_type === 'round') values.push(roundPipeOuterDiameterMm(variant) ? `Ø${roundPipeOuterDiameterMm(variant)}` : null, variant.wall_thickness_mm ? `${variant.wall_thickness_mm} мм` : null)
    else values.push(variant.piece_description, variant.wall_thickness_mm ? `${variant.wall_thickness_mm} мм` : null)
  } else if (row.material_category === 'knives') values.push(formatKnifeProfileDimensions(variant), variant.knife_material, `Скос: ${knifeBevelCharacteristicLabel(variant.knife_bevel_count)}`)
  else if (row.material_category === 'paint') values.push(variant.ral_code, variant.finish)
  else if (row.material_category === 'components') values.push(variant.specification, variant.diameter_mm ? `Ø${variant.diameter_mm}` : null)
  else if (row.material_category === 'mesh') values.push(variant.mesh_description, variant.mesh_length_mm ? `${variant.mesh_length_mm} мм` : null, variant.mesh_width_mm ? `${variant.mesh_width_mm} мм` : null)
  else if (row.material_category === 'chain_cord') values.push(variant.chain_cord_type ? CHAIN_CORD_SUBTYPE_LABELS[variant.chain_cord_type] ?? variant.chain_cord_type : null, variant.chain_cord_parameters)

  return values.filter(Boolean).join(', ') || '-'
}

function categoryLabel(category?: InventoryTransactionWithRelations['material_category'] | InventoryWarehouseHistoryCategorySummary['category'] | null) {
  if (!category) return '-'
  if (category === 'circle') return 'Круги'
  if (category === 'pipe') return 'Трубы'
  return MATERIAL_CATEGORY_LABELS[category] ?? category
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`))
}

function formatWeekRange(week: WeightWeek) {
  const start = new Date(`${week.from}T00:00:00.000Z`)
  const end = new Date(`${week.to}T00:00:00.000Z`)
  const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
  if (start.getUTCFullYear() === end.getUTCFullYear()) return `${dayMonth.format(start)}–${dayMonth.format(end)}`
  return `${formatDate(week.from)}–${formatDate(week.to)}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Chisinau',
  }).format(new Date(value))
}

function formatKg(value: number) {
  return `${formatAmount(value)} кг`
}

function signedKg(value: number) {
  return `${value > 0 ? '+' : ''}${formatKg(value)}`
}

function signedPercent(value: number) {
  return `${value > 0 ? '+' : ''}${formatAmount(value)}%`
}

function signedAmount(value: number) {
  return `${value > 0 ? '+' : ''}${formatAmount(value)}`
}

function formatAmount(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value || 0)
}
