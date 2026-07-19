'use server'

import { DIRECTOR_ACCESS_ROLES } from '@/lib/permissions/resources'
import { requirePermission } from '@/lib/permissions/server'
import type { MachineWithTotals, Task, TechnologistRequest, UserRole } from '@/lib/types'
import type {
  MaterialRequestQueueItem,
  MaterialRequestQueuePayload,
  MaterialRequestQueueState,
} from '@/lib/types/material-request-queue'

type QueueTask = Pick<
  Task,
  'machine_id' | 'assigned_to' | 'status' | 'deadline' | 'completed_at' | 'created_at'
>

type QueueMachine = Pick<MachineWithTotals, 'id' | 'name' | 'total_weight' | 'is_archived'>

type QueueRequest = Pick<
  TechnologistRequest,
  'machine_id' | 'status' | 'submitted_at' | 'created_at'
>

type QueueResult = {
  data: MaterialRequestQueuePayload | null
  error: string | null
}

function isDirector(role: UserRole) {
  return (DIRECTOR_ACCESS_ROLES as readonly UserRole[]).includes(role)
}

function taskPriority(task: QueueTask) {
  return task.status === 'pending' || task.status === 'in_progress' ? 0 : 1
}

function requestIsSubmitted(request: QueueRequest) {
  return Boolean(
    request.submitted_at
      || request.status === 'submitted_to_supply'
      || request.status === 'completed'
  )
}

function requestState(total: number, submitted: number): MaterialRequestQueueState {
  if (total === 0) return 'none'
  if (submitted < total) return 'in_progress'
  return 'submitted'
}

function statePriority(state: MaterialRequestQueueState) {
  return state === 'submitted' ? 1 : 0
}

function compareNullableDeadlines(left: string | null, right: string | null) {
  const today = new Date().toISOString().slice(0, 10)
  const leftGroup = left === null ? 1 : left <= today ? 0 : 2
  const rightGroup = right === null ? 1 : right <= today ? 0 : 2
  if (leftGroup !== rightGroup) return leftGroup - rightGroup
  if (left && right) return left.localeCompare(right)
  return 0
}

export async function getMaterialRequestQueue(): Promise<QueueResult> {
  try {
    const { supabase, userId, role } = await requirePermission('material_request_queue', 'view')
    const canViewAll = isDirector(role)

    let tasksQuery = supabase
      .from('tasks')
      .select('machine_id, assigned_to, status, deadline, completed_at, created_at')
      .eq('task_type', 'technologist_request')
      .neq('status', 'cancelled')
      .not('machine_id', 'is', null)
      .order('deadline', { ascending: true })
      .order('created_at', { ascending: true })

    if (!canViewAll) {
      tasksQuery = tasksQuery.eq('assigned_to', userId)
    }

    const { data: taskData, error: taskError } = await tasksQuery
    if (taskError) throw new Error(taskError.message || 'Не удалось загрузить задачи технолога')

    const tasks = ((taskData || []) as QueueTask[])
      .filter((task): task is QueueTask & { machine_id: string } => Boolean(task.machine_id))
      .sort((left, right) => {
        const priorityDiff = taskPriority(left) - taskPriority(right)
        if (priorityDiff !== 0) return priorityDiff
        const deadlineDiff = compareNullableDeadlines(left.deadline, right.deadline)
        if (deadlineDiff !== 0) return deadlineDiff
        return left.created_at.localeCompare(right.created_at)
      })

    const taskByMachine = new Map<string, QueueTask & { machine_id: string }>()
    for (const task of tasks) {
      if (!taskByMachine.has(task.machine_id)) taskByMachine.set(task.machine_id, task)
    }

    const machineIds = Array.from(taskByMachine.keys())
    if (machineIds.length === 0) {
      return { data: { items: [], canViewAll }, error: null }
    }

    const [machinesResult, requestsResult] = await Promise.all([
      supabase
        .from('machines_with_totals')
        .select('id, name, total_weight, is_archived')
        .in('id', machineIds)
        .eq('is_archived', false),
      supabase
        .from('technologist_requests')
        .select('machine_id, status, submitted_at, created_at')
        .in('machine_id', machineIds),
    ])

    if (machinesResult.error) {
      throw new Error(machinesResult.error.message || 'Не удалось загрузить машины')
    }
    if (requestsResult.error) {
      throw new Error(requestsResult.error.message || 'Не удалось загрузить заявки')
    }

    const requestsByMachine = new Map<string, QueueRequest[]>()
    for (const request of (requestsResult.data || []) as QueueRequest[]) {
      const current = requestsByMachine.get(request.machine_id) || []
      current.push(request)
      requestsByMachine.set(request.machine_id, current)
    }

    const items: MaterialRequestQueueItem[] = ((machinesResult.data || []) as QueueMachine[])
      .filter((machine) => !machine.is_archived)
      .flatMap((machine) => {
        const task = taskByMachine.get(machine.id)
        if (!task) return []

        const requests = requestsByMachine.get(machine.id) || []
        const submittedRequestCount = requests.filter(requestIsSubmitted).length
        return [{
          machineId: machine.id,
          machineName: machine.name,
          totalWeight: Number(machine.total_weight || 0),
          deadline: task.deadline,
          taskStatus: task.status,
          completedAt: task.completed_at,
          state: requestState(requests.length, submittedRequestCount),
          submittedRequestCount,
          totalRequestCount: requests.length,
        }]
      })
      .sort((left, right) => {
        const stateDiff = statePriority(left.state) - statePriority(right.state)
        if (stateDiff !== 0) return stateDiff
        const deadlineDiff = compareNullableDeadlines(left.deadline, right.deadline)
        if (deadlineDiff !== 0) return deadlineDiff
        return left.machineName.localeCompare(right.machineName, 'ru')
      })

    return { data: { items, canViewAll }, error: null }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Не удалось загрузить очередь заявок',
    }
  }
}
