import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLongStockLayoutSettingsInput } from './long-stock-layout-settings'

const validSettings = {
  kerfMm: 1,
  endTrimMm: 0,
  optimizationHintThresholdPercent: 25,
  categories: [
    { key: 'circle', minimumUsefulLengthMm: 0, standardLengths: [6000, 12000], nonstandardLengths: [6500] },
    { key: 'pipe', minimumUsefulLengthMm: 0, standardLengths: [6000, 12000], nonstandardLengths: [6500] },
    { key: 'knife_bevel_1', minimumUsefulLengthMm: 0, standardLengths: [6000], nonstandardLengths: [6500] },
    { key: 'knife_bevel_2', minimumUsefulLengthMm: 0, standardLengths: [6000, 6500], nonstandardLengths: [7000] },
  ],
} as const

test('normalizes category and length order', () => {
  const parsed = parseLongStockLayoutSettingsInput({
    ...validSettings,
    categories: [...validSettings.categories].reverse().map((category) => ({
      ...category,
      standardLengths: [...category.standardLengths].reverse(),
    })),
  })
  assert.deepEqual(parsed.categories.map((category) => category.key), [
    'circle',
    'pipe',
    'knife_bevel_1',
    'knife_bevel_2',
  ])
  assert.deepEqual(parsed.categories[0].standardLengths, [6000, 12000])
})

test('rejects a duplicate inside and between length groups', () => {
  assert.throws(() => parseLongStockLayoutSettingsInput({
    ...validSettings,
    categories: validSettings.categories.map((category) => category.key === 'circle'
      ? { ...category, nonstandardLengths: [6000, 6500, 6500] }
      : category),
  }), /повторяется/u)
})

test('rejects negative values and an empty standard group', () => {
  assert.throws(() => parseLongStockLayoutSettingsInput({ ...validSettings, kerfMm: -1 }))
  assert.throws(() => parseLongStockLayoutSettingsInput({
    ...validSettings,
    categories: validSettings.categories.map((category) => category.key === 'knife_bevel_1'
      ? { ...category, minimumUsefulLengthMm: -1, standardLengths: [] }
      : category),
  }))
})
