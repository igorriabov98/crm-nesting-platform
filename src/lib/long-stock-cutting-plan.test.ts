import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertLongStockCuttingPlanApprovalSucceeded,
  normalizeLongStockPlanSegments,
  serializeLongStockCandidates,
  supportsLongStockSourceSelection,
  solverModeForPlan,
  validateManualLongStockLayout,
} from './long-stock-cutting-plan'

test('approval self-invalidation is reported as an error', () => {
  assert.throws(
    () => assertLongStockCuttingPlanApprovalSucceeded({
      status: 'invalid',
      position_status: 'requires_recalculation',
    }),
    /Утверждение не состоялось.*Требуется пересчёт/u,
  )
  const approved = { status: 'approved', position_status: 'plan_approved' }
  assert.equal(assertLongStockCuttingPlanApprovalSucceeded(approved), approved)
})

test('approval source conflict is reported with the server explanation', () => {
  assert.throws(
    () => assertLongStockCuttingPlanApprovalSucceeded({
      status: 'conflict',
      message: 'Хлыст №1 уже занят другим технологом',
    }),
    /Хлыст №1 уже занят другим технологом/u,
  )
})

const workpieces = normalizeLongStockPlanSegments([
  { id: 'part-b', lengthMm: 1200 },
  { id: 'part-a', lengthMm: 2300 },
])

test('manual layout reports the exact overflowing bar and millimetres', () => {
  assert.throws(
    () => validateManualLongStockLayout({
      workpieces,
      businessRemnants: [],
      purchaseLengths: [{ lengthMm: 3500, kind: 'standard' }],
      bars: [{
        source: 'new_stock',
        stockLengthMm: 3500,
        purchaseLengthKind: 'standard',
        cuts: [{ workpieceId: 'part-a' }, { workpieceId: 'part-b' }],
      }],
      kerfMm: 1,
      endTrimMm: 0,
    }),
    /Переполнение хлыста №1: превышение 2 мм/,
  )
})

test('manual layout rejects a lost workpiece', () => {
  assert.throws(
    () => validateManualLongStockLayout({
      workpieces,
      businessRemnants: [],
      purchaseLengths: [{ lengthMm: 6000, kind: 'standard' }],
      bars: [{
        source: 'new_stock',
        stockLengthMm: 6000,
        purchaseLengthKind: 'standard',
        cuts: [{ workpieceId: 'part-a' }],
      }],
      kerfMm: 1,
      endTrimMm: 0,
    }),
    /Потеряны заготовки: part-b/,
  )
})

test('manual layout rejects a duplicated workpiece', () => {
  assert.throws(
    () => validateManualLongStockLayout({
      workpieces,
      businessRemnants: [],
      purchaseLengths: [{ lengthMm: 6000, kind: 'standard' }],
      bars: [{
        source: 'new_stock',
        stockLengthMm: 6000,
        purchaseLengthKind: 'standard',
        cuts: [
          { workpieceId: 'part-a' },
          { workpieceId: 'part-a' },
          { workpieceId: 'part-b' },
        ],
      }],
      kerfMm: 1,
      endTrimMm: 0,
    }),
    /заготовка part-a задвоена/,
  )
})

test('manual layout uses only a currently available exact business remnant', () => {
  const candidate = validateManualLongStockLayout({
    workpieces: [{ id: 'part', lengthMm: 300 }],
    businessRemnants: [{ id: 'inventory-400', lengthMm: 400, createdAt: '2026-01-01T00:00:00Z' }],
    purchaseLengths: [{ lengthMm: 6000, kind: 'standard' }],
    bars: [{
      source: 'business_remnant',
      businessRemnantId: 'inventory-400',
      stockLengthMm: 400,
      cuts: [{ workpieceId: 'part' }],
    }],
    kerfMm: 1,
    endTrimMm: 0,
  })

  assert.equal(candidate.purchasedLengthMm, 0)
  assert.equal(candidate.bars[0].remainderMm, 99)
})

test('candidate serialization preserves source inventory and exact cut mapping', () => {
  const candidate = validateManualLongStockLayout({
    workpieces: [{ id: 'part', lengthMm: 300 }],
    businessRemnants: [{ id: 'inventory-400', lengthMm: 400, createdAt: '2026-01-01T00:00:00Z' }],
    purchaseLengths: [{ lengthMm: 6000, kind: 'standard' }],
    bars: [{
      source: 'business_remnant',
      businessRemnantId: 'inventory-400',
      stockLengthMm: 400,
      cuts: [{ workpieceId: 'part' }],
    }],
    kerfMm: 1,
    endTrimMm: 0,
  })
  const stored = serializeLongStockCandidates({
    candidates: [candidate],
    workpieces: [{ id: 'part', lengthMm: 300 }],
    weightPerMeterKg: 2,
  })

  assert.equal(stored[0].bars[0].source_inventory_id, 'inventory-400')
  assert.equal(stored[0].bars[0].length_group, null)
  assert.equal(stored[0].bars[0].cuts[0].segment_number, 1)
  assert.equal(stored[0].metrics.business_scrap_length_mm, 99)
  assert.equal(stored[0].metrics.business_scrap_weight_kg, 0.198)
})

test('calculation modes map to solver flags explicitly', () => {
  assert.deepEqual(solverModeForPlan(), { mode: 'standard_only', allowMixedLengths: false })
  assert.deepEqual(solverModeForPlan('with_nonstandard'), { mode: 'optimal', allowMixedLengths: false })
  assert.deepEqual(solverModeForPlan('mixed'), { mode: 'standard_only', allowMixedLengths: true })
})

test('source selection covers circles, non-wire pipes and every exact knife variant', () => {
  assert.equal(supportsLongStockSourceSelection('circle', null), true)
  assert.equal(supportsLongStockSourceSelection('pipe', 'round'), true)
  assert.equal(supportsLongStockSourceSelection('pipe', 'profile'), true)
  assert.equal(supportsLongStockSourceSelection('pipe', 'standard'), true)
  assert.equal(supportsLongStockSourceSelection('pipe', 'wire'), false)
  assert.equal(supportsLongStockSourceSelection('knives', null), true)
  assert.equal(supportsLongStockSourceSelection('sheet', null), false)
})
