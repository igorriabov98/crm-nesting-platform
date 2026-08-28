import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { z } from 'zod'
import { CompletionCuttingPlanCard } from '../src/components/features/technologist/CompletionCuttingPlanCard'
import type { CompletionWorkspace } from '../src/lib/actions/request-completion'
import * as routes from '../src/lib/constants/routes'
import * as cuttingFiles from '../src/lib/machine-cutting/files'
import * as pipeProfile from '../src/lib/materials/pipe-profile'
import * as metalScrap from '../src/lib/metal-scrap'
import * as materialScope from '../src/lib/request-completion-material-scope'
import * as navigation from '../src/lib/request-completion-navigation'
import * as errors from '../src/lib/utils/get-error-message'

type Row = Record<string, unknown>
type DbResult = { data: Row | Row[] | null; error: { message: string } | null }
type QueryCall = { table: string; filters: Record<string, unknown> }
type WorkspaceResult = { data: CompletionWorkspace | null; error: string | null; redirectTo: string | null }
type LongStockTable = 'request_pipe' | 'request_circle' | 'request_knives'

const requestId = '11111111-1111-4111-8111-111111111111'
const actionSource = readFileSync('src/lib/actions/request-completion.ts', 'utf8')
const actionCode = ts.transpileModule(actionSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function fixture(options: {
  categories?: LongStockTable[]
  pipeType?: string
  scraps?: Row[]
  planStatus?: string
  versionId?: string | null
  requestStatus?: string
  createdBy?: string
  errorTable?: string
} = {}) {
  const categories = options.categories ?? ['request_pipe']
  const scraps = options.scraps ?? [
    { id: 'future-1', piece_length_mm: 1200, business_scrap_state: 'future', deleted_at: null },
    { id: 'future-2', piece_length_mm: 1200, business_scrap_state: 'future', deleted_at: null },
    { id: 'available-1', piece_length_mm: 800, business_scrap_state: 'available', deleted_at: null },
  ]
  const planRows = categories.map((category) => ({
    request_item_table: category,
    request_item_id: category,
    plan_id: `plan-${category}`,
    version_id: options.versionId === undefined ? `version-${category}` : options.versionId,
    plan_status: options.planStatus ?? 'open',
    planned_bar_count: 3,
  }))
  const links = categories.flatMap((category) => scraps.map((scrap) => ({
    version_id: `version-${category}`, inventory_id: `${category}-${scrap.id}`,
  })))
  const tables: Record<string, Row | Row[]> = {
    technologist_requests: { id: requestId, machine_id: 'machine-1', created_by: options.createdBy ?? 'author-1', status: options.requestStatus ?? 'stock_checked' },
    machines: { id: 'machine-1', name: 'Тестовая машина', factory_id: 'factory-1', factories: { id: 'factory-1', name: 'Берегово' } },
    request_sheet_metal: [],
    request_pipe: [],
    request_circle: [],
    request_knives: [],
    long_stock_cutting_business_scraps: [...links, { version_id: 'unrelated-version', inventory_id: 'unrelated-inventory' }],
    inventory: categories.flatMap((category) => scraps.map((scrap) => ({ ...scrap, id: `${category}-${scrap.id}` }))),
  }
  for (const category of categories) {
    tables[category] = [{
      id: category, request_id: requestId, calculated_weight_kg: 20, remainder_qty: 3,
      ...(category === 'request_pipe' ? { pipe_type: options.pipeType ?? 'square', size: options.pipeType === 'round' ? '60' : options.pipeType === 'wire' ? '4' : '40х40' } : {}),
      ...(category === 'request_circle' ? { steel_grade: '40Х', diameter_mm: 50, remainder_mm: 3000 } : {}),
      ...(category === 'request_knives' ? { knife_type: 'Нож плоский', steel_grade: '65Г' } : {}),
    }]
  }
  const calls: QueryCall[] = []
  const db = {
    from(table: string) {
      assert.ok(table in tables, `Unexpected table: ${table}`)
      const filters: QueryCall['filters'] = {}
      const query = {
        select() { return query },
        eq(key: string, value: unknown) { filters[key] = value; return query },
        in(key: string, values: unknown[]) { filters[key] = [...values]; return query },
        order() { return query },
        single() { return query },
        then(...args: Parameters<Promise<DbResult>['then']>) {
          calls.push({ table, filters })
          const source = tables[table]
          const data = Array.isArray(source) ? source.filter((row) => Object.entries(filters).every(([key, value]) => (
            Array.isArray(value) ? value.includes(row[key]) : row[key] === value
          ))) : source
          return Promise.resolve({ data, error: table === options.errorTable ? { message: 'Остатки недоступны' } : null }).then(...args)
        },
      }
      return query
    },
    async rpc(name: string, args: Record<string, unknown>) {
      assert.equal(name, 'fn_get_long_stock_completion_plan_facts_v1', 'Completion read must not call a mutation RPC')
      assert.equal(args.p_request_id, requestId)
      return { data: planRows, error: null }
    },
  }
  const forbiddenMutation = () => { throw new Error('Completion read must not mutate data') }
  const imports: Record<string, unknown> = {
    'zod': { z },
    'next/cache': { revalidatePath: forbiddenMutation },
    '@/lib/permissions/server': { requirePermission: async (resource: string, operation: string) => {
      assert.equal(resource, 'technologist_requests')
      assert.equal(operation, 'manage')
      return { userId: 'author-1' }
    } },
    '@/lib/supabase/admin': { createAdminClient: () => db },
    '@/lib/actions/technologist-requests': { completeStockReservation: forbiddenMutation },
    '@/lib/constants/routes': routes,
    '@/lib/utils/get-error-message': errors,
    '@/lib/request-completion-navigation': navigation,
    '@/lib/machine-cutting/files': cuttingFiles,
    '@/lib/request-completion-material-scope': materialScope,
    '@/lib/materials/pipe-profile': pipeProfile,
    '@/lib/metal-scrap': metalScrap,
  }
  const loadedModule = { exports: {} as { getCompletionWorkspace: (id: string) => Promise<WorkspaceResult> } }
  vm.runInNewContext(actionCode, {
    module: loadedModule, exports: loadedModule.exports,
    require(name: string) {
      assert.ok(name in imports, `Unexpected import: ${name}`)
      return imports[name]
    },
  })
  return {
    calls,
    load: async () => structuredClone(await loadedModule.exports.getCompletionWorkspace(requestId)),
  }
}

for (const [category, expectedName] of [
  ['request_pipe', 'Труба квадратная · 40х40'],
  ['request_circle', 'Круг Ø50 мм · 40Х'],
  ['request_knives', 'Нож плоский · 65Г'],
] as const) {
  test(`${category}: load and render the same business-remnant details`, async () => {
    const f = fixture({ categories: [category] })
    const result = await f.load()
    assert.equal(result.error, null)
    assert.ok(result.data)
    const item = result.data.wasteItems[0]
    assert.equal(item.itemName, expectedName)
    assert.equal(item.accountingMode, 'approved_plan')
    assert.equal(item.planSummary?.readyForSupply, true)
    assert.deepEqual(item.planSummary?.futureBusinessScraps, [
      { inventoryId: `${category}-future-1`, lengthMm: 1200, state: 'future' },
      { inventoryId: `${category}-future-2`, lengthMm: 1200, state: 'future' },
      { inventoryId: `${category}-available-1`, lengthMm: 800, state: 'available' },
    ])
    const markup = renderToStaticMarkup(<CompletionCuttingPlanCard item={item} />)
    assert.ok(markup.includes(expectedName))
    assert.ok(markup.includes('Будущие деловые остатки'))
    assert.ok(markup.includes('1 200 мм × 2 шт.'))
    assert.ok(markup.includes('800 мм × 1 шт.'))
    assert.ok(markup.includes('Общая длина: 3 200 мм'))
    assert.ok(markup.includes('Ожидает факта резки'))
    assert.ok(markup.includes('Доступен'))
    assert.ok(markup.includes('Производственные факты не требуются'))
    assert.ok(markup.includes(`aria-labelledby="future-scrap-${category}"`))
  })

  test(`${category}: explicitly show when no positive remnants are planned`, async () => {
    const result = await fixture({ categories: [category], scraps: [] }).load()
    assert.ok(result.data)
    const markup = renderToStaticMarkup(<CompletionCuttingPlanCard item={result.data.wasteItems[0]} />)
    assert.ok(markup.includes('Будущие деловые остатки'))
    assert.ok(markup.includes('положительных деловых остатков не запланировано'))
    assert.ok(!markup.includes('Общая длина:'))
  })
}

test('all pipe subtypes use Russian names and preserve profile dimensions', async () => {
  for (const [pipeType, expectedName] of [
    ['square', 'Труба квадратная · 40х40'],
    ['rectangular', 'Труба прямоугольная · 40х40'],
    ['round', 'Труба круглая · Ø60 мм'],
    ['wire', 'Проволока · 4'],
  ]) {
    const result = await fixture({ pipeType }).load()
    assert.equal(result.data?.wasteItems[0].itemName, expectedName)
  }
})

test('mixed requests batch-load remnants once, scoped to the current plan versions', async () => {
  const categories: LongStockTable[] = ['request_pipe', 'request_circle', 'request_knives']
  const f = fixture({ categories })
  const result = await f.load()
  assert.equal(result.data?.wasteItems.length, 3)
  const linkCalls = f.calls.filter((call) => call.table === 'long_stock_cutting_business_scraps')
  assert.equal(linkCalls.length, 1)
  assert.deepEqual(linkCalls[0].filters.version_id, categories.map((category) => `version-${category}`))
  assert.equal(f.calls.filter((call) => call.table === 'inventory').length, 1)
  assert.ok(result.data?.wasteItems.every((item) => item.planSummary?.futureBusinessScraps.length === 3))
})

test('keep small positive remnants but exclude deleted and non-positive inventory rows', async () => {
  const result = await fixture({ scraps: [
    { id: 'small', piece_length_mm: '0.5', business_scrap_state: 'future' },
    { id: 'zero', piece_length_mm: 0, business_scrap_state: 'future' },
    { id: 'negative', piece_length_mm: -10, business_scrap_state: 'future' },
    { id: 'deleted', piece_length_mm: 2000, business_scrap_state: 'future', deleted_at: '2026-08-27' },
  ] }).load()
  assert.deepEqual(result.data?.wasteItems[0].planSummary?.futureBusinessScraps, [
    { inventoryId: 'request_pipe-small', lengthMm: 0.5, state: 'future' },
  ])
})

test('unapproved plans do not query scraps or become ready for supply', async () => {
  const f = fixture({ versionId: null })
  const result = await f.load()
  assert.equal(result.data?.wasteItems[0].planSummary?.readyForSupply, false)
  assert.ok(!f.calls.some((call) => call.table === 'long_stock_cutting_business_scraps'))
})

test('scrap read failures are reported instead of presenting a false empty state', async () => {
  for (const errorTable of ['long_stock_cutting_business_scraps', 'inventory']) {
    const result = await fixture({ errorTable }).load()
    assert.equal(result.data, null)
    assert.match(result.error ?? '', /Остатки недоступны/)
  }
})

test('completion keeps author and lifecycle checks before loading any scraps', async () => {
  const foreign = fixture({ createdBy: 'another-author' })
  assert.match((await foreign.load()).error ?? '', /только её автор/)
  assert.equal(foreign.calls.length, 1)
  const completed = fixture({ requestStatus: 'submitted_to_supply' })
  assert.equal((await completed.load()).redirectTo, routes.ROUTES.MATERIAL_REQUESTS)
  assert.equal(completed.calls.length, 1)
})
