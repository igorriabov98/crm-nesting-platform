import Link from 'next/link'
import { AlertTriangle, CalendarClock, PackageCheck, Search, Truck } from 'lucide-react'
import { withPagePermission } from '@/lib/permissions/page-guard'
import { ROUTES } from '@/lib/constants/routes'
import { loadSupplyDeadlinePageData, type SupplyDeadlineFilters } from '@/lib/reports/supply-deadlines'
import type { SupplyDeadlineRow } from '@/lib/reports/supply-deadline-projection'
import { SupplyDeadlineExclusionControl } from '@/components/features/reports/SupplyDeadlineExclusionControl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Недовоз и просрочка дедлайнов — CRM Leda' }
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | undefined>

const STATUS_LABELS: Record<SupplyDeadlineRow['status'], string> = {
  late_accepted: 'Принято поздно',
  not_received: 'Срок прошёл, остаток не принят',
  partial_receipt: 'Неполная приёмка',
  awaiting_plan: 'Ожидается по графику',
  without_schedule: 'Без графика',
}

function dateLabel(value: string | null) {
  if (!value) return 'Не указана'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value
}

function timeLabel(value: string | null) {
  if (!value) return 'Не принято'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Kyiv',
  }).format(new Date(value))
}

function quantity(value: number, unit: string) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)} ${unit}`
}

function href(filters: SupplyDeadlineFilters, updates: Partial<SupplyDeadlineFilters>) {
  const next = { ...filters, ...updates }
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(next)) {
    if (value !== '' && value !== 'all' && value !== undefined) params.set(key, String(value))
  }
  return `${ROUTES.REPORTS_SUPPLY_DEADLINES}?${params.toString()}`
}

function SourceLink({ row }: { row: SupplyDeadlineRow }) {
  const url = row.source.requestKind === 'stock'
    ? `${ROUTES.SUPPLY_ORDERS}/stock/${row.source.requestId}`
    : `${ROUTES.SUPPLY_REQUEST}/${row.source.requestId}`
  return <Link href={url} className="font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    {row.source.sourceName}
  </Link>
}

function DeadlineCase({ row, canManage }: { row: SupplyDeadlineRow; canManage: boolean }) {
  const late = row.status === 'late_accepted' || row.status === 'not_received'
  return (
    <article className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-foreground">{row.source.materialName}</h3>
            <Badge variant="outline" className={late ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'bg-muted text-foreground'}>
              {STATUS_LABELS[row.status]}
            </Badge>
            {row.exclusion && <Badge variant="secondary">Не учитывать в просрочке</Badge>}
          </div>
          {row.source.characteristics && <p className="break-words text-sm text-muted-foreground">{row.source.characteristics}</p>}
        </div>
        <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground">{row.source.factoryName}</span>
      </div>

      <dl className="mt-4 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">Заявка / машина</dt><dd className="mt-1 break-words"><SourceLink row={row} /></dd></div>
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">Поставщик</dt><dd className="mt-1 break-words font-medium">{row.supplierName || 'Не указан'}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{row.source.requestKind === 'stock' ? 'Срок потребности' : 'Срок Мат.плана'}</dt><dd className="mt-1 font-semibold tabular-nums">{row.deadline ? dateLabel(row.deadline) : 'Срок потребности не задан'}</dd></div>
        <div><dt className="text-xs text-muted-foreground">План начала «Заготовки»</dt><dd className="mt-1 font-medium tabular-nums">{row.source.requestKind === 'stock' ? 'Не относится к складской заявке' : dateLabel(row.cuttingStart)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{row.status === 'late_accepted' ? 'Исходный план поставки' : 'Потребность к закупке'}</dt><dd className="mt-1 font-medium tabular-nums">{quantity(row.plannedQuantity, row.source.unit)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Склад подтвердил</dt><dd className="mt-1 font-medium tabular-nums">{quantity(row.acceptedQuantity, row.source.unit)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Осталось принять</dt><dd className="mt-1 font-semibold tabular-nums">{quantity(row.outstandingQuantity, row.source.unit)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Факт приёмки</dt><dd className="mt-1 font-medium tabular-nums">{timeLabel(row.acceptedAt)}</dd></div>
      </dl>
      {row.futurePlannedQuantity > 0 && <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">Ещё запланировано: <strong>{quantity(row.futurePlannedQuantity, row.source.unit)}</strong>. Это не подтверждённый складом приход.</p>}
      {row.originDescription && <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{row.originDescription}</p>}
      {row.approximateDeadline && <p className="mt-3 text-xs text-amber-800">Исторический срок не подтверждён: использован текущий Мат.план.</p>}
      {row.exclusion && <p className="mt-3 rounded-md border bg-muted/50 px-3 py-2 text-sm">Причина исключения: {row.exclusion.reason}<span className="block text-xs text-muted-foreground">{row.exclusion.changed_by_name || 'Сотрудник'} · {timeLabel(row.exclusion.changed_at)}</span></p>}
      {canManage && <div className="mt-4"><SupplyDeadlineExclusionControl row={row} /></div>}
    </article>
  )
}

async function SupplyDeadlinesPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const data = await loadSupplyDeadlinePageData((await searchParams) || {})
  const { filters } = data
  const tabs = [
    { key: 'overdue' as const, label: 'Просрочка', count: data.counts.overdue, icon: CalendarClock },
    { key: 'shortages' as const, label: 'Недовоз', count: data.counts.shortages, icon: Truck },
    { key: 'excluded' as const, label: 'Исключено', count: data.counts.excluded, icon: PackageCheck },
  ]
  return (
    <div className="space-y-5 pb-8">
      <header className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start gap-3">
          <span className="rounded-xl bg-primary/10 p-2.5 text-primary"><AlertTriangle className="size-5" aria-hidden="true" /></span>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Недовоз и просрочка дедлайнов</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Срок Мат.плана, план «Заготовки» и фактическая приёмка складом по двум заводам. Непринятый материал и принятый с опозданием отмечены отдельно.</p>
          </div>
        </div>
      </header>

      <nav aria-label="Разделы отчёта" className="grid gap-2 sm:grid-cols-3">
        {tabs.map(({ key, label, count, icon: Icon }) => (
          <Link key={key} href={href(filters, { tab: key, status: 'all', page: 1 })}
            aria-current={filters.tab === key ? 'page' : undefined}
            className={`flex min-h-14 items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filters.tab === key ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-muted'}`}>
            <span className="flex items-center gap-2"><Icon className="size-4" aria-hidden="true" />{label}</span>
            <span className="rounded-full border border-current/20 px-2 py-0.5 tabular-nums">{count}</span>
          </Link>
        ))}
      </nav>

      <form action={ROUTES.REPORTS_SUPPLY_DEADLINES} method="get" className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <input type="hidden" name="tab" value={filters.tab} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1.5 text-sm font-medium">Материал, заявка или машина
            <span className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
              <input name="search" defaultValue={filters.search} maxLength={120} placeholder="Поиск по материалу"
                className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></span>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">Завод
            <select name="factory" defaultValue={filters.factory} className="h-11 min-w-0 rounded-md border border-input bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="all">Все доступные заводы</option>
              {data.factories.map((factory) => <option key={factory.id} value={factory.id}>{factory.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">Состояние
            <select name="status" defaultValue={filters.status} className="h-11 min-w-0 rounded-md border border-input bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="all">Все состояния</option>
              {(filters.tab === 'overdue' ? ['late_accepted', 'not_received'] : filters.tab === 'shortages' ? ['partial_receipt', 'awaiting_plan', 'without_schedule'] : Object.keys(STATUS_LABELS))
                .map((status) => <option key={status} value={status}>{STATUS_LABELS[status as SupplyDeadlineRow['status']]}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">Сортировать
            <select name="sort" defaultValue={filters.sort} className="h-11 min-w-0 rounded-md border border-input bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="deadline">По сроку Мат.плана</option><option value="accepted">По факту приёмки</option><option value="material">По материалу</option>
            </select>
          </label>
        </div>
        <details className="rounded-lg border bg-muted/30 p-3" open={Boolean(filters.deadlineFrom || filters.deadlineTo || filters.receiptFrom || filters.receiptTo || filters.supplier !== 'all' || filters.requestKind !== 'all')}>
          <summary className="cursor-pointer text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Дополнительные фильтры</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="grid gap-1 text-sm">Мат.план с<input type="date" name="deadlineFrom" defaultValue={filters.deadlineFrom} className="h-11 rounded-md border border-input bg-background px-3" /></label>
            <label className="grid gap-1 text-sm">Мат.план по<input type="date" name="deadlineTo" defaultValue={filters.deadlineTo} className="h-11 rounded-md border border-input bg-background px-3" /></label>
            <label className="grid gap-1 text-sm">Поставщик<select name="supplier" defaultValue={filters.supplier} className="h-11 min-w-0 rounded-md border border-input bg-background px-3"><option value="all">Все поставщики</option>{data.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
            <label className="grid gap-1 text-sm">Приёмка с<input type="date" name="receiptFrom" defaultValue={filters.receiptFrom} className="h-11 rounded-md border border-input bg-background px-3" /></label>
            <label className="grid gap-1 text-sm">Приёмка по<input type="date" name="receiptTo" defaultValue={filters.receiptTo} className="h-11 rounded-md border border-input bg-background px-3" /></label>
            <label className="grid gap-1 text-sm">Вид заявки<select name="requestKind" defaultValue={filters.requestKind} className="h-11 rounded-md border border-input bg-background px-3"><option value="all">Машины и склад</option><option value="machine">Под машину</option><option value="stock">На склад</option></select></label>
          </div>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">Применить фильтры</Button>
          <Button render={<Link href={href(filters, { tab: filters.tab, factory: 'all', status: 'all', search: '', supplier: 'all', requestKind: 'all', deadlineFrom: '', deadlineTo: '', receiptFrom: '', receiptTo: '', sort: 'deadline', page: 1 })} />} variant="outline">Сбросить</Button>
        </div>
      </form>

      <section aria-label={tabs.find((tab) => tab.key === filters.tab)?.label} className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p className="text-sm text-muted-foreground">Найдено случаев: <strong className="text-foreground tabular-nums">{data.total}</strong>. Количества указаны в единицах каждой позиции.</p>
          <p className="text-xs text-muted-foreground">Сформировано {timeLabel(data.generatedAt)}</p>
        </div>
        {data.rows.length === 0 ? (
          <div className="rounded-2xl border bg-card px-5 py-12 text-center text-sm text-muted-foreground">
            {data.factories.length === 0 ? 'Для отчёта не выдан доступ ни к одному заводу.' : 'По выбранным фильтрам случаев нет.'}
          </div>
        ) : data.rows.map((row) => <DeadlineCase key={row.id} row={row} canManage={data.canManageFactoryIds.includes(row.source.factoryId)} />)}
      </section>

      {data.pageCount > 1 && <nav aria-label="Страницы отчёта" className="flex items-center justify-center gap-3 text-sm">
        {filters.page > 1 && <Button render={<Link href={href(filters, { page: filters.page - 1 })} />} variant="outline">Назад</Button>}
        <span className="tabular-nums">Страница {filters.page} из {data.pageCount}</span>
        {filters.page < data.pageCount && <Button render={<Link href={href(filters, { page: filters.page + 1 })} />} variant="outline">Вперёд</Button>}
      </nav>}
    </div>
  )
}

export default withPagePermission(ROUTES.REPORTS_SUPPLY_DEADLINES, SupplyDeadlinesPage)
