import type { Database } from '@/lib/types/database'
import { isTransportExpenseCategory } from '@/lib/utils/transport-expense'

type TaskStatus = Database['public']['Enums']['task_status']
type DbError = { message?: string; code?: string } | null
type DbResult = { data: unknown; error: DbError }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
  insert: (values: Record<string, unknown>) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  lte: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  or: (filters: string) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  single: () => Promise<DbResult>
}
type LooseDb = { from: (table: string) => LooseQuery }

type MachineRow = { id: string; name: string | null; created_by: string | null; is_archived: boolean | null }
type TaskRow = { id: string; machine_id?: string | null; assigned_to: string; task_type?: ShippingTaskType; status: TaskStatus }
type ShippingTaskType = 'transport_cost' | 'shipping_documents'

const TASKS: Record<ShippingTaskType, { offset: number; title: string; description: string }> = {
  transport_cost: { offset: -7, title: 'Внести стоимость транспорта', description: 'Укажите транспортный расход' },
  shipping_documents: { offset: -5, title: 'Подготовить документы для отгрузки', description: 'Подготовьте документы для отгрузки' },
}

const dbFrom = (client: unknown) => client as LooseDb
const message = (error: unknown) => error instanceof Error ? error.message : String(error || '')
const dateOnly = (value?: string | null) => value ? value.slice(0, 10) : null
const today = () => new Date().toISOString().slice(0, 10)
function addDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
function formatDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value
}

async function cancelOpenTasks(db: LooseDb, machineId: string, taskType?: ShippingTaskType) {
  let query = db.from('tasks').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('machine_id', machineId)
  query = taskType ? query.eq('task_type', taskType) : query.in('task_type', Object.keys(TASKS))
  const { error } = await query.in('status', ['pending', 'in_progress'])
  if (error) throw new Error(error.message || 'Не удалось отменить задачу по отгрузке')
}

async function hasTransportCost(db: LooseDb, machineId: string) {
  const { data, error } = await db.from('machine_expenses').select('category, amount').eq('machine_id', machineId)
  if (error) throw new Error(error.message || 'Не удалось проверить стоимость транспорта')
  return ((data || []) as Array<{ category: string | null; amount: number | string | null }>).some(
    (row) => isTransportExpenseCategory(row.category) && Number(row.amount || 0) > 0,
  )
}

async function resolveShippingReadinessDate(db: LooseDb, machineId: string) {
  const { data, error } = await db.from('production_stages').select('date_end, planned_date_end').eq('machine_id', machineId).eq('stage_type', 'shipping').order('created_at', { ascending: false }).limit(1)
  if (error) throw new Error(error.message || 'Не удалось проверить плановую готовность к погрузке')
  const stage = ((data || []) as Array<{ date_end: string | null; planned_date_end: string | null }>)[0]
  return dateOnly(stage?.date_end) || dateOnly(stage?.planned_date_end)
}

async function resolveAssignee(db: LooseDb, creatorId: string | null) {
  if (!creatorId) return { id: null, reason: 'У машины не указан автор' }
  const { data, error } = await db.from('users').select('id, is_active, is_service_account').eq('id', creatorId).single()
  if (error || !data) return { id: null, reason: 'Автор машины не найден' }
  const user = data as { id: string; is_active: boolean | null; is_service_account: boolean | null }
  if (user.is_active === false) return { id: null, reason: 'Автор машины неактивен' }
  if (user.is_service_account) return { id: null, reason: 'Автор машины является служебным пользователем' }
  return { id: user.id, reason: null }
}

async function upsertTask(db: LooseDb, machine: MachineRow, assignedTo: string, shippingDate: string, taskType: ShippingTaskType) {
  const definition = TASKS[taskType]
  const deadline = addDays(shippingDate, definition.offset)
  if (today() < deadline || (taskType === 'transport_cost' && await hasTransportCost(db, machine.id))) {
    await cancelOpenTasks(db, machine.id, taskType)
    return
  }
  const now = new Date().toISOString()
  const machineName = machine.name || 'Машина'
  const payload = {
    machine_id: machine.id,
    assigned_to: assignedTo,
    task_type: taskType,
    title: `${definition.title}: ${machineName}`,
    description: `${definition.description} для машины ${machineName}. Плановая готовность к погрузке: ${formatDate(shippingDate)}.`,
    start_date: deadline,
    deadline,
    updated_at: now,
  }
  const { data, error } = await db.from('tasks').select('id, assigned_to, status').eq('machine_id', machine.id).eq('task_type', taskType)
  if (error) throw new Error(error.message || 'Не удалось проверить задачи по отгрузке')
  const tasks = (data || []) as TaskRow[]
  const active = tasks.find((task) => ['pending', 'in_progress'].includes(task.status))
  if (active) {
    for (const duplicate of tasks.filter((task) => task.id !== active.id && ['pending', 'in_progress'].includes(task.status))) {
      const { error: cancelError } = await db.from('tasks').update({ status: 'cancelled', updated_at: now }).eq('id', duplicate.id)
      if (cancelError) throw new Error(cancelError.message || 'Не удалось отменить дубликат задачи по отгрузке')
    }
    const { error: updateError } = await db.from('tasks').update({ ...payload, assigned_to: assignedTo }).eq('id', active.id)
    if (updateError) throw new Error(updateError.message || 'Не удалось обновить задачу по отгрузке')
    return
  }
  if (tasks.some((task) => task.status === 'completed')) return
  const { error: insertError } = await db.from('tasks').insert({ ...payload, status: 'pending' satisfies TaskStatus })
  if (insertError && !String(insertError.message || '').includes('duplicate key')) throw new Error(insertError.message || 'Не удалось создать задачу по отгрузке')
}

async function syncShippingTasksInternal(client: unknown, machineId: string) {
  const db = dbFrom(client)
  const { data, error } = await db.from('machines').select('id, name, created_by, is_archived').eq('id', machineId).single()
  if (error || !data) throw new Error(error?.message || 'Машина не найдена')
  const machine = data as MachineRow
  const shippingDate = await resolveShippingReadinessDate(db, machineId)
  const assignee = await resolveAssignee(db, machine.created_by)
  if (machine.is_archived || !shippingDate || !assignee.id) {
    await cancelOpenTasks(db, machineId)
    return { skippedReason: machine.is_archived ? 'Машина в архиве' : !shippingDate ? 'Не указана плановая готовность к погрузке' : assignee.reason }
  }
  await Promise.all((Object.keys(TASKS) as ShippingTaskType[]).map((taskType) => upsertTask(db, machine, assignee.id!, shippingDate, taskType)))
  return { skippedReason: null }
}

export async function syncTransportCostTask(client: unknown, machineId: string) {
  try { return await syncShippingTasksInternal(client, machineId) }
  catch (error) {
    if (message(error).includes('invalid input value for enum task_type') && message(error).includes('shipping_documents')) return { skippedReason: 'Миграция типов задач ещё не применена' }
    throw error
  }
}

export async function syncDueTransportCostTasks(client: unknown) {
  const db = dbFrom(client)
  const dueLimit = addDays(today(), 7)
  const [stages, tasks] = await Promise.all([
    db.from('production_stages').select('machine_id').eq('stage_type', 'shipping').or(`planned_date_end.lte.${dueLimit},date_end.lte.${dueLimit}`),
    db.from('tasks').select('machine_id').in('task_type', Object.keys(TASKS)).in('status', ['pending', 'in_progress']),
  ])
  if (stages.error || tasks.error) throw new Error(stages.error?.message || tasks.error?.message || 'Не удалось найти задачи по отгрузке')
  const machineIds = new Set<string>()
  for (const row of (stages.data || []) as Array<{ machine_id?: string }>) if (row.machine_id) machineIds.add(row.machine_id)
  for (const row of (tasks.data || []) as Array<{ machine_id?: string }>) if (row.machine_id) machineIds.add(row.machine_id)
  const errors: Array<{ machineId: string; error: string }> = []
  const diagnostics: Array<{ machineId: string; reason: string }> = []
  let synced = 0
  for (const machineId of machineIds) {
    try {
      const result = await syncTransportCostTask(client, machineId)
      if (result?.skippedReason) diagnostics.push({ machineId, reason: result.skippedReason })
      else synced += 1
    } catch (error) { errors.push({ machineId, error: message(error) }) }
  }
  return { checked: machineIds.size, synced, machineIds: [...machineIds], diagnostics, errors }
}
