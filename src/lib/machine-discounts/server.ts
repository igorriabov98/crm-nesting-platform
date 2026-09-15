import 'server-only'

import type { MachineDiscountSummary } from '@/lib/order-discounts'

type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns: string) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
}
type LooseDb = { from: (table: string) => LooseQuery }

const DISCOUNT_COLUMNS = `
  id, machine_id, revision_number, status, discount_percent, reason,
  items_total_before_discount, discount_amount, discounted_items_total,
  expenses_total, total_before_discount, total_after_discount,
  submitted_at, decision_comment, decided_at
`

type DiscountRow = MachineDiscountSummary & { machine_id: string }

export async function loadActiveMachineDiscounts(db: LooseDb, machineIds: string[]) {
  if (machineIds.length === 0) return new Map<string, MachineDiscountSummary>()
  const { data, error } = await db
    .from('machine_discount_requests')
    .select(DISCOUNT_COLUMNS)
    .in('machine_id', machineIds)
    .in('status', ['pending', 'approved'])
    .order('revision_number', { ascending: false })
  if (error) throw new Error(error.message || 'Не удалось загрузить скидки заказов')

  const result = new Map<string, MachineDiscountSummary>()
  for (const raw of (data || []) as DiscountRow[]) {
    if (result.has(raw.machine_id)) continue
    result.set(raw.machine_id, {
      ...raw,
      discount_percent: Number(raw.discount_percent),
      items_total_before_discount: Number(raw.items_total_before_discount),
      discount_amount: Number(raw.discount_amount),
      discounted_items_total: Number(raw.discounted_items_total),
      expenses_total: Number(raw.expenses_total),
      total_before_discount: Number(raw.total_before_discount),
      total_after_discount: Number(raw.total_after_discount),
    })
  }
  return result
}
