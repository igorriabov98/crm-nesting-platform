import type { InventoryTransaction } from '@/lib/types'

type WriteOffRow = Pick<InventoryTransaction,
  'id' | 'machine_id' | 'inventory_id' | 'request_item_table' | 'request_item_id' |
  'quantity' | 'created_at' | 'source_reservation_id'>

type CuttingEvent = { id: string; machine_id: string; created_at: string }
type ConsumedReservation = {
  event_id: string
  reservation_id: string | null
  inventory_id: string
  request_item_table: string
  request_item_id: string
  reserved_quantity: number
  consumed_quantity: number | null
  is_cut_reservation: boolean
}

export function matchCuttingWriteOffSources(
  rows: WriteOffRow[],
  events: CuttingEvent[],
  consumedReservations: ConsumedReservation[],
  verifiedUniqueHistoricalTransactionIds: ReadonlySet<string> = new Set(),
) {
  const eventMap = new Map(events.map((event) => [event.id, event]))
  const candidates = new Map<string, { ids: string[]; certainty: 'exact' | 'possible' }>()
  for (const row of rows) {
    if (row.source_reservation_id) {
      candidates.set(row.id, { ids: [row.source_reservation_id], certainty: 'exact' })
      continue
    }
    const rowTime = Date.parse(row.created_at)
    const matchingEntries = consumedReservations.filter((entry) => {
      const event = eventMap.get(entry.event_id)
      if (!event || !entry.reservation_id || entry.is_cut_reservation) return false
      const eventTime = Date.parse(event.created_at)
      return event.machine_id === row.machine_id
        && eventTime <= rowTime && rowTime - eventTime <= 600_000
        && entry.inventory_id === row.inventory_id
        && entry.request_item_table === row.request_item_table
        && entry.request_item_id === row.request_item_id
        && Math.abs(Number(entry.consumed_quantity ?? entry.reserved_quantity) + Number(row.quantity)) <= 0.000001
    })
    const ids = [...new Set(matchingEntries.map((entry) => entry.reservation_id)
      .filter((id): id is string => !!id))]
    if (ids.length === 0) continue
    candidates.set(row.id, {
      ids,
      certainty: ids.length === 1 && matchingEntries.length === 1
        && verifiedUniqueHistoricalTransactionIds.has(row.id) ? 'exact' : 'possible',
    })
  }
  return candidates
}
