import Link from 'next/link'
import { CalendarDays, ClipboardList, PackageCheck, Rows3 } from 'lucide-react'

import { MachineProgressBadge } from '@/components/features/machines/MachineStatusBadge'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ROUTES } from '@/lib/constants/routes'
import type { MyOrderProductionProgress } from '@/lib/my-orders-core'
import type { MyOrderSummary } from '@/lib/my-orders'

const weightFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 1,
})

function dateLabel(value: string | null) {
  if (!value) return 'Не указана'
  const [year, month, day] = value.slice(0, 10).split('-')
  return year && month && day ? `${day}.${month}.${year}` : value
}

function OrderName({ order }: { order: MyOrderSummary }) {
  if (!order.canOpenDetails) {
    return <span className="font-semibold text-slate-950">{order.name}</span>
  }
  return (
    <Link
      href={`${ROUTES.SALES_PLAN}/${order.id}`}
      className="inline-flex min-h-11 max-w-full items-center whitespace-normal break-words rounded-md font-semibold text-blue-900 underline-offset-4 transition-colors hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
      aria-label={`Открыть заказ ${order.name}`}
    >
      {order.name}
    </Link>
  )
}

function ProductionProgress({
  orderName,
  progress,
}: {
  orderName: string
  progress: MyOrderProductionProgress
}) {
  if (progress.state === 'legacy') {
    return (
      <div>
        <div className="font-medium text-amber-800">Нет точных данных</div>
        <div className="mt-1 text-xs leading-5 text-slate-500">Есть старый факт без количества</div>
      </div>
    )
  }
  if (progress.state === 'no_stages') {
    return (
      <div>
        <div className="font-medium text-slate-700">Нет рассчитываемых этапов</div>
        <div className="mt-1 text-xs leading-5 text-slate-500">Этапы пропущены или неприменимы</div>
      </div>
    )
  }

  const percentLabel = `${Math.round(progress.percent)}%`
  const weightLabel = `${weightFormatter.format(progress.completedKg)} из ${weightFormatter.format(progress.applicableKg)} кг`
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-semibold tabular-nums text-blue-950">{percentLabel}</span>
        <span className="text-xs tabular-nums text-slate-500">{weightLabel}</span>
      </div>
      <Progress
        value={Math.min(100, progress.percent)}
        className="w-full gap-0"
        indicatorClassName="bg-blue-700 motion-reduce:transition-none"
        aria-label={`Прогресс производства заказа ${orderName}`}
        aria-valuetext={`${percentLabel}, ${weightLabel}`}
      />
    </div>
  )
}

function MobileOrderCard({ order }: { order: MyOrderSummary }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="min-w-0">
        <OrderName order={order} />
        <p className="mt-1 break-words text-sm text-slate-500">{order.clientName || 'Клиент не указан'}</p>
        <MachineProgressBadge progress={order.status} className="mt-3 h-auto min-h-5 max-w-full overflow-visible whitespace-normal py-1 text-left leading-4" />
      </div>

      <div className="mt-4 border-t border-slate-100 pt-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Прогресс производства</div>
        <ProductionProgress orderName={order.name} progress={order.productionProgress} />
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
        <CalendarDays className="h-4 w-4 shrink-0 text-blue-800" aria-hidden="true" />
        <span className="text-slate-500">Плановая отгрузка</span>
        <span className="ml-auto font-medium tabular-nums text-slate-900">
          {dateLabel(order.desiredShippingDate)}
        </span>
      </div>
    </article>
  )
}

export function MyOrdersView({ orders }: { orders: MyOrderSummary[] }) {
  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl border border-blue-900/10 bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 px-5 py-6 text-white shadow-[0_20px_60px_rgba(30,64,175,0.18)] sm:px-6">
        <div className="absolute -right-12 -top-16 h-48 w-48 rounded-full border border-white/10 bg-white/5" />
        <div className="absolute -bottom-20 right-24 h-44 w-44 rounded-full border border-white/10" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">
              <ClipboardList className="h-4 w-4" aria-hidden="true" />
              Контроль заказов
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Мои заказы</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">
              Заказы без даты получения клиентом, за которыми вы отвечаете или которые создали.
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-medium text-blue-50">
            <Rows3 className="h-4 w-4" aria-hidden="true" />
            Заказов: <span className="tabular-nums">{orders.length}</span>
          </div>
        </div>
      </section>

      {orders.length === 0 ? (
        <section className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-800">
            <PackageCheck className="h-7 w-7" aria-hidden="true" />
          </div>
          <h2 className="mt-5 text-lg font-semibold text-slate-950">Нет заказов без даты получения клиентом</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
            Здесь появятся созданные вами заказы и заказы ваших клиентов, пока дата получения не заполнена.
          </p>
        </section>
      ) : (
        <>
          <div className="space-y-3 md:hidden" data-testid="my-orders-mobile-list">
            {orders.map((order) => <MobileOrderCard key={order.id} order={order} />)}
          </div>

          <section className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block" aria-labelledby="my-orders-table-title" data-testid="my-orders-table">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
              <h2 id="my-orders-table-title" className="text-base font-semibold text-slate-950">Заказы в работе</h2>
              <p className="mt-0.5 text-xs text-slate-500">Сначала ближайшие плановые даты отгрузки</p>
            </div>
            <Table className="w-full table-fixed">
              <TableHeader>
                <TableRow className="bg-white">
                  <TableHead className="w-[22%] whitespace-normal leading-4 text-slate-600">Заказ</TableHead>
                  <TableHead className="w-[18%] whitespace-normal leading-4 text-slate-600">Клиент</TableHead>
                  <TableHead className="w-[22%] whitespace-normal leading-4 text-slate-600">Статус</TableHead>
                  <TableHead className="w-[25%] whitespace-normal leading-4 text-slate-600">Прогресс</TableHead>
                  <TableHead className="w-[13%] whitespace-normal text-right leading-4 text-slate-600">Плановая отгрузка</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id} className="align-middle hover:bg-slate-50/80">
                    <TableCell className="whitespace-normal break-words py-3"><OrderName order={order} /></TableCell>
                    <TableCell className="whitespace-normal break-words py-3 text-slate-600">{order.clientName || 'Не указан'}</TableCell>
                    <TableCell className="whitespace-normal py-3">
                      <MachineProgressBadge progress={order.status} className="h-auto min-h-5 overflow-visible whitespace-normal py-1 leading-4" />
                    </TableCell>
                    <TableCell className="whitespace-normal py-3">
                      <ProductionProgress orderName={order.name} progress={order.productionProgress} />
                    </TableCell>
                    <TableCell className="whitespace-normal py-3 text-right font-medium tabular-nums text-slate-900">
                      {dateLabel(order.desiredShippingDate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </>
      )}
    </div>
  )
}
