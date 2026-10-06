import type { SupplyOrderDeliverySchedule } from '@/lib/actions/supply-orders'
import { deliveredSupplyQuantity } from './receiving-supply-progress'

export type RedeliveryOrigin = {
  id: string
  date: string
  supplierId: string | null
  supplierName: string | null
  planned: number
  received: number
  available: number
}

/** A confirmed short receipt is evidence; a late, unreceived plan is not. */
export function redeliveryOrigins(
  schedules: readonly SupplyOrderDeliverySchedule[],
  related: readonly SupplyOrderDeliverySchedule[] = schedules,
): RedeliveryOrigin[] {
  const all = new Map(schedules.map((schedule) => [schedule.id, schedule]))
  const ids = new Set(related.filter((row) => row.status === 'delivered')
    .map((row) => row.receipt_parent_schedule_id || row.id))
  return [...ids].flatMap((id) => {
    const row = all.get(id)
    if (!row || row.status !== 'delivered' || row.receipt_parent_schedule_id) return []
    const received = deliveredSupplyQuantity(row)
    const committed = [...all.values()].filter((child) => child.redelivery_of_schedule_id === id
      && child.status !== 'cancelled' && !child.receipt_parent_schedule_id)
      .reduce((sum, child) => sum + Number(child.quantity || 0), 0)
    const available = Math.max(Number(row.quantity) - received - committed, 0)
    return available > 0.000001 ? [{ id, date: row.delivery_date, supplierId: row.supplier_id,
      supplierName: row.supplier_name, planned: Number(row.quantity), received, available }] : []
  }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

export function redeliveryChain(schedule: SupplyOrderDeliverySchedule, all: readonly SupplyOrderDeliverySchedule[]) {
  const byId = new Map(all.map((row) => [row.id, row]))
  const seen = new Set<string>([schedule.id])
  const chain: RedeliveryOrigin[] = []
  let id = schedule.redelivery_of_schedule_id
  while (id && !seen.has(id)) {
    seen.add(id)
    const origin = byId.get(id)
    if (!origin) break
    chain.push({ id, date: origin.delivery_date, supplierId: origin.supplier_id,
      supplierName: origin.supplier_name, planned: Number(origin.quantity),
      received: deliveredSupplyQuantity(origin), available: 0 })
    id = origin.redelivery_of_schedule_id
  }
  return chain
}

type OwnedSchedule = SupplyOrderDeliverySchedule & { request_item_table: string; request_item_id: string }
export function resolveLegacyRedeliverySchedules<T extends OwnedSchedule>(schedules: T[]): T[] {
  const result = schedules.map(row => ({ ...row }))
  for (const row of result.filter(row => row.status === 'planned' && !row.redelivery_of_schedule_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
    const related = result.filter(candidate => candidate.request_item_table === row.request_item_table
      && candidate.request_item_id === row.request_item_id)
    const candidates = redeliveryOrigins(result, related).filter(origin => {
      const source = result.find(candidate => candidate.id === origin.id)!
      return Boolean(source.delivered_at && row.created_at >= source.delivered_at
        && origin.available + 0.000001 >= row.quantity
        && source.planned_piece_length_mm === row.planned_piece_length_mm)
    })
    if (candidates.length === 1) row.redelivery_of_schedule_id = candidates[0].id
  }
  return result
}

/** Assign only unambiguous confirmed shortages. An explicit choice is validated
 * here and again under locks by the database trigger. */
export function linkRedeliveryRows(
  rows: Record<string, unknown>[], schedules: OwnedSchedule[], deleteIds: string[],
) {
  const remaining = schedules.filter(row => !deleteIds.includes(row.id))
  const budgets = new Map(redeliveryOrigins(remaining).map(origin => [origin.id, origin.available]))
  for (const row of rows.filter(row => row.preserve_origin && row.redelivery_of_schedule_id)) {
    const id = String(row.redelivery_of_schedule_id)
    budgets.set(id, (budgets.get(id) || 0) - Number(row.quantity || 0))
  }
  return rows.map(row => {
    if (row.preserve_origin) return row
    const related = schedules.filter(source => source.request_item_table === row.request_item_table
      && source.request_item_id === row.request_item_id)
    const candidates = redeliveryOrigins(remaining, related).filter(origin => (budgets.get(origin.id) || 0) > 0.000001
      && (schedules.find(source => source.id === origin.id)?.planned_piece_length_mm || null) === (row.planned_piece_length_mm || null))
    const explicit = row.redelivery_of_schedule_id as string | null
    if (!explicit && candidates.length > 1) throw new Error('Источник требует уточнения. Выберите подтверждённую исходную поставку для каждой строки довоза')
    const origin = explicit ? candidates.find(candidate => candidate.id === explicit) : candidates[0]
    if (explicit && !origin) throw new Error('Исходная поставка не относится к этой заявке или её остаток уже заказан')
    if (!origin) return row
    const quantity = Number(row.quantity)
    if (quantity > (budgets.get(origin.id) || 0) + 0.000001) throw new Error('Количество довоза превышает остаток исходной поставки. Разделите новую закупку и довоз')
    budgets.set(origin.id, (budgets.get(origin.id) || 0) - quantity)
    return { ...row, redelivery_of_schedule_id: origin.id }
  })
}
