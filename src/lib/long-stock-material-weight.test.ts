import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateLongStockWeightForLength,
  calculateLongStockWeightPerMeterKg,
  type LongStockWeightVariant,
} from '@/lib/long-stock-material-weight'

const density = 7.85 / 1_000_000
const baseVariant: LongStockWeightVariant = {
  category: 'circle',
  weight_per_m_kg: null,
  diameter_mm: null,
  pipe_type: null,
  wall_thickness_mm: null,
  piece_description: null,
  knife_dimensions: null,
  width_mm: null,
  height_mm: null,
}

test('uses explicit weight per meter when the variant provides it', () => {
  assert.equal(calculateLongStockWeightPerMeterKg({ ...baseVariant, weight_per_m_kg: 3.25 }, density), 3.25)
})

test('calculates circle and knife weight per meter from section and density', () => {
  const circle = calculateLongStockWeightPerMeterKg({ ...baseVariant, diameter_mm: 20 }, density)
  assert.ok(circle !== null)
  assert.ok(Math.abs(circle - Math.PI * 100 * 1000 * density) < 1e-10)

  const knife = calculateLongStockWeightPerMeterKg({
    ...baseVariant,
    category: 'knives',
    knife_dimensions: '6 000×100×10',
  }, density)
  assert.ok(knife !== null)
  assert.ok(Math.abs(knife - 7.85) < 1e-10)

  const knifeWithoutLegacyLength = calculateLongStockWeightPerMeterKg({
    ...baseVariant,
    category: 'knives',
    width_mm: 100,
    height_mm: 10,
  }, density)
  assert.equal(knifeWithoutLegacyLength, knife)

  const knifeWithProfileOnly = calculateLongStockWeightPerMeterKg({
    ...baseVariant,
    category: 'knives',
    knife_dimensions: '100×10',
  }, density)
  assert.equal(knifeWithProfileOnly, knife)
})

test('keeps demand and purchasing weights independent', () => {
  assert.equal(calculateLongStockWeightForLength(78.5, 10_000, 12_000), 94.2)
  assert.equal(calculateLongStockWeightForLength(78.5, 10_000, 6_000), 47.1)
  assert.equal(calculateLongStockWeightForLength(null, 10_000, 12_000), null)
  assert.equal(calculateLongStockWeightForLength(78.5, 0, 12_000), null)
})

test('calculates round and rectangular pipe weight per meter from section and density', () => {
  const round = calculateLongStockWeightPerMeterKg({
    ...baseVariant,
    category: 'pipe',
    pipe_type: 'round',
    piece_description: '50',
    wall_thickness_mm: 2,
  }, density)
  const expectedRoundSection = Math.PI * (25 ** 2 - 23 ** 2)
  assert.ok(round !== null)
  assert.ok(Math.abs(round - expectedRoundSection * 1000 * density) < 1e-10)

  const rectangular = calculateLongStockWeightPerMeterKg({
    ...baseVariant,
    category: 'pipe',
    pipe_type: 'rectangular',
    wall_thickness_mm: 3,
    piece_description: '100×50',
  }, density)
  assert.equal(rectangular, (100 * 50 - 94 * 44) * 1000 * density)
})

test('returns null when section or density is unavailable', () => {
  assert.equal(calculateLongStockWeightPerMeterKg(baseVariant, density), null)
  assert.equal(calculateLongStockWeightPerMeterKg({ ...baseVariant, diameter_mm: 20 }, null), null)
})
