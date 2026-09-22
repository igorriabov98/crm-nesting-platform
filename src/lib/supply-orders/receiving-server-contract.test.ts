import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type { MaterialDeliveryAllocationPreview, MaterialDeliveryAllocationInput } from '../actions/supply-orders'
import { allocateReceiptByPriority, committedScheduleQuantity, outstandingAllocationQuantity } from './receiving-quantity.mjs'
import { calculateSupplyReceiptProgress, type SupplyProgressSchedule } from './receiving-supply-progress'
import { wholeBarReceiptCapacity, wholeBarLogicalQuantity } from './whole-bar-receiving'
import { withRequestSteelType } from './pipe-steel-grade'
import { formatSupplyOrderCharacteristicValue } from './characteristic-labels'

// Execute the actual internal server functions with read-only query adapters.
// No copied preview/confirmation implementation and no live database credentials.
const source = ts.createSourceFile('supply-orders.ts', readFileSync(
  new URL('../actions/supply-orders.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const names = ['IDENTITY_FIELDS', 'DISPLAY_FIELDS', 'normalizeCharacteristicValue', 'getCharacteristicParts',
  'getAggregateCharacteristics', 'parseBarReceipt', 'buildMaterialAllocationPreview', 'confirmedMaterialAllocations']
const declarations = source.statements.filter((statement) => {
  if (ts.isFunctionDeclaration(statement)) return names.includes(statement.name?.text || '')
  return ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) =>
    ts.isIdentifier(declaration.name) && names.includes(declaration.name.text))
})
assert.equal(declarations.length, names.length)
const javascript = ts.transpileModule(declarations.map((node) => node.getText(source)).join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText

function server(schedules: SupplyProgressSchedule[]) {
  const dependencies = {
    isWholeBarItem: () => true,
    getAggregateIdentityKey: () => 'circle-hardox-20',
    projectSchedulesToPurchasePlans: (_items: unknown, rows: unknown) => rows,
    loadReceivingSchedules: async () => schedules,
    loadSupplierNameMap: async () => new Map(),
    loadReceivingTransportContexts: async () => [],
    plannedDateKey: (date: string) => date,
    itemKey: (item: { table: string; id: string }) => `${item.table}:${item.id}`,
    projectPlannedScheduleAllocations: () => ({ allocations: [] }),
    loadCuttingDateMap: async () => new Map([['CIV-19', '2026-10-10']]),
    calculateSupplyReceiptProgress, committedScheduleQuantity, outstandingAllocationQuantity,
    allocateReceiptByPriority, wholeBarReceiptCapacity, wholeBarLogicalQuantity,
    withRequestSteelType, formatSupplyOrderCharacteristicValue,
  }
  return new Function(...Object.keys(dependencies), `${javascript}\nreturn { buildMaterialAllocationPreview, confirmedMaterialAllocations }`)(
    ...Object.values(dependencies)) as {
    buildMaterialAllocationPreview: (...args: unknown[]) => Promise<MaterialDeliveryAllocationPreview>
    confirmedMaterialAllocations: (preview: MaterialDeliveryAllocationPreview, input: MaterialDeliveryAllocationInput[]) =>
      Array<{ quantity: number; physical_quantity: number; piece_count: number }>
  }
}

const item = {
  table: 'request_circle', id: 'circle-20', category: 'circle', factory_id: 'beregovo',
  machine_id: 'CIV-19', machine_name: 'CIV-19-2026', planned_material_date: '2026-10-07',
  order_status: 'ordered', material_id: 'circle', material_variant_id: 'hardox-20', item_name: 'круг',
  unit: 'мм', requested_quantity: 6000, reserved_quantity: 0, to_order: 12000,
  raw: { steel_grade: 'Hardox', steel_types: { name: 'Hardox' }, diameter_mm: 20, is_calibrated: false },
  long_stock_purchase_plan: {
    version_status: 'approved', cutting_status: 'plan_approved', total_piece_count: 2,
    components: [{ length_mm: 6000, piece_count: 2 }],
    receipt_bars: [{ length_mm: 6000, logical_quantity: 5500 }, { length_mm: 6000, logical_quantity: 500 }],
  },
}

async function preview(schedules: SupplyProgressSchedule[] = [], pieces = 2) {
  const functions = server(schedules)
  return { functions, data: await functions.buildMaterialAllocationPreview({},
    { received_quantity: 6000 * pieces, piece_length_mm: 6000, piece_count: pieces },
    new Set(['current']), new Set(['request_circle:circle-20']), item, [item], 12000, 6000, 2) }
}

test('server preview returns two purchased bars and full characteristics from the request row', async () => {
  const { data, functions } = await preview()
  const row = data.allocations[0]
  assert.equal(row.needed_piece_count, 2)
  assert.equal(row.suggested_piece_count, 2)
  assert.equal(row.supply_outstanding_piece_count, 2)
  assert.equal(data.free_piece_count, 0)
  assert.deepEqual(row.characteristics, [
    { label: 'Марка', value: 'Hardox' }, { label: 'Тип стали', value: 'Hardox' },
    { label: 'Диаметр', value: '20' }, { label: 'Калиброванный', value: 'нет' },
  ])
  const [allocation] = functions.confirmedMaterialAllocations(data,
    [{ mode: 'whole_bar', table: item.table, id: item.id, piece_count: 2 }])
  assert.equal(allocation.quantity, 6000)
  assert.equal(allocation.physical_quantity, 12000)
  assert.throws(() => functions.confirmedMaterialAllocations(data,
    [{ mode: 'whole_bar', table: item.table, id: item.id, piece_count: 3 }]), /Некорректное количество хлыстов/)
})

test('server rebuild rejects a stale two-bar confirmation after one bar has been received', async () => {
  const { data, functions } = await preview([{
    ...{ request_item_table: item.table, request_item_id: item.id },
    status: 'delivered', planned_piece_length_mm: 6000, received_piece_length_mm: 6000,
    received_quantity: 6000, allocated_quantity: 5500, allocated_physical_quantity: 6000,
    received_piece_count: 1, allocated_piece_count: 1,
  }], 1)
  const row = data.allocations[0]
  assert.equal(row.outstanding_quantity, 500)
  assert.equal(row.supply_outstanding_quantity, 6000)
  assert.equal(row.needed_piece_count, 1)
  assert.equal(row.suggested_quantity, 500)
  assert.throws(() => functions.confirmedMaterialAllocations(data,
    [{ mode: 'whole_bar', table: item.table, id: item.id, piece_count: 2 }]), /Некорректное количество хлыстов/)
  const [allocation] = functions.confirmedMaterialAllocations(data,
    [{ mode: 'whole_bar', table: item.table, id: item.id, piece_count: 1 }])
  assert.equal(allocation.quantity, 500)
  assert.equal(allocation.physical_quantity, 6000)
})
