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
const pendingKnifePlan = {
  plan_id: 'knife-plan',
  plan_number: 1,
  version_id: 'knife-version',
  version_number: 1,
  version_status: 'approved' as const,
  cutting_status: 'plan_approved' as const,
  components: [{ length_mm: 6_000, piece_count: 1, is_nonstandard: false }],
  total_piece_count: 1,
  total_length_mm: 6_000,
  uses_nonstandard_length: false,
}
const pendingKnife = makeAggregate({
  id: 'pending-knife',
  table: 'request_knives',
  category: 'knives',
  itemName: 'Ножи по карте',
  characteristics: [
    { label: 'Марка', value: 'Hardox' },
    { label: 'Ширина', value: '300' },
    { label: 'Высота', value: '20' },
  ],
  quantity: 6_000,
  unit: 'мм',
  weightKg: 280.8,
  unscheduledQuantity: 6_000,
  orderStatus: 'pending',
  longStockPurchasePlan: pendingKnifePlan,
})
const planlessKnife = makeAggregate({
  id: 'planless-knife',
  table: 'request_knives',
  category: 'knives',
  itemName: 'Ножи без карты',
  characteristics: [{ label: 'Марка', value: 'Hardox' }],
  quantity: 6_000,
  unit: 'мм',
  weightKg: 280.8,
  unscheduledQuantity: 6_000,
  orderStatus: 'pending',
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
const pendingPipePlan = {
  plan_id: 'pipe-plan',
  plan_number: 1,
  version_id: 'pipe-version',
  version_number: 1,
  version_status: 'approved' as const,
  cutting_status: 'plan_approved' as const,
  components: [
    { length_mm: 12_000, piece_count: 1, is_nonstandard: false },
    { length_mm: 6_000, piece_count: 2, is_nonstandard: false },
  ],
  total_piece_count: 3,
  total_length_mm: 24_000,
  uses_nonstandard_length: false,
}
const pendingPipe = makeAggregate({
  id: 'pending-pipe',
  table: 'request_pipe',
  category: 'pipe',
  itemName: 'Труба к заказу',
  characteristics: [{ label: 'Размер', value: '40×40 мм' }],
  quantity: 24_000,
  unit: 'мм',
  weightKg: 224.64,
  unscheduledQuantity: 24_000,
  orderStatus: 'pending',
  longStockPurchasePlan: pendingPipePlan,
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
  table: 'request_circle',
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
  [pendingSheet, pendingKnife, planlessKnife, orderedPipe, pendingPipe, partiallyOrderedCircle, redelivery],
  reportDate,
)

assert.equal(report.dateLabel, '10 сентября 2026 г.')
assert.equal(report.factoryLabel, 'Ужгород')
assert.equal(report.rows.length, 6, 'multi-length bar purchases must use one order row per stock length')
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
assert.equal(report.rows.find((row) => row.material === 'Круг')?.barLengthMm, 6_000)
assert.equal(report.rows.find((row) => row.material === 'Круг')?.barCount, 1)
assert.deepEqual(
  report.rows
    .filter((row) => row.material === 'Труба к заказу')
    .map((row) => ({ length: row.barLengthMm, count: row.barCount, quantity: row.quantity })),
  [
    { length: 12_000, count: 1, quantity: 12_000 },
    { length: 6_000, count: 2, quantity: 12_000 },
  ],
  'each pipe stock length must be a separate, numeric purchase line',
)
assert.equal(report.rows.find((row) => row.material === 'Ножи по карте')?.barLengthMm, 6_000)
assert.equal(report.rows.find((row) => row.material === 'Ножи по карте')?.barCount, 1)
const planlessKnifeRow = report.rows.find((row) => row.material === 'Ножи без карты')
assert(planlessKnifeRow)
assert.equal(planlessKnifeRow.barLengthMm, null)
assert.equal(planlessKnifeRow.barCount, null)
assert.match(
  planlessKnifeRow.purchaseComposition,
  /Требуется утверждённая карта раскроя/u,
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
  'Длина хлыста, мм',
  'Кол-во хлыстов к заказу, шт.',
  'Количество к заказу',
  'Ед.',
  'Вес, кг',
  'Поставщик',
  'Для машин',
])
assert.equal(worksheet.views[0]?.state, 'frozen')
assert.equal(worksheet.views[0]?.ySplit, 6)
assert.equal(worksheet.views[0]?.showGridLines, false)
assert.equal(worksheet.autoFilter, 'A6:L12')
const dataRows = Array.from(
  { length: worksheet.rowCount - 6 },
  (_, index) => worksheet.getRow(index + 7),
)
const circleRow = dataRows.find((row) => row.getCell(3).value === 'Круг')
assert(circleRow)
assert.equal(circleRow.getCell(5).value, '6\u00A0000 × 1')
assert.equal(circleRow.getCell(6).value, 6_000, 'bar length must remain a numeric Excel cell')
assert.equal(circleRow.getCell(7).value, 1, 'bar count must remain a numeric Excel cell')
assert.equal(circleRow.getCell(8).value, 6_000, 'purchase quantity must remain a numeric Excel cell')
assert.equal(circleRow.getCell(10).value, 236.64, 'known proportional weight must remain numeric')

const pipeRows = dataRows.filter((row) => row.getCell(3).value === 'Труба к заказу')
assert.deepEqual(
  pipeRows.map((row) => ({
    length: row.getCell(6).value,
    count: row.getCell(7).value,
    quantity: row.getCell(8).value,
  })),
  [
    { length: 12_000, count: 1, quantity: 12_000 },
    { length: 6_000, count: 2, quantity: 12_000 },
  ],
)

const planlessKnifeSheetRow = dataRows.find((row) => row.getCell(3).value === 'Ножи без карты')
assert(planlessKnifeSheetRow)
assert.match(String(planlessKnifeSheetRow.getCell(5).value), /Требуется утверждённая карта раскроя/u)
assert.equal(planlessKnifeSheetRow.getCell(6).value, '—')
assert.equal(planlessKnifeSheetRow.getCell(7).value, '—')

const sheetRow = dataRows.find((row) => row.getCell(3).value === 'Лист Hardox')
assert(sheetRow)
assert.equal(sheetRow.getCell(8).value, 2)
assert.equal(sheetRow.getCell(10).value, 112.32)

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
  table?: SupplyOrderAggregateSourceItem['table']
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
    table: options.table ?? 'request_sheet_metal',
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
