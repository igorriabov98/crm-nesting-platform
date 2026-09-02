import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import {
  mapShipmentReportRows,
  parseShipmentReportFilters,
  shipmentReportMonthBounds,
  type ShipmentClientRow,
  type ShipmentInvoiceRow,
  type ShipmentMachineRow,
  type ShipmentReportFactory,
  type ShipmentReportFilters,
} from '@/lib/reports/shipment-report-core'

export * from '@/lib/reports/shipment-report-core'

const REPORT_PAGE_SIZE = 1000
const RELATED_IDS_CHUNK_SIZE = 100

function chunks<T>(items: readonly T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

async function loadMachinePage(
  admin: ReturnType<typeof createAdminClient>,
  filters: ShipmentReportFilters,
  offset: number,
) {
  const { start, end } = shipmentReportMonthBounds(filters.month)
  let machineQuery = admin
    .from('machines')
    .select('id, client_id, factory_id, specification_number, actual_shipping_date, customs_clearance_date, delivery_to_client_date, freight_cost, production_month, production_workshop, production_queue_number')
    .eq('is_archived', false)

  machineQuery = filters.basis === 'actual_shipping'
    ? machineQuery.gte('actual_shipping_date', start).lt('actual_shipping_date', end).order('actual_shipping_date')
    : machineQuery.gte('production_month', start).lt('production_month', end)
      .order('production_workshop')
      .order('production_queue_number')

  if (filters.factoryId !== 'all') machineQuery = machineQuery.eq('factory_id', filters.factoryId)

  return machineQuery
    .order('specification_number')
    .range(offset, offset + REPORT_PAGE_SIZE - 1)
}

async function loadRows(admin: ReturnType<typeof createAdminClient>, filters: ShipmentReportFilters) {
  const machines: ShipmentMachineRow[] = []
  for (let offset = 0; ; offset += REPORT_PAGE_SIZE) {
    const { data, error } = await loadMachinePage(admin, filters, offset)
    if (error) throw error
    const page = (data || []) as ShipmentMachineRow[]
    machines.push(...page)
    if (page.length < REPORT_PAGE_SIZE) break
  }
  if (machines.length === 0) return []

  const machineIds = machines.map((machine) => machine.id)
  const clientIds = Array.from(new Set(machines.map((machine) => machine.client_id).filter((id): id is string => Boolean(id))))
  const [clientResults, invoiceResults] = await Promise.all([
    Promise.all(chunks(clientIds, RELATED_IDS_CHUNK_SIZE).map((ids) =>
      admin.from('clients').select('id, name').in('id', ids))),
    Promise.all(chunks(machineIds, RELATED_IDS_CHUNK_SIZE).map((ids) =>
      admin.from('invoices').select('machine_id, amount, paid_amount, invoice_date').in('machine_id', ids))),
  ])

  const relationError = [...clientResults, ...invoiceResults].find((result) => result.error)?.error
  if (relationError) throw relationError

  return mapShipmentReportRows(
    machines,
    clientResults.flatMap((result) => (result.data || []) as ShipmentClientRow[]),
    invoiceResults.flatMap((result) => (result.data || []) as ShipmentInvoiceRow[]),
  )
}

export async function loadShipmentReport(filtersInput: ShipmentReportFilters) {
  await requirePermission('complex_reports', 'view')
  const filters = parseShipmentReportFilters(filtersInput)
  return loadRows(createAdminClient(), filters)
}

export async function loadShipmentReportPageData(filtersInput: ShipmentReportFilters) {
  await requirePermission('complex_reports', 'view')
  const filters = parseShipmentReportFilters(filtersInput)
  const admin = createAdminClient()
  const [rows, factoriesResult] = await Promise.all([
    loadRows(admin, filters),
    admin.from('factories').select('id, name').order('name'),
  ])
  if (factoriesResult.error) throw factoriesResult.error

  return {
    filters,
    rows,
    factories: (factoriesResult.data || []) as ShipmentReportFactory[],
  }
}
