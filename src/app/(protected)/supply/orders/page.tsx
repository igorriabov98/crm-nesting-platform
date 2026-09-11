import Link from 'next/link'
import { ArrowLeft, ChartNoAxesColumnIncreasing, ClipboardList, History } from 'lucide-react'
import { SupplyOrderHistoryPage } from '@/components/features/supply-orders/SupplyOrderHistoryPage'
import { SupplyOrderFactoryToggle } from '@/components/features/supply-orders/SupplyOrderFactoryToggle'
import { SupplyOrdersPage } from '@/components/features/supply-orders/SupplyOrdersPage'
import { SupplyOrderSummaryPage } from '@/components/features/supply-orders/SupplyOrderSummaryPage'
import {
  getSupplyOrderAggregates,
  getSupplyOrderFactories,
  getSupplyOrderHistory,
  getSupplyOrderRequestFactoryId,
  getSupplyOrders,
  type MaterialReceivingFactory,
} from '@/lib/actions/supply-orders'
import { getSuppliers } from '@/lib/actions/suppliers'
import { ROUTES } from '@/lib/constants/routes'
import { normalizeSupplyRequestId } from '@/lib/supply-request-flow'

export const metadata = {
  title: 'Заказы снабжения — CRM Завода',
}

export default async function SupplyOrdersRoute({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; view?: string; factory?: string; request?: string; focus?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const page = Math.max(0, Number(resolvedSearchParams?.page || 1) - 1)
  const requestedRequestId = normalizeSupplyRequestId(resolvedSearchParams?.request)
  const activeView = resolvedSearchParams?.view === 'details'
    ? 'details'
    : resolvedSearchParams?.view === 'history'
      ? 'history'
      : 'summary'
  const { data: factories, error: factoriesError } = await getSupplyOrderFactories()
  const availableFactories = factories || []
  const requestFactory = activeView === 'details' && requestedRequestId
    ? await getSupplyOrderRequestFactoryId(requestedRequestId)
    : { data: null, error: null }
  const activeFactoryId = resolveActiveFactoryId(
    availableFactories,
    requestFactory.data || resolvedSearchParams?.factory || null,
  )
  const viewDescription = activeView === 'details'
    ? 'Каждая строка — отдельная заявка машины: характеристики материала, потребность и состояние поставки.'
    : activeView === 'history'
      ? 'Принятые поставки и завершённые операции снабжения.'
      : 'Сводный объём по материалам, заводам и датам поставки.'

  return (
    <div className="space-y-4 pb-8">
      <section className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Заказы снабжения</h1>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">{viewDescription}</p>
        </div>
        <Link href={ROUTES.SUPPLY} className="inline-flex min-h-10 w-fit shrink-0 items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-medium text-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="h-4 w-4" />В снабжение
        </Link>
      </section>

      <nav className="grid grid-cols-1 gap-1 rounded-2xl border border-border/70 bg-card p-1.5 shadow-sm sm:grid-cols-3" aria-label="Режим представления заказов">
        <Link
          href={supplyOrdersViewHref('details', activeFactoryId)}
          className={viewLinkClass(activeView === 'details')}
          aria-current={activeView === 'details' ? 'page' : undefined}
        >
          <ClipboardList className="h-4 w-4" />
          <span><strong>По заявкам</strong><small>Позиции и действия</small></span>
        </Link>
        <Link
          href={supplyOrdersViewHref('summary', activeFactoryId)}
          className={viewLinkClass(activeView === 'summary')}
          aria-current={activeView === 'summary' ? 'page' : undefined}
        >
          <ChartNoAxesColumnIncreasing className="h-4 w-4" />
          <span><strong>Итоги по дню</strong><small>Сводка Мат.план</small></span>
        </Link>
        <Link
          href={supplyOrdersViewHref('history', activeFactoryId)}
          className={viewLinkClass(activeView === 'history')}
          aria-current={activeView === 'history' ? 'page' : undefined}
        >
          <History className="h-4 w-4" />
          <span><strong>История</strong><small>Принятые поставки</small></span>
        </Link>
      </nav>

      {activeView === 'summary'
        ? <SummaryView factories={availableFactories} activeFactoryId={activeFactoryId} factoriesError={factoriesError} />
        : activeView === 'history'
          ? <HistoryView page={page} factoryId={activeFactoryId} />
        : <DetailsView
            page={page}
            requestId={requestedRequestId}
            factoryId={activeFactoryId}
            focusedId={resolvedSearchParams?.focus || null}
            factories={availableFactories}
            factoriesError={factoriesError || requestFactory.error}
          />}
    </div>
  )
}

function viewLinkClass(isActive: boolean) {
  return [
    'inline-flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_small]:mt-0.5 [&_small]:block [&_small]:text-xs [&_small]:font-normal [&_strong]:block [&_strong]:font-semibold',
    isActive
      ? 'bg-primary text-primary-foreground shadow-sm [&_small]:text-primary-foreground/75'
      : 'text-primary hover:bg-muted [&_small]:text-muted-foreground',
  ].join(' ')
}

async function SummaryView({
  factories,
  activeFactoryId,
  factoriesError,
}: {
  factories: MaterialReceivingFactory[]
  activeFactoryId: string | null
  factoriesError: string | null
}) {
  const suppliersPromise = getSuppliers({ active_only: true })

  if (factoriesError) {
    return <div role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">{factoriesError}</div>
  }

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
      factories={factories}
      activeFactoryId={activeFactoryId}
      suppliers={suppliers || []}
    />
  )
}

async function HistoryView({ page, factoryId }: { page: number; factoryId: string | null }) {
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
      factoryId={factoryId}
    />
  )
}

async function DetailsView({
  page,
  requestId,
  factoryId,
  focusedId,
  factories,
  factoriesError,
}: {
  page: number
  requestId: string | null
  factoryId: string | null
  focusedId: string | null
  factories: MaterialReceivingFactory[]
  factoriesError: string | null
}) {
  if (factoriesError) {
    return <div role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">{factoriesError}</div>
  }

  const [
    { data: orders, error, pagination },
    { data: aggregates, error: aggregatesError },
    { data: suppliers },
  ] = await Promise.all([
    getSupplyOrders(page, 50, requestId, factoryId),
    getSupplyOrderAggregates(factoryId),
    getSuppliers({ active_only: true }),
  ])

  if (error || aggregatesError) {
    return <div role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">{error || aggregatesError}</div>
  }

  return (
    <div className="space-y-4">
      <SupplyOrderFactoryToggle factories={factories} activeFactoryId={factoryId} view="details" />
      {requestId && (
        <section className="flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Показана выбранная заявка</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">На странице оставлены только позиции текущего заказа снабжения.</p>
          </div>
          <Link
            href={supplyOrdersViewHref('details', factoryId)}
            className="w-fit rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Показать все заявки
          </Link>
        </section>
      )}
      <SupplyOrdersPage
        items={orders || []}
        aggregates={aggregates || []}
        suppliers={suppliers || []}
        page={pagination?.page || page}
        pageSize={pagination?.pageSize || 50}
        total={pagination?.total || 0}
        initialStatus={focusedId ? 'all' : undefined}
        emptyMessage={requestId ? 'По этой заявке нет позиций к заказу: потребность полностью закрыта складом.' : undefined}
      />
    </div>
  )
}

function resolveActiveFactoryId(factories: MaterialReceivingFactory[], requestedFactoryId: string | null) {
  const requestedFactory = factories.find((factory) => factory.id === requestedFactoryId)
  const defaultFactory = factories.find((factory) => {
    const name = factory.name.toLowerCase()
    return name.includes('берег') || name.includes('bereg')
  }) || factories[0] || null
  return requestedFactory?.id || defaultFactory?.id || null
}

function supplyOrdersViewHref(view: 'details' | 'summary' | 'history', factoryId: string | null) {
  const params = new URLSearchParams({ view })
  if (factoryId) params.set('factory', factoryId)
  return `${ROUTES.SUPPLY_ORDERS}?${params.toString()}`
}
