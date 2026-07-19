import type { TaskStatus } from '@/lib/types'

export type MaterialRequestQueueState = 'none' | 'in_progress' | 'submitted'

export type MaterialRequestQueueItem = {
  machineId: string
  machineName: string
  totalWeight: number
  deadline: string | null
  taskStatus: TaskStatus
  completedAt: string | null
  state: MaterialRequestQueueState
  submittedRequestCount: number
  totalRequestCount: number
}

export type MaterialRequestQueuePayload = {
  items: MaterialRequestQueueItem[]
  canViewAll: boolean
}
