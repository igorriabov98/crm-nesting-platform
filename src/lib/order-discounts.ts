export type MachineDiscountStatus = 'pending' | 'approved' | 'rejected' | 'superseded'

export type MachineDiscountSummary = {
  id: string
  revision_number: number
  status: MachineDiscountStatus
  discount_percent: number
  reason: string
  items_total_before_discount: number
  discount_amount: number
  discounted_items_total: number
  expenses_total: number
  total_before_discount: number
  total_after_discount: number
  submitted_at: string
  decision_comment: string | null
  decided_at: string | null
}

export type DiscountTotals = {
  itemsTotalBeforeDiscount: number
  discountAmount: number
  discountedItemsTotal: number
  expensesTotal: number
  totalBeforeDiscount: number
  totalCost: number
}

export function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateDiscountTotals(
  itemsTotal: number,
  expensesTotal: number,
  percent: number,
): DiscountTotals {
  const goods = roundCurrency(itemsTotal)
  const expenses = roundCurrency(expensesTotal)
  const discountAmount = roundCurrency(goods * percent / 100)
  const discountedItemsTotal = roundCurrency(goods - discountAmount)

  return {
    itemsTotalBeforeDiscount: goods,
    discountAmount,
    discountedItemsTotal,
    expensesTotal: expenses,
    totalBeforeDiscount: roundCurrency(goods + expenses),
    totalCost: roundCurrency(discountedItemsTotal + expenses),
  }
}

export function approvedDiscount(summary: MachineDiscountSummary | null | undefined) {
  return summary?.status === 'approved' ? summary : null
}

export type DiscountDocumentTotals = {
  goods_total: number
  expenses_total: number
  grand_total: number
  discount_status?: 'none' | 'pending' | 'approved'
  discount_percent?: number
  discount_amount?: number
  goods_total_after_discount?: number
  total_before_discount?: number
}

export function normalizeDiscountDocumentTotals<T extends DiscountDocumentTotals>(totals: T) {
  return {
    ...totals,
    discount_status: totals.discount_status || 'none' as const,
    discount_percent: Number(totals.discount_percent || 0),
    discount_amount: Number(totals.discount_amount || 0),
    goods_total_after_discount: Number(totals.goods_total_after_discount ?? totals.goods_total),
    total_before_discount: Number(totals.total_before_discount ?? (totals.goods_total + totals.expenses_total)),
  }
}
