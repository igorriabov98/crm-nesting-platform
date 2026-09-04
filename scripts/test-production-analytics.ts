import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  factoryWorkingDates,
  isFactoryWorkingDay,
  isoWeekKey,
  prorateStageIntervalsForWorkingPeriod,
} from '../src/lib/production-stage-intervals'
import {
  aggregateTonnage,
  capacityOverload,
  productionProgressStatus,
  weightedProgress,
} from '../src/lib/reports/production-analytics-core'
import {
  PERMISSION_RESOURCES,
  getDefaultPermissionMap,
  getFullPermissionMap,
  getPermissionRequirementForPath,
  getSidebarResources,
  hasPermission,
} from '../src/lib/permissions/resources'

const root = process.cwd()
const exceptions = [
  { work_date: '2026-09-04', is_working: false },
  { work_date: '2026-09-05', is_working: true },
]
assert.equal(isFactoryWorkingDay('2026-09-03', exceptions), true)
assert.equal(isFactoryWorkingDay('2026-09-04', exceptions), false, 'weekday exception must close the factory')
assert.equal(isFactoryWorkingDay('2026-09-05', exceptions), true, 'weekend exception must open the factory')
assert.deepEqual(factoryWorkingDates('2026-09-03', '2026-09-07', exceptions), ['2026-09-03', '2026-09-05', '2026-09-07'])
assert.equal(isoWeekKey('2025-12-29'), '2026-W01', 'ISO week key must include the ISO year')
assert.equal(isoWeekKey('2026-01-04'), '2026-W01')

const intervals = [
  { date_start: '2026-09-01', date_end: '2026-09-03' },
  { date_start: '2026-09-07', date_end: '2026-09-08' },
]
assert.deepEqual(
  prorateStageIntervalsForWorkingPeriod(5, intervals, '2026-09-02', '2026-09-07'),
  { totalWorkingDays: 5, overlapWorkingDays: 3, tons: 3 },
  'weight must be distributed across all working days of all approaches',
)
assert.deepEqual(
  prorateStageIntervalsForWorkingPeriod(5, intervals, '2026-09-04', '2026-09-06'),
  { totalWorkingDays: 5, overlapWorkingDays: 0, tons: 0 },
)

const items = [
  { id: 'powder', quantity: 10, unitWeightKg: 2, coating: 'powder_coating' },
  { id: 'zinc', quantity: 10, unitWeightKg: 3, coating: 'zinc' },
]
const facts = [
  { itemId: 'powder', totalWeightKg: 10 },
  { itemId: 'zinc', totalWeightKg: 30 },
]
assert.deepEqual(weightedProgress(items, facts, 'painting'), {
  completedKg: 10,
  applicableKg: 20,
  percent: 50,
}, 'painting progress must only include powder-coated items')
assert.deepEqual(weightedProgress(items, facts, 'assembly'), {
  completedKg: 40,
  applicableKg: 50,
  percent: 80,
})
assert.equal(aggregateTonnage([{ quantity: 3, unitWeightKg: 1.2345 }]), 0.004, 'line and aggregate weights must round to 0.001')
assert.equal(capacityOverload(5, null), null, 'missing capacity must not imply overload')
assert.equal(capacityOverload(5, 4.999), true)
assert.equal(productionProgressStatus({
  applicableKg: 100,
  completedKg: 0,
  intervals: [{ date_start: '2026-10-01', date_end: '2026-10-05' }],
  today: '2026-09-04',
}), 'upcoming', 'future periods must not get a false -100% deviation')
assert.equal(productionProgressStatus({
  applicableKg: 100,
  completedKg: 0,
  intervals: [{ date_start: '2026-09-05', date_end: '2026-09-06' }],
  today: '2026-09-06',
}), 'data_error', 'an interval without working days must be a data-quality error')

const migration = readFileSync(join(root, 'supabase/migrations/20260904140000_production_analytics_item_facts.sql'), 'utf8')
const action = readFileSync(join(root, 'src/lib/actions/production-fact.ts'), 'utf8')
const page = readFileSync(join(root, 'src/components/features/production/ProductionFactPage.tsx'), 'utf8')
const report = readFileSync(join(root, 'src/lib/reports/production-analytics.ts'), 'utf8')
const reportPage = readFileSync(join(root, 'src/app/(protected)/reports/production/page.tsx'), 'utf8')

for (const contract of [
  'production_machine_item_facts',
  'machine_item_snapshot_id',
  "source in ('legacy_manual', 'itemized')",
  'fn_save_production_machine_item_fact_v1',
  'fn_delete_production_machine_item_fact_v1',
  'Количество превышает остаток по этапу',
  "p_stage_type = 'painting'::public.stage_type",
  "source = 'itemized'",
  "source = 'legacy_manual'",
  'pg_advisory_xact_lock',
  'for update',
  'grant execute on function public.fn_save_production_machine_item_fact_v1',
  'to service_role',
]) assert.ok(migration.toLocaleLowerCase().includes(contract.toLocaleLowerCase()), `migration contract missing: ${contract}`)
assert.match(migration, /revoke all on function public\.fn_save_production_machine_item_fact_v1[\s\S]*from public, anon, authenticated/u)
assert.match(action, /getContext\('production_fact', 'manage'\)[\s\S]*fn_save_production_machine_item_fact_v1/u)
assert.match(action, /Одна позиция не может быть указана дважды/u)
assert.match(action, /Автоматический тоннаж изменяется только через факт по номенклатуре/u)
assert.match(action, /canEditSelectedDate: canManage && canEditFactDate/u, 'view-only production access must not enable editing')
assert.match(action, /if \(canManage && !hasStandardProductionFactSections/u, 'view-only page loads must not mutate standard sections')
assert.match(page, /Выберите один заказ/u)
assert.match(page, /Сохранение заменяет факт выбранной даты, смены, участка и заказа/u)
assert.match(page, /Исторический агрегат — детализация недоступна/u)
assert.match(page, /item\.replacementLimit/u, 'editing limit and displayed remaining quantity must stay distinct')
assert.match(page, /setComment\(result\.data\.comment \|\| ''\)/u, 'repeat editing must restore the saved comment')
assert.doesNotMatch(page, /setTonnageDrafts/u, 'manual tonnage input must be removed from the quantitative stages')
assert.match(report, /production_month\?\.slice\(0, 7\) === month/u, 'progress must filter by full production year-month')
assert.match(reportPage, /max-w-full overflow-x-auto/u, 'wide tables must scroll locally on mobile')
assert.match(reportPage, /Сформировано:/u)

const productionReport = PERMISSION_RESOURCES.find((resource) => resource.key === 'production_reports')
assert(productionReport)
assert.deepEqual(productionReport.defaultViewRoles, [], 'report must be closed by default')
assert.deepEqual(productionReport.defaultManageRoles, [], 'report settings must be closed by default')
assert.equal(productionReport.supportsFactoryScope, true)
assert(!hasPermission(getDefaultPermissionMap('planning_director'), 'production_reports', 'view'))
assert(hasPermission(getFullPermissionMap(), 'production_reports', 'manage'))
assert.equal(getPermissionRequirementForPath('/reports/production')?.resourceKey, 'production_reports')
assert.equal(getPermissionRequirementForPath('/reports/production')?.operation, 'view')
assert.equal(getPermissionRequirementForPath('/reports/production/settings')?.operation, 'manage')
assert(getSidebarResources('planning_director', getFullPermissionMap(), 'reports').some((resource) => resource.key === 'production_reports'))

console.log('Production analytics contracts: OK')
