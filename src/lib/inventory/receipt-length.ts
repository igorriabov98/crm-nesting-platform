/** Physical long-stock receipts are counted in whole bars and stored in millimetres. */
export function receiptLengthMm(pieceCount: unknown, pieceLengthMm: unknown): number | null {
  const count = Number(pieceCount)
  const length = Number(pieceLengthMm)
  if (!Number.isInteger(count) || count <= 0 || !Number.isFinite(length) || length <= 0) return null
  const total = count * length
  return Number.isFinite(total) && total > 0 ? total : null
}
