'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getRequestForBusinessScrap, type SupplyRequestPayload, type SupplyStockItem } from '@/lib/actions/supply-request'
import { ROUTES } from '@/lib/constants/routes'
import { DIRECTOR_ACCESS_ROLES } from '@/lib/permissions/resources'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchPendingTelegramDeliveries } from '@/lib/services/task-notifications'
import type { RequestStatus, TaskStatus, UserRole } from '@/lib/types'

type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  neq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  maybeSingle: () => Promise<DbResult>
}
type LooseDb = {
  from: (table: string) => LooseQuery
  rpc: (fn: string, args: Record<string, unknown>) => Promise<DbResult>
}

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

export type BusinessScrapQueueState =
  | 'no_request'
  | 'draft'
  | 'initial_reservation'
  | 'submitted'
  | 'correction_pending'

export type BusinessScrapQueueItem = {
  machineId: string
  machineName: string
  factoryName: string | null
  productionMonth: string | null
  deadline: string
  taskStatus: TaskStatus
  requestId: string | null
  requestStatus: RequestStatus | null
  correctionStatus: 'pending' | 'approved' | 'rejected' | 'conflicted' | 'cancelled' | null
  state: BusinessScrapQueueState
}

export type BusinessScrapReservationDetail = {
  id: string
  inventoryId: string
  quantity: number
  secondaryQuantity: number | null
  pieceLengthMm: number | null
  consumedAt: string | null
}

export type BusinessScrapWorkspaceItem = {
  table: RequestItemTable
  id: string
  categoryLabel: string
  materialName: string
  needed: number
  unit: string
  currentReserved: number
  reservations: BusinessScrapReservationDetail[]
  stockItems: SupplyStockItem[]
  isCutReservation: boolean
}

export type BusinessScrapWorkspace = {
  machine: {
    id: string
    name: string
    factoryName: string | null
    productionMonth: string | null
  }
  request: {
    id: string
    status: RequestStatus
    createdAt: string
  }
  items: BusinessScrapWorkspaceItem[]
  pendingCorrection: {
    id: string
    reason: string
    createdAt: string
  } | null
}

export type BusinessScrapMachineEntry = {
  machine: {
    id: string
    name: string
    factoryName: string | null
    productionMonth: string | null
  }
  request: {
    id: string
    status: RequestStatus
  } | null
  workspace: BusinessScrapWorkspace | null
}

export type BusinessScrapCorrectionApproval = {
  request: {
    id: string
    status: string
    reason: string
    decisionComment: string | null
    createdAt: string
    machine: { id: string; name: string }
    requestedBy: { id: string; fullName: string } | null
  }
  items: Array<{
    id: string
    categoryLabel: string
    materialName: string
    oldQuantity: number
    proposedQuantity: number
    difference: number
  }>
}

type QueueTask = {
  machine_id: string
  assigned_to: string
  status: TaskStatus
  deadline: string
  created_at: string
}
type QueueMachine = {
  id: string
  name: string
  production_month: string | null
  is_archived: boolean | null
  factories?: { name: string } | { name: string }[] | null
}
type QueueRequest = {
  id: string
  machine_id: string
  status: RequestStatus
  created_at: string
}
type QueueCorrection = {
  technologist_request_id: string
  status: 'pending' | 'approved' | 'rejected' | 'conflicted' | 'cancelled'
  created_at: string
}
type ReservationRow = {
  id: string
  inventory_id: string
  source_inventory_id: string | null
  request_item_table: string
  request_item_id: string
  reserved_quantity: number
  reserved_secondary_quantity: number | null
  consumed_at: string | null
}

const tableLabels: Record<RequestItemTable, string> = {
  request_sheet_metal: 'Листовой металл',
  request_round_tube: 'Круглая труба',
  request_circle: 'Круг',
  request_pipe: 'Труба',
  request_knives: 'Ножи',
  request_components: 'Комплектация',
  request_paint: 'Краска',
  request_mesh: 'Сетка',
  request_chain_cord: 'Цепь / Шнур',
}
const tableUnits: Record<RequestItemTable, string> = {
  request_sheet_metal: 'шт',
  request_round_tube: 'кг',
  request_circle: 'мм',
  request_pipe: 'мм',
  request_knives: 'мм',
  request_components: 'шт',
  request_paint: 'кг',
  request_mesh: 'шт',
  request_chain_cord: 'мм',
}

const correctionSchema = z.object({
  requestId: z.string().uuid(),
  reason: z.string().trim().min(3, 'Укажите причину корректировки').max(1000),
  changes: z.array(z.object({
    request_item_table: z.enum([
      'request_sheet_metal', 'request_round_tube', 'request_circle', 'request_pipe',
      'request_knives', 'request_components', 'request_paint', 'request_mesh', 'request_chain_cord',
    ]),
    request_item_id: z.string().uuid(),
    remove_reservation_ids: z.array(z.string().uuid()).default([]),
    additions: z.array(z.object({
      inventory_id: z.string().uuid(),
      quantity: z.number().positive(),
    })).default([]),
  })).min(1),
})
const decisionSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().trim().max(1000).optional().nullable(),
})

function dbFrom(value: unknown): LooseDb {
  return value as LooseDb
}
function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}
function isDirector(role: UserRole) {
  return (DIRECTOR_ACCESS_ROLES as readonly UserRole[]).includes(role)
}
function itemKey(table: string, id: string) {
  return table + ':' + id
}
function queueState(request: QueueRequest | null, correction: QueueCorrection | null): BusinessScrapQueueState {
  if (!request) return 'no_request'
  if (correction?.status === 'pending') return 'correction_pending'
  if (request.status === 'draft') return 'draft'
  if (request.status === 'pending_stock_check' || request.status === 'stock_checked') return 'initial_reservation'
  return 'submitted'
}
function asNumber(value: unknown) {
  return Number(value || 0)
}
function neededForRow(table: RequestItemTable, row: Record<string, unknown>) {
  if (table === 'request_sheet_metal') return asNumber(row.remainder_qty || row.to_order_kg)
  if (table === 'request_round_tube') return asNumber(row.order_kg)
  if (table === 'request_circle') return asNumber(row.remainder_mm)
  if (table === 'request_pipe') return row.pipe_type === 'wire' ? asNumber(row.remainder_kg) : asNumber(row.remainder_length_mm)
  if (table === 'request_knives') return asNumber(row.remainder_meters) > 0 ? asNumber(row.remainder_meters) * 1000 : asNumber(row.to_order_mm)
  if (table === 'request_components') return Math.max(asNumber(row.quantity_needed) - asNumber(row.stock_remainder), 0)
  if (table === 'request_mesh') return asNumber(row.remainder_qty)
  if (table === 'request_chain_cord') return asNumber(row.remainder_meters) * 1000
  return asNumber(row.remainder_kg || row.to_order_kg)
}
function materialName(row: Record<string, unknown>) {
  const relation = relationOne(row.materials as { name?: string | null } | { name?: string | null }[] | null)
  return relation?.name || String(
    row.material_name || row.component_name || row.paint_type || row.knife_type || row.description || row.parameters || 'Материал',
  )
}
function flattenPayload(payload: SupplyRequestPayload) {
  return [
    ...payload.sections.sheetMetal.map((row) => ({ table: 'request_sheet_metal' as const, row })),
    ...payload.sections.roundTube.map((row) => ({ table: 'request_round_tube' as const, row })),
    ...payload.sections.circles.map((row) => ({ table: 'request_circle' as const, row })),
    ...payload.sections.pipes.map((row) => ({ table: 'request_pipe' as const, row })),
    ...payload.sections.knives.map((row) => ({ table: 'request_knives' as const, row })),
    ...payload.sections.components.map((row) => ({ table: 'request_components' as const, row })),
    ...payload.sections.paint.map((row) => ({ table: 'request_paint' as const, row })),
    ...payload.sections.meshItems.map((row) => ({ table: 'request_mesh' as const, row })),
    ...payload.sections.chainCords.map((row) => ({ table: 'request_chain_cord' as const, row })),
  ]
}
function isCutItem(table: RequestItemTable, row: Record<string, unknown>) {
  return table === 'request_knives' || (table === 'request_pipe' && row.pipe_type !== 'wire')
}
function revalidateBusinessScrap(machineId: string, requestId: string) {
  revalidatePath(ROUTES.BUSINESS_SCRAP_RESERVATIONS)
  revalidatePath(ROUTES.BUSINESS_SCRAP_RESERVATIONS + '/' + machineId)
  revalidatePath(ROUTES.SUPPLY_REQUEST + '/' + requestId)
  revalidatePath(ROUTES.MATERIAL_REQUESTS)
  revalidatePath(ROUTES.SUPPLY_MATERIAL_REQUESTS)
  revalidatePath(ROUTES.SUPPLY_ORDERS)
  revalidatePath(ROUTES.INVENTORY)
  revalidatePath(ROUTES.TASKS)
  revalidatePath(ROUTES.NOTIFICATIONS)
  revalidatePath(ROUTES.SALES_PLAN + '/' + machineId)
}
async function assertAssignedTechnologist(db: LooseDb, userId: string, role: UserRole, machineId: string) {
  if (isDirector(role)) return
  const { data, error } = await db.from('tasks').select('id')
    .eq('machine_id', machineId)
    .eq('task_type', 'technologist_request')
    .eq('assigned_to', userId)
    .neq('status', 'cancelled')
    .limit(1)
  if (error) throw new Error(error.message || 'Не удалось проверить назначение машины')
  if (!Array.isArray(data) || data.length === 0) throw new Error('Машина не назначена текущему технологу')
}
async function findSupplyDepartmentHead(db: LooseDb) {
  const { data, error } = await db.from('departments').select('id, name, head_user_id')
    .eq('is_active', true).order('sort_order', { ascending: true })
  if (error) throw new Error(error.message || 'Не удалось найти отдел снабжения')
  const departments = ((data || []) as Array<{ id: string; name: string; head_user_id: string | null }>)
    .filter((department) => department.name.trim().toLocaleLowerCase('ru').includes('снабжен'))
  if (!departments.length) throw new Error('Не найден активный отдел снабжения')
  for (const department of departments) {
    if (!department.head_user_id) continue
    const { data: userData } = await db.from('users').select('id, is_active').eq('id', department.head_user_id).maybeSingle()
    const user = userData as { id: string; is_active: boolean | null } | null
    if (user && user.is_active !== false) return user.id
  }
  const { data: membersData, error: membersError } = await db.from('department_members')
    .select('user_id, user:users!department_members_user_id_fkey(id, is_active)')
    .in('department_id', departments.map((department) => department.id))
    .eq('is_department_head', true)
  if (membersError) throw new Error(membersError.message || 'Не удалось найти начальника снабжения')
  for (const member of (membersData || []) as Array<{ user_id: string; user?: { is_active?: boolean | null } | { is_active?: boolean | null }[] | null }>) {
    if (relationOne(member.user)?.is_active !== false) return member.user_id
  }
  throw new Error('У отдела снабжения не назначен активный руководитель')
}
async function addSystemMachineUpdate(db: LooseDb, machineId: string, body: string, eventKey: string) {
  const { error } = await db.from('machine_updates').insert({
    machine_id: machineId,
    body,
    created_by: null,
    updated_by: null,
    message_kind: 'system',
    system_event_key: eventKey,
  })
  if (error) throw new Error(error.message || 'Не удалось записать системное обновление машины')
}
async function notifyUser(db: LooseDb, userId: string, title: string, message: string, machineId: string) {
  const { error } = await db.from('notifications').insert({
    user_id: userId,
    type: 'business_scrap_correction',
    title,
    message,
    related_machine_id: machineId,
  })
  if (error) throw new Error(error.message || 'Не удалось создать уведомление')
}

export async function getBusinessScrapReservationQueue(): Promise<{
  data: { items: BusinessScrapQueueItem[]; canViewAll: boolean } | null
  error: string | null
}> {
  try {
    const { supabase, userId, role } = await requirePermission('business_scrap_reservations', 'view')
    const db = dbFrom(supabase)
    const canViewAll = isDirector(role)
    let taskQuery = db.from('tasks').select('machine_id, assigned_to, status, deadline, created_at')
      .eq('task_type', 'technologist_request')
      .neq('status', 'cancelled')
      .order('deadline', { ascending: true })
      .order('created_at', { ascending: true })
    if (!canViewAll) taskQuery = taskQuery.eq('assigned_to', userId)
    const { data: taskData, error: taskError } = await taskQuery
    if (taskError) throw new Error(taskError.message || 'Не удалось загрузить задачи технолога')
    const taskByMachine = new Map<string, QueueTask>()
    for (const task of (taskData || []) as QueueTask[]) {
      if (task.machine_id && !taskByMachine.has(task.machine_id)) taskByMachine.set(task.machine_id, task)
    }
    const machineIds = Array.from(taskByMachine.keys())
    if (!machineIds.length) return { data: { items: [], canViewAll }, error: null }
    const [machinesResult, requestsResult] = await Promise.all([
      db.from('machines').select('id, name, production_month, is_archived, factories(name)')
        .in('id', machineIds).eq('is_archived', false),
      db.from('technologist_requests').select('id, machine_id, status, created_at')
        .in('machine_id', machineIds).order('created_at', { ascending: false }),
    ])
    if (machinesResult.error) throw new Error(machinesResult.error.message || 'Не удалось загрузить машины')
    if (requestsResult.error) throw new Error(requestsResult.error.message || 'Не удалось загрузить заявки')
    const requestByMachine = new Map<string, QueueRequest>()
    for (const request of (requestsResult.data || []) as QueueRequest[]) {
      if (!requestByMachine.has(request.machine_id)) requestByMachine.set(request.machine_id, request)
    }
    const requestIds = Array.from(requestByMachine.values()).map((request) => request.id)
    const correctionsResult = requestIds.length
      ? await db.from('business_scrap_correction_requests').select('technologist_request_id, status, created_at')
          .in('technologist_request_id', requestIds).order('created_at', { ascending: false })
      : { data: [], error: null }
    if (correctionsResult.error) throw new Error(correctionsResult.error.message || 'Не удалось загрузить корректировки')
    const correctionByRequest = new Map<string, QueueCorrection>()
    for (const correction of (correctionsResult.data || []) as QueueCorrection[]) {
      if (!correctionByRequest.has(correction.technologist_request_id)) correctionByRequest.set(correction.technologist_request_id, correction)
    }
    const items = ((machinesResult.data || []) as QueueMachine[]).flatMap((machine) => {
      const task = taskByMachine.get(machine.id)
      if (!task || machine.is_archived) return []
      const request = requestByMachine.get(machine.id) || null
      const correction = request ? correctionByRequest.get(request.id) || null : null
      return [{
        machineId: machine.id,
        machineName: machine.name,
        factoryName: relationOne(machine.factories)?.name || null,
        productionMonth: machine.production_month,
        deadline: task.deadline,
        taskStatus: task.status,
        requestId: request?.id || null,
        requestStatus: request?.status || null,
        correctionStatus: correction?.status || null,
        state: queueState(request, correction),
      }]
    }).sort((left, right) => {
      return (left.productionMonth || '9999-12-01').localeCompare(right.productionMonth || '9999-12-01')
        || left.deadline.localeCompare(right.deadline)
        || left.machineName.localeCompare(right.machineName, 'ru')
    })
    return { data: { items, canViewAll }, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить машины технолога' }
  }
}

export async function getBusinessScrapWorkspace(requestId: string): Promise<{
  data: BusinessScrapWorkspace | null
  error: string | null
}> {
  try {
    const payloadResult = await getRequestForBusinessScrap(requestId)
    if (!payloadResult.data || payloadResult.error) throw new Error(payloadResult.error || 'Заявка не найдена')
    const payload = payloadResult.data
    const { supabase } = await requirePermission('business_scrap_reservations', 'view')
    const db = dbFrom(supabase)
    const flatRows = flattenPayload(payload)
    const itemIds = flatRows.map(({ row }) => row.id)
    const [reservationsResult, correctionResult, machineResult] = await Promise.all([
      itemIds.length
        ? db.from('inventory_reservations')
            .select('id, inventory_id, source_inventory_id, request_item_table, request_item_id, reserved_quantity, reserved_secondary_quantity, consumed_at')
            .in('request_item_id', itemIds)
            .eq('reservation_source', 'stock')
        : Promise.resolve({ data: [], error: null } as DbResult),
      db.from('business_scrap_correction_requests').select('id, reason, created_at')
        .eq('technologist_request_id', requestId).eq('status', 'pending').maybeSingle(),
      db.from('machines').select('id, name, production_month, factories(name)')
        .eq('id', payload.request.machine_id).maybeSingle(),
    ])
    if (reservationsResult.error) throw new Error(reservationsResult.error.message || 'Не удалось загрузить бронь')
    if (correctionResult.error) throw new Error(correctionResult.error.message || 'Не удалось загрузить согласование')
    if (machineResult.error || !machineResult.data) throw new Error(machineResult.error?.message || 'Машина не найдена')
    const reservations = (reservationsResult.data || []) as ReservationRow[]
    const inventoryIds = Array.from(new Set(reservations.map((reservation) => reservation.source_inventory_id || reservation.inventory_id)))
    const inventoryResult = inventoryIds.length
      ? await db.from('inventory').select('id, is_business_scrap, piece_length_mm').in('id', inventoryIds)
      : { data: [], error: null }
    if (inventoryResult.error) throw new Error(inventoryResult.error.message || 'Не удалось определить источник брони')
    const inventoryMap = new Map(
      ((inventoryResult.data || []) as Array<{ id: string; is_business_scrap: boolean; piece_length_mm: number | null }>)
        .map((item) => [item.id, item]),
    )
    const reservationsByItem = new Map<string, BusinessScrapReservationDetail[]>()
    for (const reservation of reservations) {
      const inventory = inventoryMap.get(reservation.source_inventory_id || reservation.inventory_id)
      if (!inventory?.is_business_scrap) continue
      const key = itemKey(reservation.request_item_table, reservation.request_item_id)
      reservationsByItem.set(key, [...(reservationsByItem.get(key) || []), {
        id: reservation.id,
        inventoryId: reservation.source_inventory_id || reservation.inventory_id,
        quantity: Number(reservation.reserved_quantity || 0),
        secondaryQuantity: reservation.reserved_secondary_quantity === null ? null : Number(reservation.reserved_secondary_quantity),
        pieceLengthMm: inventory.piece_length_mm,
        consumedAt: reservation.consumed_at,
      }])
    }
    const items = flatRows.map(({ table, row }) => {
      const rowRecord = row as unknown as Record<string, unknown>
      const itemReservations = reservationsByItem.get(itemKey(table, row.id)) || []
      return {
        table,
        id: row.id,
        categoryLabel: tableLabels[table],
        materialName: materialName(rowRecord),
        needed: neededForRow(table, rowRecord),
        unit: table === 'request_pipe' && rowRecord.pipe_type === 'wire' ? 'кг' : tableUnits[table],
        currentReserved: itemReservations.reduce((sum, reservation) => sum + reservation.quantity, 0),
        reservations: itemReservations,
        stockItems: row.stock_items,
        isCutReservation: isCutItem(table, rowRecord),
      }
    })
    const machine = machineResult.data as {
      id: string
      name: string
      production_month: string | null
      factories?: { name: string } | { name: string }[] | null
    }
    const pending = correctionResult.data as { id: string; reason: string; created_at: string } | null
    return {
      data: {
        machine: {
          id: machine.id,
          name: machine.name,
          factoryName: relationOne(machine.factories)?.name || null,
          productionMonth: machine.production_month,
        },
        request: {
          id: payload.request.id,
          status: payload.request.status,
          createdAt: payload.request.created_at,
        },
        items,
        pendingCorrection: pending ? { id: pending.id, reason: pending.reason, createdAt: pending.created_at } : null,
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить рабочее место бронирования' }
  }
}

export async function getBusinessScrapMachineEntry(machineId: string): Promise<{
  data: BusinessScrapMachineEntry | null
  error: string | null
}> {
  try {
    const { supabase, userId, role } = await requirePermission('business_scrap_reservations', 'view')
    const db = dbFrom(supabase)
    const { data: machineData, error: machineError } = await db.from('machines')
      .select('id, name, production_month, is_archived, factories(name)')
      .eq('id', machineId).eq('is_archived', false).maybeSingle()
    if (machineError || !machineData) throw new Error(machineError?.message || 'Машина не найдена')
    await assertAssignedTechnologist(db, userId, role, machineId)
    const { data: requestData, error: requestError } = await db.from('technologist_requests')
      .select('id, status').eq('machine_id', machineId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (requestError) throw new Error(requestError.message || 'Не удалось загрузить заявку')
    const machine = machineData as {
      id: string
      name: string
      production_month: string | null
      factories?: { name: string } | { name: string }[] | null
    }
    const request = requestData as { id: string; status: RequestStatus } | null
    const base = {
      machine: {
        id: machine.id,
        name: machine.name,
        factoryName: relationOne(machine.factories)?.name || null,
        productionMonth: machine.production_month,
      },
      request,
    }
    if (!request || request.status === 'draft') {
      return { data: { ...base, workspace: null }, error: null }
    }
    const workspaceResult = await getBusinessScrapWorkspace(request.id)
    if (!workspaceResult.data || workspaceResult.error) {
      throw new Error(workspaceResult.error || 'Не удалось открыть бронь делового остатка')
    }
    return { data: { ...base, workspace: workspaceResult.data }, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось открыть машину' }
  }
}

export async function submitBusinessScrapCorrection(input: z.infer<typeof correctionSchema>) {
  try {
    const parsed = correctionSchema.parse(input)
    const { supabase, userId, role } = await requirePermission('business_scrap_reservations', 'manage')
    const userDb = dbFrom(supabase)
    const workspaceResult = await getBusinessScrapWorkspace(parsed.requestId)
    if (!workspaceResult.data || workspaceResult.error) throw new Error(workspaceResult.error || 'Заявка не найдена')
    const workspace = workspaceResult.data
    await assertAssignedTechnologist(userDb, userId, role, workspace.machine.id)
    if (workspace.request.status !== 'submitted_to_supply' && workspace.request.status !== 'completed') {
      throw new Error('Корректировка доступна только после передачи заявки снабжению')
    }
    if (workspace.pendingCorrection) throw new Error('По этой заявке уже ожидается решение начальника снабжения')
    const itemMap = new Map(workspace.items.map((item) => [itemKey(item.table, item.id), item]))
    const normalizedChanges = parsed.changes.map((change) => {
      const item = itemMap.get(itemKey(change.request_item_table, change.request_item_id))
      if (!item) throw new Error('Позиция корректировки не найдена')
      const removableIds = new Set(item.reservations.filter((reservation) => !reservation.consumedAt).map((reservation) => reservation.id))
      for (const reservationId of change.remove_reservation_ids) {
        if (!removableIds.has(reservationId)) throw new Error('Списанную или изменённую бронь нельзя снять')
      }
      const stockMap = new Map(item.stockItems.map((stockItem) => [stockItem.id, stockItem]))
      const additions = change.additions.map((addition) => {
        const stock = stockMap.get(addition.inventory_id)
        if (!stock || !stock.is_business_scrap) throw new Error('Выбранный деловой остаток больше недоступен')
        if (addition.quantity > Number(stock.available_quantity || 0)) throw new Error('Недостаточно доступного делового остатка')
        return {
          inventory_id: addition.inventory_id,
          quantity: addition.quantity,
          is_cut_reservation: item.isCutReservation,
        }
      })
      const removed = item.reservations
        .filter((reservation) => change.remove_reservation_ids.includes(reservation.id))
        .reduce((sum, reservation) => sum + reservation.quantity, 0)
      const added = additions.reduce((sum, addition) => sum + addition.quantity, 0)
      if (item.currentReserved - removed + added > item.needed) {
        throw new Error('Предлагаемая бронь превышает потребность позиции')
      }
      return { ...change, additions }
    })
    const adminDb = dbFrom(createAdminClient())
    const approverId = await findSupplyDepartmentHead(adminDb)
    const correctionRequestId = crypto.randomUUID()
    const taskId = crypto.randomUUID()
    const { error } = await adminDb.rpc('fn_submit_business_scrap_correction', {
      p_correction_request_id: correctionRequestId,
      p_task_id: taskId,
      p_technologist_request_id: parsed.requestId,
      p_requested_by: userId,
      p_approver_id: approverId,
      p_reason: parsed.reason,
      p_changes: normalizedChanges,
    })
    if (error) throw new Error(error.message || 'Не удалось отправить корректировку на согласование')
    await notifyUser(
      adminDb,
      approverId,
      'Корректировка делового остатка',
      'Технолог запросил корректировку брони по машине «' + workspace.machine.name + '».',
      workspace.machine.id,
    )
    await addSystemMachineUpdate(
      adminDb,
      workspace.machine.id,
      'Корректировка брони делового остатка отправлена начальнику снабжения. Причина: ' + parsed.reason,
      'business_scrap_correction_requested:' + correctionRequestId,
    )
    await dispatchPendingTelegramDeliveries({ userId: approverId })
    revalidateBusinessScrap(workspace.machine.id, parsed.requestId)
    return { success: true, correctionRequestId, taskId, error: null }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось отправить корректировку' }
  }
}

export async function getBusinessScrapCorrectionApproval(taskId: string): Promise<{
  data: BusinessScrapCorrectionApproval | null
  error: string | null
}> {
  try {
    const { supabase, userId, role } = await requirePermission('tasks', 'view')
    const db = dbFrom(supabase)
    const { data: taskData, error: taskError } = await db.from('tasks')
      .select('id, assigned_to, task_type').eq('id', taskId).maybeSingle()
    if (taskError || !taskData) throw new Error(taskError?.message || 'Задача не найдена')
    const task = taskData as { assigned_to: string; task_type: string }
    if (task.task_type !== 'business_scrap_correction_approval') {
      throw new Error('Это не задача согласования делового остатка')
    }
    if (task.assigned_to !== userId && !isDirector(role)) throw new Error('Недостаточно прав')
    const { data: requestData, error: requestError } = await db.from('business_scrap_correction_requests')
      .select('id, status, reason, decision_comment, requested_by, machine_id, created_at')
      .eq('task_id', taskId).maybeSingle()
    if (requestError || !requestData) throw new Error(requestError?.message || 'Запрос согласования не найден')
    const request = requestData as {
      id: string
      status: string
      reason: string
      decision_comment: string | null
      requested_by: string
      machine_id: string
      created_at: string
    }
    const [itemsResult, machineResult, userResult] = await Promise.all([
      db.from('business_scrap_correction_items')
        .select('id, request_item_table, request_item_id, old_reserved_quantity, proposed_reserved_quantity')
        .eq('correction_request_id', request.id).order('created_at', { ascending: true }),
      db.from('machines').select('id, name').eq('id', request.machine_id).maybeSingle(),
      db.from('users').select('id, full_name').eq('id', request.requested_by).maybeSingle(),
    ])
    if (itemsResult.error) throw new Error(itemsResult.error.message || 'Не удалось загрузить изменения')
    if (machineResult.error || !machineResult.data) throw new Error(machineResult.error?.message || 'Машина не найдена')
    const rawItems = (itemsResult.data || []) as Array<{
      id: string
      request_item_table: RequestItemTable
      request_item_id: string
      old_reserved_quantity: number
      proposed_reserved_quantity: number
    }>
    const grouped = new Map<RequestItemTable, string[]>()
    for (const item of rawItems) {
      grouped.set(item.request_item_table, [...(grouped.get(item.request_item_table) || []), item.request_item_id])
    }
    const materialByItem = new Map<string, string>()
    await Promise.all(Array.from(grouped.entries()).map(async ([table, ids]) => {
      const { data, error } = await db.from(table).select('id, materials(name)').in('id', ids)
      if (error) throw new Error(error.message || 'Не удалось загрузить материалы корректировки')
      for (const row of (data || []) as Array<{
        id: string
        materials?: { name?: string } | { name?: string }[] | null
      }>) {
        materialByItem.set(itemKey(table, row.id), relationOne(row.materials)?.name || 'Материал')
      }
    }))
    const machine = machineResult.data as { id: string; name: string }
    const requester = userResult.data as { id: string; full_name: string } | null
    return {
      data: {
        request: {
          id: request.id,
          status: request.status,
          reason: request.reason,
          decisionComment: request.decision_comment,
          createdAt: request.created_at,
          machine,
          requestedBy: requester ? { id: requester.id, fullName: requester.full_name } : null,
        },
        items: rawItems.map((item) => ({
          id: item.id,
          categoryLabel: tableLabels[item.request_item_table],
          materialName: materialByItem.get(itemKey(item.request_item_table, item.request_item_id)) || 'Материал',
          oldQuantity: Number(item.old_reserved_quantity || 0),
          proposedQuantity: Number(item.proposed_reserved_quantity || 0),
          difference: Number(item.proposed_reserved_quantity || 0) - Number(item.old_reserved_quantity || 0),
        })),
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить запрос согласования' }
  }
}

export async function decideBusinessScrapCorrection(input: z.infer<typeof decisionSchema>) {
  try {
    const parsed = decisionSchema.parse(input)
    const { supabase, userId, role } = await requirePermission('tasks', 'manage')
    const userDb = dbFrom(supabase)
    const { data: requestData, error: requestError } = await userDb.from('business_scrap_correction_requests')
      .select('id, approver_id, requested_by, machine_id, technologist_request_id, status')
      .eq('id', parsed.requestId).maybeSingle()
    if (requestError || !requestData) throw new Error(requestError?.message || 'Запрос не найден')
    const request = requestData as {
      id: string
      approver_id: string
      requested_by: string
      machine_id: string
      technologist_request_id: string
      status: string
    }
    if (request.approver_id !== userId && !isDirector(role)) throw new Error('Недостаточно прав')
    if (request.status !== 'pending') throw new Error('Запрос уже обработан')
    if (parsed.decision === 'rejected' && (parsed.comment || '').trim().length < 3) {
      throw new Error('Укажите причину отклонения')
    }
    const adminDb = dbFrom(createAdminClient())
    const { data, error } = await adminDb.rpc('fn_decide_business_scrap_correction', {
      p_correction_request_id: parsed.requestId,
      p_decided_by: userId,
      p_decision: parsed.decision,
      p_comment: parsed.comment || null,
    })
    if (error) throw new Error(error.message || 'Не удалось обработать запрос')
    const rpcResult = Array.isArray(data)
      ? data[0] as { outcome?: string; error_message?: string | null } | undefined
      : null
    const outcome = rpcResult?.outcome || parsed.decision
    const machineResult = await adminDb.from('machines').select('name').eq('id', request.machine_id).maybeSingle()
    const machineName = (machineResult.data as { name?: string } | null)?.name || 'машины'
    const outcomeLabel = outcome === 'approved'
      ? 'одобрена'
      : outcome === 'rejected'
        ? 'отклонена'
        : 'не применена из-за конфликта'
    await notifyUser(
      adminDb,
      request.requested_by,
      'Решение по корректировке делового остатка',
      'Корректировка по машине «' + machineName + '» ' + outcomeLabel + '.',
      request.machine_id,
    )
    await addSystemMachineUpdate(
      adminDb,
      request.machine_id,
      'Корректировка брони делового остатка ' + outcomeLabel
        + '.' + (parsed.comment ? ' Комментарий: ' + parsed.comment : ''),
      'business_scrap_correction_decided:' + parsed.requestId + ':' + outcome,
    )
    await dispatchPendingTelegramDeliveries({ userId: request.requested_by })
    revalidateBusinessScrap(request.machine_id, request.technologist_request_id)
    return { success: true, outcome, conflict: rpcResult?.error_message || null, error: null }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обработать запрос' }
  }
}
