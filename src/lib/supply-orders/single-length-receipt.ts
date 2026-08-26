export type SingleLengthReceiptValues = {
  receivedPieceLengthMm: number
  receivedPieceCount: number
}

export function normalizeSingleLengthReceipt(input: SingleLengthReceiptValues) {
  const pieceLengthMm = Number(input.receivedPieceLengthMm)
  const pieceCount = Number(input.receivedPieceCount)
  if (!Number.isFinite(pieceLengthMm) || pieceLengthMm <= 0) {
    throw new Error('Фактическая длина хлыста должна быть больше 0')
  }
  if (!Number.isSafeInteger(pieceCount) || pieceCount <= 0) {
    throw new Error('Количество хлыстов должно быть положительным целым числом')
  }
  return {
    pieceLengthMm,
    pieceCount,
    receivedQuantity: pieceLengthMm * pieceCount,
  }
}
