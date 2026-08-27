import assert from 'node:assert/strict'
import test from 'node:test'
import { appendKnifePieceLengthToSummary } from './knife-piece-length-summary'

test('adds the physical piece length to knife characteristics', () => {
  assert.equal(
    appendKnifePieceLengthToSummary(
      'Hardox, Скос: не указан, Ширина: 200 мм, Высота: 20 мм',
      'knives',
      '12 000 мм',
    ),
    'Hardox, Скос: не указан, Ширина: 200 мм, Высота: 20 мм, Длина: 12 000 мм',
  )
})

test('shows that a knife piece length is missing', () => {
  assert.equal(
    appendKnifePieceLengthToSummary('без характеристик', 'knives', '—'),
    'без характеристик, Длина: —',
  )
})

test('does not add a piece length to unrelated categories', () => {
  assert.equal(
    appendKnifePieceLengthToSummary('RAL 9005', 'paint', '—'),
    'RAL 9005',
  )
})
