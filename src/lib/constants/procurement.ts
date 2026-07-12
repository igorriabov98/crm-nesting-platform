import type { InventoryTransactionType, MaterialCategory, OrderItemStatus } from '@/lib/types'

export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  sheet_metal: 'Листовой металл',
  circle: 'Круг',
  pipe: 'Труба',
  knives: 'Ножи',
  paint: 'Краска',
  components: 'Комплектация',
  mesh: 'Сетка',
  chain_cord: 'Цепь / Шнур',
  round_tube: 'Круг / Труба (устар.)',
  other: 'Другое',
}

const AUTO_NAMED_MATERIAL_CATEGORIES = new Set<MaterialCategory>([
  'sheet_metal',
  'circle',
  'pipe',
  'knives',
  'paint',
])

export function defaultMaterialNameForCategory(category: MaterialCategory) {
  return AUTO_NAMED_MATERIAL_CATEGORIES.has(category) ? MATERIAL_CATEGORY_LABELS[category] : null
}

export const PIPE_SUBTYPE_LABELS: Record<string, string> = {
  square: 'Квадратная',
  rectangular: 'Прямоугольная',
  round: 'Круглая',
  wire: 'Проволока',
}

export const CHAIN_CORD_SUBTYPE_LABELS: Record<string, string> = {
  chain: 'Цепь',
  cord: 'Шнур',
}

export const PAINT_FINISH_OPTIONS = ['матовый', 'глянец', 'шагрень'] as const

export const CATEGORY_UNITS: Record<string, { primary: string; secondary?: string }> = {
  sheet_metal: { primary: 'шт' },
  circle: { primary: 'мм' },
  pipe: { primary: 'мм', secondary: 'шт' },
  knives: { primary: 'мм', secondary: 'шт' },
  paint: { primary: 'кг' },
  components: { primary: 'шт' },
  mesh: { primary: 'шт' },
  chain_cord: { primary: 'мм' },
}

export const WIRE_UNIT = 'кг'

export const ACTIVE_MATERIAL_CATEGORIES = [
  'sheet_metal',
  'circle',
  'pipe',
  'knives',
  'paint',
  'components',
  'mesh',
  'chain_cord',
] as const

export type ActiveMaterialCategory = typeof ACTIVE_MATERIAL_CATEGORIES[number]

export const REQUEST_SECTIONS = [
  { key: 'sheet_metal', label: 'Листовой металл', table: 'request_sheet_metal' },
  { key: 'circle', label: 'Круг', table: 'request_circle' },
  { key: 'pipe', label: 'Труба', table: 'request_pipe' },
  { key: 'knives', label: 'Ножи', table: 'request_knives' },
  { key: 'paint', label: 'Краска', table: 'request_paint' },
  { key: 'components', label: 'Комплектация', table: 'request_components' },
  { key: 'mesh', label: 'Сетка', table: 'request_mesh' },
  { key: 'chain_cord', label: 'Цепь / Шнур', table: 'request_chain_cord' },
] as const

export const ORDER_STATUS_LABELS: Record<OrderItemStatus, string> = {
  pending: 'Не заказано',
  ordered: 'Заказано',
  delivered: 'Доставлено',
}

export const INVENTORY_TRANSACTION_LABELS: Record<InventoryTransactionType, string> = {
  receipt: 'Приход',
  reserve: 'Бронирование',
  unreserve: 'Снятие брони',
  write_off: 'Списание',
  adjustment: 'Корректировка',
}

export const WEEKDAY_LABELS: Record<number, string> = {
  0: 'Вс',
  1: 'Пн',
  2: 'Вт',
  3: 'Ср',
  4: 'Чт',
  5: 'Пт',
  6: 'Сб',
}

export const MATERIAL_CATEGORIES: MaterialCategory[] = [
  ...ACTIVE_MATERIAL_CATEGORIES,
  'round_tube',
  'other',
]

export const DELIVERY_DAYS = [1, 2, 3, 4, 5, 6]
