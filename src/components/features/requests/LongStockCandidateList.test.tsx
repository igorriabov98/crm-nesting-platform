import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { solveLongStockCutting, type LongStockCuttingCandidate } from '@/lib/long-stock-cutting-solver'
import { candidateMaterialBreakdown, formatLongStockComposition, longStockNewBarOrigin } from '@/lib/long-stock-position-ui'
import { LongStockCandidateList, LongStockCandidateSummary } from './LongStockCandidateList'

function screenshotCandidates() {
  return solveLongStockCutting({
    workpieces: Array.from({ length: 10 }, (_, index) => ({ id: `cut-${index}`, lengthMm: 1300 })),
    stockSources: [{
      id: 'warehouse:1', inventoryId: 'warehouse', source: 'warehouse_stock', lengthMm: 12000,
      createdAt: '2026-08-01', factoryId: 'factory', requiresTransfer: false, availableFromDate: null,
    }],
    requireAllStockSources: true,
    purchaseLengths: [6000, 12000].map((lengthMm) => ({ lengthMm, kind: 'standard' as const })),
    kerfMm: 2, endTrimMm: 10, allowMixedLengths: true,
  }).candidates
}

function section(html: string, label: string) {
  const start = html.indexOf(`<section aria-label="${label}"`)
  // Summary panels also have their aria-label after the class attribute.
  const labelIndex = start >= 0 ? start : html.indexOf(`aria-label="${label}"`)
  assert.ok(labelIndex >= 0, `missing section: ${label}`)
  return html.slice(labelIndex, html.indexOf('</section>', labelIndex))
}

const sources = [{ inventoryId: 'warehouse', factoryName: 'Берегово', isOwnFactory: true, sourceMachineName: null, sourceVersionNumber: null }]

test('selected combination shows the actual warehouse bar, purchase composition and each future remainder', () => {
  const candidate = screenshotCandidates()[0]
  const html = renderToStaticMarkup(<LongStockCandidateSummary candidate={candidate} minimumUsefulLengthMm={500} sources={sources} />).replaceAll('\u00a0', ' ')
  const stock = section(html, 'Хлысты со склада')
  const purchase = section(html, 'Хлысты в закупку')
  const remnants = section(html, 'Будущие складские остатки')
  assert.match(stock, /Со склада · 1 шт\./)
  assert.match(stock, /Хлыст №1 · 12 000 мм/)
  assert.match(stock, /Обычный склад · Берегово/)
  assert.match(stock, /Резы: 1 300 мм × 9 шт\./)
  assert.match(stock, /Остаток: 272 мм/)
  assert.match(purchase, /В закупку · 1 шт\./)
  assert.match(purchase, /6 000 мм × 1 шт\./)
  assert.doesNotMatch(purchase, /12 000 мм/)
  assert.match(remnants, /Будущие остатки · 2 шт\./)
  assert.match(remnants, /272 мм × 1 шт\./)
  assert.match(remnants, /4 688 мм × 1 шт\./)
  assert.match(remnants, /Из хлыста №2 · 6 000 мм · Закупка/)
  assert.match(remnants, /Мелочь · также попадёт на склад/)
  assert.doesNotMatch(html, /warehouse|new_stock/)
})

test('only the selected combination expands and switching selection replaces its purchase and remnants', () => {
  const candidates = screenshotCandidates()
  for (const candidate of candidates) {
    const html = renderToStaticMarkup(<LongStockCandidateList candidates={candidates} selectedKey={candidate.key} bestKey={candidates[0].key} weightPerMeterKg={9.36} minimumUsefulLengthMm={500} onSelect={() => {}} />).replaceAll('\u00a0', ' ')
    assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 1)
    assert.equal((html.match(/aria-label="Состав выбранной комбинации"/g) ?? []).length, 1)
    const purchase = section(html, 'Хлысты в закупку')
    const composition = formatLongStockComposition(candidateMaterialBreakdown(candidate).purchaseGroups).replaceAll('\u00a0', ' ')
    assert.ok(purchase.includes(composition))
    const remainder = candidate.bars.find((bar) => bar.source === 'new_stock')!.remainderMm
    assert.ok(section(html, 'Будущие складские остатки').includes(`${new Intl.NumberFormat('ru-RU').format(remainder).replaceAll('\u00a0', ' ')} мм × 1 шт.`))
  }
})

test('aggregate inventory pieces stay separate and all positive remnants are counted, even below the threshold', () => {
  const original = screenshotCandidates()[0]
  const stock = original.bars.find((bar) => bar.source === 'warehouse_stock')!
  const candidate: LongStockCuttingCandidate = { ...original, bars: [0, 1, 2, 3, 4].map((index) => ({
    ...stock, barNumber: index + 1, stockSourceId: `warehouse:${index + 1}`, remainderMm: index,
  })) }
  const breakdown = candidateMaterialBreakdown(candidate)
  assert.equal(breakdown.stockBars.length, 5)
  assert.deepEqual(breakdown.stockGroups, [{ lengthMm: 12000, pieceCount: 5 }])
  assert.equal(breakdown.stockLengthMm, 60000)
  assert.equal(breakdown.purchasedLengthMm, 0)
  assert.deepEqual(breakdown.remnantBars.map((bar) => [bar.barNumber, bar.remainderMm]), [[2, 1], [3, 2], [4, 3], [5, 4]])
  const html = renderToStaticMarkup(<LongStockCandidateSummary candidate={candidate} minimumUsefulLengthMm={500} />)
  assert.match(html, /Закупка не требуется/)
  assert.equal((html.match(/Мелочь · также попадёт на склад/g) ?? []).length, 4)
  assert.doesNotMatch(section(html, 'Будущие складские остатки'), /Из хлыста №1/)
})

test('future stock describes its availability, originating machine and required transfer', () => {
  const candidate = screenshotCandidates()[0]
  candidate.bars[0] = { ...candidate.bars[0], source: 'future_business_remnant', requiresTransfer: true, availableFromDate: '2026-09-03' }
  const html = renderToStaticMarkup(<LongStockCandidateSummary candidate={candidate} minimumUsefulLengthMm={0} sources={[
    { ...sources[0], isOwnFactory: false, factoryName: 'Хуст', sourceMachineName: 'ЛЕДА.500', sourceVersionNumber: 2 },
    { ...sources[0], inventoryId: 'local' },
  ]} />)
  assert.match(html, /Будущий остаток до 03.09.2026/)
  assert.match(html, /Перевод Хуст → Берегово/)
  assert.match(html, /ЛЕДА.500 · версия №2/)
  assert.match(html, /Появятся после фактической порезки/)
})

test('received and legacy-reserved bars are not presented as a new procurement need', () => {
  const contexts = [
    { planningRecovery: { reservedStock: [{ lengthMm: 6000, pieceCount: 1 }] } },
    { recalculation: { sourceKind: 'inventory_reconciliation' } },
    { recalculation: { sourceKind: 'supply_receipt' } },
    { recalculation: { sourceKind: 'inventory_transfer' } },
  ]
  for (const context of contexts) {
    const candidate = screenshotCandidates()[0]
    const origin = longStockNewBarOrigin(context)
    const breakdown = candidateMaterialBreakdown(candidate, origin)
    assert.equal(breakdown.stockBars.length, 2)
    assert.equal(breakdown.purchaseBars.length, 0)
    assert.equal(breakdown.purchasedLengthMm, 0)
    const html = renderToStaticMarkup(<LongStockCandidateSummary candidate={candidate} minimumUsefulLengthMm={0} newBarOrigin={origin} />)
    assert.match(section(html, 'Хлысты в закупку'), /Закупка не требуется/)
    assert.match(section(html, 'Хлысты со склада'), origin === 'reserved_stock' ? /Забронированный склад/ : /Принятый материал/)
  }
  assert.equal(longStockNewBarOrigin({ recalculation: { sourceKind: 'supply_return' } }), 'purchase')
  assert.equal(longStockNewBarOrigin({ planningRecovery: { reservedStock: [] } }), 'purchase')
})
