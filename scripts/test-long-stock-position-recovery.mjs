import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const actions = readFileSync('src/lib/actions/long-stock-cutting-plans.ts', 'utf8')
const dialog = readFileSync('src/components/features/requests/LongStockPositionDialog.tsx', 'utf8')
const statusControl = readFileSync('src/components/features/requests/LongStockCuttingPlanStatusControl.tsx', 'utf8')

for (const required of [
  "'none' | 'planning' | 'active' | 'requires_recalculation'",
  "cuttingStatus === 'planning' ? 'planning'",
  'loadLongStockPlanningRecoveryDraft',
  'reserved_secondary_quantity: number | string | null',
  "('inventory_reservations')",
  "eq('is_cut_reservation', false)",
  "is('consumed_at', null)",
  'filterLongStockCandidatesByReservedStock',
  'assertLongStockRecoverySegmentTotal',
  'planning_recovery:',
  'planId: string | null',
  'planItemId: string | null',
  "if (!planItem && reservedStock.length === 0) return null",
  "? { status: 'planning', segments: [], total_length_mm: 0, piece_count: 0 }",
]) {
  assert.ok(actions.includes(required), `planning recovery action is missing ${required}`)
}

for (const required of [
  'LongStockPlanningRecoveryDialog',
  'Подготовка отсутствующей карты',
  'Сумма должна совпасть с потребностью',
  'Показать всю матрицу по отрезкам',
  'Каждый вариант использует точный состав забронированных физических хлыстов.',
]) {
  assert.ok(dialog.includes(required), `planning recovery dialog is missing ${required}`)
}

for (const required of [
  "status === 'planning'",
  'Карта не утверждена',
  'Подготовить карту',
  'LongStockPlanningRecoveryDialog',
]) {
  assert.ok(statusControl.includes(required), `planning status control is missing ${required}`)
}

console.log('Long-stock planning recovery regression passed')
