import Link from 'next/link'
import { Download, FileBarChart, Filter, Rows3 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ROUTES } from '@/lib/constants/routes'
import {
  SHIPMENT_REPORT_COLUMNS,
  loadShipmentReportPageData,
  parseShipmentReportFilters,
  type ShipmentReportFilters,
} from '@/lib/reports/shipment-report'

export const metadata = { title: 'Комплексные отчёты — CRM Завода' }
export const dynamic = 'force-dynamic'

type SearchParams = {
  month?: string
  basis?: string
  factoryId?: string
}

function dateLabel(value: string | null) {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}.${month}.${year}`
}

function moneyLabel(value: number | null) {
  if (value === null) return '—'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function exportHref(filters: ShipmentReportFilters) {
  const params = new URLSearchParams({
    month: filters.month,
    basis: filters.basis,
    factoryId: filters.factoryId,
  })
  return `/api/reports/complex/shipments.xlsx?${params.toString()}`
}

export default async function ComplexReportsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  const params = await searchParams
  const filters = parseShipmentReportFilters({
    month: params?.month,
    basis: params?.basis,
    factoryId: params?.factoryId,
  })
  const { rows, factories } = await loadShipmentReportPageData(filters)

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-blue-950">
            <FileBarChart className="h-6 w-6 text-blue-700" aria-hidden="true" />
            Комплексные отчёты
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Отгрузки, расчёты с клиентами и фактическая стоимость транспорта в одном реестре.
          </p>
        </div>
        <Button
          render={<Link href={exportHref(filters)} />}
          className="min-h-10 bg-emerald-700 text-white hover:bg-emerald-800"
        >
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
          Скачать Excel
        </Button>
      </div>

      <form
        method="get"
        action={ROUTES.REPORTS_COMPLEX}
        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-950">
          <Filter className="h-4 w-4 text-blue-800" aria-hidden="true" />
          Параметры отчёта
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Тип отчёта
            <select
              name="reportType"
              defaultValue="shipments"
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-blue-950 outline-none focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-600/20"
            >
              <option value="shipments">Отчёт отгрузок</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Месяц
            <input
              type="month"
              name="month"
              defaultValue={filters.month}
              required
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-blue-950 outline-none focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-600/20"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Способ отбора
            <select
              name="basis"
              defaultValue={filters.basis}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-blue-950 outline-none focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-600/20"
            >
              <option value="actual_shipping">Фактическая отгрузка</option>
              <option value="production_month">Месяц производства</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Завод
            <select
              name="factoryId"
              defaultValue={filters.factoryId}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-blue-950 outline-none focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-600/20"
            >
              <option value="all">Все заводы</option>
              {factories.map((factory) => (
                <option key={factory.id} value={factory.id}>{factory.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="submit" className="min-h-10 bg-blue-950 text-white hover:bg-blue-900">
            Сформировать отчёт
          </Button>
        </div>
      </form>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="shipment-report-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
          <div>
            <h2 id="shipment-report-title" className="text-base font-semibold text-slate-950">Отчёт отгрузок</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {filters.basis === 'actual_shipping' ? 'Отбор по фактической дате отгрузки' : 'Отбор по месяцу производства'}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
            <Rows3 className="h-3.5 w-3.5" aria-hidden="true" />
            Записей: {rows.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <Table className="min-w-[1380px]">
            <TableHeader className="bg-white">
              <TableRow>
                {SHIPMENT_REPORT_COLUMNS.map((column, index) => (
                  <TableHead
                    key={column.key}
                    className={index === 0 ? 'sticky left-0 z-10 min-w-56 bg-white text-slate-600' : 'min-w-40 whitespace-normal text-slate-600'}
                  >
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={SHIPMENT_REPORT_COLUMNS.length} className="h-32 text-center">
                    <p className="font-medium text-slate-700">За выбранный период отгрузок нет</p>
                    <p className="mt-1 text-sm text-slate-500">Измените месяц, способ отбора или завод.</p>
                  </TableCell>
                </TableRow>
              ) : rows.map((row) => (
                <TableRow key={row.machineId} className="group hover:bg-blue-50/40">
                  <TableCell className="sticky left-0 z-10 bg-white font-medium text-slate-900 group-hover:bg-blue-50/40">
                    {row.client || '—'}
                  </TableCell>
                  <TableCell className="font-medium text-blue-950">{row.orderNumber || '—'}</TableCell>
                  <TableCell className="tabular-nums">{moneyLabel(row.invoiceAmount)}</TableCell>
                  <TableCell>{dateLabel(row.actualShippingDate)}</TableCell>
                  <TableCell>{dateLabel(row.customsClearanceDate)}</TableCell>
                  <TableCell>{dateLabel(row.deliveryToClientDate)}</TableCell>
                  <TableCell className="tabular-nums">{moneyLabel(row.freightCost)}</TableCell>
                  <TableCell className="tabular-nums">{moneyLabel(row.paidAmount)}</TableCell>
                  <TableCell>{dateLabel(row.invoiceDate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}
