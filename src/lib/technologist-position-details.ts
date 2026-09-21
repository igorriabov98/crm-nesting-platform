import type { ApprovalSummaryItem } from '@/lib/technologist-request-approval'

function numberValue(value: unknown) {
  const parsed = Number(value)
  return value !== null && value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : null
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function formatNumber(value: unknown, maximumFractionDigits = 2) {
  const parsed = numberValue(value)
  return parsed === null ? null : parsed.toLocaleString('ru-RU', { maximumFractionDigits })
}

function detail(label: string, value: string | null, unit = '') {
  return value === null ? null : `${label}: ${value}${unit}`
}

export function getTechnologistPositionDetails(item: ApprovalSummaryItem) {
  const attributes = item.attributes || {}
  const details: Array<string | null> = []
  const weight = formatNumber(item.weightKg)

  switch (item.category) {
    case 'request_sheet_metal':
      details.push(
        detail('Марка стали', textValue(attributes.material_grade)),
        detail('Размер листа', textValue(attributes.sheet_size)),
        detail('Толщина', formatNumber(attributes.thickness_mm), ' мм'),
      )
      break
    case 'request_circle':
      details.push(
        detail('Марка стали', textValue(attributes.steel_grade)),
        detail('Диаметр', formatNumber(attributes.diameter_mm), ' мм'),
        typeof attributes.is_calibrated === 'boolean'
          ? `Калиброванный: ${attributes.is_calibrated ? 'да' : 'нет'}`
          : null,
      )
      break
    case 'request_round_tube':
    case 'request_pipe':
      details.push(
        detail('Размер', textValue(attributes.size)),
        detail('Диаметр', formatNumber(attributes.diameter_mm), ' мм'),
        detail('Толщина стенки', formatNumber(attributes.wall_thickness_mm), ' мм'),
      )
      break
    case 'request_knives':
      details.push(
        detail('Марка стали', textValue(attributes.steel_grade)),
        detail('Ширина', formatNumber(attributes.width_mm), ' мм'),
        detail('Высота', formatNumber(attributes.height_mm), ' мм'),
        detail('Количество фасок', formatNumber(attributes.knife_bevel_count, 0)),
      )
      break
    case 'request_components':
      details.push(
        detail('Спецификация', textValue(attributes.specification)),
        detail('Диаметр', formatNumber(attributes.diameter_mm), ' мм'),
      )
      break
    case 'request_paint':
      details.push(
        detail('Площадь', formatNumber(attributes.area_m2), ' м²'),
        detail('Вес с запасом', formatNumber(attributes.weight_with_waste_kg), ' кг'),
      )
      break
    case 'request_mesh':
      details.push(
        detail('Описание', textValue(attributes.description)),
        detail('Длина', formatNumber(attributes.length_mm), ' мм'),
        detail('Ширина', formatNumber(attributes.width_mm), ' мм'),
      )
      break
    case 'request_chain_cord':
      details.push(
        detail('Тип', textValue(attributes.item_type)),
        detail('Параметры', textValue(attributes.parameters)),
      )
      break
  }

  if (weight !== null) details.push(`Вес позиции: ${weight} кг`)
  return details.filter((value): value is string => Boolean(value))
}
