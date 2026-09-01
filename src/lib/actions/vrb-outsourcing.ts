'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import {
  loadVrbMeshStatuses,
  type VrbMeshStatus,
} from '@/lib/vrb/status'

type DbResult = { data: unknown; error: { message?: string; code?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  not: (column: string, operator: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  maybeSingle: () => Promise<DbResult>
  single: () => Promise<DbResult>
}
type LooseDb = { from: (table: string) => LooseQuery }
type RpcDb = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<DbResult>
}

type VrbItemRow = {
  id: string
  operation_id: string
  product_name: string
  drawing_number: string
  requested_quantity: number
  requested_weight_kg: number
  sort_order: number
}

type VrbReceiptRow = {
  vrb_item_id: string
  quantity: number
}

export type { VrbMeshStatus } from '@/lib/vrb/status'

export type VrbReceivingCard = {
  operationId: string
  machineId: string
  machineName: string
  factoryId: string
  factoryName: string
  supplierName: string | null
  deliveryMethod: 'own_transport' | 'carrier' | null
  trackingNumber: string | null
  plannedDeliveryDate: string | null
  items: Array<{
    id: string
    productName: string
    drawingNumber: string
    requestedQuantity: number
    receivedQuantity: number
    remainingQuantity: number
    requestedWeightKg: number
  }>
}

const receiveSchema = z.object({
  operationId: z.string().uuid(),
  factoryId: z.string().uuid(),
  items: z.array(z.object({
    itemId: z.string().uuid(),
    quantity: z.number().positive(),
  })).min(1),
})

const resolveChangeSchema = z.object({
  operationId: z.string().uuid(),
  decision: z.enum(['accepted', 'kept_original']),
})

const dispatchSchema = z.object({
  operationId: z.string().uuid(),
  trackingNumber: z.string().trim().min(2).max(120),
})

function dbFrom(value: unknown): LooseDb {
  return value as LooseDb
}

function rpcFrom(value: unknown): RpcDb {
  return value as RpcDb
}

function deadlineInDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

async function findSupplyDepartmentHeadOrNull(db: LooseDb) {
  const { data: departmentsData, error: departmentsError } = await db
    .from('departments')
    .select('id, name, head_user_id, is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (departmentsError) return null

  const departments = ((departmentsData || []) as Array<{
    id: string
    name: string | null
    head_user_id: string | null
  }>).filter((department) => {
    const name = (department.name || '').toLowerCase()
    return name.includes('снаб') || name.includes('закуп') || name.includes('supply') || name.includes('procurement')
  })

  for (const department of departments) {
    if (!department.head_user_id) continue
    const { data: userData } = await db
      .from('users')
      .select('id, is_active')
      .eq('id', department.head_user_id)
      .maybeSingle()
    const user = userData as { id: string; is_active: boolean | null } | null
    if (user && user.is_active !== false) return user.id
  }

  if (departments.length > 0) {
    const { data: membersData } = await db
      .from('department_members')
      .select('user_id, user:users!department_members_user_id_fkey(id, is_active)')
      .in('department_id', departments.map((department) => department.id))
      .eq('is_department_head', true)
    for (const member of (membersData || []) as Array<{
      user_id: string
      user?: { id: string; is_active: boolean | null } | Array<{ id: string; is_active: boolean | null }> | null
    }>) {
      const user = Array.isArray(member.user) ? member.user[0] : member.user
      if (user && user.is_active !== false) return member.user_id
    }
  }

  const { data: fallbackData } = await db
    .from('users')
    .select('id')
    .eq('role', 'procurement_head')
    .eq('is_active', true)
    .limit(1)
  return ((fallbackData || []) as Array<{ id: string }>)[0]?.id || null
}

export async function ensureVrbApprovalTasksForMachine(machineId?: string | null) {
  const db = dbFrom(createAdminClient())
  let query = db
    .from('machine_outsourcing_operations')
    .select('id, machine_id, approval_task_id, supply_terms_confirmed_at')
    .eq('operation_kind', 'vrb_mesh')
    .is('archived_at', null)
    .is('actual_returned_at', null)
  if (machineId) query = query.eq('machine_id', machineId)

  const { data, error } = await query.order('created_at', { ascending: true })
  if (error) return
  const operations = (data || []) as Array<{
    id: string
    machine_id: string
    approval_task_id: string | null
    supply_terms_confirmed_at: string | null
  }>
  const pendingOperations = operations.filter((operation) => !operation.supply_terms_confirmed_at)
  if (pendingOperations.length === 0) return

  const assigneeId = await findSupplyDepartmentHeadOrNull(db)
  if (!assigneeId) return

  for (const operation of pendingOperations) {
    if (operation.approval_task_id) {
      const { data: linkedTask } = await db
        .from('tasks')
        .select('id, status')
        .eq('id', operation.approval_task_id)
        .maybeSingle()
      const task = linkedTask as { id: string; status: string } | null
      if (task && (task.status === 'pending' || task.status === 'in_progress')) continue
    }

    const { data: existingTaskData } = await db
      .from('tasks')
      .select('id')
      .eq('machine_id', operation.machine_id)
      .eq('assigned_to', assigneeId)
      .eq('task_type', 'vrb_outsourcing_approval')
      .in('status', ['pending', 'in_progress'])
      .limit(1)
      .maybeSingle()
    let taskId = (existingTaskData as { id: string } | null)?.id || null

    if (!taskId) {
      const { data: createdTask, error: taskError } = await db
        .from('tasks')
        .insert({
          machine_id: operation.machine_id,
          assigned_to: assigneeId,
          task_type: 'vrb_outsourcing_approval',
          title: 'Согласовать заказ сетки VRB',
          description: 'Выберите изготовителя, срок, стоимость и способ доставки сетки VRB.',
          status: 'pending',
          start_date: new Date().toISOString().slice(0, 10),
          deadline: deadlineInDays(3),
          // This workflow is visible in CRM queues/tasks but intentionally has no Telegram push.
          notified_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (taskError || !createdTask) continue
      taskId = (createdTask as { id: string }).id
    }

    await db
      .from('machine_outsourcing_operations')
      .update({ approval_task_id: taskId })
      .eq('id', operation.id)
  }
}

export async function getMachineVrbMeshStatus(machineId: string): Promise<VrbMeshStatus | null> {
  try {
    await requirePermission('sales_plan', 'view')
    const statuses = await loadVrbMeshStatuses(createAdminClient(), [machineId])
    return statuses.get(machineId) || null
  } catch {
    return null
  }
}

export async function getVrbReceivingCards(factoryId?: string | null): Promise<{
  data: VrbReceivingCard[]
  error: string | null
}> {
  try {
    await requirePermission('inventory_receiving', 'view')
    const db = dbFrom(createAdminClient())
    const { data: operationData, error: operationError } = await db
      .from('machine_outsourcing_operations')
      .select('id, machine_id, supplier_id, delivery_method, delivery_tracking_number, delivery_dispatched_at, planned_return_date')
      .eq('operation_kind', 'vrb_mesh')
      .is('archived_at', null)
      .is('actual_returned_at', null)
      .not('supply_terms_confirmed_at', 'is', null)
      .order('created_at', { ascending: true })
    if (operationError) throw new Error(operationError.message || 'Не удалось загрузить заявки VRB')
    const operations = (operationData || []) as Array<{
      id: string
      machine_id: string
      supplier_id: string | null
      delivery_method: 'own_transport' | 'carrier' | null
      delivery_tracking_number: string | null
      delivery_dispatched_at: string | null
      planned_return_date: string | null
    }>
    if (operations.length === 0) return { data: [], error: null }

    const machineIds = Array.from(new Set(operations.map((operation) => operation.machine_id)))
    const supplierIds = Array.from(new Set(operations.map((operation) => operation.supplier_id).filter((id): id is string => Boolean(id))))
    const [machinesResult, itemsResult, suppliersResult, needsResult] = await Promise.all([
      db.from('machines').select('id, name, factory_id').in('id', machineIds),
      db.from('machine_outsourcing_vrb_items').select('id, operation_id, product_name, drawing_number, requested_quantity, requested_weight_kg, sort_order').in('operation_id', operations.map((operation) => operation.id)),
      supplierIds.length > 0
        ? db.from('suppliers').select('id, name').in('id', supplierIds)
        : Promise.resolve({ data: [], error: null }),
      db.from('machine_outsourcing_transport_needs')
        .select('operation_id, direction, plan_state, status')
        .in('operation_id', operations.map((operation) => operation.id)),
    ])
    if (machinesResult.error || itemsResult.error || suppliersResult.error || needsResult.error) {
      throw new Error(
        machinesResult.error?.message
        || itemsResult.error?.message
        || suppliersResult.error?.message
        || needsResult.error?.message
        || 'Не удалось дополнить заявки VRB',
      )
    }
    const machines = (machinesResult.data || []) as Array<{ id: string; name: string; factory_id: string | null }>
    const machineById = new Map(machines.map((machine) => [machine.id, machine]))
    const factoryIds = Array.from(new Set(machines.map((machine) => machine.factory_id).filter((id): id is string => Boolean(id))))
    const { data: factoryData, error: factoryError } = factoryIds.length > 0
      ? await db.from('factories').select('id, name').in('id', factoryIds)
      : { data: [], error: null }
    if (factoryError) throw new Error(factoryError.message || 'Не удалось загрузить заводы')

    const items = (itemsResult.data || []) as VrbItemRow[]
    const { data: receiptData, error: receiptError } = items.length > 0
      ? await db.from('machine_outsourcing_vrb_receipts').select('vrb_item_id, quantity').in('vrb_item_id', items.map((item) => item.id))
      : { data: [], error: null }
    if (receiptError) throw new Error(receiptError.message || 'Не удалось загрузить приемки VRB')
    const receivedByItem = new Map<string, number>()
    for (const receipt of (receiptData || []) as VrbReceiptRow[]) {
      receivedByItem.set(receipt.vrb_item_id, (receivedByItem.get(receipt.vrb_item_id) || 0) + Number(receipt.quantity || 0))
    }
    const factoryById = new Map(((factoryData || []) as Array<{ id: string; name: string }>).map((factory) => [factory.id, factory.name]))
    const supplierById = new Map(((suppliersResult.data || []) as Array<{ id: string; name: string }>).map((supplier) => [supplier.id, supplier.name]))
    const completedOwnDeliveryOperations = new Set(
      ((needsResult.data || []) as Array<{
        operation_id: string
        direction: string
        plan_state: string
        status: string
      }>)
        .filter((need) => need.direction === 'return' && need.plan_state === 'confirmed' && need.status === 'completed')
        .map((need) => need.operation_id),
    )

    const cards = operations.flatMap((operation): VrbReceivingCard[] => {
      const isReadyForWarehouse = operation.delivery_method === 'carrier'
        ? Boolean(operation.delivery_dispatched_at)
        : operation.delivery_method === 'own_transport' && completedOwnDeliveryOperations.has(operation.id)
      if (!isReadyForWarehouse) return []
      const machine = machineById.get(operation.machine_id)
      if (!machine?.factory_id || (factoryId && machine.factory_id !== factoryId)) return []
      const cardItems = items
        .filter((item) => item.operation_id === operation.id)
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((item) => {
          const receivedQuantity = receivedByItem.get(item.id) || 0
          return {
            id: item.id,
            productName: item.product_name,
            drawingNumber: item.drawing_number,
            requestedQuantity: Number(item.requested_quantity || 0),
            receivedQuantity,
            remainingQuantity: Math.max(0, Number(item.requested_quantity || 0) - receivedQuantity),
            requestedWeightKg: Number(item.requested_weight_kg || 0),
          }
        })
        .filter((item) => item.remainingQuantity > 0)
      if (cardItems.length === 0) return []
      return [{
        operationId: operation.id,
        machineId: machine.id,
        machineName: machine.name,
        factoryId: machine.factory_id,
        factoryName: factoryById.get(machine.factory_id) || 'Завод',
        supplierName: operation.supplier_id ? supplierById.get(operation.supplier_id) || null : null,
        deliveryMethod: operation.delivery_method,
        trackingNumber: operation.delivery_tracking_number,
        plannedDeliveryDate: operation.planned_return_date?.slice(0, 10) || null,
        items: cardItems,
      }]
    })
    return { data: cards, error: null }
  } catch (error) {
    return { data: [], error: getErrorMessage(error) }
  }
}

export async function receiveVrbMesh(input: z.infer<typeof receiveSchema>) {
  try {
    const parsed = receiveSchema.parse(input)
    const context = await requirePermission('inventory_receiving', 'manage')
    const rpc = rpcFrom(createAdminClient())
    const { error } = await rpc.rpc('fn_receive_vrb_mesh', {
      p_operation_id: parsed.operationId,
      p_items: parsed.items,
      p_factory_id: parsed.factoryId,
      p_actor: context.userId,
    })
    if (error) throw new Error(error.message || 'Не удалось принять сетку VRB')
    revalidatePath(ROUTES.INVENTORY_RECEIVING)
    revalidatePath(ROUTES.SUPPLY_OUTSOURCING_REQUESTS)
    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(ROUTES.PRODUCTION)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function resolveVrbOrderChange(input: z.infer<typeof resolveChangeSchema>) {
  try {
    const parsed = resolveChangeSchema.parse(input)
    const context = await requirePermission('supply_transport', 'manage')
    const { error } = await rpcFrom(createAdminClient()).rpc('fn_resolve_vrb_order_change', {
      p_operation_id: parsed.operationId,
      p_decision: parsed.decision,
      p_actor: context.userId,
    })
    if (error) throw new Error(error.message || 'Не удалось сохранить решение по заявке VRB')
    revalidatePath(ROUTES.SUPPLY_OUTSOURCING_REQUESTS)
    revalidatePath(ROUTES.SUPPLY_TRANSPORT)
    revalidatePath(ROUTES.TASKS)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function markVrbCarrierDispatched(input: z.infer<typeof dispatchSchema>) {
  try {
    const parsed = dispatchSchema.parse(input)
    const context = await requirePermission('supply_transport', 'manage')
    const db = dbFrom(createAdminClient())
    const { data, error } = await db
      .from('machine_outsourcing_operations')
      .select('id, machine_id, operation_kind, delivery_method, supply_terms_confirmed_at, archived_at')
      .eq('id', parsed.operationId)
      .maybeSingle()
    const operation = data as {
      id: string
      machine_id: string
      operation_kind: string
      delivery_method: string | null
      supply_terms_confirmed_at: string | null
      archived_at: string | null
    } | null
    if (error || !operation || operation.archived_at || operation.operation_kind !== 'vrb_mesh') {
      throw new Error(error?.message || 'Заявка VRB не найдена')
    }
    if (operation.delivery_method !== 'carrier' || !operation.supply_terms_confirmed_at) {
      throw new Error('Трек-номер доступен после согласования доставки службой доставки')
    }
    const now = new Date().toISOString()
    const { error: updateError } = await db
      .from('machine_outsourcing_operations')
      .update({
        delivery_tracking_number: parsed.trackingNumber,
        delivery_dispatched_at: now,
        delivery_dispatched_by: context.userId,
        updated_by: context.userId,
        updated_at: now,
      })
      .eq('id', operation.id)
    if (updateError) throw new Error(updateError.message || 'Не удалось сохранить трек-номер')
    revalidatePath(ROUTES.SUPPLY_OUTSOURCING_REQUESTS)
    revalidatePath(ROUTES.INVENTORY_RECEIVING)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}
