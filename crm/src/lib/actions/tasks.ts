'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getCurrentUserContext } from '@/lib/auth/current-user'
import { ROUTES } from '@/lib/constants/routes'
import { TASKS_LIST_LIMIT } from '@/lib/constants/performance-limits'
import { dispatchPendingTelegramDeliveries } from '@/lib/services/task-notifications'
import type { Task, TaskStatus, TaskType, UserRole } from '@/lib/types'

type DbResult = {
  data: unknown
  error: { message?: string } | null
}

type LooseQuery = PromiseLike<DbResult> & {
  select: (columns: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  single: () => Promise<DbResult>
  insert: (values: unknown) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
}

type LooseSupabaseClient = {
  from: (table: string) => LooseQuery
  rpc: (fn: string, args: Record<string, unknown>) => Promise<DbResult>
  auth: Awaited<ReturnType<typeof createServerSupabaseClient>>['auth']
}

export type TaskFilters = {
  machine_id?: string
  assigned_to?: string
  status?: TaskStatus
  statuses?: TaskStatus[]
  task_type?: TaskType
  limit?: number
}

export type TaskWithRelations = Task & {
  machine: { id: string; name: string; factory_id: string | null; is_archived?: boolean | null } | null
  assigned_user: { id: string; full_name: string } | null
}

const DIRECTOR_ROLES: UserRole[] = [
  'financial_director',
  'commercial_director',
  'planning_director',
]

async function getCurrentUser() {
  const { supabase, userId, role, factoryId } = await getCurrentUserContext()
  return { supabase, userId, role, factoryId }
}

function filterVisibleMachineTasks(tasks: TaskWithRelations[], role: UserRole, factoryId: string | null) {
  if (role !== 'production_manager') return tasks

  return tasks.filter((task) => {
    if (!task.machine_id) return true
    if (!task.machine) return false
    return task.machine.factory_id === null || task.machine.factory_id === factoryId
  })
}

async function notifyTechnologistsAboutDrawingConfirmation(db: LooseSupabaseClient, machineId: string | null, machineName?: string | null) {
  if (!machineId) return

  const message = machineName
    ? `Инженер подтвердил чертежи по машине "${machineName}". Можно готовить заявку технолога.`
    : 'Инженер подтвердил чертежи по машине. Можно готовить заявку технолога.'

  const { error } = await db.rpc('notify_users_by_role', {
    p_role: 'technologist',
    p_type: 'task_completed',
    p_title: 'Чертежи подтверждены',
    p_message: message,
    p_machine_id: machineId,
  })

  if (error) throw new Error(error.message || 'Не удалось создать уведомление технологу')

  await dispatchPendingTelegramDeliveries({ machineId })
  revalidatePath(ROUTES.NOTIFICATIONS)
}

async function hasSubmittedTechnologistRequest(db: LooseSupabaseClient, machineId: string | null) {
  if (!machineId) return false

  const { data, error } = await db
    .from('technologist_requests')
    .select('id')
    .eq('machine_id', machineId)
    .in('status', ['submitted_to_supply', 'completed'])

  if (error) throw new Error(error.message || 'Не удалось проверить заявку технолога')
  return ((data || []) as { id: string }[]).length > 0
}

async function createPlanningDirectorReasonTasks(
  db: LooseSupabaseClient,
  machineId: string,
  machineName: string | null | undefined,
  reason: string,
) {
  const { data, error } = await db
    .from('users')
    .select('id')
    .eq('role', 'planning_director')
    .eq('is_active', true)

  if (error) throw new Error(error.message || 'Не удалось загрузить директоров планирования')

  const deadline = new Date().toISOString().slice(0, 10)
  const machineLabel = machineName || 'машине'

  for (const director of (data || []) as { id: string }[]) {
    const { error: insertError } = await db.from('tasks').insert({
      machine_id: machineId,
      assigned_to: director.id,
      task_type: 'technologist_request_exception',
      title: `Ознакомиться с причиной отсутствия заявки: ${machineLabel}`,
      description: `Технолог завершил задачу без передачи заявки в снабжение.\n\nПричина: ${reason}`,
      status: 'pending',
      deadline,
    })

    if (insertError && !String(insertError.message || '').includes('duplicate key')) {
      throw new Error(insertError.message || 'Не удалось создать задачу директору планирования')
    }
  }
}

export async function getTasks(filters: TaskFilters = {}) {
  const { supabase, role, factoryId } = await getCurrentUser()
  const db = supabase as unknown as LooseSupabaseClient

  let query = db
    .from('tasks')
    .select(`
      *,
      machine:machines(id, name, factory_id, is_archived),
      assigned_user:users!tasks_assigned_to_fkey(id, full_name)
    `)
    .order('deadline', { ascending: true })
    .order('created_at', { ascending: true })

  if (filters.machine_id) query = query.eq('machine_id', filters.machine_id)
  if (filters.assigned_to) query = query.eq('assigned_to', filters.assigned_to)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.statuses?.length) query = query.in('status', filters.statuses)
  if (filters.task_type) query = query.eq('task_type', filters.task_type)
  if (filters.limit) query = query.limit(filters.limit)

  const { data, error } = await query
  if (error) return { data: null, error: error.message }

  return { data: filterVisibleMachineTasks((data || []) as unknown as TaskWithRelations[], role, factoryId), error: null }
}

export async function getMyTasks() {
  const { supabase, userId, role, factoryId } = await getCurrentUser()
  const db = supabase as unknown as LooseSupabaseClient

  const { data, error } = await db
    .from('tasks')
    .select(`
      *,
      machine:machines(id, name, factory_id, is_archived),
      assigned_user:users!tasks_assigned_to_fkey(id, full_name)
    `)
    .eq('assigned_to', userId)
    .in('status', ['pending', 'in_progress'])
    .order('deadline', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(TASKS_LIST_LIMIT)

  if (error) return { data: null, error: error.message }

  return { data: filterVisibleMachineTasks((data || []) as unknown as TaskWithRelations[], role, factoryId), error: null }
}

export async function getTasksByMachine(machineId: string) {
  return getTasks({ machine_id: machineId })
}

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const allowedStatuses: TaskStatus[] = ['pending', 'in_progress', 'completed', 'cancelled']
  if (!allowedStatuses.includes(status)) {
    return { success: false, error: 'Некорректный статус задачи' }
  }

  try {
    const { supabase, userId, role, factoryId } = await getCurrentUser()
    const db = supabase as unknown as LooseSupabaseClient

    const { data: task, error: fetchError } = await db
      .from('tasks')
      .select('id, assigned_to, machine_id, task_type, status, machine:machines(id, name, factory_id)')
      .eq('id', taskId)
      .single()

    if (fetchError || !task) throw new Error('Задача не найдена')
    const taskRow = task as unknown as {
      assigned_to: string
      machine_id: string | null
      task_type: TaskType
      status: TaskStatus
      machine: { id: string; name: string | null; factory_id: string | null } | null
    }

    const canUpdate = taskRow.assigned_to === userId || DIRECTOR_ROLES.includes(role)
    if (!canUpdate) throw new Error('Недостаточно прав для изменения задачи')
    if (
      role === 'production_manager' &&
      taskRow.machine_id &&
      (!taskRow.machine || (taskRow.machine.factory_id !== null && taskRow.machine.factory_id !== factoryId))
    ) {
      throw new Error('Задача относится к машине другого завода')
    }

    if (status === 'completed' && taskRow.task_type === 'technologist_request') {
      const hasSubmittedRequest = await hasSubmittedTechnologistRequest(db, taskRow.machine_id)
      if (!hasSubmittedRequest) {
        throw new Error('Нельзя завершить задачу технолога без переданной заявки. Передайте заявку в снабжение или завершите задачу с указанием причины.')
      }
    }

    const completedAt = status === 'completed' ? new Date().toISOString() : null
    const { error } = await db
      .from('tasks')
      .update({
        status,
        completed_at: completedAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)

    if (error) throw error

    if (status === 'completed' && taskRow.status !== 'completed' && taskRow.task_type === 'engineer_confirm') {
      await notifyTechnologistsAboutDrawingConfirmation(db, taskRow.machine_id, taskRow.machine?.name || null)
    }

    revalidatePath(ROUTES.TASKS)
    if (taskRow.machine_id) revalidatePath(`${ROUTES.SALES_PLAN}/${taskRow.machine_id}`)

    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось обновить задачу',
    }
  }
}

export async function completeTechnologistTaskWithoutRequest(taskId: string, reason: string) {
  const trimmedReason = reason.trim()
  if (trimmedReason.length < 3) {
    return { success: false, error: 'Укажите причину завершения задачи без заявки' }
  }

  try {
    const { supabase, userId, role, factoryId } = await getCurrentUser()
    const db = supabase as unknown as LooseSupabaseClient

    const { data: task, error: fetchError } = await db
      .from('tasks')
      .select('id, assigned_to, machine_id, task_type, status, description, machine:machines(id, name, factory_id)')
      .eq('id', taskId)
      .single()

    if (fetchError || !task) throw new Error('Задача не найдена')
    const taskRow = task as unknown as {
      assigned_to: string
      machine_id: string | null
      task_type: TaskType
      status: TaskStatus
      description: string | null
      machine: { id: string; name: string | null; factory_id: string | null } | null
    }

    if (taskRow.task_type !== 'technologist_request') throw new Error('Так можно завершить только задачу технолога по заявке')
    if (!taskRow.machine_id) throw new Error('Задача не привязана к машине')
    if (taskRow.status === 'completed') throw new Error('Задача уже завершена')

    const canUpdate = taskRow.assigned_to === userId || DIRECTOR_ROLES.includes(role)
    if (!canUpdate) throw new Error('Недостаточно прав для изменения задачи')
    if (
      role === 'production_manager' &&
      (!taskRow.machine || (taskRow.machine.factory_id !== null && taskRow.machine.factory_id !== factoryId))
    ) {
      throw new Error('Задача относится к машине другого завода')
    }

    const hasSubmittedRequest = await hasSubmittedTechnologistRequest(db, taskRow.machine_id)
    if (hasSubmittedRequest) {
      throw new Error('По машине уже есть переданная заявка. Завершите задачу обычным способом.')
    }

    const reasonBlock = `Завершено без передачи заявки.\nПричина: ${trimmedReason}`
    const description = taskRow.description ? `${taskRow.description}\n\n${reasonBlock}` : reasonBlock
    const now = new Date().toISOString()

    const { error: updateError } = await db
      .from('tasks')
      .update({
        status: 'completed',
        completed_at: now,
        updated_at: now,
        description,
      })
      .eq('id', taskId)

    if (updateError) throw updateError

    await createPlanningDirectorReasonTasks(db, taskRow.machine_id, taskRow.machine?.name || null, trimmedReason)
    await dispatchPendingTelegramDeliveries({ machineId: taskRow.machine_id })

    revalidatePath(ROUTES.TASKS)
    revalidatePath(ROUTES.NOTIFICATIONS)
    revalidatePath(`${ROUTES.SALES_PLAN}/${taskRow.machine_id}`)

    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось завершить задачу без заявки',
    }
  }
}
