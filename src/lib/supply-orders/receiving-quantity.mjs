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
  const value = schedule.status === 'delivered'
    ? schedule.received_quantity ?? schedule.quantity ?? 0
    : schedule.quantity ?? 0
  const quantity = Number(value)
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0
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
