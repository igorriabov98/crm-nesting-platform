import 'server-only'

type DbResult = { data: unknown; error: { message?: string } | null }
type Query = PromiseLike<DbResult> & {
  select: (columns?: string) => Query
  in: (column: string, values: unknown[]) => Query
  eq: (column: string, value: unknown) => Query
  is: (column: string, value: unknown) => Query
}

export type VrbStatusDb = { from: (table: string) => Query }

type VrbOperationRow = {
  id: string
  machine_id: string
  supply_taken_at: string | null
  supply_terms_confirmed_at: string | null
  delivery_dispatched_at: string | null
  order_changed_at: string | null
  actual_returned_at: string | null
}

export type VrbMeshStatusKey =
  | 'awaiting_approval'
  | 'in_work'
  | 'delivery'
  | 'partially_received'
  | 'received'
  | 'order_changed'

export type VrbMeshStatus = {
  key: VrbMeshStatusKey
  label: string
  requestedQuantity: number
  receivedQuantity: number
  operationCount: number
}

const STATUS_LABELS: Record<VrbMeshStatusKey, string> = {
  awaiting_approval: 'VRB: ожидает согласования',
  in_work: 'VRB: в работе',
  delivery: 'VRB: доставка',
  partially_received: 'VRB: частично получено',
  received: 'VRB: получено',
  order_changed: 'VRB: заказ изменён',
}

function resolveStatus(
  operations: VrbOperationRow[],
  requestedQuantity: number,
  receivedQuantity: number,
): VrbMeshStatus {
  let key: VrbMeshStatusKey = 'awaiting_approval'
  if (operations.some((operation) => operation.order_changed_at)) key = 'order_changed'
  else if (operations.every((operation) => operation.actual_returned_at)) key = 'received'
  else if (receivedQuantity > 0) key = 'partially_received'
  else if (operations.some((operation) => operation.delivery_dispatched_at || operation.supply_terms_confirmed_at)) key = 'delivery'
  else if (operations.some((operation) => operation.supply_taken_at)) key = 'in_work'

  return {
    key,
    label: STATUS_LABELS[key],
    requestedQuantity,
    receivedQuantity,
    operationCount: operations.length,
  }
}

export async function loadVrbMeshStatuses(
  dbValue: unknown,
  machineIds: string[],
): Promise<Map<string, VrbMeshStatus>> {
  const db = dbValue as VrbStatusDb
  const uniqueMachineIds = Array.from(new Set(machineIds.filter(Boolean)))
  if (uniqueMachineIds.length === 0) return new Map()

  const { data: operationData, error: operationError } = await db
    .from('machine_outsourcing_operations')
    .select('id, machine_id, supply_taken_at, supply_terms_confirmed_at, delivery_dispatched_at, order_changed_at, actual_returned_at')
    .in('machine_id', uniqueMachineIds)
    .eq('operation_kind', 'vrb_mesh')
    .is('archived_at', null)
  if (operationError) throw new Error(operationError.message || 'Не удалось загрузить статусы VRB')

  const operations = (operationData || []) as VrbOperationRow[]
  if (operations.length === 0) return new Map()
  const operationIds = operations.map((operation) => operation.id)
  const { data: itemData, error: itemError } = await db
    .from('machine_outsourcing_vrb_items')
    .select('id, operation_id, requested_quantity')
    .in('operation_id', operationIds)
  if (itemError) throw new Error(itemError.message || 'Не удалось загрузить позиции VRB')

  const items = (itemData || []) as Array<{ id: string; operation_id: string; requested_quantity: number }>
  let receiptRows: Array<{ vrb_item_id: string; quantity: number }> = []
  if (items.length > 0) {
    const { data: receiptData, error: receiptError } = await db
      .from('machine_outsourcing_vrb_receipts')
      .select('vrb_item_id, quantity')
      .in('vrb_item_id', items.map((item) => item.id))
    if (receiptError) throw new Error(receiptError.message || 'Не удалось загрузить приёмки VRB')
    receiptRows = (receiptData || []) as Array<{ vrb_item_id: string; quantity: number }>
  }

  const operationById = new Map(operations.map((operation) => [operation.id, operation]))
  const itemById = new Map(items.map((item) => [item.id, item]))
  const requestedByMachine = new Map<string, number>()
  const receivedByMachine = new Map<string, number>()
  for (const item of items) {
    const machineId = operationById.get(item.operation_id)?.machine_id
    if (!machineId) continue
    requestedByMachine.set(machineId, (requestedByMachine.get(machineId) || 0) + Number(item.requested_quantity || 0))
  }
  for (const receipt of receiptRows) {
    const item = itemById.get(receipt.vrb_item_id)
    const machineId = item ? operationById.get(item.operation_id)?.machine_id : null
    if (!machineId) continue
    receivedByMachine.set(machineId, (receivedByMachine.get(machineId) || 0) + Number(receipt.quantity || 0))
  }

  const operationsByMachine = new Map<string, VrbOperationRow[]>()
  for (const operation of operations) {
    operationsByMachine.set(operation.machine_id, [
      ...(operationsByMachine.get(operation.machine_id) || []),
      operation,
    ])
  }

  return new Map(Array.from(operationsByMachine.entries()).map(([machineId, machineOperations]) => [
    machineId,
    resolveStatus(
      machineOperations,
      requestedByMachine.get(machineId) || 0,
      receivedByMachine.get(machineId) || 0,
    ),
  ]))
}
