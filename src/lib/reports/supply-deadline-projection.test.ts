import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  localReceiptDate, projectSupplyDeadlineRows,
  type DeadlineSchedule, type DeadlineSource,
} from './supply-deadline-projection'

function schedule(overrides: Partial<DeadlineSchedule> = {}): DeadlineSchedule {
  return {
    id: 'schedule-1', request_item_table: 'request_sheet_metal', request_item_id: 'item-1',
    receipt_parent_schedule_id: null, redelivery_of_schedule_id: null,
    status: 'delivered', delivery_date: '2026-10-01', delivered_at: '2026-10-01T10:00:00Z',
    quantity: 3, received_quantity: 3, allocated_quantity: 3, allocated_physical_quantity: null,
    received_piece_length_mm: null, received_piece_count: null, planned_piece_length_mm: null,
    allocated_piece_count: null, supplier_id: 'supplier-1', supplier_name: 'Поставщик', unit: 'шт',
    ...overrides,
  }
}

function source(overrides: Partial<DeadlineSource> = {}): DeadlineSource {
  return {
    table: 'request_sheet_metal', itemId: 'item-1', requestId: 'request-1',
    requestKind: 'machine', sourceName: 'Машина', factoryId: 'factory-1', factoryName: 'Берегово',
    materialName: 'Листовой металл', characteristics: 'Hardox · 20 мм',
    supplierId: 'supplier-1', supplierName: 'Поставщик', materialDeadline: '2026-10-01',
    cuttingStart: '2026-10-02', procurementQuantity: 3, unit: 'шт', schedules: [schedule()],
    ...overrides,
  }
}

test('3 принято и 2 ожидаются по графику: остаток виден без ложной поздней приёмки', () => {
  const stock = source({ requestKind: 'stock', procurementQuantity: 5, materialDeadline: null,
    cuttingStart: null, schedules: [schedule(), schedule({ id: 'schedule-2', status: 'planned',
      quantity: 2, received_quantity: null, allocated_quantity: null, delivered_at: null,
      delivery_date: '2026-10-15' })] })
  const result = projectSupplyDeadlineRows([stock], [], [], '2026-10-09')
  assert.equal(result.overdue.length, 0)
  assert.equal(result.shortages.length, 1)
  assert.equal(result.shortages[0].status, 'awaiting_plan')
  assert.equal(result.shortages[0].outstandingQuantity, 2)
  assert.equal(result.shortages[0].futurePlannedQuantity, 2)
})

test('неполная приёмка и связанный довоз объясняют открытый остаток', () => {
  const first = schedule({ quantity: 3, received_quantity: 2, allocated_quantity: 2 })
  const redelivery = schedule({ id: 'schedule-2', status: 'planned', quantity: 1,
    received_quantity: null, allocated_quantity: null, delivered_at: null,
    redelivery_of_schedule_id: first.id, delivery_date: '2026-10-15' })
  const result = projectSupplyDeadlineRows([source({ schedules: [first, redelivery] })], [], [], '2026-10-09')
  assert.equal(result.shortages[0].outstandingQuantity, 1)
  assert.equal(result.shortages[0].status, 'partial_receipt')
  assert.match(result.shortages[0].originDescription || '', /план 3 шт, склад принял 2 шт, не привезено 1 шт/)
  assert.match(result.shortages[0].originDescription || '', /довоз: 1 шт на 2026-10-15/)
  assert.equal(result.overdue[0].status, 'not_received')
})

test('срок фиксируется в момент приёмки, а день сравнивается по часовому поясу завода', () => {
  assert.equal(localReceiptDate('2026-10-01T21:30:00Z'), '2026-10-02')
  const accepted = source({ materialDeadline: '2026-10-10', schedules: [schedule({
    delivered_at: '2026-10-01T21:30:00Z',
  })] })
  const result = projectSupplyDeadlineRows([accepted], [{
    schedule_id: 'schedule-1', material_deadline: '2026-10-01', cutting_start: '2026-10-03',
  }], [], '2026-10-09')
  assert.equal(result.overdue.length, 1)
  assert.equal(result.overdue[0].deadline, '2026-10-01')
  assert.equal(result.overdue[0].cuttingStart, '2026-10-03')
  assert.equal(result.overdue[0].approximateDeadline, false)
})

test('приёмка в календарный день Мат.плана своевременна', () => {
  const result = projectSupplyDeadlineRows([source({ schedules: [schedule({
    delivered_at: '2026-10-01T20:59:00Z',
  })] })], [], [], '2026-10-09')
  assert.equal(result.overdue.length, 0)
  assert.equal(result.shortages.length, 0)
})

test('распределение одного физического прихода закрывает две заявки без удвоения физического количества', () => {
  const parent = schedule({ id: 'parent', quantity: 5, received_quantity: 5, allocated_quantity: 2,
    delivered_at: '2026-10-03T10:00:00Z' })
  const child = schedule({ id: 'child', request_item_id: 'item-2', receipt_parent_schedule_id: 'parent',
    quantity: 3, received_quantity: null, allocated_quantity: 3, delivered_at: null })
  const first = source({ procurementQuantity: 2, schedules: [parent] })
  const second = source({ itemId: 'item-2', requestId: 'request-2', procurementQuantity: 3,
    schedules: [child] })
  const result = projectSupplyDeadlineRows([first, second], [], [], '2026-10-09')
  assert.equal(result.shortages.length, 0)
  assert.equal(result.overdue.length, 2)
  assert.equal(result.overdue.reduce((sum, row) => sum + row.acceptedQuantity, 0), 5)
  assert.deepEqual(new Set(result.overdue.map((row) => row.receiptId)), new Set(['parent']))
  assert.ok(result.overdue.every((row) => row.acceptedAt === parent.delivered_at))
})

test('исключение убирает просрочку, но не скрывает недовоз', () => {
  const input = source({ schedules: [schedule({ quantity: 3, received_quantity: 2,
    allocated_quantity: 2, delivered_at: '2026-10-03T10:00:00Z' })] })
  const result = projectSupplyDeadlineRows([input], [], [{
    id: 'exclusion-1', target_kind: 'item', request_item_table: input.table,
    request_item_id: input.itemId, schedule_id: null, active: true, reason: 'Не учитывать',
    changed_at: '2026-10-04T10:00:00Z', changed_by_name: 'Администратор',
  }], '2026-10-09')
  assert.equal(result.overdue.length, 0)
  assert.equal(result.shortages.length, 1)
  assert.equal(result.shortages[0].outstandingQuantity, 1)
  assert.ok(result.excluded.some((row) => row.status === 'late_accepted'))
  assert.equal(result.excluded.filter((row) => row.status === 'not_received').length, 1)
})

test('старый приход использует текущий срок с заметной пометкой', () => {
  const result = projectSupplyDeadlineRows([source({ schedules: [schedule({
    delivered_at: '2026-10-03T10:00:00Z',
  })] })], [], [], '2026-10-09')
  assert.equal(result.overdue[0].status, 'late_accepted')
  assert.equal(result.overdue[0].approximateDeadline, true)
})

test('просрочка открытого остатка и будущий план не скрывают друг друга', () => {
  const result = projectSupplyDeadlineRows([source({ procurementQuantity: 5, schedules: [
    schedule({ quantity: 2, received_quantity: 2, allocated_quantity: 2 }),
    schedule({ id: 'future', status: 'planned', quantity: 3, received_quantity: null,
      allocated_quantity: null, delivered_at: null, delivery_date: '2026-10-12' }),
  ] })], [], [], '2026-10-09')
  assert.equal(result.shortages[0].outstandingQuantity, 3)
  assert.equal(result.shortages[0].futurePlannedQuantity, 3)
  assert.equal(result.overdue[0].status, 'not_received')
})

test('исключение одной поставки не скрывает позднюю приёмку другой', () => {
  const result = projectSupplyDeadlineRows([source({ procurementQuantity: 5, schedules: [
    schedule({ id: 'first', quantity: 2, received_quantity: 2, allocated_quantity: 2,
      delivered_at: '2026-10-03T10:00:00Z' }),
    schedule({ id: 'second', quantity: 3, received_quantity: 3, allocated_quantity: 3,
      delivered_at: '2026-10-04T10:00:00Z' }),
  ] })], [], [{ id: 'excluded-first', target_kind: 'schedule', request_item_table: 'request_sheet_metal',
    request_item_id: 'item-1', schedule_id: 'first', active: true, reason: 'Согласованная задержка',
    changed_at: '2026-10-05T10:00:00Z', changed_by_name: 'Начальник снабжения' }], '2026-10-09')
  assert.deepEqual(result.overdue.map((row) => row.scheduleId), ['second'])
  assert.deepEqual(result.excluded.map((row) => row.scheduleId), ['first'])
})
