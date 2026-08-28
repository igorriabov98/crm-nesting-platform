import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LongStockSourceOption } from '@/lib/actions/long-stock-cutting-plans'
import { solveLongStockCutting } from '@/lib/long-stock-cutting-solver'
import { LongStockCandidateList } from './LongStockCandidateList'
import { LongStockScenarioSources } from './LongStockScenarioSources'

const source: LongStockSourceOption = {
  inventoryId: 'source', source: 'warehouse_stock', lengthMm: 12000, availableQuantity: 1,
  factoryId: 'own', factoryName: 'Берегово', isOwnFactory: true, requiresTransfer: false,
  state: 'available', availableFromDate: null, sourceMachineId: null, sourceMachineName: null,
  sourceRequestId: null, sourceVersionId: null, sourceVersionNumber: null, sourceBarId: null,
  available: true, unavailableReason: null, createdAt: '2026-08-01',
}
const future: LongStockSourceOption = { ...source, inventoryId: 'future', source: 'future_business_remnant',
  factoryId: 'other', factoryName: 'Хуст', isOwnFactory: false, requiresTransfer: true,
  state: 'future', availableFromDate: '2026-09-01', sourceMachineId: 'machine', sourceMachineName: 'ЛЕДА.525',
  sourceRequestId: 'request', sourceVersionNumber: 2,
}
const props = {
  scenario: { status: 'ready' as const, quantities: { source: '1' }, error: null },
  sources: [source, future], factoryName: 'Берегово', loading: false, loadError: null, disabled: false,
  onQuantityChange: () => {}, onRefresh: () => {}, onRecommend: () => {}, onRecalculate: () => {},
}

test('source controls appear only inside the expanded combination in standard and mixed layouts', () => {
  for (const allowMixedLengths of [false, true]) {
    const candidates = solveLongStockCutting({
      workpieces: Array.from({ length: 10 }, (_, i) => ({ id: String(i), lengthMm: 1300 })),
      purchaseLengths: [6000, 12000].map((lengthMm) => ({ lengthMm, kind: 'standard' as const })),
      kerfMm: 2, endTrimMm: 10, allowMixedLengths,
    }).candidates
    const html = renderToStaticMarkup(<LongStockCandidateList candidates={candidates} selectedKey={candidates[0].key}
      bestKey={candidates[0].key} weightPerMeterKg={1} minimumUsefulLengthMm={500} onSelect={() => {}}
      renderSourceEditor={() => <LongStockScenarioSources {...props} />} />)
    assert.equal((html.match(/aria-label="Источники этой комбинации"/g) ?? []).length, 1)
    assert.ok(html.indexOf('Состав выбранной комбинации') < html.indexOf('Источники этой комбинации'))
    assert.ok(html.lastIndexOf('</button>', html.indexOf('Источники этой комбинации')) > 0)
    assert.match(html, /Со своего завода/)
    assert.match(html, /С других заводов/)
  }
})

test('own factory name remains explicit without own inventory; foreign future stock shows origin and transfer', () => {
  const html = renderToStaticMarkup(<LongStockScenarioSources {...props} sources={[future]} />)
  for (const text of ['Завод машины — Берегово', 'Другие заводы', 'Будущий остаток до 01.09.2026', 'Перевод Хуст → Берегово', 'ЛЕДА.525', 'версия №2', 'Исходная заявка', 'только после фактической порезки']) assert.ok(html.includes(text), text)
  assert.match(html, /href="\/sales-plan\/machine\/request\/request"/)
})

test('unavailable choices remain visible and removable; invalid quantities are not silently clamped', () => {
  const unavailable = { ...source, available: false, availableQuantity: 0, unavailableReason: 'Исходная порезка позже потребляющей' }
  const html = renderToStaticMarkup(<LongStockScenarioSources {...props} sources={[unavailable]}
    scenario={{ ...props.scenario, status: 'dirty', quantities: { source: '2' } }} />)
  assert.match(html, /value="2"/)
  assert.match(html, /aria-invalid="true"/)
  assert.match(html, /Исходная порезка позже потребляющей/)
  const input = html.slice(html.indexOf('<input'), html.indexOf('/>', html.indexOf('<input')))
  assert.doesNotMatch(input, /\sdisabled=/)
  assert.match(html, /Итоги ниже относятся к предыдущему расчёту/)
  assert.match(html, /disabled=""[^>]*>[\s\S]*Пересчитать/)
})

test('calculation/loading states and immutable received sources cannot be edited', () => {
  const pending = renderToStaticMarkup(<LongStockScenarioSources {...props} scenario={{ ...props.scenario, status: 'calculating' }} />)
  assert.match(pending, /Пересчитываем только эту комбинацию/)
  assert.equal((pending.match(/<input[^>]*disabled=""/g) ?? []).length, 2)
  const readOnly = renderToStaticMarkup(<LongStockScenarioSources {...props} readOnly />)
  assert.match(readOnly, /Источники закреплены/)
  assert.doesNotMatch(readOnly, /<input|<button/)
})
