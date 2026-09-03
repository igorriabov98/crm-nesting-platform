import { z } from 'zod'

export const SHIPMENT_REPORT_BASIS_VALUES = ['actual_shipping', 'production_month'] as const
export type ShipmentReportBasis = (typeof SHIPMENT_REPORT_BASIS_VALUES)[number]

export type ShipmentReportFilters = {
  month: string
  basis: ShipmentReportBasis
  factoryId: 'all' | string
}

export type ShipmentReportRow = {
  machineId: string
  client: string | null
  orderNumber: string | null
  invoiceAmount: number | null
  actualShippingDate: string | null
  customsClearanceDate: string | null
  deliveryToClientDate: string | null
  freightCost: number | null
  paidAmount: number | null
  invoiceDate: string | null
}

export type ShipmentReportFactory = { id: string; name: string }

export const SHIPMENT_REPORT_COLUMNS = [
  { key: 'client', label: 'Клиент' },
  { key: 'orderNumber', label: 'Номер заказа' },
  { key: 'invoiceAmount', label: 'Сумма счёта' },
  { key: 'actualShippingDate', label: 'Факт отгрузки' },
  { key: 'customsClearanceDate', label: 'Затаможено' },
  { key: 'deliveryToClientDate', label: 'Дата получения клиентом' },
  { key: 'freightCost', label: 'Реальная стоимость транспорта' },
  { key: 'paidAmount', label: 'Оплачено на текущий момент' },
  { key: 'invoiceDate', label: 'Дата выставления инвойса' },
] as const

const shipmentReportFiltersSchema = z.object({
  month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'Некорректный месяц отчёта'),
  basis: z.enum(SHIPMENT_REPORT_BASIS_VALUES),
  factoryId: z.union([z.literal('all'), z.string().uuid('Некорректный завод')]),
})

export type ShipmentMachineRow = {
  id: string
  client_id: string | null
  factory_id: string | null
  specification_number: string | null
  actual_shipping_date: string | null
  customs_clearance_date: string | null
  delivery_to_client_date: string | null
  freight_cost: number | null
  production_month: string | null
  production_workshop: number | null
  production_queue_number: number | null
}

export type ShipmentClientRow = { id: string; name: string }
export type ShipmentInvoiceRow = {
  machine_id: string
  amount: number | null
  paid_amount: number | null
  invoice_date: string | null
  status: string
  invoice_revision: number
}

export function defaultShipmentReportFilters(date = new Date()): ShipmentReportFilters {
  return {
    month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
    basis: 'actual_shipping',
    factoryId: 'all',
  }
}

export function parseShipmentReportFilters(
  input: Partial<Record<keyof ShipmentReportFilters, string | null | undefined>>,
): ShipmentReportFilters {
  const defaults = defaultShipmentReportFilters()
  return shipmentReportFiltersSchema.parse({
    month: input.month || defaults.month,
    basis: input.basis || defaults.basis,
    factoryId: input.factoryId || defaults.factoryId,
  })
}

export function shipmentReportMonthBounds(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const start = `${year}-${String(monthNumber).padStart(2, '0')}-01`
  const nextYear = monthNumber === 12 ? year + 1 : year
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1
  return { start, end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01` }
}

export function mapShipmentReportRows(
  machines: readonly ShipmentMachineRow[],
  clients: readonly ShipmentClientRow[],
  invoices: readonly ShipmentInvoiceRow[],
): ShipmentReportRow[] {
  const clientNames = new Map(clients.map((client) => [client.id, client.name]))
  const invoicesByMachine = new Map<string, ShipmentInvoiceRow>()
  for (const invoice of invoices) {
    if (invoice.status === 'cancelled') continue
    const current = invoicesByMachine.get(invoice.machine_id)
    if (!current || invoice.invoice_revision > current.invoice_revision) {
      invoicesByMachine.set(invoice.machine_id, invoice)
    }
  }

  return machines.map((machine) => {
    const invoice = invoicesByMachine.get(machine.id)
    const freightCost = Number(machine.freight_cost || 0)
    return {
      machineId: machine.id,
      client: machine.client_id ? clientNames.get(machine.client_id) || null : null,
      orderNumber: machine.specification_number?.trim() || null,
      invoiceAmount: invoice?.amount === null || invoice?.amount === undefined ? null : Number(invoice.amount),
      actualShippingDate: machine.actual_shipping_date,
      customsClearanceDate: machine.customs_clearance_date,
      deliveryToClientDate: machine.delivery_to_client_date,
      freightCost: freightCost > 0 ? freightCost : null,
      paidAmount: invoice?.paid_amount === null || invoice?.paid_amount === undefined ? null : Number(invoice.paid_amount),
      invoiceDate: invoice?.invoice_date || null,
    }
  })
}
