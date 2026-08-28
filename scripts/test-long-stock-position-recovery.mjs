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
  'Карта раскроя: {loadError}',
]) {
  assert.ok(statusControl.includes(required), `planning status control is missing ${required}`)
}

console.log('Long-stock planning recovery regression passed')

const approvalFailure = dialog.slice(dialog.indexOf('} catch (approvalError) {'), dialog.indexOf('async function close()'))
assert.ok(approvalFailure.includes('await refreshSources()'), 'approval conflict must refresh sources')
assert.ok(approvalFailure.includes("status: 'error'"), 'approval conflict must invalidate the affected scenario')
const refreshSources = dialog.slice(dialog.indexOf('async function refreshSources()'), dialog.indexOf('function updateSourceQuantity('))
assert.ok(refreshSources.includes('applySourceSnapshot(refreshed)'), 'refresh must update scenario availability')
assert.ok(!refreshSources.includes('invalidateCalculation()'), 'refresh must not erase other scenario drafts')
assert.ok(dialog.includes('mergeRefreshedLongStockSources'), 'refresh must retain unavailable operator selections')
assert.ok(dialog.includes('longStockScenarioSelection(scenario.quantities'), 'recalculation must validate exact quantities')
assert.ok(!dialog.includes('LongStockSourcesSection'), 'global source editor must be removed')
assert.ok(dialog.includes('...selectedScenario.input'), 'approval must use the selected scenario receipt')
assert.ok(dialog.includes('generation !== sourceLoadGeneration.current'), 'late source loads must not overwrite a newer material selection')
console.log('Long-stock source conflict recovery wiring passed')
