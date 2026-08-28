// Hermetic server-action integration: real calculations/validation, an in-memory DB, no network or inventory mutations.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { build } from 'esbuild'

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ids = { item: uuid(1), request: uuid(2), machine: uuid(3), material: uuid(4), variant: uuid(5), factory: uuid(6), stock: uuid(7), plan: uuid(8), planItem: uuid(9), version: uuid(10), other: uuid(11) }
let tables
let writes
let settings
let deny = false
const db = {
  from(table) {
    const predicates = []
    const data = () => (tables[table] ?? []).filter((row) => predicates.every((predicate) => predicate(row)))
    const query = {
      select() { return query }, order() { return query },
      eq(key, value) { predicates.push((row) => row[key] === value); return query },
      is(key, value) { predicates.push((row) => (row[key] ?? null) === value); return query },
      in(key, values) { predicates.push((row) => values.includes(row[key])); return query },
      gt(key, value) { predicates.push((row) => Number(row[key]) > value); return query },
      async maybeSingle() { return { data: data()[0] ?? null, error: null } },
      async single() { return query.maybeSingle() },
      then(resolve, reject) { return Promise.resolve({ data: data(), error: null }).then(resolve, reject) },
    }
    return query
  },
  async rpc(name, args) {
    if (name === 'fn_get_long_stock_layout_settings_snapshot') return { data: structuredClone(settings), error: null }
    writes.push({ name, args })
    if (name === 'fn_create_long_stock_cutting_plan') {
      tables.long_stock_cutting_plan_items = [{ id: ids.planItem, plan_id: ids.plan,
        request_item_table: args.p_request_items[0].request_item_table, request_item_id: ids.item, cutting_status: 'planning' }]
      return { data: ids.plan, error: null }
    }
    if (name === 'fn_get_or_create_long_stock_cutting_plan_version_v2') {
      tables.long_stock_cutting_plan_versions = [{ id: ids.version, plan_id: ids.plan, version_number: 1, status: 'draft' }]
      return { data: ids.version, error: null }
    }
    throw new Error(`Unexpected RPC: ${name}`)
  },
}
const stubs = {
  '@/lib/supabase/admin': 'export function createAdminClient() { return globalThis.testDb }',
  '@/lib/permissions/server': 'export async function requirePermission() { return globalThis.testPermission() }',
  '@/lib/actions/materials': 'export const createMaterial = globalThis.unexpected; export const recordMaterialUsage = globalThis.unexpected;',
  '@/lib/actions/technologist-requests': 'export const addCircle = globalThis.unexpected, addKnife = globalThis.unexpected, addPipe = globalThis.unexpected, updateCircle = globalThis.unexpected, updateKnife = globalThis.unexpected, updatePipe = globalThis.unexpected;',
  '@/lib/long-stock-cutting-plan-pdf-server': 'export const prepareLongStockCuttingPlanPdf = globalThis.unexpected, removePreparedLongStockCuttingPlanPdf = globalThis.unexpected;',
}
const compiled = await build({ entryPoints: ['src/lib/actions/long-stock-cutting-plans.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{ name: 'hermetic-actions', setup(builder) {
    builder.onResolve({ filter: /^@\// }, (args) => args.path in stubs ? { path: args.path, namespace: 'test-stub' } : undefined)
    builder.onLoad({ filter: /.*/, namespace: 'test-stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }))
  } }],
})
const sandbox = { module: { exports: {} }, require: createRequire(import.meta.url), console, testDb: db,
  testPermission: () => { if (deny) throw new Error('Permission denied'); return { userId: uuid(99) } },
  unexpected: () => { throw new Error('Unexpected side effect') },
}
vm.runInNewContext(compiled.outputFiles[0].text, sandbox)
const actions = sandbox.module.exports

function reset(category = 'pipe', pipeType = 'profile', bevel = null) {
  writes = []
  deny = false
  const table = category === 'circle' ? 'request_circle' : category === 'knives' ? 'request_knives' : 'request_pipe'
  settings = { schema_version: 1, revision: 1, kerf_mm: 2, end_trim_mm: 10, optimization_hint_threshold_percent: 10,
    categories: ['circle', 'pipe', 'knife_bevel_1', 'knife_bevel_2'].map((key) => ({ key, material_category: category, knife_bevel_count: bevel,
      business_scrap_threshold_mm: 0, minimum_useful_length_mm: 500, standard_lengths: [6000, 12000], nonstandard_lengths: [] })),
  }
  tables = {
    [table]: [{ id: ids.item, request_id: ids.request, material_id: ids.material, material_variant_id: ids.variant,
      steel_type_id: null, pipe_type: pipeType, remainder_mm: 13000, remainder_length_mm: 13000, remainder_meters: 13 }],
    material_variants: [{ id: ids.variant, material_id: ids.material, category, pipe_type: pipeType,
      knife_bevel_count: bevel, weight_per_m_kg: 9.36 }],
    technologist_requests: [{ id: ids.request, machine_id: ids.machine }],
    machines: [{ id: ids.machine, factory_id: ids.factory, name: 'ЛЕДА.525' }],
    factories: [{ id: ids.factory, name: 'Берегово' }, { id: ids.other, name: 'Хуст' }],
    production_stages: [{ id: uuid(20), machine_id: ids.machine, stage_type: 'cutting', date_start: '2026-09-10', created_at: '2026-08-01' }],
    inventory: [{ id: ids.stock, material_id: ids.material, material_variant_id: ids.variant, factory_id: ids.factory,
      piece_length_mm: 12000, total_quantity: 12000, available_quantity: 12000, available_secondary_quantity: 1,
      is_business_scrap: false, business_scrap_state: 'available', available_from_date: null, source_machine_id: null, created_at: '2026-08-01' }],
  }
  return { requestItem: { table, id: ids.item }, mode: 'mixed',
    segments: Array.from({ length: 10 }, (_, i) => ({ id: `cut-${i}`, lengthMm: 1300 })) }
}

for (const [category, pipeType, bevel] of [['circle', null, null], ['pipe', 'standard', null], ['pipe', 'profile', null], ['pipe', 'round', null], ['knives', null, 1], ['knives', null, 2]]) {
  const input = reset(category, pipeType, bevel)
  const calculated = await actions.calculateLongStockCuttingPlan(input)
  assert.equal(writes.length, 0, 'calculation must not write/reserve')
  assert.equal(calculated.candidates[0].purchasedLengthMm, 6000)
  assert.equal(calculated.factoryName, 'Берегово')
  const receipt = calculated.candidateInputs[0]
  await actions.createLongStockCuttingPlanVersion({ ...input, ...receipt, selectedCandidateKey: receipt.candidateKey })
  const saved = structuredClone(writes.find((write) => write.name === 'fn_get_or_create_long_stock_cutting_plan_version_v2').args)
  assert.equal(saved.p_input_snapshot.calculation_fingerprint, receipt.expectedCalculationFingerprint)
  assert.deepEqual(saved.p_input_snapshot.selected_stock_sources.map((source) => source.inventory_id), [ids.stock])
  const selected = saved.p_candidates[saved.p_selected_candidate_number - 1]
  assert.deepEqual(selected.bars.map((bar) => bar.cuts.length), [9, 1])
  assert.deepEqual(selected.bars.map((bar) => bar.stock_length_mm), [12000, 6000])
}

for (const mutate of [
  () => { tables.production_stages[0].date_start = '2026-09-11' },
  () => { settings.kerf_mm = 3 },
  () => { tables.inventory[0].factory_id = ids.other },
  () => { tables.inventory[0].available_quantity = 0; tables.inventory[0].available_secondary_quantity = 0 },
]) {
  const input = reset()
  const calculated = await actions.calculateLongStockCuttingPlan(input)
  const receipt = calculated.candidateInputs[0]
  mutate()
  await assert.rejects(() => actions.createLongStockCuttingPlanVersion({ ...input, ...receipt, selectedCandidateKey: receipt.candidateKey }), /Пересчитайте|Свободных/)
  assert.equal(writes.length, 0, 'stale confirmation must fail before any version/plan/transfer write')
}

reset()
tables.inventory[0].factory_id = ids.other
const foreign = await actions.loadLongStockSourceOptions({ requestId: ids.request, materialId: ids.material, materialVariantId: ids.variant })
assert.equal(foreign.factoryName, 'Берегово')
assert.equal(foreign.sources[0].factoryName, 'Хуст')
assert.equal(foreign.sources[0].requiresTransfer, true)
assert.equal(writes.length, 0)
const futureInput = reset()
tables.inventory[0] = { ...tables.inventory[0], is_business_scrap: true, business_scrap_state: 'future',
  available_from_date: '2026-09-09', source_machine_id: uuid(30) }
tables.long_stock_cutting_business_scraps = [{ inventory_id: ids.stock, version_id: uuid(31), bar_id: uuid(32) }]
tables.long_stock_cutting_plan_versions = [{ id: uuid(31), plan_id: uuid(33), version_number: 2, status: 'approved' }]
tables.long_stock_cutting_plan_items = [{ plan_id: uuid(33), request_id: uuid(34) }]
tables.machines.push({ id: uuid(30), factory_id: ids.factory, name: 'ЛЕДА.524' })
let futureSources = await actions.loadLongStockSourceOptions({ requestId: ids.request, materialId: ids.material, materialVariantId: ids.variant })
assert.equal(futureSources.sources[0].state, 'future')
assert.equal(futureSources.sources[0].available, true)
tables.production_stages[0].date_start = '2026-09-09'
futureSources = await actions.loadLongStockSourceOptions({ requestId: ids.request, materialId: ids.material, materialVariantId: ids.variant })
assert.equal(futureSources.sources[0].available, false)
assert.match(futureSources.sources[0].unavailableReason, /раньше/)
assert.equal(writes.length, 0)
deny = true
await assert.rejects(() => actions.calculateLongStockCuttingPlan(futureInput), /Permission denied/)
const wireInput = reset('pipe', 'wire')
await assert.rejects(() => actions.calculateLongStockCuttingPlan(wireInput), /Проволока/)
console.log('Scenario server actions passed: six material variants, exact reviewed layout, stale proofs before writes, factory labels, permissions and wire exclusion. No database/network used.')
