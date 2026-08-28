import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildCuttingAreaMaterialSummaries,
  emptyCuttingAreaMaterialSummary,
  mergeCuttingAreaMaterialSummaries,
  type CuttingAreaMaterialItem,
  type CuttingAreaMaterialRequest,
  type CuttingAreaMaterialSchedule,
  type CuttingAreaMaterialTable,
} from '../src/lib/production-cutting-area/materials'
import { loadCuttingAreaMaterialSummaries } from '../src/lib/production-cutting-area/load-materials'

const request: CuttingAreaMaterialRequest = { id: 'request-1', status: 'completed', factoryId: 'factory-1', plannedMaterialDate: '2026-09-01' }
const item: CuttingAreaMaterialItem = {
  id: 'item-1', request_id: request.id, table: 'request_components', order_status: 'pending',
  ordered_at: '2026-08-28T10:00:00.123Z',
  quantity_needed: 10, stock_remainder: 0, reserved_from_stock: 0,
  material_id: 'material-1', material_variant_id: 'variant-1',
}
const schedule: CuttingAreaMaterialSchedule = {
  id: 'schedule-1', request_item_table: item.table, request_item_id: item.id,
  delivery_date: '2026-09-02', status: 'planned', quantity: 10,
  received_quantity: null, allocated_quantity: null,
}
function summarize(items = [item], schedules: CuttingAreaMaterialSchedule[] = []) {
  return buildCuttingAreaMaterialSummaries([request], items, schedules).get(request.id)!
}

assert.deepEqual(summarize([]), emptyCuttingAreaMaterialSummary())
assert.equal(summarize().counts.not_ordered, 1, 'Завершение технологом не равно получению материала')
assert.equal(summarize([{ ...item, order_status: 'ordered' }]).counts.delivery, 1)
assert.equal(summarize([{ ...item, order_status: 'delivered' }]).counts.received, 1)
assert.deepEqual(summarize([{ ...item, order_status: 'cancelled' }], [schedule]), emptyCuttingAreaMaterialSummary())
assert.deepEqual(summarize([item], [{ ...schedule, status: 'cancelled' }]).deliveryDates, [])
assert.equal(summarize([{ ...item, custom_delivery_date: '2026-09-05' }]).counts.not_ordered, 1, 'Выбранная дата сама по себе не означает заказ')
assert.deepEqual(summarize([{ ...item, custom_delivery_date: '2026-09-05' }]).deliveryDates, ['2026-09-05'])
assert.deepEqual(summarize([{ ...item, custom_delivery_date: '2026-09-05' }], [schedule]).deliveryDates, ['2026-09-02'], 'График приоритетнее старой индивидуальной даты')
assert.deepEqual(summarize([item], [schedule, { ...schedule, id: 'second', delivery_date: '2026-09-01' }, { ...schedule, id: 'same-day' }]).deliveryDates, ['2026-09-01', '2026-09-02'])
assert.equal(summarize([item], [{ ...schedule, delivery_date: '2026-02-30' }]).hasUndatedDelivery, true)
assert.deepEqual(summarize([{ ...item, custom_delivery_date: 'not-a-date' }]).deliveryDates, [])

const partial = { ...schedule, status: 'delivered', received_quantity: 100, allocated_quantity: 4 }
assert.equal(summarize([item], [partial]).counts.delivery, 1, 'Учитывается выделенное заявке количество, не весь приход')
assert.equal(summarize([{ ...item, order_status: 'delivered' }], [partial]).counts.received, 0, 'Неполная приёмка не должна стать полной из-за старого статуса')
assert.equal(summarize([item], [partial]).hasUndatedDelivery, true, 'Для остатка нужна дата довоза')
assert.equal(summarize([item], [partial, { ...schedule, id: 'rest', quantity: 6, delivery_date: '2026-09-04' }]).hasUndatedDelivery, false)
assert.equal(summarize([item], [{ ...partial, allocated_quantity: 10 }]).counts.received, 1)
assert.equal(summarize([item], [{ ...partial, allocated_quantity: 0 }]).counts.received, 0)
assert.deepEqual(summarize([item], [{ ...schedule, request_item_table: 'request_paint' }]).deliveryDates, [], 'UUID разных таблиц не смешиваются')
assert.equal(summarize([{ ...item, reserved_from_stock: 6 }], [{ ...partial, allocated_quantity: 4 }]).counts.received, 1)
assert.equal(summarize([{ ...item, quantity_needed: 0 }]).counts.not_ordered, 0)

const quantities: Array<[CuttingAreaMaterialTable, Record<string, unknown>]> = [
  ['request_sheet_metal', { remainder_qty: 10, reserved_from_stock_kg: 10 }],
  ['request_round_tube', { order_kg: 10, reserved_from_stock_kg: 10 }],
  ['request_circle', { remainder_mm: 10, reserved_from_stock_mm: 10 }],
  ['request_pipe', { pipe_type: 'round', remainder_length_mm: 10, reserved_from_stock_length_mm: 10 }],
  ['request_pipe', { pipe_type: 'wire', remainder_kg: 10, reserved_from_stock_kg: 10 }],
  ['request_knives', { remainder_meters: 0.01, reserved_from_stock_mm: 10 }],
  ['request_components', { quantity_needed: 10, reserved_from_stock: 10 }],
  ['request_paint', { remainder_kg: 10, reserved_from_stock_kg: 10 }],
  ['request_mesh', { remainder_qty: 10, reserved_from_stock_qty: 10 }],
  ['request_chain_cord', { remainder_meters: 10, reserved_from_stock_meters: 10 }],
]
for (const [table, fields] of quantities) {
  const stock = summarize([{ ...item, ...fields, table }])
  assert.equal(stock.counts.stock, 1, `${table}: полностью со склада`)
  assert.equal(stock.counts.not_ordered, 0)
  assert.equal(stock.hasUndatedDelivery, false)
  const delivery = summarize([{ ...item, ...fields, table, order_status: 'ordered' }])
  assert.equal(delivery.counts.stock, 1, `${table}: складское покрытие сильнее старого ordered`)
}

const followerRequest = { ...request, id: 'follower' }
const follower = { ...item, id: 'follower-item', request_id: followerRequest.id, order_status: 'ordered' }
function sharedSummary(requestOverride = {}, itemOverride = {}, schedules: CuttingAreaMaterialSchedule[] = [{ ...schedule, quantity: 20 }]) {
  return buildCuttingAreaMaterialSummaries([request, { ...followerRequest, ...requestOverride }], [item, { ...follower, ...itemOverride }], schedules).get(followerRequest.id)!
}
assert.deepEqual(sharedSummary().deliveryDates, ['2026-09-02'], 'Общий график на якорной позиции виден следующей заявке')
assert.equal(sharedSummary().hasSharedSchedule, true)
assert.equal(sharedSummary().counts.received, 0)
for (const scope of [{ factoryId: 'other-factory' }, { plannedMaterialDate: '2026-10-01' }, { status: 'draft' }]) {
  assert.deepEqual(sharedSummary(scope).deliveryDates, [], 'Общий график не пересекает завод, период закупки и черновики')
}
for (const identity of [{ material_variant_id: 'other' }, { material_id: 'other' }, { material_variant_id: null }, { ordered_at: null }, { ordered_at: '2026-08-27T10:00:00.123Z' }, { table: 'request_knives', to_order_mm: 10 }, { order_status: 'pending' }]) {
  assert.deepEqual(sharedSummary({}, identity).deliveryDates, [], 'Нельзя угадывать дату другой позиции')
}
assert.deepEqual(sharedSummary({}, { ordered_at: '2026-08-27T10:00:00.123Z' }, [{ ...schedule, quantity: 100 }]).deliveryDates, [], 'Лишнее количество само по себе не доказывает общую закупку')
assert.deepEqual(sharedSummary({}, {}, [schedule]).deliveryDates, ['2026-09-02'], 'Частичный общий график сохраняется с пометкой общего графика')
assert.deepEqual(sharedSummary({}, { custom_delivery_date: '2026-09-06' }).deliveryDates, ['2026-09-06'], 'Индивидуальная дата не подменяется общей')
assert.deepEqual(sharedSummary({}, {}, [{ ...schedule, status: 'delivered', quantity: 20 }]).deliveryDates, [], 'Приёмка не распространяется на соседние заявки')
assert.deepEqual(sharedSummary({}, {}, [{ ...schedule, quantity: 20 }, { ...schedule, id: 'own', request_item_id: follower.id, delivery_date: '2026-09-03' }]).deliveryDates, ['2026-09-03'])

const mixed = mergeCuttingAreaMaterialSummaries([summarize(), summarize([{ ...item, order_status: 'delivered' }]), summarize([item], [schedule])])
assert.deepEqual(mixed.counts, { not_ordered: 1, delivery: 1, received: 1, stock: 0 })
assert.deepEqual(mixed.deliveryDates, ['2026-09-02'])
assert.equal(mixed.hasUndatedDelivery, true)

type Row = Record<string, unknown>
type Filter = { column: string; values: unknown[] }
const calls: Array<{ table: string; filters: Filter[]; from: number }> = []
let readError: { message: string } | null = null
const fixtures: Record<string, Row[]> = {
  technologist_requests: [
    { id: request.id, status: request.status, machines: { factory_id: request.factoryId, planned_material_date: request.plannedMaterialDate, is_archived: false } },
    { id: 'foreign', status: 'completed', machines: { factory_id: 'other-factory', planned_material_date: null, is_archived: false } },
  ],
  request_components: Array.from({ length: 1101 }, (_, index) => ({ ...item, id: `item-${String(index).padStart(4, '0')}` })),
  supply_order_delivery_schedules: Array.from({ length: 501 }, (_, index) => ({ ...schedule, id: `schedule-${String(index).padStart(4, '0')}`, request_item_id: 'item-0000', quantity: 0.01 })),
}
function valueAt(row: Row, column: string) {
  return column.split('.').reduce<unknown>((value, key) => (value as Row)?.[key], row)
}
const db = {
  from(table: string) {
    const filters: Filter[] = []
    let from = 0
    let to = Infinity
    const query = {
      select() { return query },
      in(column: string, values: string[]) { filters.push({ column, values }); return query },
      eq(column: string, value: unknown) { filters.push({ column, values: [value] }); return query },
      order() { return query },
      range(start: number, end: number) { from = start; to = end; return query },
      get then() {
        calls.push({ table, filters, from })
        const result = Promise.resolve({ data: (fixtures[table] || []).filter((row) => filters.every((filter) => filter.values.includes(valueAt(row, filter.column)))).slice(from, to + 1), error: readError })
        return result.then.bind(result)
      },
    }
    return query
  },
}

async function main() {
  const loaded = await loadCuttingAreaMaterialSummaries(db, [request.factoryId], [request.id, 'foreign'])
  assert.equal(loaded.size, 1, 'Результат не содержит заявки чужого завода')
  assert.equal(loaded.get(request.id)!.counts.not_ordered, 1100, 'Загружаются все страницы, а не только первые 1000 строк')
  assert.equal(loaded.get(request.id)!.counts.delivery, 1)
  assert(calls.some((call) => call.table === 'request_components' && call.from === 1000))
  assert(calls.some((call) => call.table === 'supply_order_delivery_schedules' && call.from === 500))
  for (const call of calls.filter((call) => call.table === 'supply_order_delivery_schedules')) {
    assert(call.filters.some((filter) => filter.column === 'request_item_table'))
    assert(call.filters.some((filter) => filter.column === 'request_item_id' && filter.values.length <= 100))
  }
  calls.length = 0
  assert.equal((await loadCuttingAreaMaterialSummaries(db, [], [request.id])).size, 0)
  assert.equal((await loadCuttingAreaMaterialSummaries(db, [request.factoryId], [])).size, 0)
  assert.equal(calls.length, 0, 'Без разрешённого охвата запросы не выполняются')
  readError = { message: 'read failed' }
  await assert.rejects(loadCuttingAreaMaterialSummaries(db, [request.factoryId], [request.id]), /read failed/)
  readError = null

  const actions = readFileSync('src/lib/actions/production-cutting-area.ts', 'utf8')
  assert(actions.includes("assertFactoryAccess(permission, CUTTING_AREA_RESOURCE, 'view', machine.data.factory_id)"))
  const ui = readFileSync('src/components/features/production/CuttingAreaMaterials.tsx', 'utf8')
  assert(ui.includes('openOnHover') && ui.includes('PopoverTrigger'))
  assert(ui.includes('hasUndatedDelivery') && ui.includes('Раздельная доставка'))
  console.log('cutting-area-materials: OK (statuses, dates, partial receipts, all categories, shared schedules, scope, pagination)')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
