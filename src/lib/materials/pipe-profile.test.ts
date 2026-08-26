import assert from 'node:assert/strict'
import test from 'node:test'
import {
  requireCanonicalPipeProfile,
  roundPipeOuterDiameterMm,
  validatePipeProfileGeometry,
} from './pipe-profile'

test('round pipe rejects a square section entered as its diameter', () => {
  assert.equal(validatePipeProfileGeometry({
    pipe_type: 'round',
    size: '40×40',
    wall_thickness_mm: 3,
  }), 'Для круглой трубы укажите один наружный диаметр, а не размер вида 40×40.')
})

test('round pipe uses only the outer diameter in its canonical profile', () => {
  assert.deepEqual(requireCanonicalPipeProfile({
    pipe_type: 'round',
    diameter_mm: '60',
    wall_thickness_mm: '4',
  }), {
    pipeType: 'round',
    diameterMm: 60,
    pieceDescription: null,
    wallThicknessMm: 4,
  })
})

test('legacy single-number round size remains readable but is canonicalized', () => {
  const legacy = {
    pipe_type: 'round',
    piece_description: '48,3',
    wall_thickness_mm: 3,
  }
  assert.equal(roundPipeOuterDiameterMm(legacy), 48.3)
  assert.equal(requireCanonicalPipeProfile(legacy).pieceDescription, null)
  assert.equal(requireCanonicalPipeProfile(legacy).diameterMm, 48.3)
})

test('round pipe rejects an impossible wall thickness', () => {
  assert.equal(validatePipeProfileGeometry({
    pipe_type: 'round',
    diameter_mm: 40,
    wall_thickness_mm: 20,
  }), 'Толщина стенки трубы не может быть больше или равна половине наружного диаметра.')
})

test('partial custom pipe edits may be empty but reject an entered invalid diameter', () => {
  assert.equal(validatePipeProfileGeometry({
    pipe_type: 'round',
    diameter_mm: '',
    wall_thickness_mm: '',
  }, { requireComplete: false }), null)
  assert.equal(validatePipeProfileGeometry({
    pipe_type: 'round',
    diameter_mm: '0',
    wall_thickness_mm: '',
  }, { requireComplete: false }), 'Введите наружный диаметр круглой трубы')
})

test('square pipe keeps its two-dimensional section and has no diameter', () => {
  assert.deepEqual(requireCanonicalPipeProfile({
    pipe_type: 'square',
    size: '40×40',
    wall_thickness_mm: 3,
  }), {
    pipeType: 'square',
    diameterMm: null,
    pieceDescription: '40×40',
    wallThicknessMm: 3,
  })
})
