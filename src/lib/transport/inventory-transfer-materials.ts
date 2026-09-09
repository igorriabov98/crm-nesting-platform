import {
  CHAIN_CORD_SUBTYPE_LABELS,
  MATERIAL_CATEGORY_LABELS,
  PIPE_SUBTYPE_LABELS,
} from '@/lib/constants/procurement'
import { calculateLongStockWeightPerMeterKg } from '@/lib/long-stock-material-weight'
import { knifeBevelLabel } from '@/lib/materials/knife-bevel'
import { knifeProfileDimensions } from '@/lib/materials/knife-profile'
import { roundPipeOuterDiameterMm } from '@/lib/materials/pipe-profile'

export type InventoryTransferMaterialVariant = {
  category: string
  steel_type_id?: string | null
  material_grade?: string | null
  thickness_mm?: number | null
  sheet_size?: string | null
  weight_per_unit_kg?: number | null
  length_m?: number | null
  weight_per_m_kg?: number | null
  piece_description?: string | null
  knife_dimensions?: string | null
  knife_material?: string | null
  knife_bevel_count?: number | null
  specification?: string | null
  default_unit?: string | null
  ral_code?: string | null
  finish?: string | null
  diameter_mm?: number | null
  is_calibrated?: boolean | null
  pipe_type?: string | null
  wall_thickness_mm?: number | null
  width_mm?: number | null
  height_mm?: number | null
  mesh_description?: string | null
  mesh_length_mm?: number | null
  mesh_width_mm?: number | null
  chain_cord_type?: string | null
  chain_cord_parameters?: string | null
  unit_weight_kg?: number | null
}

export type InventoryTransferMaterialCharacteristic = {
  label: string
  value: string
}

export type InventoryTransferMeasuredQuantity = {
  pieceLengthMm: number | null
  requestedSecondaryQuantity: number | null
  remainingQuantity: number
  remainingSecondaryQuantity: number | null
  unit: string
}

export function materialCategoryLabel(category: string | null) {
  if (!category) return null
  return (MATERIAL_CATEGORY_LABELS as Record<string, string>)[category] || category
}

export function inventoryTransferMaterialCharacteristics(input: {
  category: string | null
  variant: InventoryTransferMaterialVariant | null
  steelTypeName: string | null
}) {
  const { category, variant, steelTypeName } = input
  if (!category || !variant) return []

  const fields: InventoryTransferMaterialCharacteristic[] = []
  const push = (label: string, value: unknown, unit?: string) => {
    const formatted = formattedValue(value, unit)
    if (formatted) fields.push({ label, value: formatted })
  }
  const steelName = steelTypeName || variant.material_grade || variant.knife_material

  if (category === 'sheet_metal') {
    push('Марка стали', steelName)
    push('Размер листа', variant.sheet_size)
    push('Толщина', variant.thickness_mm, 'мм')
  } else if (category === 'circle') {
    push('Марка стали', steelName)
    push('Диаметр', variant.diameter_mm, 'мм')
    if (variant.is_calibrated !== null && variant.is_calibrated !== undefined) {
      push('Калиброванный', variant.is_calibrated ? 'Да' : 'Нет')
    }
  } else if (category === 'pipe') {
    push('Подтип', variant.pipe_type ? PIPE_SUBTYPE_LABELS[variant.pipe_type] || variant.pipe_type : null)
    push('Марка стали', steelName)
    if (variant.pipe_type === 'round') {
      push('Наружный диаметр', roundPipeOuterDiameterMm(variant), 'мм')
    } else if (variant.pipe_type !== 'wire') {
      push('Сечение', variant.piece_description)
    }
    push(variant.pipe_type === 'wire' ? 'Диаметр' : 'Толщина стенки',
      variant.pipe_type === 'wire' ? variant.diameter_mm : variant.wall_thickness_mm,
      'мм')
  } else if (category === 'knives') {
    const profile = knifeProfileDimensions(variant)
    push('Марка стали', steelName)
    push('Скос', knifeBevelLabel(variant.knife_bevel_count))
    push('Ширина', profile.widthMm, 'мм')
    push('Высота', profile.heightMm, 'мм')
  } else if (category === 'paint') {
    push('RAL', variant.ral_code)
    push('Покрытие', variant.finish)
  } else if (category === 'components') {
    push('Спецификация', variant.specification)
    push('Диаметр', variant.diameter_mm, 'мм')
  } else if (category === 'mesh') {
    push('Характеристика сетки', variant.mesh_description)
    push('Длина', variant.mesh_length_mm, 'мм')
    push('Ширина', variant.mesh_width_mm, 'мм')
  } else if (category === 'chain_cord') {
    push('Тип', variant.chain_cord_type
      ? CHAIN_CORD_SUBTYPE_LABELS[variant.chain_cord_type] || variant.chain_cord_type
      : null)
    push('Параметры', variant.chain_cord_parameters)
  }

  return fields
}

export function calculateInventoryTransferMaterialWeight(input: {
  remainingQuantity: number
  unit: string
  variant: InventoryTransferMaterialVariant | null
  densityKgMm3: number | null
  sourceStock: { totalQuantity: number; calculatedWeightKg: number | null } | null
}) {
  const { remainingQuantity, unit, variant, densityKgMm3, sourceStock } = input
  if (!Number.isFinite(remainingQuantity) || remainingQuantity < 0) return null
  if (remainingQuantity === 0) return 0

  const stockQuantity = positiveNumber(sourceStock?.totalQuantity)
  const stockWeightKg = positiveNumber(sourceStock?.calculatedWeightKg)
  if (stockQuantity !== null && stockWeightKg !== null) {
    return remainingQuantity * stockWeightKg / stockQuantity
  }

  const normalizedUnit = unit.trim().toLocaleLowerCase('ru').replace(/\./g, '')
  if (['кг', 'kg'].includes(normalizedUnit)) return remainingQuantity
  if (!variant) return null

  if (['мм', 'mm', 'м', 'm'].includes(normalizedUnit)) {
    const weightPerMeterKg = calculateLongStockWeightPerMeterKg({
      category: variant.category,
      weight_per_m_kg: variant.weight_per_m_kg ?? null,
      diameter_mm: variant.diameter_mm ?? null,
      pipe_type: variant.pipe_type ?? null,
      wall_thickness_mm: variant.wall_thickness_mm ?? null,
      piece_description: variant.piece_description ?? null,
      knife_dimensions: variant.knife_dimensions ?? null,
      width_mm: variant.width_mm ?? null,
      height_mm: variant.height_mm ?? null,
    }, densityKgMm3)
    if (weightPerMeterKg === null) return null
    return weightPerMeterKg * (['мм', 'mm'].includes(normalizedUnit) ? remainingQuantity / 1000 : remainingQuantity)
  }

  const unitWeightKg = positiveNumber(variant.weight_per_unit_kg)
    ?? positiveNumber(variant.unit_weight_kg)
  if (unitWeightKg !== null) return remainingQuantity * unitWeightKg

  const lengthM = positiveNumber(variant.length_m)
  const weightPerMeterKg = positiveNumber(variant.weight_per_m_kg)
  return lengthM !== null && weightPerMeterKg !== null
    ? remainingQuantity * lengthM * weightPerMeterKg
    : null
}

export function isMeasuredInventoryTransferItem(item: InventoryTransferMeasuredQuantity) {
  return item.pieceLengthMm !== null
    && Number.isFinite(item.pieceLengthMm)
    && item.pieceLengthMm > 0
    && item.requestedSecondaryQuantity !== null
}

export function formatInventoryTransferQuantity(
  item: InventoryTransferMeasuredQuantity,
  quantity: number,
  secondaryQuantity: number | null,
) {
  if (!isMeasuredInventoryTransferItem(item) || item.pieceLengthMm === null) {
    return `${numberLabel(quantity)} ${item.unit}`
  }
  const pieceCount = secondaryQuantity ?? quantity / item.pieceLengthMm
  return pieceCount > 0
    ? `${numberLabel(pieceCount)} шт. × ${numberLabel(item.pieceLengthMm)} мм`
    : '0 шт.'
}

export function inventoryTransferReceiptInputValue(item: InventoryTransferMeasuredQuantity) {
  if (!isMeasuredInventoryTransferItem(item) || item.pieceLengthMm === null) {
    return item.remainingQuantity
  }
  return item.remainingSecondaryQuantity ?? item.remainingQuantity / item.pieceLengthMm
}

export function inventoryTransferReceiptPrimaryQuantity(
  item: InventoryTransferMeasuredQuantity,
  displayedQuantity: number,
) {
  return isMeasuredInventoryTransferItem(item) && item.pieceLengthMm !== null
    ? displayedQuantity * item.pieceLengthMm
    : displayedQuantity
}

function formattedValue(value: unknown, unit?: string) {
  if (value === null || value === undefined || value === '') return null
  const formatted = typeof value === 'number'
    ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)
    : String(value).trim()
  return formatted ? `${formatted}${unit ? ` ${unit}` : ''}` : null
}

function numberLabel(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)
}

function positiveNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
