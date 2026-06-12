import type { MaterialSelectionSource } from './MaterialSearch'

type RequestMaterialVariantRow = {
  material_id?: string | null
  material_variant_id?: string | null
  is_custom_material_variant?: boolean | null
}

export function isCustomVariantSource(source: MaterialSelectionSource) {
  return source === 'new_material'
}

export function canEditMaterialCharacteristics(row: RequestMaterialVariantRow, canEdit: boolean) {
  if (!canEdit) return false
  return row.is_custom_material_variant === true && !row.material_variant_id
}
