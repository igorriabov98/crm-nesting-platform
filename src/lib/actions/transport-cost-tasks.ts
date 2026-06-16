import type { Database } from '@/lib/types/database'

type TaskStatus = Database['public']['Enums']['task_status']
type UserRole = Database['public']['Enums']['user_role']

type DbError = { message?: string; code?: string } | null
type DbResult = { data: unknown; error: DbError }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
  insert: (values: Record<string, unknown>) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  single: () => Promise<DbResult>
}
type LooseDb = {
  from: (table: string) => LooseQuery
}

type MachineForTransportTask = {
  id: string
  name: string | null
  created_by: string | null
  desired_shipping_date: string | null
  is_archived: boolean | null
}

type ShippingStageDate = {
  date_end: string | null
  planned_date_end: string | null
}

type TransportTaskRow = {
  id: string
  assigned_to: string
  status: TaskStatus
}

const TRANSPORT_TASK_TYPE = 'transport_cost' as const

function dbFrom(client: unknown): LooseDb {
  return client as LooseDb
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || '')
}

function isMissingTransportTaskTypeError(error: unknown) {
  const message = getErrorMessage(error)
  return message.includes('invalid input value for enum task_type') && message.includes(TRANSPORT_TASK_TYPE)
}

function dateOnly(value: string | null | undefined) {
  if (!value) return null
  return value.slice(0, 10)
}

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

async function cancelOpenTransportTasks(db: LooseDb, machineId: string) {
  const { error } = await db
    .from('tasks')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('machine_id', machineId)
    .eq('task_type', TRANSPORT_TASK_TYPE)
    .in('status', ['pending', 'in_progress'])

  if (error) throw new Error(error.message || 'Не удалось отменить задачу по транспорту')
}

async function resolveTransportTaskDate(db: LooseDb, machineId: string, fallbackDate: string | null) {
  const { data, error } = await db
    .from('production_stages')
    .select('date_end, planned_date_end')
    .eq('machine_id', machineId)
    .eq('stage_type', 'shipping')

  if (error) throw new Error(error.message || 'Не удалось проверить плановую отгрузку')

  const shippingStage = ((data || []) as ShippingStageDate[])[0] || null
  return dateOnly(shippingStage?.planned_date_end) || dateOnly(shippingStage?.date_end) || dateOnly(fallbackDate)
}

async function resolveTransportAssignee(db: LooseDb, creatorId: string | null) {
  if (creatorId) {
    const { data: creatorData } = await db
      .from('users')
      .select('id, is_active')
      .eq('id', creatorId)
      .single()

    const creator = creatorData as { id: string; is_active: boolean | null } | null
    if (creator && creator.is_active !== false) return creator.id
  }

  const { data, error } = await db
    .from('users')
    .select('id')
    .eq('role', 'commercial_director' satisfies UserRole)
    .eq('is_active', true)

  if (error) throw new Error(error.message || 'Не удалось найти коммерческого директора')

  const director = ((data || []) as { id: string }[])[0]
  if (!director) throw new Error('Не найден исполнитель для задачи по транспорту')
  return director.id
}

async function syncTransportCostTaskInternal(client: unknown, machineId: string) {
  const db = dbFrom(client)

  const { data: machineData, error: machineError } = await db
    .from('machines')
    .select('id, name, created_by, desired_shipping_date, is_archived')
    .eq('id', machineId)
    .single()

  if (machineError || !machineData) throw new Error(machineError?.message || 'Машина не найдена')

  const machine = machineData as MachineForTransportTask
  if (machine.is_archived) {
    await cancelOpenTransportTasks(db, machineId)
    return
  }

  const shippingDate = await resolveTransportTaskDate(db, machineId, machine.desired_shipping_date)
  if (!shippingDate) {
    await cancelOpenTransportTasks(db, machineId)
    return
  }

  const assignedTo = await resolveTransportAssignee(db, machine.created_by)
  const deadline = addDays(shippingDate, -7)
  const machineName = machine.name || 'Машина'
  const now = new Date().toISOString()
  const taskPayload = {
    machine_id: machineId,
    assigned_to: assignedTo,
    task_type: TRANSPORT_TASK_TYPE,
    title: `Внести стоимость транспорта: ${machineName}`,
    description: `Укажите транспортный расход для машины ${machineName}. Плановая отгрузка: ${formatDate(shippingDate)}.`,
    status: 'pending' satisfies TaskStatus,
    start_date: deadline,
    deadline,
    updated_at: now,
  }

  const { data: tasksData, error: tasksError } = await db
    .from('tasks')
    .select('id, assigned_to, status')
    .eq('machine_id', machineId)
    .eq('task_type', TRANSPORT_TASK_TYPE)

  if (tasksError) throw new Error(tasksError.message || 'Не удалось проверить задачу по транспорту')

  const tasks = (tasksData || []) as TransportTaskRow[]
  const completedForAssignee = tasks.find((task) => task.assigned_to === assignedTo && task.status === 'completed')
  const reusableTask = tasks.find((task) => (
    task.assigned_to === assignedTo &&
    task.status !== 'completed'
  ))

  for (const task of tasks) {
    if (task.assigned_to === assignedTo || task.status === 'completed' || task.status === 'cancelled') continue

    const { error } = await db
      .from('tasks')
      .update({ status: 'cancelled', updated_at: now })
      .eq('id', task.id)

    if (error) throw new Error(error.message || 'Не удалось обновить старую задачу по транспорту')
  }

  if (reusableTask) {
    const { error } = await db
      .from('tasks')
      .update({
        ...taskPayload,
        status: reusableTask.status === 'cancelled' ? 'pending' : reusableTask.status,
      })
      .eq('id', reusableTask.id)

    if (error) throw new Error(error.message || 'Не удалось обновить задачу по транспорту')
    return
  }

  if (completedForAssignee) return

  const { error: insertError } = await db
    .from('tasks')
    .insert(taskPayload)

  if (insertError && !String(insertError.message || '').includes('duplicate key')) {
    throw new Error(insertError.message || 'Не удалось создать задачу по транспорту')
  }
}

export async function syncTransportCostTask(client: unknown, machineId: string) {
  try {
    await syncTransportCostTaskInternal(client, machineId)
  } catch (error) {
    if (isMissingTransportTaskTypeError(error)) return
    throw error
  }
}
