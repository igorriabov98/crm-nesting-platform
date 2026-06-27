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
  ShieldCheck,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  CHAIN_CORD_SUBTYPE_LABELS,
  INVENTORY_TRANSACTION_LABELS,
  MATERIAL_CATEGORY_LABELS,
  PIPE_SUBTYPE_LABELS,
} from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'
import type {
  InventoryFactory,
  InventoryTransactionWithRelations,
  InventoryWarehouseHistoryCategorySummary,
  InventoryWarehouseHistoryOverview,
} from '@/lib/actions/inventory'
import type { InventoryTransactionType } from '@/lib/types'

type Props = {
  overview: InventoryWarehouseHistoryOverview
  rows: InventoryTransactionWithRelations[]
  factories: InventoryFactory[]
  activeFactoryId: string | null
  transactionType?: InventoryTransactionType | null
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
}

const TRANSACTION_TYPES: InventoryTransactionType[] = ['receipt', 'reserve', 'unreserve', 'write_off', 'adjustment']

export function InventoryWarehouseHistoryPage({
  overview,
  rows,
  factories,
  activeFactoryId,
  transactionType,
  page,
  pageSize,
  total,
}: Props) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentFrom = total === 0 ? 0 : page * pageSize + 1
  const currentTo = Math.min(total, (page + 1) * pageSize)
  const activeFactory = factories.find((factory) => factory.id === activeFactoryId) || null
  const trendState = overview.deltaWeightKg > 0 ? 'up' : overview.deltaWeightKg < 0 ? 'down' : 'flat'

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
                href={periodHref(overview, factory.id, transactionType)}
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

      <section className="grid gap-3 lg:grid-cols-4">
        <MetricCard
          icon={Boxes}
          label="Текущий вес склада"
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
          label="Приход"
          value={formatKg(overview.receiptWeightKg)}
          note={`${overview.transactionCount} операций всего`}
          tone="up"
        />
        <MetricCard
          icon={PackageMinus}
          label="Списание"
          value={formatKg(overview.writeOffWeightKg)}
          note={`Бронь ${formatKg(overview.reserveWeightKg)}`}
          tone="down"
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-xl border border-[#E0E7EF] bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-[#1B3A6B]">Динамика веса</h3>
              <p className="mt-1 text-sm text-[#6B7280]">Изменение общего веса по дням выбранного периода.</p>
            </div>
            <TrendBadge value={overview.deltaWeightKg} />
          </div>
          <TrendChart overview={overview} />
        </div>

        <div className="rounded-xl border border-[#E0E7EF] bg-white p-4 shadow-sm">
          <h3 className="text-lg font-semibold text-[#1B3A6B]">Категории</h3>
          <div className="mt-4 space-y-3">
            {overview.categories.map((category) => (
              <CategoryRow key={category.category} item={category} />
            ))}
            {overview.categories.length === 0 && (
              <div className="rounded-lg border border-dashed border-[#CED7E2] p-4 text-sm text-[#6B7280]">
                Нет складских остатков и операций за период.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[#E0E7EF] bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-[#E8ECF0] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-[#1B3A6B]">Журнал операций</h3>
            <p className="mt-1 text-sm text-[#6B7280]">
              Записи {currentFrom}-{currentTo} из {total}. Страница {page + 1} из {pageCount}.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href={pageHref(overview, activeFactoryId, transactionType, page)}
              className={page <= 0 ? 'pointer-events-none rounded-md border border-[#CED7E2] px-3 py-2 text-sm font-semibold text-[#1B3A6B] opacity-50' : 'rounded-md border border-[#CED7E2] px-3 py-2 text-sm font-semibold text-[#1B3A6B] hover:bg-[#F3F6FA]'}
            >
              Назад
            </Link>
            <Link
              href={pageHref(overview, activeFactoryId, transactionType, page + 2)}
              className={page + 1 >= pageCount ? 'pointer-events-none rounded-md border border-[#CED7E2] px-3 py-2 text-sm font-semibold text-[#1B3A6B] opacity-50' : 'rounded-md border border-[#CED7E2] px-3 py-2 text-sm font-semibold text-[#1B3A6B] hover:bg-[#F3F6FA]'}
            >
              Вперед
            </Link>
          </div>
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-[#F8FAFC] text-xs uppercase tracking-wide text-[#64748B]">
              <tr>
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3">Операция</th>
                <th className="px-4 py-3">Материал</th>
                <th className="px-4 py-3">Категория</th>
                <th className="px-4 py-3">Характеристики</th>
                <th className="px-4 py-3">Количество</th>
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
                  <td className="px-4 py-3 text-[#475569]">{categoryLabel(row.material_category)}</td>
                  <td className="px-4 py-3 text-[#64748B]">{variantSummary(row)}</td>
                  <td className={row.quantity < 0 ? 'px-4 py-3 font-semibold text-red-700' : 'px-4 py-3 font-semibold text-emerald-700'}>{quantityText(row)}</td>
                  <td className="px-4 py-3">{machineCell(row)}</td>
                  <td className="px-4 py-3 text-[#475569]">{row.supplier_name || '-'}</td>
                  <td className="px-4 py-3 text-[#475569]">{row.user_name || '-'}</td>
                  <td className="px-4 py-3 text-[#64748B]">{row.comment || '-'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-[#94A3B8]">Операций за выбранный период нет</td>
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
                  <div className="mt-1 text-sm text-[#64748B]">{categoryLabel(row.material_category)}</div>
                </div>
                <Badge variant="outline" className={TYPE_CLASSES[row.transaction_type]}>{INVENTORY_TRANSACTION_LABELS[row.transaction_type]}</Badge>
              </div>
              <div className="mt-3 grid gap-2 text-sm">
                <InfoLine label="Характеристики" value={variantSummary(row)} />
                <InfoLine label="Количество" value={quantityText(row)} strong={row.quantity < 0 ? 'down' : 'up'} />
                <InfoLine label="Машина" value={row.machine_name || '-'} />
                <InfoLine label="Поставщик" value={row.supplier_name || '-'} />
                <InfoLine label="Кто" value={row.user_name || '-'} />
                <InfoLine label="Комментарий" value={row.comment || '-'} />
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
  const maxDelta = Math.max(1, ...overview.trend.map((point) => Math.abs(point.deltaWeightKg)))
  const showLabels = overview.trend.length <= 45

  return (
    <div className="mt-5">
      <div className="flex h-36 items-end gap-1 border-b border-[#E8ECF0] pb-2">
        {overview.trend.map((point) => {
          const height = Math.max(4, Math.round((Math.abs(point.deltaWeightKg) / maxDelta) * 104))
          const color = point.deltaWeightKg > 0 ? 'bg-emerald-500' : point.deltaWeightKg < 0 ? 'bg-red-500' : 'bg-slate-300'
          return (
            <div key={point.date} className="group flex min-w-[5px] flex-1 flex-col items-center justify-end">
              <div className="hidden rounded-md border border-[#E0E7EF] bg-white px-2 py-1 text-xs text-[#334155] shadow-sm group-hover:block">
                {formatDate(point.date)}: {signedKg(point.deltaWeightKg)}
              </div>
              <div className={`w-full max-w-5 rounded-t-sm ${color}`} style={{ height }} />
            </div>
          )
        })}
      </div>
      {showLabels && (
        <div className="mt-2 flex justify-between text-xs text-[#94A3B8]">
          <span>{formatDate(overview.period.from)}</span>
          <span>{formatDate(overview.period.to)}</span>
        </div>
      )}
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
  page: number,
) {
  const params = new URLSearchParams()
  if (factoryId) params.set('factory', factoryId)
  params.set('from', overview.period.from)
  params.set('to', overview.period.to)
  if (transactionType) params.set('type', transactionType)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `${ROUTES.INVENTORY_HISTORY}?${query}` : ROUTES.INVENTORY_HISTORY
}

function periodHref(overview: InventoryWarehouseHistoryOverview, factoryId: string | null, transactionType: InventoryTransactionType | null | undefined) {
  const params = new URLSearchParams()
  if (factoryId) params.set('factory', factoryId)
  params.set('from', overview.period.from)
  params.set('to', overview.period.to)
  if (transactionType) params.set('type', transactionType)
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

function variantSummary(row: InventoryTransactionWithRelations) {
  const variant = row.variant
  if (!variant) return '-'

  const values: Array<string | number | null | undefined> = []
  if (row.material_category === 'sheet_metal') values.push(variant.material_grade, variant.sheet_size, variant.thickness_mm ? `${variant.thickness_mm} мм` : null)
  else if (row.material_category === 'circle') values.push(variant.material_grade, variant.diameter_mm ? `Ø${variant.diameter_mm}` : null, variant.is_calibrated ? 'калибр.' : null)
  else if (row.material_category === 'pipe') {
    values.push(variant.pipe_type ? PIPE_SUBTYPE_LABELS[variant.pipe_type] ?? variant.pipe_type : null)
    if (variant.pipe_type === 'wire') values.push(variant.diameter_mm ? `Ø${variant.diameter_mm}` : null)
    else values.push(variant.piece_description, variant.wall_thickness_mm ? `${variant.wall_thickness_mm} мм` : null)
  } else if (row.material_category === 'knives') values.push(variant.knife_dimensions, variant.knife_material)
  else if (row.material_category === 'paint') values.push(variant.ral_code, variant.finish)
  else if (row.material_category === 'components') values.push(variant.specification, variant.diameter_mm ? `Ø${variant.diameter_mm}` : null)
  else if (row.material_category === 'mesh') values.push(variant.mesh_description, variant.mesh_length_mm ? `${variant.mesh_length_mm} мм` : null, variant.mesh_width_mm ? `${variant.mesh_width_mm} мм` : null)
  else if (row.material_category === 'chain_cord') values.push(variant.chain_cord_type ? CHAIN_CORD_SUBTYPE_LABELS[variant.chain_cord_type] ?? variant.chain_cord_type : null, variant.chain_cord_parameters)

  return values.filter(Boolean).join(', ') || '-'
}

function categoryLabel(category?: InventoryTransactionWithRelations['material_category'] | InventoryWarehouseHistoryCategorySummary['category'] | null) {
  if (!category) return '-'
  return MATERIAL_CATEGORY_LABELS[category] ?? category
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`))
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
