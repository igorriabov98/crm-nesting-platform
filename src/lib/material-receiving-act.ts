import { MATERIAL_CATEGORY_LABELS } from '@/lib/constants/procurement'
import type { LongStockPurchaseComponent } from '@/lib/supply-orders/long-stock-purchase-plan'
import type { MaterialCategory } from '@/lib/types'

export type MaterialReceivingActSourceItem = {
  key: string
  machine_id: string
  machine_name: string
  machine_specification_number: string | null
  factory_name: string
  delivery_date: string
  planned_quantity: number
  unit: string
  supplier_name: string | null
  category: MaterialCategory
  is_whole_bar: boolean
  item_name: string
  characteristics: Array<{ label: string; value: string }>
  weight_kg: number | null
  is_virtual_schedule: boolean
  planned_piece_length_mm: number | null
  planned_piece_count: number | null
  purchase_components: LongStockPurchaseComponent[]
}

export type MaterialReceivingActItem = {
  key: string
  materialName: string
  categoryLabel: string
  characteristics: Array<{ label: string; value: string }>
  supplierName: string
  orderName: string
  specificationNumber: string | null
  plannedQuantity: number
  unit: string
  plannedWeightKg: number | null
  plannedBars: Array<{ lengthMm: number; pieceCount: number; isNonstandard: boolean }>
  isVirtualSchedule: boolean
}

export type MaterialReceivingActOrder = {
  machineId: string
  name: string
  specificationNumber: string | null
  itemCount: number
}

export type MaterialReceivingActData = {
  deliveryDate: string
  generatedAt: string
  factoryName: string
  items: MaterialReceivingActItem[]
  orders: MaterialReceivingActOrder[]
  supplierNames: string[]
  totalWeightKg: number | null
}

function plannedBars(item: MaterialReceivingActSourceItem) {
  if (!item.is_whole_bar) return []
  if (item.planned_piece_length_mm && item.planned_piece_count) {
    return [{
      lengthMm: item.planned_piece_length_mm,
      pieceCount: item.planned_piece_count,
      isNonstandard: false,
    }]
  }
  return item.purchase_components.map((component) => ({
    lengthMm: component.length_mm,
    pieceCount: component.piece_count,
    isNonstandard: component.is_nonstandard,
  }))
}

export function buildMaterialReceivingActData(input: {
  deliveryDate: string
  generatedAt: string
  factoryName: string
  items: MaterialReceivingActSourceItem[]
}): MaterialReceivingActData {
  const orders = new Map<string, MaterialReceivingActOrder>()
  const supplierNames = new Set<string>()
  let totalWeightKg = 0
  let hasWeight = false

  const items = input.items.map((item) => {
    const order = orders.get(item.machine_id)
    orders.set(item.machine_id, order
      ? { ...order, itemCount: order.itemCount + 1 }
      : {
          machineId: item.machine_id,
          name: item.machine_name,
          specificationNumber: item.machine_specification_number,
          itemCount: 1,
        })
    if (item.supplier_name) supplierNames.add(item.supplier_name)
    if (item.weight_kg !== null && Number.isFinite(item.weight_kg)) {
      totalWeightKg += item.weight_kg
      hasWeight = true
    }

    return {
      key: item.key,
      materialName: item.item_name,
      categoryLabel: MATERIAL_CATEGORY_LABELS[item.category],
      characteristics: item.characteristics,
      supplierName: item.supplier_name || 'Не назначен',
      orderName: item.machine_name,
      specificationNumber: item.machine_specification_number,
      plannedQuantity: item.planned_quantity,
      unit: item.unit,
      plannedWeightKg: item.weight_kg,
      plannedBars: plannedBars(item),
      isVirtualSchedule: item.is_virtual_schedule,
    }
  })

  return {
    deliveryDate: input.deliveryDate,
    generatedAt: input.generatedAt,
    factoryName: input.factoryName,
    items,
    orders: Array.from(orders.values()).sort((left, right) => left.name.localeCompare(right.name, 'ru')),
    supplierNames: Array.from(supplierNames).sort((left, right) => left.localeCompare(right, 'ru')),
    totalWeightKg: hasWeight ? totalWeightKg : null,
  }
}
