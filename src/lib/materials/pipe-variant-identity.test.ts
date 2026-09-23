import assert from 'node:assert/strict'
import test from 'node:test'
import { sameRotatedPipeVariant } from './pipe-variant-identity'

const profile = {
  material_id: 'pipe-material',
  category: 'pipe',
  pipe_type: 'rectangular',
  steel_type_id: 'steel-1',
  material_grade: 'S235',
  wall_thickness_mm: 4,
  piece_description: '100×50',
  diameter_mm: null,
}

test('rotated rectangular pipe variants share identity only with matching material and wall', () => {
  assert.equal(sameRotatedPipeVariant(profile, { ...profile, piece_description: '50x100' }), true)
  assert.equal(sameRotatedPipeVariant(profile, { ...profile, wall_thickness_mm: 5, piece_description: '50x100' }), false)
  assert.equal(sameRotatedPipeVariant(profile, { ...profile, material_id: 'different', piece_description: '50x100' }), false)
  assert.equal(sameRotatedPipeVariant(profile, { ...profile, pipe_type: 'square', piece_description: '50x100' }), false)
  assert.equal(sameRotatedPipeVariant({ ...profile, pipe_type: 'round' }, profile), false)
})
