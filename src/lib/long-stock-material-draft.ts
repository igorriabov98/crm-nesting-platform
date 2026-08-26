import {
  requireCanonicalPipeProfile,
  validatePipeProfileGeometry,
} from '@/lib/materials/pipe-profile'

export type LongStockMaterialCategory = 'circle' | 'pipe' | 'knives'

export type LongStockNewMaterialDraft = {
  name: string
  category: LongStockMaterialCategory
  fields: Record<string, string | boolean>
}

export type LongStockDialogAction = 'create_material' | 'standard' | 'mixed' | 'with_nonstandard'

export function validateLongStockDialogAction(
  action: LongStockDialogAction,
  input: {
    materialVariantId?: string | null
    segmentError?: string | null
    newMaterialDraft?: LongStockNewMaterialDraft | null
  },
) {
  if (action === 'create_material') {
    return input.newMaterialDraft
      ? validateLongStockMaterialDraft(input.newMaterialDraft)
      : 'Заполните новый материал'
  }
  if (!String(input.materialVariantId ?? '').trim()) {
    return 'Расчёт доступен только после выбора конкретного варианта материала.'
  }
  return input.segmentError ?? null
}

export function longStockDraftDemandPatch(
  table: 'request_circle' | 'request_pipe' | 'request_knives',
  totalLengthMm: number,
  pieceCount: number,
) {
  if (table === 'request_circle') return { remainder_mm: totalLengthMm }
  if (table === 'request_pipe') {
    return {
      remainder_length_mm: totalLengthMm,
      remainder_qty: pieceCount,
      remainder_kg: 0,
    }
  }
  return {
    remainder_meters: totalLengthMm / 1000,
    remainder_qty: pieceCount,
  }
}

export function createLongStockMaterialDraft(
  name: string,
  category: LongStockMaterialCategory,
): LongStockNewMaterialDraft {
  let fields: Record<string, string | boolean>
  if (category === 'circle') {
    fields = { steel_type_id: '', diameter_mm: '', is_calibrated: false }
  } else if (category === 'pipe') {
    fields = { pipe_type: 'square', steel_type_id: '', size: '', diameter_mm: '', wall_thickness_mm: '' }
  } else {
    fields = { steel_type_id: '', knife_bevel_count: '', width_mm: '', height_mm: '' }
  }
  return { name, category, fields }
}

export function validateLongStockMaterialDraft(draft: LongStockNewMaterialDraft) {
  if (!draft.name.trim()) return 'Введите название материала'
  if (!stringValue(draft.fields.steel_type_id)) return 'Выберите тип металла'

  if (draft.category === 'circle') {
    if (!positiveNumber(draft.fields.diameter_mm)) return 'Введите диаметр круга'
    return null
  }

  if (draft.category === 'pipe') {
    const pipeType = stringValue(draft.fields.pipe_type)
    if (!pipeType) return 'Выберите подтип трубы'
    if (pipeType === 'wire') return 'Проволока остаётся в прежнем интерфейсе'
    return validatePipeProfileGeometry(draft.fields)
  }

  if (!stringValue(draft.fields.knife_bevel_count)) return 'Выберите скос ножа'
  if (!positiveNumber(draft.fields.width_mm)) return 'Введите ширину ножа'
  if (!positiveNumber(draft.fields.height_mm)) return 'Введите высоту ножа'
  return null
}

export function longStockMaterialCharacteristics(
  draft: LongStockNewMaterialDraft,
  steelTypeName: string | null,
) {
  const steelTypeId = stringValue(draft.fields.steel_type_id)
  if (draft.category === 'circle') {
    return {
      steel_type_id: steelTypeId,
      material_grade: steelTypeName,
      diameter_mm: draft.fields.diameter_mm,
      is_calibrated: Boolean(draft.fields.is_calibrated),
    }
  }
  if (draft.category === 'pipe') {
    const pipeProfile = requireCanonicalPipeProfile(draft.fields)
    return {
      pipe_type: pipeProfile.pipeType,
      steel_type_id: steelTypeId,
      material_grade: steelTypeName,
      size: pipeProfile.pieceDescription,
      diameter_mm: pipeProfile.diameterMm,
      wall_thickness_mm: pipeProfile.wallThicknessMm,
    }
  }
  return {
    steel_type_id: steelTypeId,
    material_grade: steelTypeName,
    knife_material: steelTypeName,
    knife_bevel_count: draft.fields.knife_bevel_count,
    standard_length_mm: null,
    knife_dimensions: null,
    width_mm: draft.fields.width_mm,
    height_mm: draft.fields.height_mm,
  }
}

function stringValue(value: unknown) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function positiveNumber(value: unknown) {
  const parsed = Number(String(value ?? '').trim().replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
