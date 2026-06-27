import Link from 'next/link'
import type { ReactNode } from 'react'
import { CalendarDays, CheckCircle2, ExternalLink, Factory, PackageCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { SupplyOrderHistoryItem } from '@/lib/actions/supply-orders'
import { MATERIAL_CATEGORY_LABELS } from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'

type SupplyOrderHistoryPageProps = {
  items: SupplyOrderHistoryItem[]
  page: number
  pageSize: number
  total: number
}

export function SupplyOrderHistoryPage({ items, page, pageSize, total }: SupplyOrderHistoryPageProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentFrom = total === 0 ? 0 : page * pageSize + 1
  const currentTo = Math.min(total, (page + 1) * pageSize)

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
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

      {items.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <PackageCheck className="h-5 w-5" />
          </div>
          <div className="mt-3 font-medium text-slate-950">В истории пока нет принятых поставок</div>
          <div className="mt-1 text-sm text-slate-600">
            После приемки на склад строки появятся здесь автоматически.
          </div>
        </div>
      ) : (
        <>
          <div className="hidden lg:block">
            <div className="grid grid-cols-[minmax(160px,1fr)_minmax(220px,1.4fr)_130px_150px_150px_120px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase text-slate-500">
              <span>Машина</span>
              <span>Материал</span>
              <span>Заявка</span>
              <span>План поставки</span>
              <span>Принято</span>
              <span className="text-right">Количество</span>
            </div>
            <div className="divide-y divide-slate-100">
              {items.map((item) => (
                <HistoryRow key={item.id} item={item} />
              ))}
            </div>
          </div>

          <div className="grid gap-3 p-3 lg:hidden">
            {items.map((item) => (
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
  return (
    <div className="min-w-0">
      <div className="font-medium text-slate-950">{item.item_name}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
          {MATERIAL_CATEGORY_LABELS[item.category]}
        </Badge>
        {item.weight_kg ? <span className="tabular-nums">{formatAmount(item.weight_kg)} кг</span> : null}
      </div>
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
