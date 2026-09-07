import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')

const enumMigration = read('supabase/migrations/20260906223000_sales_order_confirmation_task_type.sql')
const automation = read('supabase/migrations/20260906223100_sales_order_confirmation_task_automation.sql')
const myOrders = read('src/lib/my-orders.ts')
const myOrdersView = read('src/components/features/my-orders/MyOrdersView.tsx')
const tasksAction = read('src/lib/actions/tasks.ts')
const taskCards = read('src/components/features/tasks/TaskCards.tsx')
const databaseTypes = read('src/lib/types/database.ts')

assert.match(enumMigration, /ALTER TYPE public\.task_type ADD VALUE IF NOT EXISTS 'sales_order_confirmation'/)
assert.match(automation, /task\.task_type = 'engineer_confirm'/)
assert.match(automation, /v_confirmation_deadline := v_engineer_deadline - 2/)
assert.match(automation, /v_machine\.created_by/)
assert.match(automation, /manager\.is_active = true/)
assert.match(automation, /COALESCE\(manager\.is_service_account, false\) = false/)
assert.match(automation, /CREATE TRIGGER trg_engineer_task_sales_confirmation_insert/)
assert.match(automation, /CREATE TRIGGER trg_engineer_task_sales_confirmation_update/)
assert.match(automation, /CREATE TRIGGER trg_machines_sales_order_confirmation_sync/)
assert.match(automation, /CREATE TRIGGER trg_users_sales_order_confirmation_task_sync/)
assert.match(automation, /COALESCE\(v_machine\.is_confirmed, false\)/)
assert.match(automation, /SET status = 'completed'/)
assert.match(automation, /SET status = 'cancelled'/)
assert.match(automation, /REVOKE ALL ON FUNCTION public\.fn_sync_sales_order_confirmation_task\(uuid\)[\s\S]*FROM PUBLIC, anon, authenticated/)
assert.doesNotMatch(automation, /client\.responsible_user_id/)

assert.match(myOrders, /\.eq\('task_type', 'engineer_confirm'\)/)
assert.match(myOrders, /confirmationDeadlineFromEngineerDeadline\(task\.deadline\)/)
assert.match(myOrdersView, /Дедлайн подтверждения/)
assert.match(tasksAction, /SALES_ORDER_CONFIRMATION_TASK_TYPE/)
assert.match(tasksAction, /Задача подтверждения заказа закрывается автоматически после подтверждения заказа/)
assert.match(taskCards, /sales_order_confirmation: 'Подтверждение заказа'/)
assert.match(databaseTypes, /'sales_order_confirmation'/)

console.log('sales order confirmation deadline source checks passed')
