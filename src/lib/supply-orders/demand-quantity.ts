/** Procurement quantity before receipts, after material already reserved from stock. */
export function requestedSupplyQuantity(table: string, row: Record<string, unknown>) {
  if (table === 'request_sheet_metal') return Number(row.remainder_qty || row.to_order_kg || 0)
  if (table === 'request_round_tube') return Number(row.order_kg || 0)
  if (table === 'request_circle') return Number(row.remainder_mm || 0)
  if (table === 'request_pipe') return row.pipe_type === 'wire' ? Number(row.remainder_kg || 0) : Number(row.remainder_length_mm || 0)
  if (table === 'request_knives') {
    const meters = Number(row.remainder_meters || 0)
    return meters > 0 ? meters * 1000 : Number(row.to_order_mm || 0)
  }
  if (table === 'request_components') return Math.max(Number(row.quantity_needed || 0) - Number(row.stock_remainder || 0), 0)
  if (table === 'request_mesh') return Number(row.remainder_qty || 0)
  if (table === 'request_chain_cord') return Number(row.remainder_meters || 0) * 1000
  return Number(row.remainder_kg || row.to_order_kg || 0)
}

export function reservedSupplyStockQuantity(table: string, row: Record<string, unknown>) {
  if (table === 'request_sheet_metal' || table === 'request_round_tube') return Number(row.reserved_from_stock_kg || 0)
  if (table === 'request_circle' || table === 'request_knives') return Number(row.reserved_from_stock_mm || 0)
  if (table === 'request_pipe') return row.pipe_type === 'wire' ? Number(row.reserved_from_stock_kg || 0) : Number(row.reserved_from_stock_length_mm || 0)
  if (table === 'request_components') return Number(row.reserved_from_stock || 0)
  if (table === 'request_mesh') return Number(row.reserved_from_stock_qty || 0)
  if (table === 'request_chain_cord') return Number(row.reserved_from_stock_meters || 0) * 1000
  return Number(row.reserved_from_stock_kg || 0)
}

export function supplyQuantityUnit(table: string, row: Record<string, unknown>) {
  if (table === 'request_sheet_metal' || table === 'request_mesh') return 'шт'
  if (table === 'request_circle' || table === 'request_knives' || table === 'request_chain_cord') return 'мм'
  if (table === 'request_pipe') return row.pipe_type === 'wire' ? 'кг' : 'мм'
  if (table === 'request_components') return String(row.unit || 'шт')
  return 'кг'
}
