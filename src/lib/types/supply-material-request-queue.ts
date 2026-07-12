export type SupplyMaterialRequestState = 'needs_action' | 'covered' | 'received'

export type SupplyMaterialRequestQueueItem = {
  requestId: string
  machineId: string
  machineName: string
  factoryId: string | null
  factoryName: string
  submittedAt: string
  materialDeadline: string | null
  positions: number
  reservedPositions: number
  remainingPositions: number
  state: SupplyMaterialRequestState
}

export type SupplyMaterialRequestQueuePayload = {
  items: SupplyMaterialRequestQueueItem[]
  factories: Array<{ id: string; name: string }>
}
