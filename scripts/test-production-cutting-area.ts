import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PERMISSION_RESOURCES, getPermissionRequirementForPath, hasPermission, type PermissionMap } from '../src/lib/permissions/resources'
import {
  cuttingAreaFileCategory,
  isCuttingAreaFileForItem,
  type CuttingAreaItemFileBinding,
} from '../src/lib/production-cutting-area/files'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const migration = read('supabase/migrations/20260809120000_production_cutting_area.sql')
const factoryScopeMigration = read('supabase/migrations/20260811120000_production_cutting_area_factory_scope.sql')

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
assert(factoryScopeMigration.includes("default 'own'"), 'Существующие настройки должны остаться в охвате своего завода')
assert(factoryScopeMigration.includes("factory_scope in ('own', 'all')"))
assert(factoryScopeMigration.includes("factory_scope = 'own' or resource_key = 'production_cutting_area'"))
assert(factoryScopeMigration.includes('old_factory_scope'))
assert(factoryScopeMigration.includes('new_factory_scope'))
assert(!factoryScopeMigration.includes("set factory_scope = 'all'"), 'Миграция не должна автоматически открывать оба завода')

const resource = PERMISSION_RESOURCES.find((candidate) => candidate.key === 'production_cutting_area')
assert(resource)
assert.equal(resource.label, 'Участок заготовки')
assert.equal(resource.defaultHref, '/production/cutting-area')
assert.equal(resource.supportsFactoryScope, true)
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
assert(action.includes('getProductionCuttingAreaRequest'))
assert(action.includes(".eq('machine_id', parsed.machineId)"), 'Заявка должна проверяться в контексте выбранной машины')
assert(action.includes("assertFactoryAccess(permission, CUTTING_AREA_RESOURCE, 'view', machineResult.data.factory_id)"), 'Read-only заявка должна сохранять заводской охват')
assert(action.includes('canAccessAllFactories'))
assert(action.includes('assertFactoryAccess'))
assert(action.includes("db.from('factories').select('id,name')"), 'Payload должен содержать доступные заводы для фильтра')
assert(action.includes('canViewAllFactories: canSeeAllFactories'), 'Payload должен сообщать о полном заводском охвате')
assert(!action.includes('DIRECTOR_ROLES'), 'Серверные действия должны использовать единый резолвер охвата')
assert(action.includes('production_month'))
assert(action.includes(".in('product_id', productIds)"), 'Файлы старых позиций должны находиться по product_id')
assert(action.includes("['drawing','step','pdf']"), 'PDF изделия должен отображаться вместе с чертежами')
assert(action.includes("db.from('long_stock_cutting_plan_items')"), 'Под заявкой должны загружаться карты раскроя')
assert(action.includes(".in('status', ['approved', 'invalid'])"), 'Участок должен видеть утверждённые и недействительные версии')

const page = read('src/components/features/production/CuttingAreaPage.tsx')
for (const label of ['Ожидают', 'В работе', 'Выполненные', 'Все заводы', 'Все месяцы', 'Сборочный чертёж', 'Общие чертежи', 'STEP file', 'Чертежи и STEP', 'Карты раскроя', 'Открыть PDF', 'требуется пересчёт', 'Открыть заявку', 'Взял в работу', 'Машина завершена']) {
  assert(page.includes(label), `UI не содержит ${label}`)
}
assert(page.includes('workspace.canViewAllFactories && <div>'), 'Фильтр заводов должен быть скрыт без полного охвата')
assert(page.includes("order.factoryId === factoryFilter"), 'Очередь должна фильтроваться по выбранному заводу')
assert(page.includes('setExpanded(null)'), 'Смена завода должна закрывать открытые подробности')
assert(page.includes('aria-label="Завод"'), 'Фильтр заводов должен иметь доступное имя')
assert(page.includes('aria-expanded={isExpanded}'))
assert(page.includes('showCloseButton={false}'), 'Модальное окно файлов должно использовать крупную кнопку закрытия')
assert(!page.includes('min-w-['), 'Страница не должна задавать фиксированную горизонтальную ширину')

const requestPage = read('src/app/(protected)/production/cutting-area/[machineId]/request/[requestId]/page.tsx')
assert(requestPage.includes('TechnologistRequestPage'))
assert(requestPage.includes('canManage={false}'), 'Производственная страница заявки должна быть строго read-only')
assert(requestPage.includes('Назад к участку заготовки'))

const breadcrumbs = read('src/components/features/layout/Breadcrumbs.tsx')
assert(breadcrumbs.includes('"cutting-area": "Участок заготовки"'))
assert(breadcrumbs.includes('"request": "Заявка на материалы"'))

const archiveRoute = read('src/app/api/production/cutting-area/archives/[id]/route.ts')
const fileRoute = read('src/app/api/production/cutting-area/files/[kind]/[id]/route.ts')
const cuttingPlanRoute = read('src/app/api/production/cutting-area/cutting-plans/[versionId]/route.ts')
for (const route of [archiveRoute, fileRoute, cuttingPlanRoute]) {
  assert(route.includes("requirePermission('production_cutting_area', 'view')"))
  assert(route.includes('canAccessFactory'))
  assert(route.includes('resolveFileResponse'))
}
assert(!archiveRoute.includes('isDirector'))
assert(!fileRoute.includes('isDirector'))
assert(cuttingPlanRoute.includes("version.status === 'invalid'"), 'Недействительная карта не должна выдаваться')
assert(cuttingPlanRoute.includes("disposition: 'inline'"), 'Карта должна открываться как PDF')
assert(!cuttingPlanRoute.includes('renderToBuffer'), 'Скачивание не должно пересобирать PDF')

const accessPage = read('src/components/features/settings/RolePermissionsPage.tsx')
for (const label of ['Охват заказов', 'Свой завод', 'Все заводы']) {
  assert(accessPage.includes(label), `Матрица доступа не содержит ${label}`)
}
assert(accessPage.includes('supportsFactoryScope'))
assert(fileRoute.includes(".eq('machine_id', machineId)"))
assert(fileRoute.includes(".eq('is_sample', false)"))
assert(fileRoute.includes("['drawing','step','pdf']"))

const legacyItem: CuttingAreaItemFileBinding = {
  productId: 'product-1',
  productVersionId: 'current-version',
  productProjectId: 'project-1',
  productProjectVersionId: 'approved-project-version',
}
assert(isCuttingAreaFileForItem(legacyItem, {
  kind: 'product', productId: 'product-1', productVersionId: 'current-version', fileKind: 'pdf',
}))
assert(!isCuttingAreaFileForItem(legacyItem, {
  kind: 'product', productId: 'product-1', productVersionId: 'other-version', fileKind: 'pdf',
}))
assert(isCuttingAreaFileForItem(legacyItem, {
  kind: 'project', productProjectId: 'project-1', productProjectVersionId: 'approved-project-version', fileKind: 'step',
}))
assert.equal(cuttingAreaFileCategory({
  kind: 'product', productId: 'product-1', productVersionId: 'current-version', fileKind: 'drawing',
}), 'assembly')
assert.equal(cuttingAreaFileCategory({
  kind: 'production_drawing', productVersionId: 'current-version', fileKind: 'pdf',
}), 'general')
assert.equal(cuttingAreaFileCategory({
  kind: 'project', productProjectId: 'project-1', productProjectVersionId: 'approved-project-version', fileKind: 'step',
}), 'step')

console.log('production-cutting-area: OK')
