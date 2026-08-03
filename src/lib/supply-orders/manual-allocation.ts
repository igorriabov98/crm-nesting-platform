export type ManualAllocationMode = 'quantity' | 'whole_bar'

export type ManualAllocationRowInput = {
  key: string
  value: number
  max: number
  isEligible: boolean
  outstandingQuantity: number
}

type CalculatedRow = {
  isValid: boolean
  physical: number
  logical: number
  futureScrap: number
}

export function calculateManualAllocation<T extends ManualAllocationRowInput>({
  mode,
  receivedQuantity,
  pieceLengthMm,
  pieceCount,
  rows,
}: {
  mode: ManualAllocationMode
  receivedQuantity: number
  pieceLengthMm: number | null
  pieceCount: number | null
  rows: T[]
}) {
  const isBar = mode === 'whole_bar'
  const calculatedRows: Array<T & CalculatedRow> = rows.map((row) => {
    const validNumber = Number.isFinite(row.value) && row.value >= 0
    const validStep = !isBar || Number.isInteger(row.value)
    const isValid = !row.isEligible || (validNumber && validStep && row.value <= row.max + 0.000001)
    const physical = row.isEligible && validNumber
      ? isBar ? row.value * Number(pieceLengthMm || 0) : row.value
      : 0
    const logical = Math.min(row.outstandingQuantity, physical)
    return {
      ...row,
      isValid,
      physical,
      logical,
      futureScrap: isBar ? Math.max(physical - logical, 0) : 0,
    }
  })
  const selectedRows = calculatedRows.filter((row) => row.isEligible && row.value > 0)
  const allocatedPhysical = selectedRows.reduce((sum, row) => sum + row.physical, 0)
  const allocatedLogical = selectedRows.reduce((sum, row) => sum + row.logical, 0)
  const futureScrap = selectedRows.reduce((sum, row) => sum + row.futureScrap, 0)
  const allocatedPieces = isBar ? selectedRows.reduce((sum, row) => sum + row.value, 0) : 0
  const freePieces = isBar ? Math.max(Number(pieceCount || 0) - allocatedPieces, 0) : 0
  const freeQuantity = Math.max(receivedQuantity - allocatedPhysical, 0)
  const invalidRows = calculatedRows.some((row) => !row.isValid)
  const exceedsReceipt = allocatedPhysical > receivedQuantity + 0.000001

  return {
    rows: calculatedRows,
    selectedRows,
    allocatedPhysical,
    allocatedLogical,
    futureScrap,
    allocatedPieces,
    freePieces,
    freeQuantity,
    invalidRows,
    exceedsReceipt,
    canConfirm: selectedRows.length > 0 && !invalidRows && !exceedsReceipt,
  }
}
