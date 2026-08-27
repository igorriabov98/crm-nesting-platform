import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendLongStockPieceLengthToSummary,
  newMaterialReceiptPieceLength,
  requiresPhysicalPieceLength,
  validateNewMaterialPieceLength,
} from './long-stock-piece-length-summary'

test('adds the physical piece length to knife, circle, and non-wire pipe characteristics', () => {
  assert.equal(
    appendLongStockPieceLengthToSummary(
      'Hardox, Скос: не указан, Ширина: 200 мм, Высота: 20 мм',
      'knives',
      null,
      '12 000 мм',
    ),
    'Hardox, Скос: не указан, Ширина: 200 мм, Высота: 20 мм, Длина: 12 000 мм',
  )
  assert.equal(
    appendLongStockPieceLengthToSummary('Hardox, Диаметр: 40 мм', 'circle', null, '6 000 мм'),
    'Hardox, Диаметр: 40 мм, Длина: 6 000 мм',
  )
  assert.equal(
    appendLongStockPieceLengthToSummary('Квадратная, Hardox, Сечение: 40x40 мм', 'pipe', 'square', '8 000 мм'),
    'Квадратная, Hardox, Сечение: 40x40 мм, Длина: 8 000 мм',
  )
})

test('does not add or request a physical piece length for wire', () => {
  assert.equal(
    appendLongStockPieceLengthToSummary('Проволока, Диаметр: 2 мм', 'pipe', 'wire', '—'),
    'Проволока, Диаметр: 2 мм',
  )
  assert.equal(requiresPhysicalPieceLength('pipe', 'wire'), false)
  assert.equal(newMaterialReceiptPieceLength('pipe', { pipe_type: 'wire', piece_length_mm: '6000' }), '')
  assert.equal(validateNewMaterialPieceLength('pipe', { pipe_type: 'wire', piece_length_mm: '' }), null)
})

test('moves the new-material physical length into the receipt for every whole-bar category', () => {
  for (const [category, pipeType] of [
    ['circle', ''],
    ['knives', ''],
    ['pipe', 'square'],
    ['pipe', 'round'],
  ] as const) {
    assert.equal(requiresPhysicalPieceLength(category, pipeType), true)
    assert.equal(newMaterialReceiptPieceLength(category, {
      pipe_type: pipeType,
      piece_length_mm: ' 6000 ',
    }), '6000')
    assert.equal(validateNewMaterialPieceLength(category, {
      pipe_type: pipeType,
      piece_length_mm: '6000',
    }), null)
    assert.equal(validateNewMaterialPieceLength(category, {
      pipe_type: pipeType,
      piece_length_mm: '',
    }), 'Введите длину материала')
  }
})

test('does not add a physical piece length to unrelated categories', () => {
  assert.equal(
    appendLongStockPieceLengthToSummary('RAL 9005', 'paint', null, '—'),
    'RAL 9005',
  )
})
