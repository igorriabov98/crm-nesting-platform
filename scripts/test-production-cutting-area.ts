import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PERMISSION_RESOURCES, getPermissionRequirementForPath, hasPermission, type PermissionMap } from '../src/lib/permissions/resources'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const migration = read('supabase/migrations/20260809120000_production_cutting_area.sql')

for (const table of ['production_cutting_cycles', 'production_cutting_cycle_requests', 'production_cutting_cycle_events']) {
  assert(migration.includes(`create table public.${table}`), `Нет таблицы ${table}`)
  assert(migration.includes(`alter table public.${table} enable row level security`), `RLS не включен для ${table}`)
}
assert(migration.includes("status in ('in_progress','completed','cancelled')"))
assert(migration.includes('production_cutting_cycles_active_machine_idx'))
assert(migration.includes('cutting_event_id uuid references public.production_fact_cutting_events(id) on delete set null'))
assert(migration.includes('Production cutting history is immutable'))
assert(migration.includes('fn_finalize_technologist_request_with_archives'))
assert(migration.includes("from storage.objects\n      where bucket_id = 'nesting-files'"))
assert(migration.includes('fn_start_production_cutting_cycle'))
assert(migration.includes('v_cutting_event_id := public.fn_apply_production_fact_cutting(v_fact_id, p_actor)'))
assert(migration.includes("event_type in ('started','completed','reopened','cancelled')"))
assert(migration.includes("source = 'historical_backfill'"))
assert(/select role, 'production_cutting_area', can_view, can_manage[\s\S]*resource_key = 'production_fact'/u.test(migration))
assert(/resource_key = 'production_fact'[\s\S]*'production_cutting_area'/u.test(migration))
assert(migration.includes('to service_role'))
assert(migration.includes('from public, anon, authenticated'))

const resource = PERMISSION_RESOURCES.find((candidate) => candidate.key === 'production_cutting_area')
assert(resource)
assert.equal(resource.label, 'Участок заготовки')
assert.equal(resource.defaultHref, '/production/cutting-area')
const pathRequirement = getPermissionRequirementForPath('/production/cutting-area')
assert.equal(pathRequirement?.resourceKey, 'production_cutting_area')
const viewOnly: PermissionMap = { production_cutting_area: { canView: true, canManage: false } }
assert(hasPermission(viewOnly, 'production_cutting_area', 'view'))
assert(!hasPermission(viewOnly, 'production_cutting_area', 'manage'))

const action = read('src/lib/actions/production-cutting-area.ts')
assert(action.includes("requirePermission('production_cutting_area', 'view')"))
assert(action.includes("requirePermission('production_cutting_area', 'manage')"))
assert(action.includes(".eq('is_confirmed', true)"))
assert(action.includes(".eq('is_archived', false)"))
assert(action.includes(".eq('stage_type', 'cutting')"))
assert(action.includes('getProductionCuttingAreaDetails'))

const page = read('src/components/features/production/CuttingAreaPage.tsx')
for (const label of ['Ожидают', 'В работе', 'Выполненные', 'Все чертежи и STEP', 'Взял в работу', 'Машина завершена']) {
  assert(page.includes(label), `UI не содержит ${label}`)
}
assert(page.includes('aria-expanded={isExpanded}'))
assert(!page.includes('min-w-['), 'Страница не должна задавать фиксированную горизонтальную ширину')

const archiveRoute = read('src/app/api/production/cutting-area/archives/[id]/route.ts')
const fileRoute = read('src/app/api/production/cutting-area/files/[kind]/[id]/route.ts')
for (const route of [archiveRoute, fileRoute]) {
  assert(route.includes("requirePermission('production_cutting_area', 'view')"))
  assert(route.includes('resolveFileResponse'))
}
assert(fileRoute.includes(".eq('machine_id', parsed.data.machineId)"))
assert(fileRoute.includes(".eq('is_sample', false)"))

console.log('production-cutting-area: OK')
