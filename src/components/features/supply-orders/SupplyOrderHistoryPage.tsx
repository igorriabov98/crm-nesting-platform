'use client'

import Link from 'next/link'
import { useMemo, useState, type ReactNode } from 'react'
import { CalendarDays, CheckCircle2, ExternalLink, Factory, PackageCheck, RotateCcw, Search, SlidersHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SupplyOrderHistoryItem } from '@/lib/actions/supply-orders'
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABELS } from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'
import { filterAndSortHistory, type HistoryFiltersState, type SupplyOrderHistorySort } from './supply-order-view'

type SupplyOrderHistoryPageProps = {
  items: SupplyOrderHistoryItem[]
  page: number
  pageSize: number
  total: number
}

export function SupplyOrderHistoryPage({ items, page, pageSize, total }: SupplyOrderHistoryPageProps) {
  const defaultFilters = useMemo<HistoryFiltersState>(() => ({ query: '', supplier: 'all', category: 'all', sort: 'accepted_desc' }), [])
  const [filters, setFilters] = useState<HistoryFiltersState>(defaultFilters)
  const visibleItems = useMemo(() => filterAndSortHistory(items, filters), [filters, items])
  const suppliers = useMemo(() => Array.from(new Set(items.map((item) => item.supplier_name || 'none')))
    .sort((left, right) => left.localeCompare(right, 'ru')), [items])
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentFrom = total === 0 ? 0 : page * pageSize + 1
  const currentTo = Math.min(total, (page + 1) * pageSize)

  return (
    <div className="space-y-4">
      <HistoryFilters
        value={filters}
        suppliers={suppliers}
        resultCount={visibleItems.length}
        totalCount={items.length}
        onChange={setFilters}
        onReset={() => setFilters(defaultFilters)}
      />
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">История приемки металла</h2>
          <p className="mt-1 text-sm text-slate-600">
            Принятые на склад поставки из заказов снабжения.
          </p>
        </div>
        <div className="inline-flex min-h-10 w-fit items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-800">
          <PackageCheck className="h-4 w-4" />
          {total} {pluralize(total, 'поставка', 'поставки', 'поставок')}
        </div>
      </div>

      {visibleItems.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <PackageCheck className="h-5 w-5" />
          </div>
          <div className="mt-3 font-medium text-slate-950">{items.length === 0 ? 'В истории пока нет принятых поставок' : 'По выбранным фильтрам ничего не найдено'}</div>
          <div className="mt-1 text-sm text-slate-600">
            {items.length === 0 ? 'После приемки на склад строки появятся здесь автоматически.' : 'Измените условия поиска или сбросьте фильтры.'}
          </div>
          {items.length > 0 && <Button type="button" variant="outline" className="mt-4" onClick={() => setFilters(defaultFilters)}>Сбросить фильтры</Button>}
        </div>
      ) : (
        <>
          <div className="hidden lg:block">
            <div className="grid grid-cols-[minmax(160px,1fr)_minmax(220px,1.4fr)_130px_150px_150px_120px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase text-slate-500">
              <span>Машина</span>
              <span>Материал</span>
              <span>Заявка</span>
              <span>План поставки</span>
              <span role="columnheader" aria-sort={filters.sort === 'accepted_asc' ? 'ascending' : filters.sort === 'accepted_desc' ? 'descending' : 'none'}>
                <button
                  type="button"
                  className="w-fit rounded-sm text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setFilters((current) => ({ ...current, sort: current.sort === 'accepted_desc' ? 'accepted_asc' : 'accepted_desc' }))}
                >
                  Принято {filters.sort === 'accepted_asc' ? '↑' : filters.sort === 'accepted_desc' ? '↓' : ''}
                </button>
              </span>
              <span className="text-right">Количество</span>
            </div>
            <div className="divide-y divide-slate-100">
              {visibleItems.map((item) => (
                <HistoryRow key={item.id} item={item} />
              ))}
            </div>
          </div>

          <div className="grid gap-3 p-3 lg:hidden">
            {visibleItems.map((item) => (
              <HistoryCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}

      <div className="flex flex-col gap-2 border-t border-slate-200 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Показано {currentFrom}-{currentTo} из {total}. Страница {page + 1} из {pageCount}.
        </span>
        <div className="flex gap-2">
          <PaginationLink page={page - 1} disabled={page <= 0}>
            Назад
          </PaginationLink>
          <PaginationLink page={page + 1} disabled={page + 1 >= pageCount}>
            Вперед
          </PaginationLink>
        </div>
      </div>
    </section>
    </div>
  )
}

const historySortLabels: Record<SupplyOrderHistorySort, string> = {
  accepted_desc: 'Принято: сначала новые',
  accepted_asc: 'Принято: сначала старые',
  material_asc: 'Материал: А–Я',
  quantity_desc: 'Количество: по убыванию',
}

function HistoryFilters({ value, suppliers, resultCount, totalCount, onChange, onReset }: {
  value: HistoryFiltersState
  suppliers: string[]
  resultCount: number
  totalCount: number
  onChange: (value: HistoryFiltersState) => void
  onReset: () => void
}) {
  const activeCount = [value.query, value.supplier !== 'all', value.category !== 'all', value.sort !== 'accepted_desc'].filter(Boolean).length
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm" aria-label="Фильтры истории поставок">
      <div className="flex flex-col gap-3 border-b border-border/60 bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><SlidersHorizontal className="h-4 w-4" /></div>
          <div><h2 className="text-sm font-semibold text-foreground">Поиск в истории</h2><p className="text-xs text-muted-foreground">Показано {resultCount} из {totalCount} на странице</p></div>
        </div>
        <Button type="button" variant="ghost" size="sm" className="min-h-9 justify-start" disabled={activeCount === 0} onClick={onReset}><RotateCcw className="h-4 w-4" />Сбросить{activeCount > 0 ? ` (${activeCount})` : ''}</Button>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-12">
        <label className="grid gap-1.5 md:col-span-2 xl:col-span-4">
          <span className="text-xs font-medium text-muted-foreground">Поиск</span>
          <span className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input type="search" value={value.query} onChange={(event) => onChange({ ...value, query: event.target.value })} placeholder="Материал, машина, характеристика" className="h-11 pl-9" /></span>
        </label>
        <HistoryFilterSelect
          className="xl:col-span-3"
          label="Поставщик"
          value={value.supplier}
          display={value.supplier === 'all' ? 'Все поставщики' : value.supplier === 'none' ? 'Без поставщика' : value.supplier}
          items={[['all', 'Все поставщики'], ...suppliers.map((supplier) => [supplier, supplier === 'none' ? 'Без поставщика' : supplier])]}
          onValueChange={(supplier) => onChange({ ...value, supplier })}
        />
        <HistoryFilterSelect
          className="xl:col-span-2"
          label="Категория"
          value={value.category}
          display={value.category === 'all' ? 'Все категории' : MATERIAL_CATEGORY_LABELS[value.category]}
          items={[['all', 'Все категории'], ...MATERIAL_CATEGORIES.map((category) => [category, MATERIAL_CATEGORY_LABELS[category]])]}
          onValueChange={(category) => onChange({ ...value, category: category as HistoryFiltersState['category'] })}
        />
        <HistoryFilterSelect
          className="xl:col-span-3"
          label="Сортировка"
          value={value.sort}
          display={historySortLabels[value.sort]}
          items={Object.entries(historySortLabels)}
          onValueChange={(sort) => onChange({ ...value, sort: sort as SupplyOrderHistorySort })}
        />
      </div>
    </section>
  )
}

function HistoryFilterSelect({ label, value, display, items, onValueChange, className }: {
  label: string
  value: string
  display: string
  items: string[][]
  onValueChange: (value: string) => void
  className?: string
}) {
  return (
    <label className={`grid min-w-0 gap-1.5 ${className || ''}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue || '')}>
        <SelectTrigger className="h-11 w-full bg-background"><SelectValue>{display}</SelectValue></SelectTrigger>
        <SelectContent>{items.map(([itemValue, itemLabel]) => <SelectItem key={itemValue} value={itemValue}>{itemLabel}</SelectItem>)}</SelectContent>
      </Select>
    </label>
  )
}

function HistoryRow({ item }: { item: SupplyOrderHistoryItem }) {
  return (
    <div className="grid grid-cols-[minmax(160px,1fr)_minmax(220px,1.4fr)_130px_150px_150px_120px] items-center gap-3 px-4 py-3 text-sm">
      <MachineLink item={item} />
      <MaterialSummary item={item} />
      <RequestLink requestId={item.request_id} />
      <DateStack
        primary={formatDate(item.planned_delivery_date)}
        secondary={item.planned_material_date ? `Мат.план: ${formatDate(item.planned_material_date)}` : 'Мат.план не указан'}
      />
      <DateStack
        primary={formatDateTime(item.accepted_at)}
        secondary={item.source === 'schedule' ? 'Строка графика' : 'Позиция целиком'}
        success
      />
      <div className="text-right font-semibold tabular-nums text-slate-950">
        {formatAmount(item.quantity)} {item.unit}
      </div>
    </div>
  )
}

function HistoryCard({ item }: { item: SupplyOrderHistoryItem }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <MachineLink item={item} />
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
          Принято
        </Badge>
      </div>
      <div className="mt-3">
        <MaterialSummary item={item} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <DataPoint label="План поставки" value={formatDate(item.planned_delivery_date)} icon={<CalendarDays className="h-4 w-4" />} />
        <DataPoint label="Принято" value={formatDateTime(item.accepted_at)} icon={<CheckCircle2 className="h-4 w-4" />} />
        <DataPoint label="Мат.план" value={formatDate(item.planned_material_date)} />
        <DataPoint label="Количество" value={`${formatAmount(item.quantity)} ${item.unit}`} />
      </dl>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <div className="min-w-0 text-xs text-slate-500">
          {item.supplier_name || 'Поставщик не указан'}
        </div>
        <RequestLink requestId={item.request_id} />
      </div>
    </article>
  )
}

function MachineLink({ item }: { item: SupplyOrderHistoryItem }) {
  return (
    <div className="min-w-0">
      <Link
        href={`${ROUTES.SALES_PLAN}/${item.machine_id}`}
        className="inline-flex max-w-full items-center gap-2 font-semibold text-[#1B3A6B] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/30"
      >
        <Factory className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.machine_name}</span>
      </Link>
      <div className="mt-1 truncate text-xs text-slate-500">
        {item.supplier_name || 'Поставщик не указан'}
      </div>
    </div>
  )
}

function MaterialSummary({ item }: { item: SupplyOrderHistoryItem }) {
  const characteristics = item.characteristics.filter((part) => !(part.label === 'Позиция' && part.value === item.item_name))

  return (
    <div className="min-w-0">
      <div className="font-medium text-slate-950">{item.item_name}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
          {MATERIAL_CATEGORY_LABELS[item.category]}
        </Badge>
        {item.weight_kg ? <span className="tabular-nums">{formatAmount(item.weight_kg)} кг</span> : null}
      </div>
      {characteristics.length > 0 ? (
        <dl className="mt-2 flex flex-wrap gap-1.5">
          {characteristics.map((part) => (
            <div key={`${part.label}:${part.value}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-xs leading-5 text-slate-700 ring-1 ring-inset ring-slate-200">
              <dt className="shrink-0 text-slate-500">{part.label}:</dt>
              <dd className="min-w-0 break-words font-medium text-slate-900">{part.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

function RequestLink({ requestId }: { requestId: string }) {
  return (
    <Link
      href={`${ROUTES.SUPPLY_REQUEST}/${requestId}`}
      className="inline-flex min-h-9 w-fit items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-[#1B3A6B] transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/30"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      Заявка
    </Link>
  )
}

function DateStack({ primary, secondary, success = false }: { primary: string; secondary: string; success?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={success ? 'font-semibold tabular-nums text-emerald-800' : 'font-semibold tabular-nums text-slate-950'}>
        {primary}
      </div>
      <div className="mt-1 truncate text-xs text-slate-500">{secondary}</div>
    </div>
  )
}

function DataPoint({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-xs text-slate-500">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 font-semibold tabular-nums text-slate-950">{value}</dd>
    </div>
  )
}

function PaginationLink({ page, disabled, children }: { page: number; disabled: boolean; children: ReactNode }) {
  const className = 'inline-flex min-h-9 items-center justify-center rounded-md border border-slate-200 px-3 text-sm font-medium text-[#1B3A6B]'
  if (disabled) {
    return <span className={`${className} cursor-not-allowed opacity-50`}>{children}</span>
  }
  return (
    <Link href={`${ROUTES.SUPPLY_ORDERS}?view=history&page=${page + 1}`} className={`${className} hover:bg-slate-50`}>
      {children}
    </Link>
  )
}

function formatDate(value: string | null) {
  if (!value) return 'Не указано'
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`)
  if (!Number.isFinite(date.getTime())) return 'Не указано'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

function formatDateTime(value: string | null) {
  if (!value) return 'Дата не записана'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Дата не записана'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatAmount(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}

function pluralize(value: number, one: string, few: string, many: string) {
  const mod10 = Math.abs(value) % 10
  const mod100 = Math.abs(value) % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
