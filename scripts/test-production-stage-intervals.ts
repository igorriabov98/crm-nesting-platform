import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  dateBelongsToStageInterval,
  getStageIntervals,
  getStageIntervalSequenceError,
  intervalActiveDays,
  prorateStageIntervalsForPeriod,
  stageActiveDays,
  type ProductionStageIntervalValue,
} from '../src/lib/production-stage-intervals'

const root = process.cwd()
const migration = readFileSync(join(root, 'supabase/migrations/20260812130000_production_stage_intervals.sql'), 'utf8')
const planner = readFileSync(join(root, 'src/components/features/production/ProductionPlanner.tsx'), 'utf8')
const table = readFileSync(join(root, 'src/components/features/production/ProductionTable.tsx'), 'utf8')
const stickyTable = readFileSync(join(root, 'src/components/features/shared/StickyTable.tsx'), 'utf8')
const approval = readFileSync(join(root, 'src/lib/actions/production-plan.ts'), 'utf8')
const dashboard = readFileSync(join(root, 'src/lib/dashboard/planning-director/data.ts'), 'utf8')
const stages = readFileSync(join(root, 'src/lib/constants/stages.ts'), 'utf8')

const intervals: ProductionStageIntervalValue[] = [
  { id: 'b', production_stage_id: 'stage', position: 2, date_start: '2026-08-10', date_end: '2026-08-12', workshop: 2 },
  { id: 'a', production_stage_id: 'stage', position: 1, date_start: '2026-08-03', date_end: '2026-08-07', workshop: 1 },
]
const stage = {
  id: 'stage',
  stage_type: 'assembly',
  workshop: null,
  date_start: '2026-08-03',
  date_end: '2026-08-12',
  intervals,
}

assert.deepEqual(getStageIntervals(stage).map((interval) => interval.id), ['a', 'b'], 'intervals must be ordered by position')
assert.equal(stageActiveDays(stage), 8, 'gaps must not add active production days')
assert.equal(intervalActiveDays(intervals[0]), 3, 'date ranges are inclusive')
assert.equal(dateBelongsToStageInterval(stage, '2026-08-08'), false, 'a night date in a gap must be rejected')
assert.equal(dateBelongsToStageInterval(stage, '2026-08-10'), true, 'a night date inside an approach must be accepted')

const load = prorateStageIntervalsForPeriod(8, intervals, '2026-08-01', '2026-08-31')
assert.deepEqual(load, { totalDays: 8, overlapDays: 8, tons: 8 })
const partialLoad = prorateStageIntervalsForPeriod(8, intervals, '2026-08-10', '2026-08-12')
assert.deepEqual(partialLoad, { totalDays: 8, overlapDays: 3, tons: 3 })
assert.equal(getStageIntervalSequenceError(intervals), null)
assert.match(
  getStageIntervalSequenceError([
    intervals[1],
    { ...intervals[0], date_start: '2026-08-07' },
  ]) || '',
  /пересекается/,
)

const legacy = getStageIntervals({
  id: 'legacy-stage', stage_type: 'cutting', workshop: 1,
  date_start: '2026-08-01', date_end: '2026-08-02', intervals: [],
})
assert.equal(legacy.length, 1)
assert.equal(legacy[0].id, 'legacy:legacy-stage')

for (const needle of [
  'CREATE TABLE IF NOT EXISTS public.production_stage_intervals',
  'ON CONFLICT (production_stage_id, position) DO NOTHING',
  'production_stage_intervals_sync_parent',
  'production_stages_sync_single_interval',
  'fn_mutate_production_stage_interval',
  'fn_apply_production_stage_interval_changes',
  'fn_apply_production_plan_date_change_items',
  "target_type = 'stage_interval'",
  'Дата ночной малярки должна попадать внутрь одного из подходов',
]) {
  assert.ok(migration.includes(needle), `migration contract missing: ${needle}`)
}

assert.ok(migration.includes("stage_type::text IN ('cutting', 'assembly', 'cleaning', 'painting')"))
assert.ok(migration.includes("stage_type::text NOT IN ('cutting', 'assembly', 'cleaning', 'painting')"))
assert.ok(migration.includes('current_interval.date_start <= previous_interval.date_end'))
assert.ok(migration.includes('SET CONSTRAINTS production_stage_intervals_sync_parent DEFERRED'))
assert.ok(migration.includes('REVOKE ALL ON FUNCTION public.fn_mutate_production_stage_interval'))
assert.ok(!migration.includes('ps.updated_at'), 'production_stages has no updated_at column')
assert.ok(planner.includes("window.localStorage.setItem('production-planner-view', next)"))
assert.ok(planner.includes("setDesktopInspectorOpen(next === 'gantt')"), 'the list must open without the date inspector')
assert.ok(planner.includes('.flatMap(productionStageToGanttStages)'))
assert.ok(planner.includes('machineWeight / totalActiveDays'))
assert.ok(planner.includes('new Set(row.visibleStages.map((stage) => stage.parent_stage_id || stage.id)).size'))
assert.ok(planner.includes('productionStageHasTimelineSegment(stage)'))
assert.ok(table.includes('Ещё подход'))
assert.ok(table.includes('useVirtualizer'))
assert.ok(table.includes("window.localStorage.setItem('production-table-density', density)"), 'whole-table scale must persist')
assert.ok(table.includes('aria-label="Масштаб всей таблицы"'))
assert.ok(table.includes("target.closest('button, a, input, select, textarea"), 'date controls must not select the row')
assert.ok(table.includes('id: `draft:${stage.id}`'), 'empty interval stages must render approach 1 fields')
assert.ok(table.includes("placeholder={editable ? 'дд.мм' : '—'}"), 'empty editable dates must remain visible')
assert.ok(table.includes('Очистить начало и конец подхода'), 'interval clear must describe both dates')
assert.ok(table.includes('patchLocalStage(stage.id, { date_start: null, date_end: null })'), 'stage clear must clear both boundaries')
assert.ok(stickyTable.includes('top: var(--sticky-table-header-row-height)'), 'the second header row must not overlap stage names')
assert.ok(!table.includes('bg-blue-900/30'), 'legacy purple-blue status fill must be removed')
assert.ok(!table.includes('aria-label="Sort by date"'), 'table controls must use Russian accessible labels')
assert.ok(approval.includes("target_type: 'stage_interval'"))
assert.ok(approval.includes("db.rpc('fn_apply_production_plan_date_change_items'"))
assert.ok(dashboard.includes('prorateStageIntervalsForWorkingPeriod'))
assert.ok(stages.includes("assembly:    { label: 'Сборка/Сварка'"))

console.log('Production stage interval contracts: OK')
