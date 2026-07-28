'use server'

import { DIRECTOR_ACCESS_ROLES } from '@/lib/permissions/resources'
import { requirePermission } from '@/lib/permissions/server'
import type { MachineWithTotals, Task, TechnologistRequest, UserRole } from '@/lib/types'
import { sortMaterialRequestQueueItems } from '@/lib/material-request-queue'
import type {
  MaterialRequestQueueItem,
  MaterialRequestQueuePayload,
  MaterialRequestQueueState,
} from '@/lib/types/material-request-queue'

type QueueTask = Pick<
  Task,
  'machine_id' | 'assigned_to' | 'status' | 'deadline' | 'completed_at' | 'created_at'
>

type QueueMachine = Pick<
  MachineWithTotals,
  'id' | 'name' | 'total_weight' | 'production_month' | 'is_archived'
>

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

export async function getMaterialRequestQueue(): Promise<QueueResult> {
  try {
    const { supabase, role } = await requirePermission('material_request_queue', 'view')
    const canViewAll = isDirector(role)

    const { data: machineData, error: machineError } = await supabase
      .from('machines_with_totals')
      .select('id, name, total_weight, production_month, is_archived')
      .eq('is_archived', false)

    if (machineError) {
      throw new Error(machineError.message || 'Не удалось загрузить машины')
    }

    const machines = ((machineData || []) as QueueMachine[])
      .filter((machine) => !machine.is_archived)
    const machineIds = machines.map((machine) => machine.id)

    if (machineIds.length === 0) {
      return { data: { items: [], canViewAll }, error: null }
    }

    const [tasksResult, requestsResult] = await Promise.all([
      supabase
        .from('tasks')
        .select('machine_id, assigned_to, status, deadline, completed_at, created_at')
        .eq('task_type', 'technologist_request')
        .neq('status', 'cancelled')
        .not('machine_id', 'is', null)
        .in('machine_id', machineIds)
        .order('deadline', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('technologist_requests')
        .select('machine_id, status, submitted_at, created_at')
        .in('machine_id', machineIds),
    ])

    if (tasksResult.error) {
      throw new Error(tasksResult.error.message || 'Не удалось загрузить задачи технолога')
    }
    if (requestsResult.error) {
      throw new Error(requestsResult.error.message || 'Не удалось загрузить заявки')
    }

    const tasks = ((tasksResult.data || []) as QueueTask[])
      .filter((task): task is QueueTask & { machine_id: string } => Boolean(task.machine_id))
      .sort((left, right) => {
        const priorityDiff = taskPriority(left) - taskPriority(right)
        if (priorityDiff !== 0) return priorityDiff
        return left.created_at.localeCompare(right.created_at)
      })

    const taskByMachine = new Map<string, QueueTask & { machine_id: string }>()
    for (const task of tasks) {
      if (!taskByMachine.has(task.machine_id)) taskByMachine.set(task.machine_id, task)
    }

    const requestsByMachine = new Map<string, QueueRequest[]>()
    for (const request of (requestsResult.data || []) as QueueRequest[]) {
      const current = requestsByMachine.get(request.machine_id) || []
      current.push(request)
      requestsByMachine.set(request.machine_id, current)
    }

    const items: MaterialRequestQueueItem[] = machines
      .map((machine) => {
        const task = taskByMachine.get(machine.id)
        const requests = requestsByMachine.get(machine.id) || []
        const submittedRequestCount = requests.filter(requestIsSubmitted).length
        return {
          machineId: machine.id,
          machineName: machine.name,
          totalWeight: Number(machine.total_weight || 0),
          productionMonth: machine.production_month,
          deadline: task?.deadline || null,
          taskStatus: task?.status || null,
          completedAt: task?.completed_at || null,
          state: requestState(requests.length, submittedRequestCount),
          submittedRequestCount,
          totalRequestCount: requests.length,
        }
      })

    return {
      data: { items: sortMaterialRequestQueueItems(items, 'deadline_asc'), canViewAll },
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Не удалось загрузить очередь заявок',
    }
  }
}
