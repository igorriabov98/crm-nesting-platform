import type { LongStockCuttingCandidate } from '@/lib/long-stock-cutting-solver'
import type { LongStockManualBarInput, LongStockPlanSegmentInput } from '@/lib/long-stock-cutting-plan'

export type LongStockSegmentRow = {
  id: string
  lengthMm: string | number
  quantity: string | number
}

export function expandLongStockSegmentRows(
  rows: readonly LongStockSegmentRow[],
): LongStockPlanSegmentInput[] {
  if (rows.length === 0) throw new Error('Добавьте хотя бы одну строку отрезков')

  return rows.flatMap((row, rowIndex) => {
    const lengthMm = Number(row.lengthMm)
    const quantity = Number(row.quantity)
    if (!Number.isFinite(lengthMm) || lengthMm <= 0) {
      throw new Error(`Строка ${rowIndex + 1}: длина должна быть больше 0 мм`)
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error(`Строка ${rowIndex + 1}: количество должно быть положительным целым числом`)
    }
    return Array.from({ length: quantity }, (_, pieceIndex) => ({
      id: `${row.id}-${pieceIndex + 1}`,
      lengthMm,
    }))
  })
}

export function totalLongStockSegmentLength(segments: readonly LongStockPlanSegmentInput[]) {
  return segments.reduce((total, segment) => total + segment.lengthMm, 0)
}

export function candidateWastePercent(candidate: LongStockCuttingCandidate) {
  const totalStockLength = candidate.bars.reduce((total, bar) => total + bar.stockLengthMm, 0)
  return totalStockLength > 0 ? candidate.totalRemainderMm / totalStockLength * 100 : 0
}

export function candidateRemainderPreview(candidate: LongStockCuttingCandidate) {
  const pieces = candidate.bars
    .map((bar) => bar.remainderMm)
    .filter((lengthMm) => Number.isFinite(lengthMm) && lengthMm > 0)
    .sort((left, right) => right - left)
  const visiblePieces = pieces.length > 3 ? pieces.slice(0, 2) : pieces
  return {
    pieces,
    visiblePieces,
    hiddenCount: pieces.length - visiblePieces.length,
  }
}

export function cutDisplayLabel(cutNumber: number) {
  return `Рез ${cutNumber}`
}

export function shouldShowBarSegmentLabel(lengthMm: number, stockLengthMm: number) {
  return stockLengthMm > 0 && lengthMm / stockLengthMm >= 0.08
}

export function longStockCutColorMap(lengthsMm: readonly number[]) {
  const uniqueLengths = [...new Set(lengthsMm.filter((lengthMm) => Number.isFinite(lengthMm) && lengthMm > 0))]
    .sort((left, right) => left - right)
  return new Map(uniqueLengths.map((lengthMm, index) => [
    lengthMm,
    `hsl(${Math.round((213 + index * 137.508) % 360)} 68% 43%)`,
  ]))
}

export function candidateComposition(candidate: LongStockCuttingCandidate) {
  const grouped = new Map<string, { label: string; count: number; lengthMm: number }>()
  for (const bar of candidate.bars) {
    const label = bar.source === 'business_remnant'
      ? `${formatMm(bar.stockLengthMm)} (со склада)`
      : formatMm(bar.stockLengthMm)
    const key = `${bar.source}:${bar.stockLengthMm}`
    const existing = grouped.get(key)
    grouped.set(key, {
      label,
      lengthMm: bar.stockLengthMm,
      count: (existing?.count ?? 0) + 1,
    })
  }
  return [...grouped.values()]
    .sort((left, right) => left.lengthMm - right.lengthMm || left.label.localeCompare(right.label, 'ru'))
    .map((group) => `${group.label} × ${group.count}`)
    .join(' + ')
}

export function candidatePurchaseLengthLabel(candidate: LongStockCuttingCandidate) {
  if (candidate.newBarCount === 0) return 'Только остатки со склада'
  if (candidate.purchaseLengthsMm.length === 1) return `${formatMm(candidate.purchaseLengthsMm[0])} мм`
  return candidateComposition(candidate)
}

export function candidateToManualBars(candidate: LongStockCuttingCandidate): LongStockManualBarInput[] {
  return candidate.bars.map((bar) => ({
    source: bar.source,
    businessRemnantId: bar.businessRemnantId,
    purchaseLengthKind: bar.purchaseLengthKind,
    stockLengthMm: bar.stockLengthMm,
    cuts: bar.cuts.map((cut) => ({ workpieceId: cut.workpieceId })),
  }))
}

export function formatMm(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)
}

export function formatKg(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}
