import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RequestItemOrderStatus } from '../src/components/features/requests/RequestItemOrderStatus'
import {
  formatMaterialRequestStockQuantity,
  getMaterialRequestStockCoverage,
  isMaterialRequestItemReservedFromStock,
  type MaterialRequestItemTable,
} from '../src/lib/material-request-stock-coverage'

const cases: Array<{
  table: MaterialRequestItemTable
  row: Record<string, unknown>
  needed: number
  reserved: number
  unit: string
}> = [
  { table: 'request_sheet_metal', row: { remainder_qty: 2, reserved_from_stock_kg: 2 }, needed: 2, reserved: 2, unit: 'шт' },
  { table: 'request_circle', row: { remainder_mm: 3000, reserved_from_stock_mm: 3000 }, needed: 3000, reserved: 3000, unit: 'мм' },
  { table: 'request_pipe', row: { pipe_type: 'square', remainder_length_mm: 6000, reserved_from_stock_length_mm: 6000 }, needed: 6000, reserved: 6000, unit: 'мм' },
  { table: 'request_pipe', row: { pipe_type: 'wire', remainder_kg: 12.5, reserved_from_stock_kg: 12.5 }, needed: 12.5, reserved: 12.5, unit: 'кг' },
  { table: 'request_knives', row: { remainder_meters: 4, reserved_from_stock_mm: 4000 }, needed: 4000, reserved: 4000, unit: 'мм' },
  { table: 'request_components', row: { quantity_needed: 5, stock_remainder: 1, reserved_from_stock: 4 }, needed: 4, reserved: 4, unit: 'шт' },
  { table: 'request_paint', row: { remainder_kg: 8, reserved_from_stock_kg: 8 }, needed: 8, reserved: 8, unit: 'кг' },
  { table: 'request_mesh', row: { remainder_qty: 3, reserved_from_stock_qty: 3 }, needed: 3, reserved: 3, unit: 'шт' },
  { table: 'request_chain_cord', row: { remainder_meters: 9, reserved_from_stock_meters: 9 }, needed: 9000, reserved: 9000, unit: 'мм' },
]

for (const testCase of cases) {
  assert.deepEqual(
    getMaterialRequestStockCoverage(testCase.table, testCase.row),
    { needed: testCase.needed, reserved: testCase.reserved, unit: testCase.unit },
  )
  assert.equal(
    isMaterialRequestItemReservedFromStock('pending', testCase.table, testCase.row),
    true,
    `${testCase.table} should be shown as reserved from stock`,
  )
}

assert.equal(
  isMaterialRequestItemReservedFromStock(
    'pending',
    'request_knives',
    { remainder_meters: 4, reserved_from_stock_mm: 3999 },
  ),
  false,
  'partial stock coverage must keep the procurement status',
)
assert.equal(
  isMaterialRequestItemReservedFromStock(
    'ordered',
    'request_knives',
    { remainder_meters: 4, reserved_from_stock_mm: 4000 },
  ),
  false,
  'ordered status must take precedence over stock coverage',
)
assert.equal(
  isMaterialRequestItemReservedFromStock(
    'delivered',
    'request_knives',
    { remainder_meters: 4, reserved_from_stock_mm: 4000 },
  ),
  false,
  'delivered status must take precedence over stock coverage',
)
assert.equal(
  isMaterialRequestItemReservedFromStock(
    'pending',
    'request_knives',
    { remainder_meters: 0, reserved_from_stock_mm: 0 },
  ),
  false,
  'empty positions must not be shown as reserved from stock',
)
assert.equal(formatMaterialRequestStockQuantity(2000, 'мм'), '2 000 мм')
assert.deepEqual(
  getMaterialRequestStockCoverage(
    'request_knives',
    { remainder_meters: 4, reserved_from_stock_mm: 1500 },
  ),
  { needed: 4000, reserved: 1500, unit: 'мм' },
  'partial coverage must preserve both quantities for the UI breakdown',
)

const fullCoverageMarkup = renderToStaticMarkup(createElement(RequestItemOrderStatus, {
  status: 'pending',
  itemTable: 'request_knives',
  item: { remainder_meters: 4, reserved_from_stock_mm: 4000 },
}))
assert.match(fullCoverageMarkup, /Забронировано со склада/)
assert.doesNotMatch(fullCoverageMarkup, /Не заказано/)

const partialCoverageMarkup = renderToStaticMarkup(createElement(RequestItemOrderStatus, {
  status: 'pending',
  itemTable: 'request_knives',
  item: { remainder_meters: 4, reserved_from_stock_mm: 1500 },
}))
assert.match(partialCoverageMarkup, /Забронировано:/)
assert.match(partialCoverageMarkup, /1 500 мм/)
assert.match(partialCoverageMarkup, /К заказу:/)
assert.match(partialCoverageMarkup, /2 500 мм/)
assert.ok(partialCoverageMarkup.indexOf('Забронировано:') < partialCoverageMarkup.indexOf('К заказу:'))
assert.doesNotMatch(partialCoverageMarkup, /Не заказано/)

console.log('Material request stock coverage tests passed')
