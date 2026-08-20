import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8')

const actionSource = read('src/lib/actions/supply-orders.ts')
const summarySource = read('src/components/features/supply-orders/SupplyOrderSummaryPage.tsx')
const returnButtonSource = read('src/components/features/supply-orders/ReturnLongStockPositionButton.tsx')
const requestListSource = read('src/components/features/department-requests/DepartmentRequestsPage.tsx')
const requestDetailSource = read('src/app/(protected)/requests/detail/[id]/page.tsx')
const migrationSource = read('supabase/migrations/20260818150000_supply_long_stock_plan_return.sql')

assert.match(
  actionSource,
  /summarizeLongStockPurchaseBars\(barsByCandidate\.get\(candidate\.id\) \|\| \[\]\)/,
  'supply order rows must derive purchase composition from the approved candidate bars',
)
assert.match(
  summarySource,
  /К закупке по утверждённой карте/,
  'supply must show the approved purchase composition without exposing the layout matrix',
)
assert.match(
  summarySource,
  /Нестандартная длина: дороже и дольше в поставке/,
  'nonstandard lengths must explain their supply impact',
)
assert.match(
  summarySource,
  /Складские остатки в закупку не включены/,
  'supply summary must explain that warehouse remnants are excluded',
)
assert.doesNotMatch(
  summarySource,
  /long_stock_cutting_bar_cuts|long_stock_cutting_segments/,
  'supply UI must not load or render cutting layouts',
)
assert.match(
  returnButtonSource,
  /Причина возврата/,
  'returning a position must require a reason',
)
assert.match(
  actionSource,
  /fn_return_long_stock_position_to_technologist_v1/,
  'the UI action must use the atomic database return RPC',
)
assert.match(requestListSource, /Пересчёт позиции/, 'return request must appear in the common request list')
assert.match(
  requestDetailSource,
  /#request-item-\$\{request\.request_item_id\}/,
  'return request must deep-link to the exact technologist request item',
)

for (const table of ['request_circle', 'request_pipe', 'request_knives']) {
  const sectionSource = read(`src/components/features/requests/${
    table === 'request_circle' ? 'CircleSection' : table === 'request_pipe' ? 'PipeSection' : 'KnivesSection'
  }.tsx`)
  assert.match(sectionSource, /id=\{`request-item-\$\{row\.id\}`\}/, `${table} row must expose a stable item anchor`)
}

assert.match(
  migrationSource,
  /request_kind = 'long_stock_recalculation'[\s\S]*request_item_id is not null/,
  'the database request must require an exact request-item reference',
)
assert.match(
  migrationSource,
  /set cutting_status = 'requires_recalculation'/,
  'return must put the position into recalculation state',
)
assert.match(
  migrationSource,
  /fn_assert_long_stock_cutting_ready[\s\S]*requires_recalculation/,
  'the database must block cutting while recalculation is required',
)
assert.match(
  migrationSource,
  /set status = 'done',[\s\S]*Новая версия карты раскроя утверждена/,
  'new plan approval must close the return request automatically',
)
assert.match(
  migrationSource,
  /fn_apply_production_fact_cutting_before_long_stock_return/,
  'all production cutting facts must pass through the recalculation guard',
)

console.log('supply long-stock plan and return regression: ok')
