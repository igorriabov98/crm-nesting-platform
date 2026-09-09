import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PACKING_GROUP_PRESETS,
  packingSummaryFromGroups,
  totalPackingPlaces,
} from './packing-summary'

test('keeps the box count separate from packing groups', () => {
  assert.equal(totalPackingPlaces([]), 0)
  assert.equal(packingSummaryFromGroups([], 'en', 24), '24 cardboard boxes')
  assert.equal(packingSummaryFromGroups([], 'ua', 24), '24 картонні коробки')
})

test('provides the two supported packing-group presets', () => {
  assert.deepEqual(PACKING_GROUP_PRESETS, [
    {
      key: 'pack',
      label: 'Pack (пачка)',
      packing_type_en: 'Pack',
      packing_type_ua: 'пачка',
    },
    {
      key: 'wooden-pallet',
      label: 'Wooden pallet (дерев. піддон)',
      packing_type_en: 'Wooden pallet',
      packing_type_ua: 'дерев. піддон',
    },
  ])
})

test('shows explicit packing groups and the independent box count together', () => {
  assert.equal(packingSummaryFromGroups([{
    packing_type_en: 'Wooden pallet',
    packing_type_ua: 'дерев. піддон',
    places: 2,
  }], 'en', 24), '2 Wooden pallets and 24 cardboard boxes')
})
