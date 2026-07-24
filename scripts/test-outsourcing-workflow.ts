import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const quickAdd = read('src/components/features/production/ProductionOutsourcingQuickAdd.tsx')
const outsourcingTab = read('src/components/features/outsourcing/OutsourcingTab.tsx')
const supplyWorkspace = read('src/components/features/supply/OutsourcingTransportPage.tsx')
const supplyRequests = read('src/components/features/supply/SupplyOutsourcingRequestsPage.tsx')
const productionRequests = read('src/components/features/production/ProductionOutsourcingRequestsPage.tsx')
const productionPlanner = read('src/components/features/production/ProductionPlanner.tsx')
const productionWorkspace = read('src/components/features/production/ProductionWorkspace.tsx')
const outsourcingActions = read('src/lib/actions/outsourcing.ts')
const routes = read('src/lib/constants/routes.ts')
const resources = read('src/lib/permissions/resources.ts')
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
assert.match(supplyRequests, /Запросы на аутсорсинг/)
assert.match(supplyRequests, /confirmOutsourcingServiceTerms/)
assert.match(productionRequests, /Желаемые даты отправителя/)
assert.match(productionRequests, /Начало у исполнителя/)
assert.match(productionRequests, /Конец у исполнителя/)
assert.match(productionPlanner, /OutsourcingStageCard/)
assert.match(productionPlanner, /Аутсорсинг/)
assert.match(productionWorkspace, /outsourcing:/)
assert.match(productionWorkspace, /display_label: operation\.work_type_name/)
assert.match(routes, /PRODUCTION_OUTSOURCING_REQUESTS/)
assert.match(routes, /SUPPLY_OUTSOURCING_REQUESTS/)
assert.match(resources, /ROUTES\.PRODUCTION_OUTSOURCING_REQUESTS/)
assert.match(resources, /ROUTES\.SUPPLY_OUTSOURCING_REQUESTS/)

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
assert.match(outsourcingActions, /syncConfirmedTransportForIncomingPlan/)
assert.match(outsourcingActions, /Маршрут: \$\{routeLabel\}/)
assert.match(outsourcingActions, /Описание работы: \$\{operation\.note\}/)
assert.match(outsourcingActions, /Что забрать:/)
assert.match(outsourcingActions, /operation\.incoming_date_start/)
assert.match(outsourcingActions, /operation\.incoming_date_end/)
assert.match(outsourcingActions, /loadedOperations\.filter\(\(operation\) => operation\.executor_type === 'supplier'\)/)
assert.match(productionPlanActions, /supply_terms_confirmed_at: null/)
assert.match(migration, /ADD COLUMN IF NOT EXISTS supply_terms_confirmed_at/)
assert.match(migration, /ADD COLUMN IF NOT EXISTS supply_terms_confirmed_by/)
assert.match(databaseTypes, /supply_terms_confirmed_at: string \| null/)

console.log('outsourcing workflow checks: ok')
