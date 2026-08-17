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
    fields = { pipe_type: 'square', steel_type_id: '', size: '', wall_thickness_mm: '' }
  } else {
    fields = { steel_type_id: '', knife_bevel_count: '', standard_length_mm: '', width_mm: '', height_mm: '' }
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
    const size = stringValue(draft.fields.size)
    if (!size) return pipeType === 'round' ? 'Введите диаметр трубы' : 'Введите размер трубы'
    const wall = positiveNumber(draft.fields.wall_thickness_mm)
    if (wall === null) return 'Введите толщину стенки трубы'

    if (pipeType === 'round') {
      const diameter = positiveNumber(size)
      if (diameter === null) return 'Диаметр трубы должен быть положительным числом'
      if (wall * 2 >= diameter) {
        return 'Толщина стенки трубы не может быть больше или равна половине диаметра.'
      }
      return null
    }

    const dimensions = parseDimensions(size)
    if (!dimensions) return 'Размер трубы укажите как ширина × высота'
    if (wall * 2 >= Math.min(dimensions[0], dimensions[1])) {
      return 'Толщина стенки трубы не может быть больше или равна половине меньшей стороны размера.'
    }
    return null
  }

  if (!stringValue(draft.fields.knife_bevel_count)) return 'Выберите скос ножа'
  if (!positiveNumber(draft.fields.standard_length_mm)) return 'Введите длину ножа'
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
    return {
      pipe_type: draft.fields.pipe_type,
      steel_type_id: steelTypeId,
      material_grade: steelTypeName,
      size: draft.fields.size,
      wall_thickness_mm: draft.fields.wall_thickness_mm,
    }
  }
  return {
    steel_type_id: steelTypeId,
    material_grade: steelTypeName,
    knife_material: steelTypeName,
    knife_bevel_count: draft.fields.knife_bevel_count,
    standard_length_mm: draft.fields.standard_length_mm,
    width_mm: draft.fields.width_mm,
    height_mm: draft.fields.height_mm,
  }
}

function parseDimensions(value: string) {
  const dimensions = value
    .replace(/[хХ×*]/g, 'x')
    .split('x')
    .map((part) => positiveNumber(part.trim()))
  return dimensions.length >= 2 && dimensions.every((part) => part !== null)
    ? dimensions as number[]
    : null
}

function stringValue(value: unknown) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function positiveNumber(value: unknown) {
  const parsed = Number(String(value ?? '').trim().replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
