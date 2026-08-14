import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  filterReservationsByStockScope,
  type InventoryStockReference,
} from '../src/lib/inventory/reservation-stock-scope'

const inventoryById = new Map<string, InventoryStockReference>([
  ['business-2000', { id: 'business-2000', is_business_scrap: true }],
  ['regular-6000', { id: 'regular-6000', is_business_scrap: false }],
])

const reservations = [
  {
    id: 'technologist-business-reservation',
    inventory_id: 'business-2000',
    source_inventory_id: 'business-2000',
    reserved_quantity: 2000,
  },
  {
    id: 'supply-regular-reservation',
    inventory_id: 'regular-6000',
    source_inventory_id: 'regular-6000',
    reserved_quantity: 4000,
  },
  {
    id: 'unknown-source-reservation',
    inventory_id: 'missing-inventory',
    source_inventory_id: null,
    reserved_quantity: 1000,
  },
]

const supplyReservations = filterReservationsByStockScope(reservations, inventoryById, 'regular_stock')
assert.deepEqual(supplyReservations.map((reservation) => reservation.id), ['supply-regular-reservation'])
assert.equal(supplyReservations.reduce((sum, reservation) => sum + reservation.reserved_quantity, 0), 4000)
assert.equal(reservations.slice(0, 2).reduce((sum, reservation) => sum + reservation.reserved_quantity, 0), 6000)

const technologistReservations = filterReservationsByStockScope(reservations, inventoryById, 'business_scrap')
assert.deepEqual(technologistReservations.map((reservation) => reservation.id), ['technologist-business-reservation'])
assert.equal(technologistReservations.reduce((sum, reservation) => sum + reservation.reserved_quantity, 0), 2000)

const supplyRequestSource = readFileSync(join(process.cwd(), 'src/lib/actions/supply-request.ts'), 'utf8')
const wholeBarPolicy = supplyRequestSource.slice(
  supplyRequestSource.indexOf('function isImmediateCutReservationTable'),
  supplyRequestSource.indexOf('function normalizeText'),
)
assert.match(
  wholeBarPolicy,
  /table === 'request_knives' && Boolean\(row\.material_variant_id\)/u,
  'Only active knife positions with an exact variant should enter the whole-bar path',
)
assert.match(
  wholeBarPolicy,
  /Number\(item\.piece_length_mm \|\| 0\) > 0/u,
  'Knife whole-bar routing must require measured stock',
)
assert.match(
  wholeBarPolicy,
  /function isImmediateCutReservationTable[\s\S]*return table === 'request_knives'/u,
  'Legacy knife positions must retain the cut-reservation path',
)
assert.match(
  wholeBarPolicy,
  /table === 'request_pipe' && row\.pipe_type !== 'wire'/u,
  'Wire must remain outside the whole-bar path',
)

console.log('Supply reservation stock scope regression passed')
