'use server'

import { requirePermission } from '@/lib/permissions/server'
import type {
  SupplyMaterialRequestQueueItem,
  SupplyMaterialRequestQueuePayload,
  SupplyMaterialRequestState,
} from '@/lib/types/supply-material-request-queue'

type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
}
type LooseDb = { from: (table: string) => LooseQuery }

type RequestItemTable =
  | 'request_sheet_metal'
  | 'request_round_tube'
  | 'request_circle'
  | 'request_pipe'
  | 'request_knives'
  | 'request_components'
  | 'request_paint'
  | 'request_mesh'
  | 'request_chain_cord'

type QueueRequest = {
  id: string
  machine_id: string
  status: 'submitted_to_supply' | 'completed'
  submitted_at: string | null
  created_at: string
}

type QueueMachine = {
  id: string
  name: string
  factory_id: string | null
  planned_material_date: string | null
  is_archived: boolean
}

type QueuePosition = Record<string, unknown> & {
  id: string
  request_id: string
  order_status?: 'pending' | 'ordered' | 'delivered'
}

const REQUEST_TABLES: RequestItemTable[] = [
  'request_sheet_metal',
  'request_round_tube',
  'request_circle',
  'request_pipe',
  'request_knives',
  'request_components',
  'request_paint',
  'request_mesh',
  'request_chain_cord',
]

function asNumber(value: unknown) {
  return Number(value || 0)
}

function neededQuantity(table: RequestItemTable, row: QueuePosition) {
  if (table === 'request_sheet_metal') return asNumber(row.remainder_qty || row.to_order_kg)
  if (table === 'request_round_tube') return asNumber(row.order_kg)
  if (table === 'request_circle') return asNumber(row.remainder_mm)
  if (table === 'request_pipe') {
    return row.pipe_type === 'wire' ? asNumber(row.remainder_kg) : asNumber(row.remainder_length_mm)
  }
  if (table === 'request_knives') {
    return asNumber(row.remainder_meters) > 0
      ? asNumber(row.remainder_meters) * 1000
      : asNumber(row.to_order_mm)
  }
  if (table === 'request_components') {
    return Math.max(asNumber(row.quantity_needed) - asNumber(row.stock_remainder), 0)
  }
  if (table === 'request_mesh') return asNumber(row.remainder_qty)
  if (table === 'request_chain_cord') return asNumber(row.remainder_meters) * 1000
  return asNumber(row.remainder_kg || row.to_order_kg)
}

function reservedQuantity(table: RequestItemTable, row: QueuePosition) {
  if (table === 'request_pipe' && row.pipe_type === 'wire') return asNumber(row.reserved_from_stock_kg)
  if (table === 'request_sheet_metal' || table === 'request_round_tube' || table === 'request_paint') {
    return asNumber(row.reserved_from_stock_kg)
  }
  if (table === 'request_circle') return asNumber(row.reserved_from_stock_mm)
  if (table === 'request_pipe') return asNumber(row.reserved_from_stock_length_mm)
  if (table === 'request_knives') return asNumber(row.reserved_from_stock_mm)
  if (table === 'request_components') return asNumber(row.reserved_from_stock)
  if (table === 'request_mesh') return asNumber(row.reserved_from_stock_qty)
  return asNumber(row.reserved_from_stock_meters) * 1000
}

function requestTimestamp(request: QueueRequest) {
  return request.submitted_at || request.created_at
}

function stateForPositions(positions: Array<{ table: RequestItemTable; row: QueuePosition }>): SupplyMaterialRequestState {
  if (positions.length > 0 && positions.every(({ row }) => row.order_status === 'delivered')) return 'received'
  const requiresCoverage = positions.length === 0 || positions.some(({ table, row }) => (
    row.order_status !== 'delivered'
      && Math.max(neededQuantity(table, row) - reservedQuantity(table, row), 0) > 0
  ))
  return requiresCoverage ? 'needs_action' : 'covered'
}

function statePriority(state: SupplyMaterialRequestState) {
  if (state === 'needs_action') return 0
  if (state === 'covered') return 1
  return 2
}

export async function getSupplyMaterialRequestQueue(): Promise<{
  data: SupplyMaterialRequestQueuePayload | null
  error: string | null
}> {
  try {
    const { supabase } = await requirePermission('supply_material_requests', 'view')
    const db = supabase as unknown as LooseDb
    const { data: requestData, error: requestError } = await db
      .from('technologist_requests')
      .select('id, machine_id, status, submitted_at, created_at')
      .in('status', ['submitted_to_supply', 'completed'])
      .order('submitted_at', { ascending: false })
      .order('created_at', { ascending: false })

    if (requestError) throw new Error(requestError.message || 'Не удалось загрузить переданные заявки')

    const latestRequestByMachine = new Map<string, QueueRequest>()
    for (const request of (requestData || []) as QueueRequest[]) {
      const current = latestRequestByMachine.get(request.machine_id)
      if (!current || requestTimestamp(request) > requestTimestamp(current)) {
        latestRequestByMachine.set(request.machine_id, request)
      }
    }

    const requests = Array.from(latestRequestByMachine.values())
    if (requests.length === 0) return { data: { items: [], factories: [] }, error: null }

    const machineIds = requests.map((request) => request.machine_id)
    const requestIds = requests.map((request) => request.id)
    const [machinesResult, ...positionResults] = await Promise.all([
      db
        .from('machines')
        .select('id, name, factory_id, planned_material_date, is_archived')
        .in('id', machineIds)
        .eq('is_archived', false),
      ...REQUEST_TABLES.map((table) => db.from(table).select('*').in('request_id', requestIds)),
    ])

    if (machinesResult.error) throw new Error(machinesResult.error.message || 'Не удалось загрузить машины')
    for (const result of positionResults) {
      if (result.error) throw new Error(result.error.message || 'Не удалось загрузить позиции заявок')
    }

    const machines = (machinesResult.data || []) as QueueMachine[]
    const factoryIds = Array.from(new Set(machines.map((machine) => machine.factory_id).filter(Boolean))) as string[]
    const factoriesResult = factoryIds.length
      ? await db.from('factories').select('id, name').in('id', factoryIds).order('name', { ascending: true })
      : { data: [], error: null }
    if (factoriesResult.error) throw new Error(factoriesResult.error.message || 'Не удалось загрузить заводы')

    const factories = (factoriesResult.data || []) as Array<{ id: string; name: string }>
    const factoryMap = new Map(factories.map((factory) => [factory.id, factory.name]))
    const requestMap = new Map(requests.map((request) => [request.machine_id, request]))
    const positionsByRequest = new Map<string, Array<{ table: RequestItemTable; row: QueuePosition }>>()

    REQUEST_TABLES.forEach((table, index) => {
      for (const row of (positionResults[index].data || []) as QueuePosition[]) {
        const current = positionsByRequest.get(row.request_id) || []
        current.push({ table, row })
        positionsByRequest.set(row.request_id, current)
      }
    })

    const items: SupplyMaterialRequestQueueItem[] = machines
      .filter((machine) => !machine.is_archived)
      .flatMap((machine) => {
        const request = requestMap.get(machine.id)
        if (!request) return []
        const positions = positionsByRequest.get(request.id) || []
        const state = stateForPositions(positions)
        const reservedPositions = positions.filter(({ table, row }) => reservedQuantity(table, row) > 0).length
        const remainingPositions = positions.filter(({ table, row }) => (
          row.order_status !== 'delivered'
            && Math.max(neededQuantity(table, row) - reservedQuantity(table, row), 0) > 0
        )).length

        return [{
          requestId: request.id,
          machineId: machine.id,
          machineName: machine.name,
          factoryId: machine.factory_id,
          factoryName: machine.factory_id ? factoryMap.get(machine.factory_id) || 'Завод не найден' : 'Не назначен',
          submittedAt: requestTimestamp(request),
          materialDeadline: machine.planned_material_date,
          positions: positions.length,
          reservedPositions,
          remainingPositions,
          state,
        }]
      })
      .sort((left, right) => {
        const byState = statePriority(left.state) - statePriority(right.state)
        if (byState !== 0) return byState
        const leftDeadline = left.materialDeadline || '9999-12-31'
        const rightDeadline = right.materialDeadline || '9999-12-31'
        const byDeadline = leftDeadline.localeCompare(rightDeadline)
        if (byDeadline !== 0) return byDeadline
        return left.machineName.localeCompare(right.machineName, 'ru')
      })

    return { data: { items, factories }, error: null }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Не удалось загрузить очередь бронирования склада',
    }
  }
}
