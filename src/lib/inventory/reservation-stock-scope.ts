export type ReservationStockScope = 'business_scrap' | 'regular_stock'

export type ReservationStockReference = {
  inventory_id: string | null
  source_inventory_id: string | null
}

export type InventoryStockReference = {
  id: string
  is_business_scrap?: boolean | null
}

export function getReservationSourceInventoryId(reservation: ReservationStockReference) {
  return reservation.source_inventory_id || reservation.inventory_id
}

export function reservationMatchesStockScope(
  reservation: ReservationStockReference,
  inventoryById: ReadonlyMap<string, InventoryStockReference>,
  scope: ReservationStockScope,
) {
  const inventoryId = getReservationSourceInventoryId(reservation)
  const inventory = inventoryId ? inventoryById.get(inventoryId) : null
  if (!inventory) return false

  return scope === 'business_scrap'
    ? Boolean(inventory.is_business_scrap)
    : !Boolean(inventory.is_business_scrap)
}

export function filterReservationsByStockScope<T extends ReservationStockReference>(
  reservations: T[],
  inventoryById: ReadonlyMap<string, InventoryStockReference>,
  scope: ReservationStockScope,
) {
  return reservations.filter((reservation) => reservationMatchesStockScope(reservation, inventoryById, scope))
}
