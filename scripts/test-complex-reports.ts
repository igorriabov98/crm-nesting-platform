import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'

import { machinePackingSettingsSchema } from '../src/lib/types/schemas'
import {
  SHIPMENT_REPORT_COLUMNS,
  mapShipmentReportRows,
  parseShipmentReportFilters,
  shipmentReportMonthBounds,
  type ShipmentMachineRow,
} from '../src/lib/reports/shipment-report-core'
import { buildShipmentReportXlsx } from '../src/lib/reports/shipment-report-xlsx'
import { calculateInvoiceAmount, calculateInvoiceDueDate } from '../src/lib/invoices/calculations'

const root = process.cwd()
const source = (path: string) => readFileSync(join(root, path), 'utf8')

async function main() {
const expectedHeaders = [
  'Клиент',
  'Номер заказа',
  'Сумма счёта',
  'Факт отгрузки',
  'Затаможено',
  'Дата получения клиентом',
  'Реальная стоимость транспорта',
  'Оплачено на текущий момент',
  'Дата выставления инвойса',
]
assert.deepEqual(SHIPMENT_REPORT_COLUMNS.map((column) => column.label), expectedHeaders)

assert.deepEqual(parseShipmentReportFilters({
  month: '2026-08',
  basis: 'actual_shipping',
  factoryId: 'all',
}), { month: '2026-08', basis: 'actual_shipping', factoryId: 'all' })
assert.deepEqual(parseShipmentReportFilters({
  month: '2026-09',
  basis: 'production_month',
  factoryId: '10000000-0000-4000-8000-000000000001',
}), {
  month: '2026-09',
  basis: 'production_month',
  factoryId: '10000000-0000-4000-8000-000000000001',
})
assert.throws(() => parseShipmentReportFilters({ month: '2026-13' }))
assert.throws(() => parseShipmentReportFilters({ factoryId: 'not-a-factory' }))
assert.deepEqual(shipmentReportMonthBounds('2026-12'), { start: '2026-12-01', end: '2027-01-01' })

const machineBase: ShipmentMachineRow = {
  id: 'machine-1',
  client_id: 'client-1',
  factory_id: 'factory-1',
  specification_number: '  ORD-42  ',
  actual_shipping_date: '2026-08-05',
  customs_clearance_date: '2026-08-09',
  delivery_to_client_date: '2026-08-12',
  freight_cost: 1234.56,
  production_month: '2026-08-01',
  production_workshop: 1,
  production_queue_number: 7,
}
const rows = mapShipmentReportRows(
  [machineBase, { ...machineBase, id: 'machine-2', client_id: null, specification_number: null, freight_cost: 0 }],
  [{ id: 'client-1', name: 'Клиент Тест' }],
  [
    {
      machine_id: 'machine-1',
      amount: 9000,
      paid_amount: 9000,
      invoice_date: '2026-07-01',
      status: 'cancelled',
      invoice_revision: 0,
    },
    {
      machine_id: 'machine-1',
      amount: 12000,
      paid_amount: 3000,
      invoice_date: '2026-07-15',
      status: 'not_paid',
      invoice_revision: 1,
    },
    {
      machine_id: 'machine-1',
      amount: 15000,
      paid_amount: 5000,
      invoice_date: '2026-08-01',
      status: 'partially_paid',
      invoice_revision: 2,
    },
  ],
)
assert.deepEqual(rows[0], {
  machineId: 'machine-1',
  client: 'Клиент Тест',
  orderNumber: 'ORD-42',
  invoiceAmount: 15000,
  actualShippingDate: '2026-08-05',
  customsClearanceDate: '2026-08-09',
  deliveryToClientDate: '2026-08-12',
  freightCost: 1234.56,
  paidAmount: 5000,
  invoiceDate: '2026-08-01',
})
assert.equal(rows[1].invoiceAmount, null, 'Машина без инвойса должна остаться в отчёте')
assert.equal(rows[1].paidAmount, null, 'Оплата без инвойса не должна подменяться нулём')
assert.equal(rows[1].freightCost, null, 'Историческая нулевая стоимость показывается как не указанная')
assert.equal(rows[0].invoiceAmount, 15000, 'Отчёт должен выбирать последнюю активную ревизию инвойса')

const cancelledOnlyRows = mapShipmentReportRows(
  [machineBase],
  [{ id: 'client-1', name: 'Клиент Тест' }],
  [{
    machine_id: 'machine-1',
    amount: 9000,
    paid_amount: 0,
    invoice_date: '2026-07-01',
    status: 'cancelled',
    invoice_revision: 0,
  }],
)
assert.equal(cancelledOnlyRows[0].invoiceAmount, null, 'Аннулированный инвойс не должен попадать в отчёт')

const packingBase = {
  contract_id: null,
  specification_number: null,
  specification_date: null,
  customs_clearance_date: null,
  delivery_to_client_date: null,
  delivery_basis_type: 'own_delivery' as const,
  packing_boxes_count: 0,
  groups: [],
}
assert(machinePackingSettingsSchema.safeParse({ ...packingBase, freight_cost: null }).success)
assert(machinePackingSettingsSchema.safeParse({ ...packingBase, freight_cost: 12.34 }).success)
assert(!machinePackingSettingsSchema.safeParse({ ...packingBase, freight_cost: 0 }).success)
assert(!machinePackingSettingsSchema.safeParse({ ...packingBase, freight_cost: -1 }).success)
assert(!machinePackingSettingsSchema.safeParse({ ...packingBase, freight_cost: 12.345 }).success)

assert.equal(calculateInvoiceAmount(
  [{ price: 100, quantity: 2 }, { price: 50, quantity: 3 }],
  [{ amount: 25 }],
), 375, 'Инвойс должен учитывать только товары и дополнительные расходы')
assert.equal(calculateInvoiceDueDate({
  payment_terms_type: 'delivery_days',
  payment_due_days: 14,
  delivery_to_client_date: '2026-08-12',
}, '2026-08-01'), '2026-08-26')
assert.equal(calculateInvoiceDueDate({
  payment_terms_type: 'prepayment_full',
  payment_due_days: 5,
  final_payment_due_days: 20,
  delivery_to_client_date: '2026-08-12',
}, '2026-08-01'), '2026-09-01')

const workbookBuffer = await buildShipmentReportXlsx(rows, {
  month: '2026-08',
  basis: 'actual_shipping',
  factoryId: 'all',
})
const workbook = new ExcelJS.Workbook()
await workbook.xlsx.load(workbookBuffer)
const worksheet = workbook.getWorksheet('Отчёт отгрузок')
assert(worksheet)
assert.deepEqual((worksheet.getRow(1).values as unknown[]).slice(1), expectedHeaders)
assert.equal(worksheet.views[0]?.state, 'frozen')
assert.equal(worksheet.views[0]?.ySplit, 1)
assert.equal(worksheet.autoFilter, 'A1:I3')
assert.equal(typeof worksheet.getCell('C2').value, 'number', 'Сумма счёта должна быть числовой Excel-ячейкой')
assert.equal(typeof worksheet.getCell('G2').value, 'number', 'Стоимость транспорта должна быть числовой Excel-ячейкой')
assert.equal(typeof worksheet.getCell('H2').value, 'number', 'Оплаченная сумма должна быть числовой Excel-ячейкой')
assert(worksheet.getCell('D2').value instanceof Date, 'Дата отгрузки должна быть Excel-датой')
assert.equal(worksheet.getCell('C3').value, '—')

const reportSource = source('src/lib/reports/shipment-report.ts')
assert(reportSource.includes("await requirePermission('complex_reports', 'view')"))
assert(reportSource.includes(".eq('is_archived', false)"), 'Архивные машины должны исключаться в БД-запросе')
assert(reportSource.includes(".gte('actual_shipping_date', start).lt('actual_shipping_date', end)"))
assert(reportSource.includes(".gte('production_month', start).lt('production_month', end)"))
assert(reportSource.includes("machineQuery.eq('factory_id', filters.factoryId)"))
assert(reportSource.includes(".neq('status', 'cancelled')"), 'Отчёт должен загружать только активный инвойс')
assert(reportSource.includes("createAdminClient()"), 'Отчёт должен читать доверенным клиентом после проверки права')
assert(!reportSource.includes("requirePermission('invoices'"), 'Отчёт не должен зависеть от invoices:view')

const invoiceActions = source('src/lib/actions/invoices.ts')
assert(!invoiceActions.includes('createServerSupabaseClient'), 'Инвойсные мутации не должны использовать пользовательский DB-клиент')
assert(invoiceActions.includes("requirePermission('invoices', 'manage')"))
assert(invoiceActions.includes('getTrustedDocumentData'))
assert(invoiceActions.includes('createInvoiceDocumentSnapshot'))
assert(!invoiceActions.includes('freight_cost'), 'Транспортная стоимость не должна входить в расчёт инвойса')

const settingsAction = source('src/app/(protected)/sales-plan/actions.ts')
const packingAction = settingsAction.split('export async function updateMachinePackingSettings(')[1]?.split('export async function ')[0] || ''
assert(packingAction.includes('await assertMachineNotArchived'))
assert(packingAction.includes('customs_clearance_date'))
assert(packingAction.includes('delivery_to_client_date'))
assert(packingAction.includes('freight_cost'))

const migration = source('supabase/migrations/20260902190000_machine_logistics_and_complex_reports.sql')
assert(migration.includes('ADD COLUMN IF NOT EXISTS customs_clearance_date date'))
assert(migration.includes('ALTER COLUMN freight_cost DROP DEFAULT'))
assert(migration.includes('DROP TRIGGER IF EXISTS trg_upsert_invoice_on_delivery'))
assert(migration.includes('DROP FUNCTION IF EXISTS public.fn_upsert_invoice_on_delivery()'))
assert(!/\bUPDATE\s+public\.machines\b/iu.test(migration), 'Исторические нулевые значения нельзя переписывать миграцией')
assert(!/CREATE\s+POLICY/iu.test(migration), 'Нельзя добавлять публичную invoice-политику')

const invoicePdf = source('src/lib/pdf/InvoiceDocument.tsx')
assert(!invoicePdf.includes('freight_cost'), 'PDF инвойса не должен включать внутреннюю стоимость транспорта')
const xlsxRoute = source('src/app/api/reports/complex/shipments.xlsx/route.ts')
assert(xlsxRoute.includes("await requirePermission('complex_reports', 'view')"))
assert(xlsxRoute.includes('buildShipmentReportXlsx(rows, filters)'))

console.log(`complex-reports: OK (${rows.length} строки, ${expectedHeaders.length} колонок)`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
