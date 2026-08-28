import type { calculateLongStockCuttingPlan, LongStockSourceOption } from './actions/long-stock-cutting-plans'
import { compareLongStockCandidates, type LongStockCuttingCandidate } from './long-stock-cutting-solver'
import type { LongStockSourceSelection } from './long-stock-cutting-plan'

export type LongStockScenarioCalculation = Awaited<ReturnType<typeof calculateLongStockCuttingPlan>>
export type LongStockScenario = {
  id: string
  revision: number
  status: 'ready' | 'dirty' | 'calculating' | 'error'
  error: string | null
  quantities: Record<string, string>
  candidate: LongStockCuttingCandidate
  calculation: LongStockScenarioCalculation
  input: LongStockScenarioCalculation['candidateInputs'][number]
}

export function createLongStockScenario(calculation: LongStockScenarioCalculation, candidate: LongStockCuttingCandidate, id: string): LongStockScenario {
  const input = calculation.candidateInputs.find((entry) => entry.candidateKey === candidate.key)
  if (!input) throw new Error('Расчёт не содержит подтверждения комбинации. Выполните расчёт заново.')
  return {
    id, revision: 0, status: 'ready', error: null, calculation, candidate, input,
    quantities: Object.fromEntries(input.stockSelection.map(({ inventoryId, quantity }) => [inventoryId, String(quantity)])),
  }
}

export function updateLongStockScenarioQuantity(scenario: LongStockScenario, inventoryId: string, value: string): LongStockScenario {
  return { ...scenario, revision: scenario.revision + 1, status: 'dirty', error: null,
    quantities: { ...scenario.quantities, [inventoryId]: value } }
}

export function longStockScenarioQuantityError(value: string, source: LongStockSourceOption | undefined) {
  const quantity = value === '' ? 0 : Number(value)
  if (!Number.isSafeInteger(quantity) || quantity < 0) return 'Введите целое количество от 0.'
  if (quantity === 0) return null
  if (!source?.available) return source?.unavailableReason || 'Источник больше недоступен. Снимите выбор.'
  if (quantity > source.availableQuantity) return `Свободно только ${source.availableQuantity} шт. Уменьшите количество.`
  return null
}

export function longStockScenarioSelection(quantities: Record<string, string>, sources: readonly LongStockSourceOption[]): LongStockSourceSelection[] {
  return Object.entries(quantities).sort(([a], [b]) => a.localeCompare(b, 'en')).flatMap(([inventoryId, value]) => {
    const error = longStockScenarioQuantityError(value, sources.find((option) => option.inventoryId === inventoryId))
    if (error) throw new Error(error)
    const quantity = Number(value)
    return quantity > 0 ? [{ inventoryId, quantity }] : []
  })
}

export function finishLongStockScenarioCalculation(scenario: LongStockScenario, revision: number, calculation: LongStockScenarioCalculation): LongStockScenario {
  if (scenario.revision !== revision || scenario.status !== 'calculating') return scenario
  const candidate = calculation.candidates[0]
  if (!candidate) return { ...scenario, status: 'error', error: 'Для выбранных источников раскладка не найдена. Измените количества или запросите рекомендацию.' }
  return { ...createLongStockScenario(calculation, candidate, scenario.id), revision }
}

export function bestLongStockScenarioId(scenarios: readonly LongStockScenario[]) {
  return scenarios.filter((scenario) => scenario.status === 'ready')
    .sort((a, b) => compareLongStockCandidates(a.candidate, b.candidate))[0]?.id ?? null
}

function sourceIdentity(source: LongStockSourceOption | undefined) {
  if (!source) return null
  return JSON.stringify([source.source, source.lengthMm, source.availableQuantity, source.available,
    source.factoryId, source.requiresTransfer, source.state, source.availableFromDate,
    source.sourceVersionId, source.sourceBarId, source.createdAt])
}

export function refreshLongStockScenarios(
  scenarios: readonly LongStockScenario[], previous: readonly LongStockSourceOption[], refreshed: readonly LongStockSourceOption[],
  contextChanged: boolean, exceptId?: string,
): LongStockScenario[] {
  const changed = new Set([...previous, ...refreshed].filter((source) =>
    sourceIdentity(previous.find((item) => item.inventoryId === source.inventoryId))
    !== sourceIdentity(refreshed.find((item) => item.inventoryId === source.inventoryId))).map((source) => source.inventoryId))
  return scenarios.map((scenario) => {
    if (scenario.id === exceptId) return scenario
    const affected = contextChanged || scenario.input.stockSelection.some(({ inventoryId }) => changed.has(inventoryId))
      || Object.entries(scenario.quantities).some(([id, value]) => Number(value) > 0 && changed.has(id))
    return affected ? { ...scenario, revision: scenario.revision + 1, status: 'dirty',
      error: 'Доступность источников или дата порезки изменились. Пересчитайте эту комбинацию.' } : scenario
  })
}
