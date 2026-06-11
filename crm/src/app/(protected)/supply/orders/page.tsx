import Link from 'next/link'
import { SupplyOrdersPage } from '@/components/features/supply-orders/SupplyOrdersPage'
import { getSupplyOrders } from '@/lib/actions/supply-orders'
import { getSuppliers } from '@/lib/actions/suppliers'
import { ROUTES } from '@/lib/constants/routes'

export const metadata = {
  title: 'Что нужно заказать — CRM Завода',
}

export default async function SupplyOrdersRoute({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const page = Math.max(0, Number(resolvedSearchParams?.page || 1) - 1)
  const [{ data: orders, error, pagination }, { data: suppliers }] = await Promise.all([
    getSupplyOrders(page, 50),
    getSuppliers({ active_only: true }),
  ])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1B3A6B]">Что нужно заказать</h1>
          <p className="text-sm text-[#6B7280]">Позиции из заявок технолога, сгруппированные по дате поставки и поставщику.</p>
        </div>
        <Link href={ROUTES.SUPPLY} className="text-sm font-medium text-[#1B3A6B] hover:underline">
          Вернуться в снабжение
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg bg-red-500/10 p-4 text-sm text-[#DC2626]">{error}</div>
      ) : (
        <SupplyOrdersPage
          items={orders || []}
          suppliers={suppliers || []}
          page={pagination?.page || page}
          pageSize={pagination?.pageSize || 50}
          total={pagination?.total || 0}
        />
      )}
    </div>
  )
}
