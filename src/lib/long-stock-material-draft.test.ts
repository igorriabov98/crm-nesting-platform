import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLongStockMaterialDraft,
  longStockDraftDemandPatch,
  validateLongStockDialogAction,
  validateLongStockMaterialDraft,
} from '@/lib/long-stock-material-draft'

test('creates a new material without requiring a selected catalog variant or valid segments', () => {
  const draft = createLongStockMaterialDraft('Круг Hardox', 'circle')
  draft.fields = {
    ...draft.fields,
    steel_type_id: 'hardox-id',
    diameter_mm: '40',
  }

  assert.equal(validateLongStockDialogAction('create_material', {
    materialVariantId: null,
    segmentError: 'Строка 1: длина должна быть больше 0 мм',
    newMaterialDraft: draft,
  }), null)
})

test('catalog calculations validate only variant selection and segments for every calculation mode', () => {
  for (const mode of ['standard', 'mixed', 'with_nonstandard'] as const) {
    assert.equal(validateLongStockDialogAction(mode, {
      materialVariantId: 'catalog-variant-id',
      segmentError: null,
      newMaterialDraft: null,
    }), null)
  }
})

test('mixed and optimal recalculations update demand without resending catalog characteristics', () => {
  const patch = longStockDraftDemandPatch('request_pipe', 8200, 3)
  assert.deepEqual(patch, {
    remainder_length_mm: 8200,
    remainder_qty: 3,
    remainder_kg: 0,
  })
  assert.equal('material_variant_id' in patch, false)
  assert.equal('size' in patch, false)
  assert.equal('wall_thickness_mm' in patch, false)
  assert.equal('steel_type_id' in patch, false)
})

test('new pipe variant keeps characteristic validation scoped to material creation', () => {
  const draft = createLongStockMaterialDraft('Труба Hardox', 'pipe')
  draft.fields = {
    ...draft.fields,
    steel_type_id: 'hardox-id',
    size: '40×40',
    wall_thickness_mm: '20',
  }
  assert.equal(
    validateLongStockMaterialDraft(draft),
    'Толщина стенки трубы не может быть больше или равна половине меньшей стороны размера.',
  )
})

test('new knife profile requires section and bevel but never asks for a standard length', () => {
  const draft = createLongStockMaterialDraft('Нож Hardox', 'knives')
  assert.equal('standard_length_mm' in draft.fields, false)
  draft.fields = {
    ...draft.fields,
    steel_type_id: 'hardox-id',
    knife_bevel_count: '2',
    width_mm: '200',
    height_mm: '20',
  }
  assert.equal(validateLongStockMaterialDraft(draft), null)
})
