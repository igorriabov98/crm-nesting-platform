export type SupplyProgressSchedule = {
  status?: string | null
  quantity?: number | string | null
  allocated_quantity?: number | string | null
  allocated_physical_quantity?: number | string | null
  allocated_piece_count?: number | string | null
  received_quantity?: number | string | null
  received_piece_length_mm?: number | string | null
  received_piece_count?: number | string | null
  planned_piece_length_mm?: number | string | null
  receipt_parent_schedule_id?: string | null
}

export type SupplyReceiptProgress = {
  requestedQuantity: number
  deliveredQuantity: number
  outstandingQuantity: number
  requestedPieceCount: number | null
  deliveredPieceCount: number | null
  outstandingPieceCount: number | null
}

/**
 * Returns the physical quantity accepted for one request item. For long stock,
 * the physical bar allocation is authoritative and the logical cutting coverage
 * must not be presented as the quantity received from the supplier.
 */
export function deliveredSupplyQuantity(schedule: SupplyProgressSchedule) {
  const pieceLength = positiveNumber(
    schedule.received_piece_length_mm ?? schedule.planned_piece_length_mm,
  )
  if (pieceLength > 0) {
    const physicalQuantity = schedule.allocated_physical_quantity
      ?? schedule.received_quantity
      ?? (schedule.allocated_piece_count === null || schedule.allocated_piece_count === undefined
        ? null
        : Number(schedule.allocated_piece_count) * pieceLength)
      ?? (schedule.received_piece_count === null || schedule.received_piece_count === undefined
        ? null
        : Number(schedule.received_piece_count) * pieceLength)
    return nonNegativeNumber(physicalQuantity)
  }

  return nonNegativeNumber(
    schedule.allocated_quantity ?? schedule.received_quantity ?? schedule.quantity,
  )
}

/**
 * Returns the number of whole bars attributed to one request item. Allocation
 * fields take precedence because a parent receipt may have distributed bars to
 * several request items through technical child schedules.
 */
export function deliveredSupplyPieceCount(schedule: SupplyProgressSchedule) {
  if (schedule.allocated_piece_count !== null && schedule.allocated_piece_count !== undefined) {
    return nonNegativeNumber(schedule.allocated_piece_count)
  }

  const pieceLength = positiveNumber(
    schedule.received_piece_length_mm ?? schedule.planned_piece_length_mm,
  )
  const physicalQuantity = deliveredSupplyQuantity(schedule)
  if (pieceLength > 0 && physicalQuantity > 0) {
    return physicalQuantity / pieceLength
  }

  if (!schedule.receipt_parent_schedule_id) {
    return nonNegativeNumber(schedule.received_piece_count)
  }

  return 0
}

export function calculateSupplyReceiptProgress({
  requestedQuantity,
  requestedPieceCount,
  schedules,
}: {
  requestedQuantity: number
  requestedPieceCount: number | null
  schedules: SupplyProgressSchedule[]
}): SupplyReceiptProgress {
  const normalizedRequestedQuantity = nonNegativeNumber(requestedQuantity)
  const deliveredSchedules = schedules.filter((schedule) => schedule.status === 'delivered')
  const deliveredQuantity = deliveredSchedules.reduce(
    (sum, schedule) => sum + deliveredSupplyQuantity(schedule),
    0,
  )
  const normalizedRequestedPieceCount = requestedPieceCount === null
    ? null
    : nonNegativeNumber(requestedPieceCount)
  const deliveredPieceCount = normalizedRequestedPieceCount === null
    ? null
    : deliveredSchedules.reduce(
      (sum, schedule) => sum + deliveredSupplyPieceCount(schedule),
      0,
    )

  return {
    requestedQuantity: normalizedRequestedQuantity,
    deliveredQuantity,
    outstandingQuantity: Math.max(normalizedRequestedQuantity - deliveredQuantity, 0),
    requestedPieceCount: normalizedRequestedPieceCount,
    deliveredPieceCount,
    outstandingPieceCount: normalizedRequestedPieceCount === null || deliveredPieceCount === null
      ? null
      : Math.max(normalizedRequestedPieceCount - deliveredPieceCount, 0),
  }
}

function positiveNumber(value: number | string | null | undefined) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function nonNegativeNumber(value: number | string | null | undefined) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number >= 0 ? number : 0
}
