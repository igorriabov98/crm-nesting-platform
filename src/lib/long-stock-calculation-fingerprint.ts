import { createHash } from 'node:crypto'
import type { LongStockCuttingCandidate } from './long-stock-cutting-solver'

/** Server-only proof of the reviewed inputs and layout, not of search diagnostics. */
export function longStockCalculationFingerprint(inputs: unknown, candidate: LongStockCuttingCandidate) {
  const layout = { ...candidate, searchComplete: undefined, exploredVariants: undefined }
  return createHash('sha256').update(JSON.stringify({ contract: 2, inputs, layout })).digest('hex')
}

export function assertLongStockCalculationFingerprint(expected: string | undefined, actual: string) {
  // Older callers remain compatible. The scenario editor always supplies a proof.
  if (expected !== undefined && expected !== actual) {
    throw new Error('Расчёт изменился: источники, даты или настройки больше не соответствуют показанной комбинации. Пересчитайте её перед утверждением.')
  }
}
