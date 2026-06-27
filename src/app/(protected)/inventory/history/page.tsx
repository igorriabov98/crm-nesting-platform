import { InventoryWarehouseHistoryPage } from '@/components/features/inventory/InventoryWarehouseHistoryPage'
import { getInventoryFactories, getTransactions, getWarehouseHistoryOverview } from '@/lib/actions/inventory'
import type { InventoryTransactionType } from '@/lib/types'

export const metadata = {
  title: 'История склада - CRM Завода',
}

type SearchParams = {
  factory?: string
  from?: string
  to?: string
  type?: string
  page?: string
}

const PAGE_SIZE = 50
const TRANSACTION_TYPES: InventoryTransactionType[] = ['receipt', 'reserve', 'unreserve', 'write_off', 'adjustment']

export default async function InventoryWarehouseHistoryRoute({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  const resolvedSearchParams = await searchParams
  const factoriesResult = await getInventoryFactories()
  const factories = factoriesResult.data || []
  const activeFactory = factories.find((factory) => factory.id === resolvedSearchParams?.factory) || factories[0] || null
  const activeFactoryId = activeFactory?.id || null
  const period = normalizePeriod(resolvedSearchParams?.from, resolvedSearchParams?.to)
  const page = Math.max(0, Number.isFinite(Number(resolvedSearchParams?.page)) ? Number(resolvedSearchParams?.page || 1) - 1 : 0)
  const transactionType = parseTransactionType(resolvedSearchParams?.type)

  const [overviewResult, transactionsResult] = await Promise.all([
    getWarehouseHistoryOverview({
      factory_id: activeFactoryId,
      from_date: period.from,
      to_date: period.to,
    }),
    getTransactions({
      factory_id: activeFactoryId,
      from_date: `${period.from}T00:00:00.000Z`,
      to_date: `${period.to}T23:59:59.999Z`,
      type: transactionType || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
  ])
  const pageError = factoriesResult.error || overviewResult.error || transactionsResult.error

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">История склада</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Все приходы, бронирования, снятия брони, списания и корректировки склада.</p>
      </div>
      {pageError || !overviewResult.data || !transactionsResult.pagination ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{pageError || 'Не удалось загрузить историю склада'}</div>
      ) : (
        <InventoryWarehouseHistoryPage
          overview={overviewResult.data}
          rows={transactionsResult.data || []}
          factories={factories}
          activeFactoryId={activeFactoryId}
          transactionType={transactionType}
          page={transactionsResult.pagination.page}
          pageSize={transactionsResult.pagination.pageSize}
          total={transactionsResult.pagination.total}
        />
      )}
    </div>
  )
}

function parseTransactionType(value?: string): InventoryTransactionType | null {
  if (!value) return null
  return TRANSACTION_TYPES.includes(value as InventoryTransactionType) ? value as InventoryTransactionType : null
}

function normalizePeriod(fromDate?: string, toDate?: string) {
  const today = new Date()
  const fallbackTo = dateOnly(today)
  const fallbackFrom = dateOnly(addDays(today, -29))
  const from = safeDateOnly(fromDate) || fallbackFrom
  const to = safeDateOnly(toDate) || fallbackTo
  return from <= to ? { from, to } : { from: to, to: from }
}

function safeDateOnly(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : value
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

function addDays(value: Date, days: number) {
  const next = new Date(value)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}
