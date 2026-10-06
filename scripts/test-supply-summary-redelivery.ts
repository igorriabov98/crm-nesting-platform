import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { SupplyOrderDeliverySchedule } from '../src/lib/actions/supply-orders'
import { linkRedeliveryRows, redeliveryChain, redeliveryOrigins, resolveLegacyRedeliverySchedules } from '../src/lib/supply-orders/redelivery'
import { defaultSummaryPreferences, parseSummaryPreferences } from '../src/components/features/supply-orders/summary-preferences'

type Owned = SupplyOrderDeliverySchedule & { request_item_table: string; request_item_id: string }
const make = (patch: Partial<Owned>): Owned => ({
  id: 'source', request_item_table: 'request_sheet_metal', request_item_id: 'machine-request',
  delivery_date: '2026-10-12', quantity: 15, unit: 'шт', supplier_id: 'old-supplier',
  supplier_name: 'Старый поставщик', change_reason: null, status: 'delivered',
  received_quantity: 12, allocated_quantity: 12, allocated_physical_quantity: 12,
  planned_piece_length_mm: null, planned_piece_count: null, received_piece_length_mm: null,
  received_piece_count: null, allocated_piece_count: null, excess_quantity: 0,
  receipt_parent_schedule_id: null, delivered_at: '2026-10-12T10:00:00Z',
  received_by: 'warehouse', created_at: '2026-10-10T10:00:00Z',
  updated_at: '2026-10-12T10:00:00Z', ...patch,
})
const source = make({})
const planned = make({ id: 'original-plan', status: 'planned', received_quantity: null,
  allocated_quantity: null, allocated_physical_quantity: null, delivered_at: null })
assert.deepEqual(redeliveryOrigins([planned]), [], 'an overdue plan has no confirmed shortage')
assert.deepEqual(redeliveryOrigins([source]).map(origin => [origin.date, origin.available]), [['2026-10-12', 3]])
const stock = make({ id: 'new-stock', request_item_id: 'stock-request', status: 'planned', quantity: 5,
  received_quantity: null, allocated_quantity: null, allocated_physical_quantity: null, delivered_at: null })
const fullPhysical = make({ id: 'old-full-physical', quantity: 30, received_quantity: 30,
  allocated_quantity: 25, allocated_physical_quantity: 25, excess_quantity: 5 })
assert.equal(redeliveryOrigins([fullPhysical, stock]).length, 0,
  'five unallocated physical sheets do not create a shortage or cover the new stock purchase')
assert.equal(linkRedeliveryRows([{ request_item_table: stock.request_item_table,
  request_item_id: stock.request_item_id, quantity: 5, planned_piece_length_mm: null }],
  [fullPhysical, stock], []).at(0)?.redelivery_of_schedule_id, undefined)
const newPlan = make({ id: 'redelivery-2', delivery_date: '2026-10-20', quantity: 2,
  status: 'planned', received_quantity: null, allocated_quantity: null,
  allocated_physical_quantity: null, delivered_at: null, supplier_id: 'new-supplier',
  supplier_name: 'Новый поставщик', redelivery_of_schedule_id: source.id,
  created_at: '2026-10-13T10:00:00Z' })
assert.deepEqual(redeliveryChain(newPlan, [source, newPlan]).map(origin => [origin.date, origin.supplierName]),
  [['2026-10-12', 'Старый поставщик']], 'changing supplier and date keeps the source')
assert.equal(redeliveryOrigins([source, newPlan])[0].available, 1,
  'a partial redelivery schedule leaves the other sheet unplanned')
const confirmedAgain = { ...newPlan, status: 'delivered' as const, received_quantity: 1,
  allocated_quantity: 1, allocated_physical_quantity: 1, delivered_at: '2026-10-20T10:00:00Z' }
assert.deepEqual(redeliveryOrigins([source, confirmedAgain]).map(origin => [origin.id, origin.available]),
  [['source', 1], ['redelivery-2', 1]], 'a second partial receipt retains both independent origins')
const newRows = [2, 1].map(quantity => ({ request_item_table: source.request_item_table,
  request_item_id: source.request_item_id, quantity, planned_piece_length_mm: null }))
assert.deepEqual(linkRedeliveryRows(newRows, [source], []).map(row => row.redelivery_of_schedule_id),
  ['source', 'source'], 'two rows may share one source only up to its short balance')
assert.throws(() => linkRedeliveryRows([{ ...newRows[0], quantity: 4 }], [source], []), /превышает остаток/)
assert.throws(() => linkRedeliveryRows([{ ...newRows[0], quantity: 2 }], [source, confirmedAgain], []),
  /Источник требует уточнения/, 'ambiguous history needs an explicit source choice')
assert.deepEqual(linkRedeliveryRows([
  { ...newRows[0], quantity: 1, redelivery_of_schedule_id: source.id },
  { ...newRows[0], quantity: 1, redelivery_of_schedule_id: confirmedAgain.id },
], [source, confirmedAgain], []).map(row => row.redelivery_of_schedule_id),
[source.id, confirmedAgain.id], 'two origins persist as separate linked procurement rows')
const legacy = { ...newPlan, id: 'legacy-plan', redelivery_of_schedule_id: null }
assert.equal(resolveLegacyRedeliverySchedules([source, legacy])[1].redelivery_of_schedule_id, source.id)
assert.equal(resolveLegacyRedeliverySchedules([source, confirmedAgain, { ...legacy, created_at: '2026-10-21T10:00:00Z' }])[2].redelivery_of_schedule_id, null,
  'legacy provenance is inferred only with a unique confirmed source')
assert.deepEqual(parseSummaryPreferences('{invalid'), defaultSummaryPreferences)
assert.equal(parseSummaryPreferences(JSON.stringify({ ...defaultSummaryPreferences,
  view: 'cards', section: 'all', allStatus: 'closed' })).allStatus, 'closed')

const migration = readFileSync(new URL('../supabase/migrations/20261006160000_supply_summary_redelivery.sql', import.meta.url), 'utf8')
assert.match(migration, /create policy "Supplier categories read supply roles"[\s\S]*supply_orders', 'view'/i)
assert.match(migration, /redelivery_of_schedule_id uuid references public\.supply_order_delivery_schedules\(id\) on delete restrict/i)
assert.match(migration, /fn_guard_supply_redelivery_origin[\s\S]*crm_has_permission\('supply_orders','manage'\)/i)
assert.match(migration, /fn_receiving_material_identity_v1[\s\S]*another factory|Нельзя назначить довоз на другой завод/i)
assert.match(migration, /v_ref\.incoming <= greatest\(origin\.quantity-coalesce\(origin\.received_quantity/i)
assert.match(migration, /row\.redelivery_of_schedule_id[\s\S]*from jsonb_to_recordset/i)
assert.doesNotMatch(migration, /create policy[^;]*(for insert|for update|for delete)/i,
  'supplier directory write policies stay unchanged')
console.log('supply summary redelivery: ok')
