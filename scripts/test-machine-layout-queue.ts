import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = readFileSync(
  resolve('supabase/migrations/20260807180000_machine_layout_department_queue.sql'),
  'utf8',
)
const layoutActions = readFileSync(resolve('src/lib/actions/machine-layout.ts'), 'utf8')
const requestActions = readFileSync(resolve('src/lib/actions/department-requests.ts'), 'utf8')
const requestUi = readFileSync(
  resolve('src/components/features/department-requests/RequestActions.tsx'),
  'utf8',
)
const taskActions = readFileSync(resolve('src/lib/actions/tasks.ts'), 'utf8')
const taskCards = readFileSync(resolve('src/components/features/tasks/TaskCards.tsx'), 'utf8')
const technologistTab = readFileSync(
  resolve('src/components/features/machines/tabs/TechnologistTab.tsx'),
  'utf8',
)
const drawingRoute = readFileSync(
  resolve('src/app/api/machine-layout/drawings/[source]/[id]/route.ts'),
  'utf8',
)

assert.match(migration, /request_kind text not null default 'manual'/)
assert.match(migration, /request_kind in \('manual', 'machine_layout'\)/)
assert.match(migration, /department_request_id uuid[\s\S]*references public\.department_requests/)
assert.match(migration, /idx_machine_layout_requests_open_department_request/)
assert.match(migration, /machine_layout_next_workday/)
assert.match(migration, /extract\(isodow from next_date\) in \(6, 7\)/)
assert.match(migration, /can_claim_machine_layout_request/)
assert.match(migration, /app_user\.role in \('technologist', 'engineer'\)/)
assert.match(migration, /status = 'new'\s+and assigned_to is null/)
assert.match(migration, /when request_row\.request_kind = 'machine_layout' then 'machine_layout'/)
assert.match(migration, /'in_progress',[\s\S]*task_start_date,[\s\S]*task_deadline/)
assert.match(migration, /task_id = new_task_id,[\s\S]*assigned_to = current_user_id/)
assert.match(migration, /create or replace function public\.complete_machine_layout_request/)
assert.match(migration, /status = 'completed'[\s\S]*task_type = 'machine_layout'/)
assert.match(migration, /status = 'done'[\s\S]*PDF расстановки загружен/)
assert.match(migration, /Заявка на расстановку завершается автоматически после загрузки PDF/)
assert.match(migration, /request_row\.request_kind = 'machine_layout'[\s\S]*status = 'completed'/)
assert.match(migration, /old\.request_kind = 'machine_layout'[\s\S]*new\.status = 'in_progress'/)

assert.match(layoutActions, /create_machine_layout_department_request/)
assert.match(layoutActions, /sync_machine_layout_request_version/)
assert.match(layoutActions, /complete_machine_layout_request/)
assert.match(layoutActions, /requirePermission\('department_requests', 'manage'\)/)
assert.doesNotMatch(layoutActions, /auto_task_technologist_user_id/)
assert.doesNotMatch(layoutActions, /resolveConfiguredTechnologist/)
assert.doesNotMatch(layoutActions, /upsertLayoutTask/)

assert.match(requestActions, /canClaimMachineLayout/)
assert.match(requestActions, /dispatchPendingTelegramDeliveries/)
assert.match(requestActions, /revalidateRequest\(id, meta\?\.target_department, meta\?\.machine_id\)/)
assert.match(requestUi, /Открыть машину/)
assert.match(requestUi, /status === 'in_progress' && !isMachineLayout/)
assert.match(taskActions, /task\.task_type !== MACHINE_LAYOUT_TASK_TYPE/)
assert.match(taskActions, /Задача расстановки закреплена за сотрудником/)
assert.match(taskActions, /Задача расстановки закрывается автоматически после загрузки PDF/)
assert.match(taskCards, /task\.task_type === 'machine_layout'/)
assert.match(taskCards, /Открыть машину/)
assert.match(technologistTab, /Ожидает исполнителя/)
assert.match(technologistTab, /Заявка добавлена в «Технолог → Запросы»/)
assert.match(technologistTab, /can\('department_requests', 'manage'\)/)
assert.match(drawingRoute, /assigned_to', context\.userId/)
assert.match(drawingRoute, /contains\('item_snapshot'/)

console.log('Machine layout queue regression passed')
