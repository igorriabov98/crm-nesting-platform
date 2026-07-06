import type { Database } from '@/lib/types/database'

type TaskStatus = Database['public']['Enums']['task_status']
type UserRole = Database['public']['Enums']['user_role']
type MaterialType = Database['public']['Enums']['material_type']

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

type MachineForMaterialTypeTask = {
  id: string
  name: string | null
  created_by: string | null
  is_confirmed: boolean | null
  material_type: MaterialType | null
  is_archived: boolean | null
}

type MaterialTypeTaskRow = {
  id: string
  assigned_to: string
  status: TaskStatus
}

const MATERIAL_TYPE_TASK_TYPE = 'material_type_selection' as const

function dbFrom(client: unknown): LooseDb {
  return client as LooseDb
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || '')
}

function isMissingMaterialTypeTaskTypeError(error: unknown) {
  const message = getErrorMessage(error)
  return message.includes('invalid input value for enum task_type') && message.includes(MATERIAL_TYPE_TASK_TYPE)
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10)
}

async function getMachineGoodsCount(db: LooseDb, machineId: string) {
  const { data, error } = await db
    .from('machine_items')
    .select('id, is_sample')
    .eq('machine_id', machineId)

  if (error) throw new Error(error.message || 'Не удалось проверить товары машины')
  return ((data || []) as Array<{ id: string; is_sample: boolean | null }>).filter((item) => !item.is_sample).length
}

async function completeOpenMaterialTypeTasks(db: LooseDb, machineId: string) {
  const now = new Date().toISOString()
  const { error } = await db
    .from('tasks')
    .update({ status: 'completed', completed_at: now, updated_at: now })
    .eq('machine_id', machineId)
    .eq('task_type', MATERIAL_TYPE_TASK_TYPE)
    .in('status', ['pending', 'in_progress'])

  if (error) throw new Error(error.message || 'Не удалось закрыть задачу определения типа материала')
}

async function cancelOpenMaterialTypeTasks(db: LooseDb, machineId: string) {
  const { error } = await db
    .from('tasks')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('machine_id', machineId)
    .eq('task_type', MATERIAL_TYPE_TASK_TYPE)
    .in('status', ['pending', 'in_progress'])

  if (error) throw new Error(error.message || 'Не удалось отменить задачу определения типа материала')
}

async function resolveMaterialTypeAssignee(db: LooseDb, creatorId: string | null) {
  const { data: settingsData } = await db
    .from('company_settings')
    .select('auto_task_technologist_user_id')
    .eq('id', '00000000-0000-0000-0000-000000000001')
    .single()

  const configuredUserId = (settingsData as { auto_task_technologist_user_id?: string | null } | null)?.auto_task_technologist_user_id || null
  if (configuredUserId) {
    const { data: configuredData } = await db
      .from('users')
      .select('id, is_active')
      .eq('id', configuredUserId)
      .single()

    const configured = configuredData as { id: string; is_active: boolean | null } | null
    if (configured && configured.is_active !== false) return configured.id
  }

  const { data, error } = await db
    .from('users')
    .select('id')
    .eq('role', 'technologist' satisfies UserRole)
    .eq('is_active', true)

  if (error) throw new Error(error.message || 'Не удалось найти технолога')

  const technologist = ((data || []) as { id: string }[])[0]
  if (technologist) return technologist.id

  if (creatorId) {
    const { data: creatorData } = await db
      .from('users')
      .select('id, is_active')
      .eq('id', creatorId)
      .single()

    const creator = creatorData as { id: string; is_active: boolean | null } | null
    if (creator && creator.is_active !== false) return creator.id
  }

  throw new Error('Не найден исполнитель для задачи определения типа материала')
}

async function syncMaterialTypeTaskInternal(client: unknown, machineId: string) {
  const db = dbFrom(client)

  const { data: machineData, error: machineError } = await db
    .from('machines')
    .select('id, name, created_by, is_confirmed, material_type, is_archived')
    .eq('id', machineId)
    .single()

  if (machineError || !machineData) throw new Error(machineError?.message || 'Машина не найдена')

  const machine = machineData as MachineForMaterialTypeTask
  if (machine.is_archived || !machine.is_confirmed) {
    await cancelOpenMaterialTypeTasks(db, machineId)
    return
  }

  if (machine.material_type && machine.material_type !== 'undefined') {
    await completeOpenMaterialTypeTasks(db, machineId)
    return
  }

  const goodsCount = await getMachineGoodsCount(db, machineId)
  if (goodsCount === 0) {
    await cancelOpenMaterialTypeTasks(db, machineId)
    return
  }

  const assignedTo = await resolveMaterialTypeAssignee(db, machine.created_by)
  const now = new Date().toISOString()
  const today = todayDateOnly()
  const machineName = machine.name || 'машина'
  const taskPayload = {
    machine_id: machineId,
    assigned_to: assignedTo,
    task_type: MATERIAL_TYPE_TASK_TYPE,
    title: `Определить тип материала: ${machineName}`,
    description: 'Во вкладке "Технолог" выберите тип материала: стандартный или нестандартный.',
    status: 'pending' satisfies TaskStatus,
    start_date: today,
    deadline: today,
    updated_at: now,
  }

  const { data: tasksData, error: tasksError } = await db
    .from('tasks')
    .select('id, assigned_to, status')
    .eq('machine_id', machineId)
    .eq('task_type', MATERIAL_TYPE_TASK_TYPE)

  if (tasksError) throw new Error(tasksError.message || 'Не удалось проверить задачу определения типа материала')

  const tasks = (tasksData || []) as MaterialTypeTaskRow[]
  const reusableTask = tasks.find((task) => task.assigned_to === assignedTo)

  for (const task of tasks) {
    if (task.assigned_to === assignedTo || task.status === 'completed' || task.status === 'cancelled') continue

    const { error } = await db
      .from('tasks')
      .update({ status: 'cancelled', updated_at: now })
      .eq('id', task.id)

    if (error) throw new Error(error.message || 'Не удалось обновить старую задачу определения типа материала')
  }

  if (reusableTask) {
    const { error } = await db
      .from('tasks')
      .update({
        ...taskPayload,
        status: reusableTask.status === 'in_progress' ? 'in_progress' : 'pending',
      })
      .eq('id', reusableTask.id)

    if (error) throw new Error(error.message || 'Не удалось обновить задачу определения типа материала')
    return
  }

  const { error: insertError } = await db
    .from('tasks')
    .insert(taskPayload)

  if (insertError && !String(insertError.message || '').includes('duplicate key')) {
    throw new Error(insertError.message || 'Не удалось создать задачу определения типа материала')
  }
}

export async function syncMaterialTypeTask(client: unknown, machineId: string) {
  try {
    await syncMaterialTypeTaskInternal(client, machineId)
  } catch (error) {
    if (isMissingMaterialTypeTaskTypeError(error)) return
    throw error
  }
}
