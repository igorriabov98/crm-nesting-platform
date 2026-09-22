import type { LongStockPurchasePlan } from './long-stock-purchase-plan'
import { deliveredSupplyPieceCount, type SupplyProgressSchedule } from './receiving-supply-progress'

/** A bar is purchased for the cuts assigned to it, not for ceil(total cuts / length). */
export function wholeBarReceiptCapacity({
  plan,
  schedules,
  plannedPieceLengthMm,
  receivedPieceLengthMm,
  outstandingLogicalQuantity,
}: {
  plan: LongStockPurchasePlan | null
  schedules: SupplyProgressSchedule[]
  plannedPieceLengthMm: number | null
  receivedPieceLengthMm: number
  outstandingLogicalQuantity: number
}) {
  if (!Number.isFinite(receivedPieceLengthMm) || receivedPieceLengthMm <= 0) {
    throw new Error('Некорректная длина принятого хлыста')
  }
  if (!plan) {
    return {
      neededPieceCount: Math.ceil(outstandingLogicalQuantity / receivedPieceLengthMm),
      logicalQuantitiesByPiece: null,
    }
  }
  if (plan.version_status !== 'approved'
    || !['plan_approved', 'accepted'].includes(plan.cutting_status)
    || !plan.receipt_bars) {
    throw new Error('Для приёмки нужна актуальная утверждённая карта раскроя')
  }
  const length = plannedPieceLengthMm ?? receivedPieceLengthMm
  const bars = plan.receipt_bars.filter((bar) => bar.length_mm === length)
  const expected = plan.components
    .filter((component) => component.length_mm === length)
    .reduce((sum, component) => sum + component.piece_count, 0)
  if (bars.length !== expected || bars.some((bar) => (
    !Number.isFinite(bar.logical_quantity) || bar.logical_quantity <= 0 || bar.logical_quantity > bar.length_mm
  ))) {
    throw new Error('Закупочные хлысты не соответствуют отрезкам утверждённой карты. Обновите данные раскроя')
  }
  const allocatedPieces = schedules
    .filter((schedule) => schedule.status === 'delivered'
      && Number(schedule.planned_piece_length_mm ?? schedule.received_piece_length_mm) === length)
    .reduce((sum, schedule) => sum + deliveredSupplyPieceCount(schedule), 0)
  if (!Number.isInteger(allocatedPieces) || allocatedPieces < 0 || allocatedPieces > bars.length) {
    throw new Error('Ранее принятые хлысты не соответствуют утверждённой карте. Обновите данные приёмки')
  }
  const remaining = bars.slice(allocatedPieces)
  return {
    neededPieceCount: remaining.length,
    logicalQuantitiesByPiece: remaining.map((bar) => bar.logical_quantity),
  }
}

export function wholeBarLogicalQuantity(
  pieces: number,
  pieceLengthMm: number,
  outstandingLogicalQuantity: number,
  logicalQuantitiesByPiece?: number[] | null,
) {
  const plannedLogical = logicalQuantitiesByPiece == null
    ? pieces * pieceLengthMm
    : logicalQuantitiesByPiece.slice(0, pieces).reduce((sum, quantity) => sum + quantity, 0)
  return Math.min(outstandingLogicalQuantity, pieces * pieceLengthMm, plannedLogical)
}
