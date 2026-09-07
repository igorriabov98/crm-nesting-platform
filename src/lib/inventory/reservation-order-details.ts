export type ReservationOrderEntry = {
  reservationId: string
  machineId: string
  machineName: string
  quantity: number
  secondaryQuantity: number | null
  reservedAt: string
}

export type ReservationOrderDetails = {
  machineId: string
  machineName: string
  quantity: number
  secondaryQuantity: number | null
  reservationCount: number
  reservedAt: string
}

export type InventoryReservationLink = {
  reservationId: string
  inventoryId: string
  sourceInventoryId: string | null
  businessScrapInventoryId: string | null
  businessScrapQuantity: number | null
  machineId: string
  quantity: number
  secondaryQuantity: number | null
  reservedAt: string
}

export function aggregateReservationOrders(entries: ReservationOrderEntry[]): ReservationOrderDetails[] {
  const byMachine = new Map<string, ReservationOrderDetails>()

  for (const entry of entries) {
    if (!Number.isFinite(entry.quantity) || entry.quantity <= 0) continue

    const current = byMachine.get(entry.machineId)
    if (!current) {
      byMachine.set(entry.machineId, {
        machineId: entry.machineId,
        machineName: entry.machineName,
        quantity: entry.quantity,
        secondaryQuantity: entry.secondaryQuantity,
        reservationCount: 1,
        reservedAt: entry.reservedAt,
      })
      continue
    }

    current.quantity += entry.quantity
    current.secondaryQuantity = current.secondaryQuantity === null && entry.secondaryQuantity === null
      ? null
      : Number(current.secondaryQuantity || 0) + Number(entry.secondaryQuantity || 0)
    current.reservationCount += 1
    if (entry.reservedAt < current.reservedAt) current.reservedAt = entry.reservedAt
  }

  return Array.from(byMachine.values()).sort((left, right) => (
    left.machineName.localeCompare(right.machineName, 'ru') || left.machineId.localeCompare(right.machineId)
  ))
}

export function groupInventoryReservationOrders(
  inventoryIds: string[],
  reservations: InventoryReservationLink[],
  machineNames: ReadonlyMap<string, string>,
) {
  const inventoryIdSet = new Set(inventoryIds)
  const entriesByInventory = new Map<string, ReservationOrderEntry[]>()

  const addEntry = (inventoryId: string, reservation: InventoryReservationLink, quantity: number, secondaryQuantity: number | null) => {
    if (!inventoryIdSet.has(inventoryId) || !Number.isFinite(quantity) || quantity <= 0) return
    entriesByInventory.set(inventoryId, [
      ...(entriesByInventory.get(inventoryId) || []),
      {
        reservationId: reservation.reservationId,
        machineId: reservation.machineId,
        machineName: machineNames.get(reservation.machineId) || 'Заказ',
        quantity,
        secondaryQuantity,
        reservedAt: reservation.reservedAt,
      },
    ])
  }

  for (const reservation of reservations) {
    if (reservation.businessScrapInventoryId) {
      addEntry(
        reservation.businessScrapInventoryId,
        reservation,
        Number(reservation.businessScrapQuantity || 0),
        null,
      )
    }

    const baseInventoryId = reservation.sourceInventoryId && inventoryIdSet.has(reservation.sourceInventoryId)
      ? reservation.sourceInventoryId
      : reservation.inventoryId
    if (baseInventoryId !== reservation.businessScrapInventoryId) {
      addEntry(baseInventoryId, reservation, reservation.quantity, reservation.secondaryQuantity)
    }
  }

  return new Map(inventoryIds.map((inventoryId) => [
    inventoryId,
    aggregateReservationOrders(entriesByInventory.get(inventoryId) || []),
  ]))
}
