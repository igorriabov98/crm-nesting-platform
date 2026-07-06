import {
  assertMachineReadyForTechnologistRequest,
  pickActiveTechnologistRequest,
  pickLatestProductionFact,
  resolveMachineProgress,
  type MachineProgressContext,
  type MachineProgressFactInput,
  type MachineProgressMachineInput,
  type MachineProgressOutsourcingInput,
  type MachineProgressRequestInput,
} from '@/lib/machine-progress'
import type { MachineProgress, OrderItemStatus, ProductionFactSection, StageType } from '@/lib/types'

type DbResult = { data: unknown; error: { message?: string; code?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  single: () => Promise<DbResult>
}
type LooseDb = { from: (table: string) => LooseQuery }

type RequestRow = MachineProgressRequestInput & {
  machine_id: string
}

type RequestOrderRow = Record<string, unknown> & {
  request_id: string
  order_status: OrderItemStatus | null
}

type FactRow = {
  id: string
  machine_id: string
  section_id: string
  fact_date: string
  shift: MachineProgressFactInput['shift']
  created_at?: string | null
  updated_at?: string | null
  section?: Pick<ProductionFactSection, 'id' | 'name' | 'production_stage_type'> | Pick<ProductionFactSection, 'id' | 'name' | 'production_stage_type'>[] | null
  production_fact_sections?: Pick<ProductionFactSection, 'id' | 'name' | 'production_stage_type'> | Pick<ProductionFactSection, 'id' | 'name' | 'production_stage_type'>[] | null
}

type OutsourcingProgressRow = {
  id: string
  machine_id: string
  work_type_id: string | null
  position_after_stage_type: StageType | null
  source_stage_type: StageType | null
  planned_send_date: string | null
  planned_return_date: string | null
  actual_sent_at: string | null
  actual_returned_at: string | null
}

type OutsourcingWorkTypeRow = {
  id: string
  name: string
}

const REQUEST_ITEM_TABLES = [
  'request_sheet_metal',
  'request_round_tube',
  'request_circle',
  'request_pipe',
  'request_knives',
  'request_components',
  'request_paint',
  'request_mesh',
  'request_chain_cord',
] as const

type RequestItemTable = typeof REQUEST_ITEM_TABLES[number]

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value || null
}

function positiveNumber(value: unknown) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function hasPurchaseQuantity(table: RequestItemTable, row: RequestOrderRow) {
  switch (table) {
    case 'request_sheet_metal':
      return positiveNumber(row.to_order_kg) > 0
    case 'request_round_tube':
      return positiveNumber(row.order_kg) > positiveNumber(row.reserved_from_stock_kg)
        || positiveNumber(row.order_meters) > positiveNumber(row.reserved_from_stock_m)
    case 'request_circle':
      return positiveNumber(row.remainder_mm) > positiveNumber(row.reserved_from_stock_mm)
    case 'request_pipe':
      return positiveNumber(row.remainder_length_mm) > positiveNumber(row.reserved_from_stock_length_mm)
        || positiveNumber(row.remainder_qty) > positiveNumber(row.reserved_from_stock_qty)
        || positiveNumber(row.remainder_kg) > positiveNumber(row.reserved_from_stock_kg)
    case 'request_knives':
      return positiveNumber(row.to_order_mm) > 0
        || positiveNumber(row.order_mm) > positiveNumber(row.reserved_from_stock_mm)
    case 'request_components':
      return positiveNumber(row.to_order) > 0
        || positiveNumber(row.quantity_needed) > positiveNumber(row.reserved_from_stock)
    case 'request_paint':
      return positiveNumber(row.to_order_kg) > 0
        || positiveNumber(row.weight_with_waste_kg) > positiveNumber(row.reserved_from_stock_kg)
    case 'request_mesh':
      return positiveNumber(row.remainder_qty) > positiveNumber(row.reserved_from_stock_qty)
    case 'request_chain_cord':
      return positiveNumber(row.remainder_meters) > positiveNumber(row.reserved_from_stock_meters)
    default:
      return true
  }
}

async function loadRequestOrderStatuses(db: LooseDb, requestIds: string[]) {
  const statuses = new Map<string, OrderItemStatus[]>()
  for (const requestId of requestIds) statuses.set(requestId, [])
  if (requestIds.length === 0) return statuses

  const results = await Promise.all(
    REQUEST_ITEM_TABLES.map((table) => db
      .from(table)
      .select('*')
      .in('request_id', requestIds))
  )

  for (const [index, result] of results.entries()) {
    if (result.error) throw new Error(result.error.message || 'Не удалось загрузить статусы закупки')
    const table = REQUEST_ITEM_TABLES[index]
    for (const row of (result.data || []) as RequestOrderRow[]) {
      if (!row.request_id || !row.order_status) continue
      if (!hasPurchaseQuantity(table, row)) continue
      const list = statuses.get(row.request_id) || []
      list.push(row.order_status)
      statuses.set(row.request_id, list)
    }
  }

  return statuses
}

async function loadRequestContexts(db: LooseDb, machineIds: string[]) {
  const requestsByMachine = new Map<string, MachineProgressRequestInput[]>()
  if (machineIds.length === 0) return new Map<string, MachineProgressRequestInput>()

  const { data, error } = await db
    .from('technologist_requests')
    .select('id, machine_id, status, submitted_at, created_at, updated_at')
    .in('machine_id', machineIds)
    .order('updated_at', { ascending: false })

  if (error) throw new Error(error.message || 'Не удалось загрузить заявки технолога')

  for (const row of (data || []) as RequestRow[]) {
    const list = requestsByMachine.get(row.machine_id) || []
    list.push({
      id: row.id,
      status: row.status,
      submitted_at: row.submitted_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })
    requestsByMachine.set(row.machine_id, list)
  }

  const activeByMachine = new Map<string, MachineProgressRequestInput>()
  const requestIds: string[] = []
  for (const [machineId, requests] of requestsByMachine.entries()) {
    const request = pickActiveTechnologistRequest(requests)
    if (!request) continue
    activeByMachine.set(machineId, request)
    requestIds.push(request.id)
  }

  const statusesByRequest = await loadRequestOrderStatuses(db, uniqueValues(requestIds))
  for (const request of activeByMachine.values()) {
    request.orderStatuses = statusesByRequest.get(request.id) || []
  }

  return activeByMachine
}

async function loadFactContexts(db: LooseDb, machineIds: string[]) {
  const factsByMachine = new Map<string, MachineProgressFactInput[]>()
  if (machineIds.length === 0) return new Map<string, MachineProgressFactInput>()

  const { data, error } = await db
    .from('production_machine_facts')
    .select('id, machine_id, section_id, fact_date, shift, created_at, updated_at, section:production_fact_sections(id, name, production_stage_type)')
    .in('machine_id', machineIds)
    .order('fact_date', { ascending: false })

  if (error) throw new Error(error.message || 'Не удалось загрузить факты производства')

  for (const row of (data || []) as FactRow[]) {
    const section = firstRelation(row.section) || firstRelation(row.production_fact_sections)
    const list = factsByMachine.get(row.machine_id) || []
    list.push({
      id: row.id,
      section_id: row.section_id,
      section_name: section?.name || null,
      production_stage_type: section?.production_stage_type || null,
      fact_date: row.fact_date,
      shift: row.shift,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })
    factsByMachine.set(row.machine_id, list)
  }

  const latestByMachine = new Map<string, MachineProgressFactInput>()
  for (const [machineId, facts] of factsByMachine.entries()) {
    const latestFact = pickLatestProductionFact(facts)
    if (latestFact) latestByMachine.set(machineId, latestFact)
  }

  return latestByMachine
}

async function loadOutsourcingContexts(db: LooseDb, machineIds: string[]) {
  const operationsByMachine = new Map<string, MachineProgressOutsourcingInput[]>()
  if (machineIds.length === 0) return operationsByMachine

  const { data, error } = await db
    .from('machine_outsourcing_operations')
    .select(`
      id,
      machine_id,
      work_type_id,
      position_after_stage_type,
      source_stage_type,
      planned_send_date,
      planned_return_date,
      actual_sent_at,
      actual_returned_at
    `)
    .in('machine_id', machineIds)
    .is('archived_at', null)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message || 'Не удалось загрузить операции аутсорсинга')

  const rows = (data || []) as OutsourcingProgressRow[]
  const workTypeIds = uniqueValues(rows.map((row) => row.work_type_id || ''))
  const workTypesResult = workTypeIds.length > 0
    ? await db.from('outsourcing_work_types').select('id, name').in('id', workTypeIds)
    : { data: [], error: null }

  if (workTypesResult.error) throw new Error(workTypesResult.error.message || 'Не удалось загрузить типы аутсорсинга')

  const workTypeById = new Map(((workTypesResult.data || []) as OutsourcingWorkTypeRow[]).map((row) => [row.id, row.name]))

  for (const row of rows) {
    const list = operationsByMachine.get(row.machine_id) || []
    list.push({
      id: row.id,
      work_type_name: row.work_type_id ? workTypeById.get(row.work_type_id) || null : null,
      position_after_stage_type: row.position_after_stage_type,
      source_stage_type: row.source_stage_type,
      planned_send_date: row.planned_send_date,
      planned_return_date: row.planned_return_date,
      actual_sent_at: row.actual_sent_at,
      actual_returned_at: row.actual_returned_at,
    })
    operationsByMachine.set(row.machine_id, list)
  }

  return operationsByMachine
}

export async function loadMachineProgressContexts(db: LooseDb, machineIds: string[]) {
  const ids = uniqueValues(machineIds)
  const contexts = new Map<string, MachineProgressContext>()
  for (const id of ids) contexts.set(id, {})
  if (ids.length === 0) return contexts

  const [requests, facts, outsourcingOperations] = await Promise.all([
    loadRequestContexts(db, ids),
    loadFactContexts(db, ids),
    loadOutsourcingContexts(db, ids),
  ])

  for (const id of ids) {
    contexts.set(id, {
      request: requests.get(id) || null,
      latestFact: facts.get(id) || null,
      outsourcingOperations: outsourcingOperations.get(id) || [],
    })
  }

  return contexts
}

export function resolveMachineProgressWithContext(
  machine: MachineProgressMachineInput,
  context?: MachineProgressContext,
): MachineProgress {
  return resolveMachineProgress(machine, context)
}

export async function assertMachineCanUseTechnologistRequest(db: LooseDb, machineId: string) {
  const { data, error } = await db
    .from('machines')
    .select(`
      id,
      is_confirmed,
      actual_shipping_date,
      machine_items(id, is_sample),
      production_stages(stage_type, date_start, date_end, is_skipped)
    `)
    .eq('id', machineId)
    .single()

  if (error || !data) throw new Error('Машина не найдена')
  assertMachineReadyForTechnologistRequest(data as MachineProgressMachineInput)
}
