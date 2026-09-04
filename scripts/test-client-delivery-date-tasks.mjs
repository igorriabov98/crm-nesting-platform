import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')

const enumMigration = read('supabase/migrations/20260904130000_client_delivery_date_task_type.sql')
const automation = read('supabase/migrations/20260904131000_client_delivery_date_task_automation.sql')
const dueRoute = read('src/app/api/tasks/due/route.ts')
const syncAction = read('src/lib/actions/client-delivery-date-tasks.ts')
const tasksAction = read('src/lib/actions/tasks.ts')
const taskCards = read('src/components/features/tasks/TaskCards.tsx')
const salesActions = read('src/app/(protected)/sales-plan/actions.ts')
const clientActions = read('src/lib/actions/clients.ts')
const databaseTypes = read('src/lib/types/database.ts')

assert.match(enumMigration, /ALTER TYPE public\.task_type ADD VALUE IF NOT EXISTS 'client_delivery_date'/)
assert.match(automation, /COALESCE\(v_machine\.actual_shipping_date, v_machine\.desired_shipping_date\)/)
assert.match(automation, /v_deadline := v_calculated_delivery_date - 3/)
assert.match(automation, /client\.responsible_user_id/)
assert.match(automation, /manager\.role = 'sales_manager'::public\.user_role/)
assert.match(automation, /manager\.is_active = true/)
assert.match(automation, /delivery_to_client_date IS NOT NULL/)
assert.match(automation, /CREATE TRIGGER trg_machines_client_delivery_date_sync/)
assert.match(automation, /CREATE TRIGGER trg_clients_delivery_date_task_sync/)
assert.match(automation, /CREATE TRIGGER trg_users_client_delivery_date_task_sync/)
assert.match(automation, /daily-client-delivery-date-tasks/)
assert.match(automation, /REVOKE ALL ON FUNCTION public\.fn_sync_due_client_delivery_date_tasks\(\)[\s\S]*FROM PUBLIC, anon, authenticated/)
assert.doesNotMatch(automation, /assigned_to[^\n]*created_by/)

assert.match(syncAction, /fn_sync_due_client_delivery_date_tasks/)
assert.match(syncAction, /\.eq\('task_type', 'client_delivery_date'/)
assert.match(dueRoute, /syncDueClientDeliveryDateTasks/)
assert.match(dueRoute, /clientDeliveryResult/)
assert.match(tasksAction, /Задача по дате доставки закрывается автоматически после внесения даты доставки клиенту/)
assert.match(tasksAction, /Задача по дате доставки закреплена за ответственным менеджером клиента/)
assert.match(taskCards, /client_delivery_date: 'Дата доставки клиенту'/)
assert.match(taskCards, /\?tab=packing/)
assert.match(taskCards, /Внести дату доставки/)
assert.match(databaseTypes, /'client_delivery_date'/)

const packingAction = salesActions.slice(
  salesActions.indexOf('export async function updateMachinePackingSettings'),
  salesActions.indexOf('export async function updateMachineMaterialType'),
)
assert.match(packingAction, /revalidatePath\(ROUTES\.TASKS\)/)

const updateClientAction = clientActions.slice(
  clientActions.indexOf('export async function updateClient'),
  clientActions.indexOf('export async function uploadClientImage'),
)
assert.match(updateClientAction, /revalidatePath\(ROUTES\.TASKS\)/)

console.log('client delivery date task source checks passed')
