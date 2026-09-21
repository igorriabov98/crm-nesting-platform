import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LayoutCoverage } from '@/lib/actions/supply-request'
import { LayoutCoveragePurchase, LayoutCoverageSources, LayoutCoverageState } from './LayoutCoverageSummary'

const coverage: LayoutCoverage = {
  request_item_table: 'request_circle',
  request_item_id: 'item',
  plan_id: 'plan',
  plan_number: 3,
  version_id: 'version',
  version_number: 2,
  status: 'approved',
  warehouse_mm: 4_000,
  business_scrap_mm: 1_532,
  purchase_covered_mm: 6_468,
  purchase_total_mm: 7_000,
  purchase_bars: [{ length_mm: 7_000, quantity: 1 }],
  source_factories: ['Берегово', 'Ужгород'],
  warehouse_factories: ['Берегово'],
  business_scrap_factories: ['Ужгород'],
}

test('layout coverage shows reserved sources, source factories and purchased bar composition', () => {
  const markup = renderToStaticMarkup(
    <>
      <LayoutCoverageSources coverage={coverage} />
      <LayoutCoveragePurchase coverage={coverage} />
      <LayoutCoverageState coverage={coverage} requestId="request" />
    </>,
  )
  assert.match(markup, /Основной склад — забронировано по раскладке:/)
  assert.match(markup, /Деловой остаток — забронировано по раскладке:/)
  assert.match(markup, /Берегово/)
  assert.match(markup, /Ужгород/)
  assert.match(markup, /1 × 7\s000 мм/)
  assert.match(markup, /Всего к закупке: 7\s000 мм/)
  assert.match(markup, /Открыть раскладку №3/)
  assert.match(markup, /\/api\/technologist\/requests\/request\/cutting-plans\/version/)
})

test('missing and stale layouts never look like available stock', () => {
  const missing = renderToStaticMarkup(<LayoutCoverageState coverage={null} />)
  const stale = renderToStaticMarkup(
    <LayoutCoverageState coverage={{ ...coverage, status: 'needs_recalculation' }} />,
  )
  assert.match(missing, /Раскладка не утверждена/)
  assert.match(stale, /Требуется пересчёт/)
  assert.doesNotMatch(missing, /На складе/)
})
