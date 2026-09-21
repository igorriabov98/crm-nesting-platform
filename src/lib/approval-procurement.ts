import type { ApprovalSummaryItem } from './technologist-request-approval'
import { summarizeLongStockPurchaseBars, type LongStockPurchaseBar } from './supply-orders/long-stock-purchase-plan'

export function isLayoutProcurement(item: ApprovalSummaryItem) {
  return item.category === 'request_circle' || item.category === 'request_knives'
    || (item.category === 'request_pipe' && item.attributes?.pipe_type !== 'wire')
}

/** Agreed physical blanks, not useful cutting length or today's outstanding delivery. */
export function approvedProcurement(item: ApprovalSummaryItem, bars?: LongStockPurchaseBar[]) {
  if (isLayoutProcurement(item)) {
    if (!bars) return { quantity: null, unit: 'мм', components: [], unavailable: true }
    const plan = summarizeLongStockPurchaseBars(bars)
    return { quantity: plan.total_length_mm, unit: 'мм', components: plan.components, unavailable: false }
  }
  return {
    quantity: item.quantity === null ? null : Math.max(item.quantity - (item.category === 'request_components' ? Number(item.attributes?.stock_remainder || 0) : 0) - item.businessScrapReserved - item.regularStockReserved, 0),
    unit: item.unit,
    components: [],
    unavailable: item.quantity === null,
  }
}
