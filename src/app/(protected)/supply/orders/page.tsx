import Link from 'next/link'
import { ArrowLeft, ChartNoAxesColumnIncreasing, ClipboardList, History, PackageSearch } from 'lucide-react'
import { SupplyOrderHistoryPage } from '@/components/features/supply-orders/SupplyOrderHistoryPage'
import { SupplyOrdersPage } from '@/components/features/supply-orders/SupplyOrdersPage'
import { SupplyOrderSummaryPage } from '@/components/features/supply-orders/SupplyOrderSummaryPage'
import { getSupplyOrderAggregates, getSupplyOrderFactories, getSupplyOrderHistory, getSupplyOrders } from '@/lib/actions/supply-orders'
import { getSuppliers } from '@/lib/actions/suppliers'
import { ROUTES } from '@/lib/constants/routes'

export const metadata = {
  title: 'Что нужно заказать — CRM Завода',
}

export default async function SupplyOrdersRoute({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; view?: string; factory?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const page = Math.max(0, Number(resolvedSearchParams?.page || 1) - 1)
  const activeView = resolvedSearchParams?.view === 'details'
    ? 'details'
    : resolvedSearchParams?.view === 'history'
      ? 'history'
      : 'summary'

  return (
    <div className="space-y-5 pb-8">
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-7">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/15">
              <PackageSearch className="h-5 w-5" />
            </div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Управление закупками</div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Что нужно заказать</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Единое рабочее место снабжения: от потребности технолога до поставщика, графика, платежа и приемки на склад.
            </p>
          </div>
          <Link href={ROUTES.SUPPLY} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-medium text-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="h-4 w-4" />Вернуться в снабжение
          </Link>
        </div>
      </section>

      <nav className="grid grid-cols-1 gap-2 rounded-2xl border border-border/70 bg-card p-2 shadow-sm sm:grid-cols-3" aria-label="Режим представления заказов">
        <Link
          href={`${ROUTES.SUPPLY_ORDERS}?view=details`}
          className={viewLinkClass(activeView === 'details')}
          aria-current={activeView === 'details' ? 'page' : undefined}
        >
          <ClipboardList className="h-4 w-4" />
          <span><strong>По заявкам</strong><small>Позиции и действия</small></span>
        </Link>
        <Link
          href={ROUTES.SUPPLY_ORDERS}
          className={viewLinkClass(activeView === 'summary')}
          aria-current={activeView === 'summary' ? 'page' : undefined}
        >
          <ChartNoAxesColumnIncreasing className="h-4 w-4" />
          <span><strong>Итоги по дню</strong><small>Сводка Мат.план</small></span>
        </Link>
        <Link
          href={`${ROUTES.SUPPLY_ORDERS}?view=history`}
          className={viewLinkClass(activeView === 'history')}
          aria-current={activeView === 'history' ? 'page' : undefined}
        >
          <History className="h-4 w-4" />
          <span><strong>История</strong><small>Принятые поставки</small></span>
        </Link>
      </nav>

      {activeView === 'summary'
        ? <SummaryView requestedFactoryId={resolvedSearchParams?.factory || null} />
        : activeView === 'history'
          ? <HistoryView page={page} />
        : <DetailsView page={page} />}
    </div>
  )
}

function viewLinkClass(isActive: boolean) {
  return [
    'inline-flex min-h-16 items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_small]:mt-0.5 [&_small]:block [&_small]:text-xs [&_small]:font-normal [&_strong]:block [&_strong]:font-semibold',
    isActive
      ? 'bg-primary text-primary-foreground shadow-sm [&_small]:text-primary-foreground/75'
      : 'text-primary hover:bg-muted [&_small]:text-muted-foreground',
  ].join(' ')
}

async function SummaryView({ requestedFactoryId }: { requestedFactoryId: string | null }) {
  const factoriesPromise = getSupplyOrderFactories()
  const suppliersPromise = getSuppliers({ active_only: true })
  const { data: factories, error: factoriesError } = await factoriesPromise

  if (factoriesError) {
    return <div role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">{factoriesError}</div>
  }

  const availableFactories = factories || []
  const requestedFactory = availableFactories.find((factory) => factory.id === requestedFactoryId)
  const defaultFactory = availableFactories.find((factory) => {
    const name = factory.name.toLowerCase()
    return name.includes('берег') || name.includes('bereg')
  }) || availableFactories[0] || null
  const activeFactoryId = requestedFactory?.id || defaultFactory?.id || null

  const [{ data: aggregates, error }, { data: suppliers }] = await Promise.all([
    getSupplyOrderAggregates(activeFactoryId),
    suppliersPromise,
  ])

  if (error) {
    return <div role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
  }

  return (
    <SupplyOrderSummaryPage
      aggregates={aggregates || []}
      factories={availableFactories}
      activeFactoryId={activeFactoryId}
      suppliers={suppliers || []}
    />
  )
}

async function HistoryView({ page }: { page: number }) {
  const { data: history, error, pagination } = await getSupplyOrderHistory(page, 50)

  if (error) {
    return <div role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
  }

  return (
    <SupplyOrderHistoryPage
      items={history || []}
      page={pagination?.page || page}
      pageSize={pagination?.pageSize || 50}
      total={pagination?.total || 0}
    />
  )
}

async function DetailsView({ page }: { page: number }) {
  const [{ data: orders, error, pagination }, { data: suppliers }] = await Promise.all([
    getSupplyOrders(page, 50),
    getSuppliers({ active_only: true }),
  ])

  if (error) {
    return <div role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
  }

  return (
    <SupplyOrdersPage
      items={orders || []}
      suppliers={suppliers || []}
      page={pagination?.page || page}
      pageSize={pagination?.pageSize || 50}
      total={pagination?.total || 0}
    />
  )
}
