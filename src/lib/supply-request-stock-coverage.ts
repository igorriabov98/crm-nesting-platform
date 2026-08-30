type StockCoverageInput = {
  reservedQuantity?: unknown
  coveredQuantity?: unknown
}

function normalizeQuantity(value: unknown) {
  const quantity = Number(value)
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0
}

/**
 * The current workflow stage can expose only its own inventory reservation,
 * while an approved cutting layout is already recorded in the request's
 * covered quantity. The UI must show the larger, total warehouse coverage
 * without changing the scoped reservation used by reserve/unreserve actions.
 */
export function displayedStockCoverage({ reservedQuantity, coveredQuantity }: StockCoverageInput) {
  return Math.max(normalizeQuantity(reservedQuantity), normalizeQuantity(coveredQuantity))
}

export function hasLayoutStockCoverage({ reservedQuantity, coveredQuantity }: StockCoverageInput) {
  return normalizeQuantity(coveredQuantity) > normalizeQuantity(reservedQuantity)
}

export function summarizeDisplayedStockCoverage(needed: unknown, rows: StockCoverageInput[]) {
  const reserved = rows.reduce((sum, row) => sum + displayedStockCoverage(row), 0)
  return {
    reserved,
    toOrder: Math.max(normalizeQuantity(needed) - reserved, 0),
  }
}
