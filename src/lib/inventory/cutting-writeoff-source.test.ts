import assert from 'node:assert/strict'
import { test } from 'node:test'

import { matchCuttingWriteOffSources } from './cutting-writeoff-source'
import type { InventoryTransaction } from '@/lib/types'

test('cutting write-offs preserve three distinct 2 + 4 + 4 reservations without guessing equal historical rows', () => {
  const event = { id: 'event-1', machine_id: 'machine-1', created_at: '2026-09-23T18:17:00Z' }
  const reservation = (id: string, quantity: number) => ({
    event_id: event.id,
    reservation_id: id,
    inventory_id: 'inventory-1',
    request_item_table: 'request_sheet_metal',
    request_item_id: 'request-item-1',
    reserved_quantity: quantity,
    consumed_quantity: quantity,
    is_cut_reservation: false,
  })
  const row = (id: string, quantity: number, sourceReservationId: string | null = null) => ({
    id,
    machine_id: event.machine_id,
    inventory_id: 'inventory-1',
    request_item_table: 'request_sheet_metal',
    request_item_id: 'request-item-1',
    quantity: -quantity,
    created_at: '2026-09-23T18:18:00Z',
    source_reservation_id: sourceReservationId,
  }) as InventoryTransaction

  const sources = matchCuttingWriteOffSources(
    [row('old-2', 2), row('old-4-a', 4), row('old-4-b', 4), row('new-4', 4, 'reservation-4-b')],
    [event],
    [reservation('reservation-2', 2), reservation('reservation-4-a', 4), reservation('reservation-4-b', 4)],
  )

  assert.deepEqual(sources.get('old-2'), { ids: ['reservation-2'], certainty: 'possible' })
  assert.deepEqual(sources.get('old-4-a'), {
    ids: ['reservation-4-a', 'reservation-4-b'], certainty: 'possible',
  })
  assert.deepEqual(sources.get('old-4-b'), sources.get('old-4-a'))
  assert.deepEqual(sources.get('new-4'), { ids: ['reservation-4-b'], certainty: 'exact' })

  const verified = matchCuttingWriteOffSources(
    [row('old-2', 2), row('old-4-a', 4), row('old-4-b', 4)],
    [event],
    [reservation('reservation-2', 2), reservation('reservation-4-a', 4), reservation('reservation-4-b', 4)],
    new Set(['old-2', 'old-4-a']),
  )
  assert.deepEqual(verified.get('old-2'), { ids: ['reservation-2'], certainty: 'exact' })
  assert.equal(verified.get('old-4-a')?.certainty, 'possible')
})
