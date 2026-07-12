import Link from 'next/link'
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
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1B3A6B]">Что нужно заказать</h1>
          <p className="text-sm text-[#6B7280]">
            Позиции из заявок технолога: детальный список и итоги по дню Мат.план.
          </p>
        </div>
        <Link href={ROUTES.SUPPLY} className="text-sm font-medium text-[#1B3A6B] hover:underline">
          Вернуться в снабжение
        </Link>
      </div>

      <div className="flex w-full overflow-x-auto rounded-lg border border-[#E8ECF0] bg-white p-1 sm:w-fit">
        <Link
          href={`${ROUTES.SUPPLY_ORDERS}?view=details`}
          className={viewLinkClass(activeView === 'details')}
          aria-current={activeView === 'details' ? 'page' : undefined}
        >
          По заявкам
        </Link>
        <Link
          href={ROUTES.SUPPLY_ORDERS}
          className={viewLinkClass(activeView === 'summary')}
          aria-current={activeView === 'summary' ? 'page' : undefined}
        >
          Итоги по дню
        </Link>
        <Link
          href={`${ROUTES.SUPPLY_ORDERS}?view=history`}
          className={viewLinkClass(activeView === 'history')}
          aria-current={activeView === 'history' ? 'page' : undefined}
        >
          История
        </Link>
      </div>

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
    'inline-flex min-h-10 shrink-0 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/30',
    isActive
      ? 'bg-[#1B3A6B] text-white'
      : 'text-[#1B3A6B] hover:bg-[#EFF6FF]',
  ].join(' ')
}

async function SummaryView({ requestedFactoryId }: { requestedFactoryId: string | null }) {
  const factoriesPromise = getSupplyOrderFactories()
  const suppliersPromise = getSuppliers({ active_only: true })
  const { data: factories, error: factoriesError } = await factoriesPromise

  if (factoriesError) {
    return <div className="rounded-lg bg-red-500/10 p-4 text-sm text-[#DC2626]">{factoriesError}</div>
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
    return <div className="rounded-lg bg-red-500/10 p-4 text-sm text-[#DC2626]">{error}</div>
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
    return <div className="rounded-lg bg-red-500/10 p-4 text-sm text-[#DC2626]">{error}</div>
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
    return <div className="rounded-lg bg-red-500/10 p-4 text-sm text-[#DC2626]">{error}</div>
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
