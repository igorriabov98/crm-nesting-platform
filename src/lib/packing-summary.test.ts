import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultPackingBoxGroup,
  packingSummaryFromGroups,
  totalPackingPlaces,
} from './packing-summary'

test('creates one usable packing group from the saved cardboard-box count', () => {
  const group = defaultPackingBoxGroup(24, 1)

  assert.deepEqual(group, {
    start_item_number: 1,
    end_item_number: 1,
    packing_type_en: 'Cardboard boxes',
    packing_type_ua: 'картонні коробки',
    places: 24,
    sort_order: 0,
  })
  assert.equal(totalPackingPlaces(group ? [group] : []), 24)
  assert.equal(packingSummaryFromGroups(group ? [group] : [], 'en', 24), '24 Cardboard boxes')
})

test('does not create a group without boxes or goods positions', () => {
  assert.equal(defaultPackingBoxGroup(0, 1), null)
  assert.equal(defaultPackingBoxGroup(24, 0), null)
})

test('keeps the legacy box summary when explicit groups describe another package type', () => {
  assert.equal(packingSummaryFromGroups([{
    packing_type_en: 'Wooden crate',
    packing_type_ua: 'деревʼяний ящик',
    places: 2,
  }], 'en', 24), '2 Wooden crates and 24 cardboard boxes')
})
