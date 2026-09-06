import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatLongStockPurchaseComposition,
  mergeLongStockPurchasePlans,
  projectPlannedLongStockSchedulesToPurchasePlan,
  summarizeLongStockPurchaseBars,
  type LongStockPurchasePlan,
} from './long-stock-purchase-plan'

test('показывает только закупаемые хлысты и исключает складские остатки', () => {
  const summary = summarizeLongStockPurchaseBars([
    { stock_length_mm: 12_000, length_group: 'standard', source_type: 'new_stock' },
    { stock_length_mm: 12_000, length_group: 'standard', source_type: 'new_stock' },
    { stock_length_mm: 6_000, length_group: 'standard', source_type: 'new_stock' },
    { stock_length_mm: 3_699, length_group: null, source_type: 'business_remnant' },
  ])

  assert.deepEqual(summary.components, [
    { length_mm: 12_000, piece_count: 2, is_nonstandard: false },
    { length_mm: 6_000, piece_count: 1, is_nonstandard: false },
  ])
  assert.equal(summary.total_piece_count, 3)
  assert.equal(summary.total_length_mm, 30_000)
  assert.equal(formatLongStockPurchaseComposition(summary.components), '12 000 × 2 + 6 000 × 1')
})

test('ножи, круг и непроволочная труба передают снабжению два новых хлыста, а не складской третий', () => {
  for (const category of ['ножи', 'круг', 'непроволочная труба']) {
    const summary = summarizeLongStockPurchaseBars([
      { stock_length_mm: 6_000, length_group: 'standard', source_type: 'business_remnant' },
      { stock_length_mm: 6_000, length_group: 'standard', source_type: 'new_stock' },
      { stock_length_mm: 6_000, length_group: 'standard', source_type: 'new_stock' },
    ])

    assert.deepEqual(
      summary,
      {
        components: [{ length_mm: 6_000, piece_count: 2, is_nonstandard: false }],
        total_piece_count: 2,
        total_length_mm: 12_000,
        uses_nonstandard_length: false,
      },
      `${category}: складская бронь не должна попадать в закупку`,
    )
  }
})

test('нестандартная длина сохраняет явную пометку', () => {
  const summary = summarizeLongStockPurchaseBars([
    { stock_length_mm: 8_500, length_group: 'nonstandard', source_type: 'new_stock' },
  ])

  assert.equal(summary.uses_nonstandard_length, true)
  assert.deepEqual(summary.components, [
    { length_mm: 8_500, piece_count: 1, is_nonstandard: true },
  ])
})

test('объединяет закупочный состав нескольких позиций одного материала', () => {
  const makePlan = (components: LongStockPurchasePlan['components']): LongStockPurchasePlan => ({
    plan_id: crypto.randomUUID(),
    plan_number: 1,
    version_id: crypto.randomUUID(),
    version_number: 1,
    version_status: 'approved',
    cutting_status: 'plan_approved',
    components,
    total_piece_count: 0,
    total_length_mm: 0,
    uses_nonstandard_length: false,
  })

  const summary = mergeLongStockPurchasePlans([
    makePlan([{ length_mm: 12_000, piece_count: 2, is_nonstandard: false }]),
    makePlan([
      { length_mm: 12_000, piece_count: 1, is_nonstandard: false },
      { length_mm: 6_000, piece_count: 2, is_nonstandard: false },
    ]),
  ])

  assert.deepEqual(summary.components, [
    { length_mm: 12_000, piece_count: 3, is_nonstandard: false },
    { length_mm: 6_000, piece_count: 2, is_nonstandard: false },
  ])
})

test('для ножей, круга и трубы исключает из поставки складской хлыст и лишнюю строку графика', () => {
  const plan: LongStockPurchasePlan = {
    plan_id: 'plan',
    plan_number: 1,
    version_id: 'version',
    version_number: 1,
    version_status: 'approved',
    cutting_status: 'plan_approved',
    components: [{ length_mm: 6_000, piece_count: 2, is_nonstandard: false }],
    total_piece_count: 2,
    total_length_mm: 12_000,
    uses_nonstandard_length: false,
  }
  const schedules = [
    {
      id: 'required',
      delivery_date: '2026-09-08',
      created_at: '2026-09-06T09:00:00Z',
      status: 'planned',
      quantity: 12_000,
      planned_piece_length_mm: 6_000,
      planned_piece_count: 2,
    },
    {
      id: 'stale-excess',
      delivery_date: '2026-09-08',
      created_at: '2026-09-06T09:01:00Z',
      status: 'planned',
      quantity: 6_000,
      planned_piece_length_mm: 6_000,
      planned_piece_count: 1,
    },
  ]

  for (const category of ['ножи', 'круг', 'непроволочная труба']) {
    const projected = projectPlannedLongStockSchedulesToPurchasePlan(schedules, plan)
    assert.deepEqual(
      projected.map((schedule) => ({ id: schedule.id, quantity: schedule.quantity, pieces: schedule.planned_piece_count })),
      [{ id: 'required', quantity: 12_000, pieces: 2 }],
      `${category}: поставщик должен везти только два новых хлыста из карты`,
    )
  }
})

test('перенос даты связанной строки не разделяет два закупочных хлыста между рейсом и старым графиком', () => {
  const plan: LongStockPurchasePlan = {
    plan_id: 'plan',
    plan_number: 1,
    version_id: 'version',
    version_number: 1,
    version_status: 'approved',
    cutting_status: 'plan_approved',
    components: [{ length_mm: 6_000, piece_count: 2, is_nonstandard: false }],
    total_piece_count: 2,
    total_length_mm: 12_000,
    uses_nonstandard_length: false,
  }
  const projected = projectPlannedLongStockSchedulesToPurchasePlan([
    {
      id: 'trip-schedule',
      delivery_date: '2026-09-10',
      created_at: '2026-09-06T09:00:00Z',
      status: 'planned',
      quantity: 12_000,
      planned_piece_length_mm: 6_000,
      planned_piece_count: 2,
    },
    {
      id: 'stale-excess',
      delivery_date: '2026-09-08',
      created_at: '2026-09-06T09:01:00Z',
      status: 'planned',
      quantity: 6_000,
      planned_piece_length_mm: 6_000,
      planned_piece_count: 1,
    },
  ], plan)

  assert.deepEqual(
    projected.map((schedule) => ({ id: schedule.id, quantity: schedule.quantity, pieces: schedule.planned_piece_count })),
    [{ id: 'trip-schedule', quantity: 12_000, pieces: 2 }],
  )
})

test('активная связь рейса имеет приоритет над устаревшей строкой независимо от порядка создания', () => {
  const plan: LongStockPurchasePlan = {
    plan_id: 'plan',
    plan_number: 1,
    version_id: 'version',
    version_number: 1,
    version_status: 'approved',
    cutting_status: 'plan_approved',
    components: [{ length_mm: 6_000, piece_count: 2, is_nonstandard: false }],
    total_piece_count: 2,
    total_length_mm: 12_000,
    uses_nonstandard_length: false,
  }
  const projected = projectPlannedLongStockSchedulesToPurchasePlan([
    {
      id: 'stale-excess',
      delivery_date: '2026-09-08',
      created_at: '2026-09-05T09:00:00Z',
      status: 'planned',
      quantity: 6_000,
      planned_piece_length_mm: 6_000,
      planned_piece_count: 1,
    },
    {
      id: 'trip-schedule',
      delivery_date: '2026-09-10',
      created_at: '2026-09-06T09:00:00Z',
      status: 'planned',
      quantity: 12_000,
      planned_piece_length_mm: 6_000,
      planned_piece_count: 2,
    },
  ], plan, { preferredScheduleIds: new Set(['trip-schedule']) })

  assert.deepEqual(
    projected.map((schedule) => ({ id: schedule.id, quantity: schedule.quantity, pieces: schedule.planned_piece_count })),
    [{ id: 'trip-schedule', quantity: 12_000, pieces: 2 }],
  )
})

test('после частичной поставки оставляет к перевозке только непринятые закупочные хлысты', () => {
  const plan: LongStockPurchasePlan = {
    plan_id: 'plan',
    plan_number: 1,
    version_id: 'version',
    version_number: 1,
    version_status: 'approved',
    cutting_status: 'plan_approved',
    components: [{ length_mm: 6_000, piece_count: 2, is_nonstandard: false }],
    total_piece_count: 2,
    total_length_mm: 12_000,
    uses_nonstandard_length: false,
  }
  const projected = projectPlannedLongStockSchedulesToPurchasePlan([
    {
      id: 'delivered',
      delivery_date: '2026-09-07',
      status: 'delivered',
      quantity: 6_000,
      planned_piece_length_mm: 6_000,
      planned_piece_count: 1,
      received_piece_length_mm: 6_000,
      received_piece_count: 1,
      receipt_parent_schedule_id: null,
    },
    {
      id: 'remaining',
      delivery_date: '2026-09-08',
      status: 'planned',
      quantity: 12_000,
      planned_piece_length_mm: 6_000,
      planned_piece_count: 2,
    },
  ], plan)

  assert.deepEqual(
    projected.map((schedule) => ({ id: schedule.id, quantity: schedule.quantity, pieces: schedule.planned_piece_count })),
    [
      { id: 'delivered', quantity: 6_000, pieces: 1 },
      { id: 'remaining', quantity: 6_000, pieces: 1 },
    ],
  )
})

test('полностью складская карта не создаёт закупку и перевозку', () => {
  const plan: LongStockPurchasePlan = {
    plan_id: 'warehouse-plan',
    plan_number: 1,
    version_id: 'warehouse-version',
    version_number: 1,
    version_status: 'approved',
    cutting_status: 'plan_approved',
    components: [],
    total_piece_count: 0,
    total_length_mm: 0,
    uses_nonstandard_length: false,
  }

  assert.deepEqual(projectPlannedLongStockSchedulesToPurchasePlan([{
    id: 'stale-supplier-row',
    delivery_date: '2026-09-08',
    status: 'planned',
    quantity: 6_000,
    planned_piece_length_mm: 6_000,
    planned_piece_count: 1,
  }], plan), [])
})

test('неоднозначная старая строка без состава хлыстов не попадает к поставщику', () => {
  const plan: LongStockPurchasePlan = {
    plan_id: 'mixed-plan',
    plan_number: 1,
    version_id: 'mixed-version',
    version_number: 1,
    version_status: 'approved',
    cutting_status: 'plan_approved',
    components: [
      { length_mm: 12_000, piece_count: 1, is_nonstandard: false },
      { length_mm: 6_000, piece_count: 1, is_nonstandard: false },
    ],
    total_piece_count: 2,
    total_length_mm: 18_000,
    uses_nonstandard_length: false,
  }

  assert.deepEqual(projectPlannedLongStockSchedulesToPurchasePlan([{
    id: 'ambiguous-legacy-row',
    delivery_date: '2026-09-08',
    status: 'planned',
    quantity: 6_000,
    planned_piece_length_mm: null,
    planned_piece_count: null,
  }], plan), [])
})
