/**
 * @typedef {{
 *   quantity?: number | string | null,
 *   status?: string | null,
 *   received_quantity?: number | string | null,
 * }} DeliveryScheduleQuantity
 */

/**
 * Quantity already committed by a schedule.
 * A delivered schedule contributes its actual receipt, while an active schedule
 * contributes the quantity that is still planned.
 *
 * @param {DeliveryScheduleQuantity} schedule
 */
export function committedScheduleQuantity(schedule) {
  if (schedule.status === 'cancelled') return 0
  const value = schedule.status === 'delivered'
    ? schedule.allocated_quantity ?? schedule.received_quantity ?? schedule.quantity ?? 0
    : schedule.quantity ?? 0
  const quantity = Number(value)
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0
}

/**
 * Distribute one physical receipt over matching open demands. Demands with the
 * earliest cutting date and then material-plan date are closed first. A different active supplier
 * schedule is not touched, so an already committed future shipment is not
 * silently duplicated.
 *
 * For knives and circle the allocator works in whole bars. The logical demand may be
 * smaller than the physical quantity reserved: a 12 000 mm bar closes a
 * 6 000 mm demand, but all 12 000 mm remain assigned to that machine until
 * cutting turns the pre-created future scrap into available stock.
 *
 * @param {{
 *   receivedQuantity: number,
 *   pieceLengthMm?: number | null,
 *   pieceCount?: number | null,
 *   candidates: Array<{
 *     key: string,
 *     table: string,
 *     id: string,
 *     priorityDate?: string | null,
 *     cuttingDate?: string | null,
 *     materialDate?: string | null,
 *     outstandingQuantity: number,
 *     hasOtherPlannedSchedule?: boolean,
 *     isSource?: boolean,
 *   }>,
 * }} input
 */
export function allocateReceiptByPriority(input) {
  const receivedQuantity = positiveNumber(input.receivedQuantity)
  if (receivedQuantity <= 0) return { allocations: [], excessQuantity: 0 }

  const candidates = [...input.candidates]
    .filter((candidate) => positiveNumber(candidate.outstandingQuantity) > 0)
    .filter((candidate) => candidate.isSource || !candidate.hasOtherPlannedSchedule)
    .sort((left, right) => comparePriority(left, right, true))

  const pieceLengthMm = positiveNumber(input.pieceLengthMm)
  const pieceCount = positiveInteger(input.pieceCount)
  if (pieceLengthMm > 0 || pieceCount > 0) {
    if (pieceLengthMm <= 0 || pieceCount <= 0) {
      throw new Error('Для ножей укажите длину бруска и количество брусков')
    }
    const calculatedTotal = pieceLengthMm * pieceCount
    if (Math.abs(calculatedTotal - receivedQuantity) > 0.000001) {
      throw new Error('Общая длина должна равняться длине бруска, умноженной на количество')
    }

    let availablePieces = pieceCount
    const allocations = []
    for (const candidate of candidates) {
      if (availablePieces <= 0) break
      const outstanding = positiveNumber(candidate.outstandingQuantity)
      const neededPieces = Math.ceil(outstanding / pieceLengthMm)
      const allocatedPieces = Math.min(availablePieces, neededPieces)
      if (allocatedPieces <= 0) continue
      const physicalQuantity = allocatedPieces * pieceLengthMm
      allocations.push({
        table: candidate.table,
        id: candidate.id,
        key: candidate.key,
        quantity: Math.min(outstanding, physicalQuantity),
        physical_quantity: physicalQuantity,
        piece_count: allocatedPieces,
      })
      availablePieces -= allocatedPieces
    }

    return {
      allocations,
      excessQuantity: availablePieces * pieceLengthMm,
    }
  }

  let available = receivedQuantity
  const allocations = []
  for (const candidate of candidates) {
    if (available <= 0.000001) break
    const quantity = Math.min(available, positiveNumber(candidate.outstandingQuantity))
    if (quantity <= 0) continue
    allocations.push({
      table: candidate.table,
      id: candidate.id,
      key: candidate.key,
      quantity,
      physical_quantity: quantity,
      piece_count: null,
    })
    available -= quantity
  }

  return { allocations, excessQuantity: Math.max(available, 0) }
}

function comparePriority(left, right, useBarPriority = false) {
  if (useBarPriority) {
    const leftCuttingDate = left.cuttingDate || '9999-12-31'
    const rightCuttingDate = right.cuttingDate || '9999-12-31'
    const byCutting = leftCuttingDate.localeCompare(rightCuttingDate)
    if (byCutting !== 0) return byCutting

    const leftMaterialDate = left.materialDate || left.priorityDate || '9999-12-31'
    const rightMaterialDate = right.materialDate || right.priorityDate || '9999-12-31'
    const byMaterial = leftMaterialDate.localeCompare(rightMaterialDate)
    if (byMaterial !== 0) return byMaterial
  }
  const leftDate = left.priorityDate || '9999-12-31'
  const rightDate = right.priorityDate || '9999-12-31'
  return leftDate.localeCompare(rightDate) || left.key.localeCompare(right.key)
}

function positiveNumber(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function positiveInteger(value) {
  const number = positiveNumber(value)
  return Number.isInteger(number) ? number : 0
}

/**
 * @param {number} requiredQuantity
 * @param {DeliveryScheduleQuantity[]} schedules
 */
export function outstandingReceivingQuantity(requiredQuantity, schedules) {
  const committed = schedules.reduce(
    (sum, schedule) => sum + committedScheduleQuantity(schedule),
    0,
  )
  return Math.max(Number(requiredQuantity || 0) - committed, 0)
}

/**
 * Keep the logical machine need separate from the rounded physical purchase
 * plan used for whole bars. A 10 300 mm knife need may legitimately be bought
 * as two 6 000 mm bars, but receiving must close only 10 300 mm and preserve
 * the remaining 1 700 mm as future scrap linked to the cutting reservation.
 *
 * @param {{
 *   isWholeBar: boolean,
 *   requestedQuantity: number,
 *   reservedQuantity: number,
 *   purchaseQuantity: number,
 *   deliveredQuantity: number,
 * }} input
 */
export function outstandingAllocationQuantity(input) {
  const logicalRequired = input.isWholeBar
    ? Math.max(positiveNumber(input.requestedQuantity) - positiveNumber(input.reservedQuantity), 0)
    : positiveNumber(input.purchaseQuantity)
  return Math.max(logicalRequired - positiveNumber(input.deliveredQuantity), 0)
}

/**
 * Project virtual receiving rows from the authoritative aggregate remainder.
 * One supply schedule may intentionally be stored on a single anchor request
 * while covering several matching request items. Per-item projection would
 * repeat every follower as an unscheduled delivery even when the aggregate is
 * already fully covered.
 *
 * Items with an active schedule keep their real schedule row and do not get a
 * second virtual row. Any genuine aggregate remainder is assigned to uncovered
 * followers in input order and capped by the aggregate total.
 *
 * @param {Array<{
 *   key: string,
 *   aggregateKey: string,
 *   requiredQuantity: number,
 *   schedules: DeliveryScheduleQuantity[],
 * }>} items
 * @returns {Map<string, number>}
 */
export function projectAggregateVirtualReceivingQuantities(items) {
  const groups = new Map()

  for (const item of items) {
    const requiredQuantity = positiveNumber(item.requiredQuantity)
    const schedules = Array.isArray(item.schedules) ? item.schedules : []
    const group = groups.get(item.aggregateKey) || {
      requiredQuantity: 0,
      committedQuantity: 0,
      items: [],
    }
    group.requiredQuantity += requiredQuantity
    group.committedQuantity += schedules.reduce(
      (sum, schedule) => sum + committedScheduleQuantity(schedule),
      0,
    )
    group.items.push({
      key: item.key,
      outstandingQuantity: outstandingReceivingQuantity(requiredQuantity, schedules),
      hasActiveSchedule: schedules.some((schedule) => (
        schedule.status !== 'delivered' && schedule.status !== 'cancelled'
      )),
    })
    groups.set(item.aggregateKey, group)
  }

  const projected = new Map()
  for (const group of groups.values()) {
    let aggregateOutstanding = Math.max(
      group.requiredQuantity - group.committedQuantity,
      0,
    )

    for (const item of group.items) {
      if (aggregateOutstanding <= 0.000001) break
      if (item.hasActiveSchedule || item.outstandingQuantity <= 0.000001) continue
      const quantity = Math.min(item.outstandingQuantity, aggregateOutstanding)
      projected.set(item.key, quantity)
      aggregateOutstanding -= quantity
    }
  }

  return projected
}
