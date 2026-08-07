import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLIENT_PRICE_COATINGS } from '@/lib/client-prices/constants'
import {
  COATING_OPTIONS,
  COATINGS,
  isZincCoating,
  normalizeRalNumberForCoating,
} from '@/lib/constants/coatings'
import { machineItemSchema } from '@/lib/types/schemas'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

assert.deepEqual([...COATING_OPTIONS], ['cold_zinc', 'zinc', 'powder_coating', 'none'])
assert.deepEqual([...CLIENT_PRICE_COATINGS], [...COATING_OPTIONS])
assert.equal(COATINGS.cold_zinc.label, 'Холодный цинк')
assert.equal(COATINGS.zinc.label, 'Горячий цинк')
assert.equal(COATINGS.powder_coating.label, 'Порошковая покраска')
assert.equal(COATINGS.none.label, 'Без покрытия')

const existingClientPrices: Record<string, Partial<Record<(typeof COATING_OPTIONS)[number], number>>> = {
  product_1: { zinc: 125 },
}
assert.equal(existingClientPrices.product_1.zinc, 125)
assert.equal(existingClientPrices.product_1.cold_zinc, undefined)

for (const coating of ['cold_zinc', 'zinc']) assert.equal(isZincCoating(coating), true)
for (const coating of ['powder_coating', 'none', null, undefined]) assert.equal(isZincCoating(coating), false)

const coatingScenarios = [
  { name: 'hot-only', coatings: ['zinc'], hasZinc: true, hasHot: true, hasCold: false },
  { name: 'cold-only', coatings: ['cold_zinc'], hasZinc: true, hasHot: false, hasCold: true },
  { name: 'mixed-zinc', coatings: ['cold_zinc', 'zinc'], hasZinc: true, hasHot: true, hasCold: true },
  { name: 'powder-only', coatings: ['powder_coating'], hasZinc: false, hasHot: false, hasCold: false },
  { name: 'none', coatings: ['none'], hasZinc: false, hasHot: false, hasCold: false },
] as const

for (const scenario of coatingScenarios) {
  const coatings = new Set<string>(scenario.coatings)
  assert.equal(scenario.coatings.some(isZincCoating), scenario.hasZinc, scenario.name)
  assert.equal(coatings.has('zinc'), scenario.hasHot, scenario.name)
  assert.equal(coatings.has('cold_zinc'), scenario.hasCold, scenario.name)
}

assert.equal(normalizeRalNumberForCoating('cold_zinc', ' 7016 '), null)
assert.equal(normalizeRalNumberForCoating('zinc', ' 7016 '), null)
assert.equal(normalizeRalNumberForCoating('none', ' 7016 '), null)
assert.equal(normalizeRalNumberForCoating('powder_coating', ' 7016 '), '7016')

const coldItem = machineItemSchema.parse({
  drawing_number: 'TEST-COLD-ZINC',
  product_name: 'Тестовая позиция',
  weight: 1,
  price: 0,
  quantity: 1,
  coating: 'cold_zinc',
  ral_number: '',
})
assert.equal(coldItem.coating, 'cold_zinc')

const migration = read('supabase/migrations/20260807130100_integrate_cold_hot_zinc.sql')
assert.match(migration, /coating IN \('zinc', 'cold_zinc'\)/)
assert.match(migration, /DROP VIEW IF EXISTS public\.machines_with_totals/)
assert.match(migration, /AS has_hot_zinc/)
assert.match(migration, /AS has_cold_zinc/)
assert.match(migration, /stage_type IN \('galvanizing', 'post_galvanizing_cleaning'\)/)

const outsourcingActions = read('src/lib/actions/outsourcing.ts')
assert.match(outsourcingActions, /items\.filter\(\(item\) => isZincCoating\(item\.coating\)\)/)

const machineCreateForm = read('src/components/features/machines/MachineCreateForm.tsx')
assert.match(machineCreateForm, /clientPriceLookup\[productId\]\?\.\[coating\]/)
assert.doesNotMatch(machineCreateForm, /cold_zinc[^\n]+zinc|zinc[^\n]+cold_zinc/)

console.log('Coating variant checks passed')
