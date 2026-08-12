import type { OrderItemStatus } from '@/lib/types'

export type MaterialRequestItemTable =
  | 'request_sheet_metal'
  | 'request_circle'
  | 'request_pipe'
  | 'request_knives'
  | 'request_components'
  | 'request_paint'
  | 'request_mesh'
  | 'request_chain_cord'

type MaterialRequestRow = Record<string, unknown>

function asNumber(value: unknown) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function asRow(value: unknown): MaterialRequestRow {
  return value && typeof value === 'object' ? value as MaterialRequestRow : {}
}

export function getMaterialRequestStockCoverage(table: MaterialRequestItemTable, value: unknown) {
  const row = asRow(value)

  if (table === 'request_sheet_metal') {
    const usesPieces = asNumber(row.remainder_qty) > 0
    return {
      needed: asNumber(row.remainder_qty || row.to_order_kg),
      reserved: asNumber(row.reserved_from_stock_kg),
      unit: usesPieces ? 'шт' : 'кг',
    }
  }
  if (table === 'request_circle') {
    return {
      needed: asNumber(row.remainder_mm),
      reserved: asNumber(row.reserved_from_stock_mm),
      unit: 'мм',
    }
  }
  if (table === 'request_pipe') {
    const isWire = row.pipe_type === 'wire'
    return {
      needed: isWire ? asNumber(row.remainder_kg) : asNumber(row.remainder_length_mm),
      reserved: isWire ? asNumber(row.reserved_from_stock_kg) : asNumber(row.reserved_from_stock_length_mm),
      unit: isWire ? 'кг' : 'мм',
    }
  }
  if (table === 'request_knives') {
    const remainderMeters = asNumber(row.remainder_meters)
    return {
      needed: remainderMeters > 0 ? remainderMeters * 1000 : asNumber(row.to_order_mm),
      reserved: asNumber(row.reserved_from_stock_mm),
      unit: 'мм',
    }
  }
  if (table === 'request_components') {
    return {
      needed: Math.max(asNumber(row.quantity_needed) - asNumber(row.stock_remainder), 0),
      reserved: asNumber(row.reserved_from_stock),
      unit: 'шт',
    }
  }
  if (table === 'request_mesh') {
    return {
      needed: asNumber(row.remainder_qty),
      reserved: asNumber(row.reserved_from_stock_qty),
      unit: 'шт',
    }
  }
  if (table === 'request_chain_cord') {
    return {
      needed: asNumber(row.remainder_meters) * 1000,
      reserved: asNumber(row.reserved_from_stock_meters) * 1000,
      unit: 'мм',
    }
  }
  return {
    needed: asNumber(row.remainder_kg || row.to_order_kg),
    reserved: asNumber(row.reserved_from_stock_kg),
    unit: 'кг',
  }
}

export function formatMaterialRequestStockQuantity(value: number, unit: string) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} ${unit}`
}

export function isMaterialRequestItemReservedFromStock(
  status: OrderItemStatus | null | undefined,
  table: MaterialRequestItemTable,
  value: unknown,
) {
  if ((status || 'pending') !== 'pending') return false
  const { needed, reserved } = getMaterialRequestStockCoverage(table, value)
  return needed > 0 && reserved >= needed
}
