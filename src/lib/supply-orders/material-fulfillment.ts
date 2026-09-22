/** Quantities must use the same unit and demand basis (logical or physical). */
export function materialFulfillment(input: {
  demand: number
  stock?: number
  allocated: number
  planned: number
}) {
  const demand = nonNegative(input.demand)
  const stock = Math.min(nonNegative(input.stock ?? 0), demand)
  const supplyDemand = demand - stock
  const received = Math.min(nonNegative(input.allocated), supplyDemand)
  const outstanding = Math.max(supplyDemand - received, 0)
  const planned = nonNegative(input.planned)
  return {
    demand, stock, supplyDemand, received, outstanding, planned,
    expected: Math.min(planned, outstanding),
    notOrdered: Math.max(outstanding - planned, 0),
    plannedExcess: Math.max(planned - outstanding, 0),
  }
}

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(value, 0) : 0
}
