import { displayedStockCoverage, hasLayoutStockCoverage } from '@/lib/supply-request-stock-coverage'
import { ORDER_STATUS_LABELS } from '@/lib/constants/procurement'
import type { OrderItemStatus, RequestStatus } from '@/lib/types'

export type SupplyRequestItemTable =
  | 'request_sheet_metal'
  | 'request_round_tube'
  | 'request_circle'
  | 'request_pipe'
  | 'request_knives'
  | 'request_components'
  | 'request_paint'
  | 'request_mesh'
  | 'request_chain_cord'

export type ReservationStockSource = 'business_scrap' | 'regular_stock'

export function getReservationStockSourceForStatus(status: RequestStatus): ReservationStockSource | null {
  if (status === 'pending_stock_check') return 'business_scrap'
  if (status === 'stock_checked' || status === 'submitted_to_supply' || status === 'completed') return 'regular_stock'
  return null
}

export function isActiveWarehouseReservationStatus(status: RequestStatus) {
  return status === 'pending_stock_check' || status === 'stock_checked'
}

export function isLayoutManagedSupplyRequestItem(
  table: string,
  row: Pick<Record<string, unknown>, 'pipe_type'> | Record<string, unknown> = {},
) {
  return table === 'request_circle'
    || table === 'request_knives'
    || table === 'request_round_tube'
    || (table === 'request_pipe' && row.pipe_type !== 'wire')
}

export function assertManualSupplyRequestReservationAllowed(
  table: string,
  row: Record<string, unknown> = {},
) {
  if (isLayoutManagedSupplyRequestItem(table, row)) {
    throw new Error('Круг, ножи и мерная труба бронируются только в программе раскладки')
  }
}

export function getSupplyRequestPositionStatus(input: {
  table: SupplyRequestItemTable
  status: OrderItemStatus
  needed: number
  reserved: number | null | undefined
  covered: number | null | undefined
  pipeType?: unknown
}) {
  if (input.status === 'cancelled') return ORDER_STATUS_LABELS.cancelled
  const coverage = displayedStockCoverage({
    reservedQuantity: input.reserved,
    coveredQuantity: input.covered,
  })
  if (input.needed > 0 && coverage >= input.needed) {
    if (
      isLayoutManagedSupplyRequestItem(input.table, { pipe_type: input.pipeType })
      && hasLayoutStockCoverage({ reservedQuantity: input.reserved, coveredQuantity: input.covered })
    ) {
      return 'Забронировано по раскладке'
    }
    return 'Закрыто со склада'
  }
  return ORDER_STATUS_LABELS[input.status]
}
