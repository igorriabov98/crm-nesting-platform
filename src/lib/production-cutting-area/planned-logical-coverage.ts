import type { CuttingAreaMaterialSchedule } from './materials'

/** The same ordered bars/cuts that receiving allocates; waste is not order coverage. */
export function plannedLogicalCoverage(
  bars: Array<{ length: number; logical: number }>,
  schedules: CuttingAreaMaterialSchedule[],
) {
  const lengths = new Set(bars.map((bar) => bar.length))
  let quantity = 0
  for (const length of lengths) {
    const sameLength = bars.filter((bar) => bar.length === length)
    const allocatedPieces = schedules.filter((row) => row.status === 'delivered'
      && Number(row.planned_piece_length_mm ?? row.received_piece_length_mm) === length)
      .reduce((sum, row) => sum + Number(row.allocated_piece_count ?? Number(row.allocated_physical_quantity || 0) / length), 0)
    const plannedPieces = schedules.filter((row) => row.status === 'planned' && Number(row.planned_piece_length_mm) === length)
      .reduce((sum, row) => sum + Number(row.planned_piece_count ?? Number(row.quantity || 0) / length), 0)
    quantity += sameLength.slice(allocatedPieces, allocatedPieces + plannedPieces)
      .reduce((sum, bar) => sum + bar.logical, 0)
  }
  return quantity
}
