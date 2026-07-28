import type { TaskStatus } from '@/lib/types'

export type MaterialRequestQueueState = 'none' | 'in_progress' | 'submitted'

export type MaterialRequestQueueSort = 'deadline_asc' | 'ready_first'

export type MaterialRequestQueueItem = {
  machineId: string
  machineName: string
  totalWeight: number
  productionMonth: string | null
  deadline: string | null
  taskStatus: TaskStatus | null
  completedAt: string | null
  state: MaterialRequestQueueState
  submittedRequestCount: number
  totalRequestCount: number
}

export type MaterialRequestQueuePayload = {
  items: MaterialRequestQueueItem[]
  canViewAll: boolean
}
