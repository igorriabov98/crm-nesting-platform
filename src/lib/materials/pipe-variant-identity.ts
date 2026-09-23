import { sameRectangularDimensions } from './rotatable-dimensions'

type PipeVariantIdentity = {
  material_id?: unknown
  category?: unknown
  pipe_type?: unknown
  steel_type_id?: unknown
  material_grade?: unknown
  wall_thickness_mm?: unknown
  piece_description?: unknown
  diameter_mm?: unknown
}

export function sameRotatedPipeVariant(left: PipeVariantIdentity, right: PipeVariantIdentity) {
  const type = String(left.pipe_type ?? '')
  if (type !== 'square' && type !== 'rectangular') return false
  const sameText = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
  return left.category === 'pipe'
    && right.category === 'pipe'
    && left.material_id === right.material_id
    && type === right.pipe_type
    && left.steel_type_id === right.steel_type_id
    && sameText(left.material_grade, right.material_grade)
    && Number(left.wall_thickness_mm) > 0
    && Number(right.wall_thickness_mm) > 0
    && Number(left.wall_thickness_mm) === Number(right.wall_thickness_mm)
    && Number(left.diameter_mm || 0) === Number(right.diameter_mm || 0)
    && sameRectangularDimensions(left.piece_description, right.piece_description)
}
