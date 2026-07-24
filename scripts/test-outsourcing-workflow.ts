import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const quickAdd = read('src/components/features/production/ProductionOutsourcingQuickAdd.tsx')
const outsourcingTab = read('src/components/features/outsourcing/OutsourcingTab.tsx')
const supplyWorkspace = read('src/components/features/supply/OutsourcingTransportPage.tsx')
const outsourcingActions = read('src/lib/actions/outsourcing.ts')
const productionPlanActions = read('src/lib/actions/production-plan.ts')
const migration = read('supabase/migrations/20260724175500_outsourcing_supply_terms_confirmation.sql')
const databaseTypes = read('src/lib/types/database.ts')

assert.doesNotMatch(quickAdd, /Стоимость услуги/)
assert.doesNotMatch(outsourcingTab, /Field label="Стоимость услуги"/)
assert.match(quickAdd, /Другой тип работы/)
assert.match(quickAdd, /workTypeName: draft\.useCustomWorkType/)
assert.match(outsourcingTab, /Другой тип работы/)

assert.match(supplyWorkspace, /Согласование услуг аутсорсинга/)
assert.match(supplyWorkspace, /Стоимость услуги/)
assert.match(supplyWorkspace, /confirmOutsourcingServiceTerms/)
assert.match(supplyWorkspace, /Ожидает подтверждения/)
assert.match(supplyWorkspace, /Цена перевозки/)

const saveOperationSource = outsourcingActions.slice(
  outsourcingActions.indexOf('export async function saveOutsourcingOperation'),
  outsourcingActions.indexOf('export async function archiveOutsourcingOperation'),
)
assert.match(saveOperationSource, /resolveWorkTypeId/)
assert.doesNotMatch(saveOperationSource, /parsed\.serviceCostPlanned/)
assert.match(saveOperationSource, /supply_terms_confirmed_at = null/)

assert.match(outsourcingActions, /export async function confirmOutsourcingServiceTerms/)
assert.match(outsourcingActions, /service_cost_planned: parsed\.serviceCostPlanned/)
assert.match(outsourcingActions, /supply_terms_confirmed_at: now/)
assert.match(productionPlanActions, /supply_terms_confirmed_at: null/)
assert.match(migration, /ADD COLUMN IF NOT EXISTS supply_terms_confirmed_at/)
assert.match(migration, /ADD COLUMN IF NOT EXISTS supply_terms_confirmed_by/)
assert.match(databaseTypes, /supply_terms_confirmed_at: string \| null/)

console.log('outsourcing workflow checks: ok')
