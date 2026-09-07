import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import ExcelJS from 'exceljs'

import type {
  SupplyOrderAggregate,
  SupplyOrderAggregateSourceItem,
  SupplyOrderDeliverySchedule,
} from '@/lib/actions/supply-orders'
import {
  buildSupplyDateOrderReport,
  supplyDateOrderFilename,
} from '@/lib/reports/supply-date-order-report'
import { buildSupplyDateOrderXlsx } from '@/lib/reports/supply-date-order-xlsx'

const reportDate = '2026-09-10'
const pendingSheet = makeAggregate({
  id: 'pending-sheet',
  category: 'sheet_metal',
  itemName: 'Лист Hardox',
  characteristics: [
    { label: 'Марка', value: 'Hardox 450' },
    { label: 'Толщина', value: '10 мм' },
    { label: 'Размер', value: '1500×3000 мм' },
  ],
  quantity: 2,
  unit: 'шт',
  weightKg: 112.32,
  unscheduledQuantity: 2,
  orderStatus: 'pending',
  supplierName: null,
})
const orderedPipe = makeAggregate({
  id: 'ordered-pipe',
  category: 'pipe',
  itemName: 'Труба',
  characteristics: [{ label: 'Размер', value: '40×40 мм' }],
  quantity: 6_000,
  unit: 'мм',
  weightKg: 56.16,
  unscheduledQuantity: 0,
  orderStatus: 'ordered',
  schedules: [makeSchedule({
    id: 'ordered-pipe-schedule',
    delivery_date: reportDate,
    quantity: 6_000,
    status: 'planned',
    received_quantity: null,
    allocated_quantity: null,
    allocated_physical_quantity: null,
    delivered_at: null,
  })],
})
const partialCirclePlan = {
  plan_id: 'circle-plan',
  plan_number: 1,
  version_id: 'circle-version',
  version_number: 1,
  version_status: 'approved' as const,
  cutting_status: 'plan_approved' as const,
  components: [{ length_mm: 6_000, piece_count: 4, is_nonstandard: false }],
  total_piece_count: 4,
  total_length_mm: 24_000,
  uses_nonstandard_length: false,
}
const partiallyOrderedCircle = makeAggregate({
  id: 'partial-circle',
  category: 'circle',
  itemName: 'Круг',
  characteristics: [
    { label: 'Марка', value: '40Х' },
    { label: 'Диаметр', value: '80 мм' },
  ],
  quantity: 24_000,
  unit: 'мм',
  weightKg: 946.56,
  unscheduledQuantity: 6_000,
  orderStatus: 'ordered',
  supplierName: 'Сталь Сервис',
  schedules: [makeSchedule({
    id: 'partial-circle-schedule',
    delivery_date: '2026-09-09',
    quantity: 18_000,
    status: 'planned',
    received_quantity: null,
    allocated_quantity: null,
    allocated_physical_quantity: null,
    planned_piece_length_mm: 6_000,
    planned_piece_count: 3,
    delivered_at: null,
  })],
  longStockPurchasePlan: partialCirclePlan,
})
const redelivery = makeAggregate({
  id: 'redelivery',
  category: 'components',
  itemName: 'Редуктор',
  characteristics: [{ label: 'Модель', value: 'R-10' }],
  quantity: 10,
  unit: 'шт',
  weightKg: 100,
  unscheduledQuantity: 9,
  orderStatus: 'ordered',
  schedules: [makeSchedule({ quantity: 10, received_quantity: 1, allocated_quantity: 1 })],
})

const report = buildSupplyDateOrderReport(
  [pendingSheet, orderedPipe, partiallyOrderedCircle, redelivery],
  reportDate,
)

assert.equal(report.dateLabel, '10 сентября 2026 г.')
assert.equal(report.factoryLabel, 'Ужгород')
assert.deepEqual(
  report.rows.map((row) => row.material),
  ['Круг', 'Лист Hardox'],
  'the document must include only ordinary uncovered purchase quantities for this date',
)
assert.equal(
  report.rows.find((row) => row.material === 'Круг')?.quantity,
  6_000,
  'a partially ordered material must export only its uncovered remainder',
)
assert.equal(
  report.rows.find((row) => row.material === 'Круг')?.purchaseComposition,
  '6\u00A0000 × 1',
  'the remaining long-stock row must state the exact bar composition still to purchase',
)
assert.equal(report.rows.find((row) => row.material === 'Лист Hardox')?.supplier, 'Не назначен')
assert.equal(report.rows.some((row) => row.material === 'Труба'), false, 'fully ordered material must be excluded')
assert.equal(report.rows.some((row) => row.material === 'Редуктор'), false, 'redelivery belongs to the separate redelivery workflow')
assert.equal(supplyDateOrderFilename(reportDate), 'zakaz-materialov-2026-09-10.xlsx')
assert.equal(supplyDateOrderFilename('no_supply_date'), 'zakaz-materialov-bez-daty.xlsx')

async function verifyWorkbook() {
const buffer = await buildSupplyDateOrderXlsx(report, new Date('2026-09-07T09:30:00Z'))
if (process.env.SUPPLY_DATE_ORDER_XLSX_OUTPUT) {
  await writeFile(process.env.SUPPLY_DATE_ORDER_XLSX_OUTPUT, Buffer.from(buffer))
}
const workbook = new ExcelJS.Workbook()
await workbook.xlsx.load(buffer)
const worksheet = workbook.getWorksheet('Заказ 10.09.2026')
assert(worksheet)
assert.deepEqual((worksheet.getRow(6).values as unknown[]).slice(1), [
  '№',
  'Категория',
  'Материал',
  'Характеристики',
  'Состав закупки',
  'Количество к заказу',
  'Ед.',
  'Вес, кг',
  'Поставщик',
  'Для машин',
])
assert.equal(worksheet.views[0]?.state, 'frozen')
assert.equal(worksheet.views[0]?.ySplit, 6)
assert.equal(worksheet.views[0]?.showGridLines, false)
assert.equal(worksheet.autoFilter, 'A6:J8')
assert.equal(worksheet.getCell('F7').value, 6_000, 'purchase quantity must remain a numeric Excel cell')
assert.equal(worksheet.getCell('H7').value, 236.64, 'known proportional weight must remain numeric')
assert.equal(worksheet.getCell('E7').value, '6\u00A0000 × 1')
assert.equal(worksheet.getCell('F8').value, 2)
assert.equal(worksheet.getCell('H8').value, 112.32)

const routeSource = readFileSync(
  new URL('../src/app/api/reports/supply/date-order.xlsx/route.ts', import.meta.url),
  'utf8',
)
assert.match(routeSource, /await requirePermission\('supply_orders', 'view'\)/u)
assert.match(routeSource, /getSupplyOrderAggregates\(params\.factory\)/u)
assert.match(routeSource, /Cache-Control': 'private, no-store'/u)

const pageSource = readFileSync(
  new URL('../src/components/features/supply-orders/SupplyOrderSummaryPage.tsx', import.meta.url),
  'utf8',
)
assert.match(pageSource, /SupplyDateOrderExportButton/u)
assert.match(pageSource, /slice\.unscheduledQuantity > 0\.000001/u)

console.log(`supply date order XLSX: ok (${report.rows.length} строки)`)
}

type AggregateOptions = {
  id: string
  category: SupplyOrderAggregate['category']
  itemName: string
  characteristics: SupplyOrderAggregate['characteristics']
  quantity: number
  unit: string
  weightKg: number | null
  unscheduledQuantity: number
  orderStatus: SupplyOrderAggregateSourceItem['order_status']
  supplierName?: string | null
  schedules?: SupplyOrderDeliverySchedule[]
  longStockPurchasePlan?: SupplyOrderAggregateSourceItem['long_stock_purchase_plan']
}

function makeAggregate(options: AggregateOptions): SupplyOrderAggregate {
  const schedules = options.schedules || []
  const plannedQuantity = schedules
    .filter((schedule) => schedule.status === 'planned')
    .reduce((sum, schedule) => sum + Number(schedule.quantity || 0), 0)
  const deliveredQuantity = schedules
    .filter((schedule) => schedule.status === 'delivered')
    .reduce((sum, schedule) => sum + Number(schedule.allocated_quantity ?? schedule.received_quantity ?? schedule.quantity), 0)
  const item = makeItem({
    id: `${options.id}-item`,
    quantity: options.quantity,
    unit: options.unit,
    supplier_id: options.supplierName ? 'supplier-id' : null,
    supplier_name: options.supplierName ?? null,
    weight_kg: options.weightKg,
    order_status: options.orderStatus,
    supply_delivery_date: schedules[0]?.delivery_date || reportDate,
    planned_schedule_quantity: plannedQuantity,
    delivered_schedule_quantity: deliveredQuantity,
    unscheduled_quantity: options.unscheduledQuantity,
    delivery_schedules: schedules,
    long_stock_purchase_plan: options.longStockPurchasePlan ?? null,
  })

  return {
    id: options.id,
    planned_material_date: reportDate,
    category: options.category,
    item_name: options.itemName,
    unit: options.unit,
    material_id: `${options.id}-material`,
    material_variant_id: null,
    characteristics: options.characteristics,
    quantity: options.quantity,
    requested_quantity: options.quantity,
    reserved_quantity: 0,
    weight_kg: options.weightKg,
    item_count: 1,
    machine_count: 1,
    pending_count: options.orderStatus === 'pending' ? 1 : 0,
    ordered_count: options.orderStatus === 'ordered' ? 1 : 0,
    delivered_count: 0,
    planned_schedule_quantity: plannedQuantity,
    delivered_schedule_quantity: deliveredQuantity,
    unscheduled_quantity: options.unscheduledQuantity,
    factories: [{
      factory_id: 'cd72f88c-160a-4885-9068-ed5ff8e5368c',
      factory_name: 'Ужгород',
      quantity: options.quantity,
      requested_quantity: options.quantity,
      reserved_quantity: 0,
      weight_kg: options.weightKg,
      item_count: 1,
      machine_count: 1,
      pending_count: options.orderStatus === 'pending' ? 1 : 0,
      ordered_count: options.orderStatus === 'ordered' ? 1 : 0,
      delivered_count: 0,
      planned_schedule_quantity: plannedQuantity,
      delivered_schedule_quantity: deliveredQuantity,
      unscheduled_quantity: options.unscheduledQuantity,
      delivery_schedule_count: schedules.length,
      has_delivery_schedules: schedules.length > 0,
      production_date: reportDate,
      supply_delivery_date: schedules.length === 1 ? schedules[0].delivery_date : null,
      has_mixed_supply_delivery_dates: schedules.length > 1,
      suppliers: [{
        id: options.supplierName ? 'supplier-id' : null,
        name: options.supplierName || 'Без поставщика',
        item_count: 1,
        pending_count: options.orderStatus === 'pending' ? 1 : 0,
        ordered_count: options.orderStatus === 'ordered' ? 1 : 0,
        delivered_count: 0,
      }],
      items: [item],
    }],
  }
}

function makeItem(patch: Partial<SupplyOrderAggregateSourceItem>): SupplyOrderAggregateSourceItem {
  return {
    table: 'request_sheet_metal',
    id: 'item',
    request_id: 'request-id',
    machine_id: 'machine-id',
    machine_name: 'test 5/09',
    quantity: 1,
    unit: 'шт',
    supplier_id: null,
    supplier_name: null,
    weight_kg: null,
    order_status: 'pending',
    supply_delivery_date: reportDate,
    planned_schedule_quantity: 0,
    delivered_schedule_quantity: 0,
    unscheduled_quantity: 1,
    delivery_schedules: [],
    long_stock_purchase_plan: null,
    ...patch,
  }
}

function makeSchedule(patch: Partial<SupplyOrderDeliverySchedule>): SupplyOrderDeliverySchedule {
  return {
    id: 'schedule-id',
    delivery_date: reportDate,
    quantity: 1,
    unit: 'шт',
    supplier_id: 'supplier-id',
    supplier_name: 'Сталь Сервис',
    change_reason: null,
    status: 'delivered',
    received_quantity: 1,
    allocated_quantity: 1,
    allocated_physical_quantity: 1,
    planned_piece_length_mm: null,
    planned_piece_count: null,
    received_piece_length_mm: null,
    received_piece_count: null,
    allocated_piece_count: null,
    excess_quantity: 0,
    receipt_parent_schedule_id: null,
    delivered_at: '2026-09-07T09:00:00Z',
    received_by: 'user-id',
    created_at: '2026-09-06T09:00:00Z',
    updated_at: '2026-09-07T09:00:00Z',
    ...patch,
  }
}

verifyWorkbook().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
