'use server'

import { revalidatePath } from 'next/cache'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import { ROUTES } from '@/lib/constants/routes'
import { STAGES } from '@/lib/constants/stages'
import { isDirector } from '@/lib/utils/permissions'
import { formatProductionMonth, normalizeProductionMonthValue } from '@/lib/utils/production-months'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import { normalizeNightShiftDates } from '@/lib/utils/night-shift-dates'
import { createSystemMachineChatMessage } from '@/lib/actions/machine-activity'
import { syncTransportCostTask } from '@/lib/actions/transport-cost-tasks'
import { getIncomingOutsourcingPlanBlockers, syncOutsourcingTransportForProductionPlan, syncZincOutsourcingFromStage } from '@/lib/actions/outsourcing'
import { dispatchPendingTelegramDeliveries } from '@/lib/services/task-notifications'
import type { ProductionDateChangeRequestStatus, ProductionMonthPlanStatus, StageType, TaskStatus, TaskType, UserRole } from '@/lib/types'

type DbResult = { data: unknown; error: { message?: string; code?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  upsert: (values: unknown, options?: { onConflict?: string }) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  maybeSingle: () => Promise<DbResult>
  single: () => Promise<DbResult>
}
type LooseDb = { from: (table: string) => LooseQuery }

export type ProductionMonthPlanSummary = {
  id: string
  factory_id: string
  production_month: string
  status: ProductionMonthPlanStatus
  preliminary_ready_at: string | null
  confirmed_at: string | null
}

export type ProductionPlanDateChangeInput = {
  target_type: 'machine' | 'stage' | 'outsourcing'
  production_stage_id?: string | null
  outsourcing_operation_id?: string | null
  field_name: 'planned_material_date' | 'date_start' | 'date_end' | 'night_shift_date' | 'planned_send_date' | 'planned_return_date'
  new_value: string | null
}

export type ProductionPlanDateChangeApprovalPayload = {
  request: {
    id: string
    status: ProductionDateChangeRequestStatus
    comment: string | null
    decision_comment: string | null
    created_at: string
    machine: { id: string; name: string; factory_id: string | null; production_month: string | null }
    factory: { id: string; name: string } | null
    plan: { id: string; production_month: string; status: ProductionMonthPlanStatus }
    requested_by_user: { id: string; full_name: string } | null
  }
  items: ProductionPlanDateChangeApprovalItem[]
}

export type ProductionPlanDateChangeApprovalItem = {
  id: string
  target_type: 'machine' | 'stage' | 'outsourcing'
  production_stage_id: string | null
  outsourcing_operation_id: string | null
  stage_type: StageType | null
  field_name: string
  old_value: string | null
  new_value: string | null
  status: ProductionDateChangeRequestStatus
}

type MachineForPlan = {
  id: string
  name: string
  factory_id: string | null
  production_month: string | null
  planned_material_date?: string | null
  is_archived?: boolean | null
  production_stages?: Array<{
    id: string
    stage_type: StageType
    date_start?: string | null
    date_end?: string | null
    night_shift_date?: string | null
    is_skipped?: boolean | null
  }> | null
}

type ProductionMonthPlanRow = ProductionMonthPlanSummary & {
  preliminary_ready_by: string | null
  confirmed_by: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

type DateChangeRequestRow = {
  id: string
  production_month_plan_id: string
  machine_id: string
  requested_by: string
  decided_by: string | null
  task_id: string | null
  status: ProductionDateChangeRequestStatus
  comment: string | null
  decision_comment: string | null
  created_at: string
  updated_at: string
  decided_at: string | null
}

type DateChangeItemRow = ProductionPlanDateChangeApprovalItem & {
  request_id: string
  machine_id: string
  sort_order: number
}

type TaskRow = {
  id: string
  assigned_to: string
  status: TaskStatus
  task_type: TaskType
}

const planStatusSchema = z.enum(['preliminary_ready', 'confirmed'])
const dateValueSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Некорректная дата').nullable()
const changeSchema = z.object({
  target_type: z.enum(['machine', 'stage', 'outsourcing']),
  production_stage_id: z.string().uuid().optional().nullable(),
  outsourcing_operation_id: z.string().uuid().optional().nullable(),
  field_name: z.enum(['planned_material_date', 'date_start', 'date_end', 'night_shift_date', 'planned_send_date', 'planned_return_date']),
  new_value: dateValueSchema,
}).superRefine((value, ctx) => {
  if (value.target_type === 'machine' && value.field_name !== 'planned_material_date') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['field_name'], message: 'Для машины можно менять только плановую дату материала' })
  }
  if (value.target_type === 'stage' && (!value.production_stage_id || value.field_name === 'planned_material_date')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['production_stage_id'], message: 'Для этапа нужна дата этапа' })
  }
  if (value.target_type === 'outsourcing' && (!value.outsourcing_operation_id || (value.field_name !== 'planned_send_date' && value.field_name !== 'planned_return_date'))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['outsourcing_operation_id'], message: 'Для аутсорсинга нужна операция и дата отправки или возврата' })
  }
})
const createRequestSchema = z.object({
  machineId: z.string().uuid(),
  changes: z.array(changeSchema).min(1),
  comment: z.string().trim().max(1000).optional().nullable(),
})
const decideRequestSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().trim().max(1000).optional().nullable(),
})

function dbFrom(value: unknown): LooseDb {
  return value as LooseDb
}

function dateOnly(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null
}

function normalizeMonthOrThrow(value: string | null | undefined) {
  const normalized = normalizeProductionMonthValue(value)
  if (!normalized) throw new Error('Выберите месяц производства')
  return normalized
}

function formatDate(value: string | null | undefined) {
  const date = dateOnly(value)
  if (!date) return 'дата не указана'
  const [year, month, day] = date.split('-').map(Number)
  return format(new Date(year, month - 1, day), 'dd.MM.yyyy', { locale: ru })
}

function todayLabel() {
  return format(new Date(), 'dd.MM.yyyy', { locale: ru })
}

function statusLabel(status: ProductionMonthPlanStatus) {
  if (status === 'confirmed') return 'полностью подтверждён'
  if (status === 'preliminary_ready') return 'предварительно готов'
  return 'черновик'
}

function statusTitle(status: ProductionMonthPlanStatus) {
  if (status === 'confirmed') return 'План производства подтверждён'
  if (status === 'preliminary_ready') return 'План производства предварительно готов'
  return 'План производства'
}

function fieldLabel(item: Pick<DateChangeItemRow, 'target_type' | 'stage_type' | 'field_name'>) {
  if (item.target_type === 'machine') return 'Плановая поставка материала'
  if (item.target_type === 'outsourcing') {
    return item.field_name === 'planned_send_date'
      ? 'Аутсорсинг: готовы отправить'
      : 'Аутсорсинг: ожидаем возврат'
  }
  const stage = item.stage_type ? STAGES[item.stage_type]?.label || item.stage_type : 'Этап'
  const field = item.field_name === 'date_start'
    ? 'начало'
    : item.field_name === 'date_end'
      ? 'окончание'
      : 'ночная смена'
  return `${stage}: ${field}`
}

function formatChangeLine(item: Pick<DateChangeItemRow, 'target_type' | 'stage_type' | 'field_name' | 'old_value' | 'new_value'>) {
  return `${fieldLabel(item)}: ${formatDate(item.old_value)} -> ${formatDate(item.new_value)}`
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function isProductionManagerScoped(role: UserRole, userFactoryId: string | null, factoryId: string) {
  return role !== 'production_manager' || userFactoryId === factoryId
}

async function requireProductionManage(factoryId: string) {
  const context = await requirePermission('production', 'manage')
  if (!isProductionManagerScoped(context.role, context.factoryId, factoryId)) throw new Error('Доступ запрещён')
  return context
}

async function getPlanByFactoryMonth(db: LooseDb, factoryId: string, productionMonth: string) {
  const { data, error } = await db
    .from('production_month_plans')
    .select('*')
    .eq('factory_id', factoryId)
    .eq('production_month', productionMonth)
    .maybeSingle()

  if (error) throw new Error(error.message || 'Не удалось загрузить статус плана')
  return data as ProductionMonthPlanRow | null
}

async function ensurePlan(db: LooseDb, factoryId: string, productionMonth: string, userId: string) {
  const existing = await getPlanByFactoryMonth(db, factoryId, productionMonth)
  if (existing) return existing

  const { data, error } = await db
    .from('production_month_plans')
    .insert({
      factory_id: factoryId,
      production_month: productionMonth,
      status: 'draft',
      created_by: userId,
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message || 'Не удалось создать статус плана')
  return data as ProductionMonthPlanRow
}

async function getPlanMachines(db: LooseDb, factoryId: string, productionMonth: string) {
  const { data, error } = await db
    .from('machines')
    .select(`
      id,
      name,
      factory_id,
      production_month,
      is_archived,
      production_stages(id, stage_type, date_end, is_skipped)
    `)
    .eq('factory_id', factoryId)
    .eq('production_month', productionMonth)
    .eq('is_archived', false)
    .order('production_queue_number', { ascending: true })

  if (error) throw new Error(error.message || 'Не удалось загрузить машины плана')
  return (data || []) as MachineForPlan[]
}

function getShippingDate(machine: MachineForPlan) {
  const shipping = (machine.production_stages || []).find((stage) => stage.stage_type === 'shipping')
  return dateOnly(shipping?.date_end)
}

async function notifyMachinePlanStatus(machine: MachineForPlan, plan: ProductionMonthPlanRow, status: ProductionMonthPlanStatus, excludeUserId?: string | null) {
  const shippingDate = getShippingDate(machine)
  const body = [
    `${statusTitle(status)}.`,
    `Месяц: ${formatProductionMonth(plan.production_month)}.`,
    `Статус: ${statusLabel(status)}.`,
    `Дата готовности к погрузке сейчас: ${formatDate(shippingDate)}.`,
    `Текущая дата: ${todayLabel()}.`,
  ].join('\n')

  await createSystemMachineChatMessage({
    machineId: machine.id,
    body,
    eventKey: `production_plan_status:${plan.id}:${status}:${machine.id}`,
    excludeUserId,
  })
}

async function getConfirmedPlanForMachine(db: LooseDb, machineId: string) {
  const { data, error } = await db
    .from('machines')
    .select('id, factory_id, production_month, is_archived')
    .eq('id', machineId)
    .maybeSingle()

  if (error) throw new Error(error.message || 'Не удалось проверить план машины')
  const machine = data as Pick<MachineForPlan, 'id' | 'factory_id' | 'production_month' | 'is_archived'> | null
  if (!machine?.factory_id || !machine.production_month || machine.is_archived) return null

  const plan = await getPlanByFactoryMonth(db, machine.factory_id, normalizeMonthOrThrow(machine.production_month))
  return plan?.status === 'confirmed' ? plan : null
}

async function getReadyPlanForMachine(db: LooseDb, machineId: string) {
  const { data, error } = await db
    .from('machines')
    .select(`
      id,
      name,
      factory_id,
      production_month,
      is_archived,
      production_stages(id, stage_type, date_end, is_skipped)
    `)
    .eq('id', machineId)
    .maybeSingle()

  if (error) throw new Error(error.message || 'Не удалось проверить план машины')
  const machine = data as MachineForPlan | null
  if (!machine?.factory_id || !machine.production_month || machine.is_archived) return null

  const plan = await getPlanByFactoryMonth(db, machine.factory_id, normalizeMonthOrThrow(machine.production_month))
  if (!plan || plan.status === 'draft') return null
  return { plan, machine }
}

async function findPlanningDepartmentHead(db: LooseDb) {
  const { data: departmentsData, error: departmentsError } = await db
    .from('departments')
    .select('id, name, head_user_id, is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (departmentsError) throw new Error(departmentsError.message || 'Не удалось найти отдел планирования')

  const departments = ((departmentsData || []) as Array<{ id: string; name: string | null; head_user_id: string | null }>)
    .filter((department) => {
      const name = (department.name || '').toLowerCase()
      return name.includes('планирован') || name.includes('planning')
    })

  if (departments.length === 0) throw new Error('Не найден активный отдел планирования')

  for (const department of departments) {
    if (!department.head_user_id) continue
    const { data: userData, error: userError } = await db
      .from('users')
      .select('id, is_active')
      .eq('id', department.head_user_id)
      .maybeSingle()

    const user = userData as { id: string; is_active: boolean | null } | null
    if (!userError && user && user.is_active !== false) {
      return department.head_user_id
    }
  }

  const { data: membersData, error: membersError } = await db
    .from('department_members')
    .select('user_id, department_id, is_department_head, user:users!department_members_user_id_fkey(id, is_active)')
    .in('department_id', departments.map((department) => department.id))
    .eq('is_department_head', true)

  if (membersError) throw new Error(membersError.message || 'Не удалось найти руководителя отдела планирования')

  for (const member of (membersData || []) as Array<{ user_id: string; user?: { id: string; is_active: boolean | null } | { id: string; is_active: boolean | null }[] | null }>) {
    const user = relationOne(member.user)
    if (user?.is_active !== false) return member.user_id
  }

  throw new Error('У отдела планирования нет активного руководителя')
}

export async function getProductionMonthPlans(factoryId: string): Promise<{ data: ProductionMonthPlanSummary[]; error: string | null }> {
  try {
    const context = await requirePermission('production', 'view')
    if (!isProductionManagerScoped(context.role, context.factoryId, factoryId)) {
      throw new Error('Доступ запрещён')
    }

    const db = dbFrom(createAdminClient())
    const { data, error } = await db
      .from('production_month_plans')
      .select('id, factory_id, production_month, status, preliminary_ready_at, confirmed_at')
      .eq('factory_id', factoryId)
      .order('production_month', { ascending: false })

    if (error) throw new Error(error.message || 'Не удалось загрузить статусы планов')
    return { data: (data || []) as ProductionMonthPlanSummary[], error: null }
  } catch (error) {
    return { data: [], error: getErrorMessage(error) }
  }
}

export async function markProductionMonthPlanStatus(factoryId: string, productionMonthValue: string, nextStatusValue: ProductionMonthPlanStatus) {
  try {
    const nextStatus = planStatusSchema.parse(nextStatusValue)
    const productionMonth = normalizeMonthOrThrow(productionMonthValue)
    const context = await requireProductionManage(factoryId)
    const db = dbFrom(createAdminClient())
    const plan = await ensurePlan(db, factoryId, productionMonth, context.userId)

    if (plan.status === 'confirmed') {
      if (nextStatus === 'confirmed') return { success: true, data: plan, error: null }
      throw new Error('Подтверждённый план нельзя вернуть в предварительный статус')
    }
    if (plan.status === nextStatus) return { success: true, data: plan, error: null }

    const machines = await getPlanMachines(db, factoryId, productionMonth)
    const blockers = machines
      .filter((machine) => !getShippingDate(machine))
      .map((machine) => machine.name)

    const incomingOutsourcingBlockers = await getIncomingOutsourcingPlanBlockers(factoryId, productionMonth)
    blockers.push(...incomingOutsourcingBlockers.map((name) => `${name} (входящий аутсорсинг)`))

    if (blockers.length > 0) {
      return {
        success: false,
        error: `Укажите даты для подтверждения плана: ${blockers.join(', ')}`,
        blockers,
      }
    }

    const now = new Date().toISOString()
    const updates: Record<string, unknown> = { status: nextStatus }
    if (nextStatus === 'preliminary_ready') {
      updates.preliminary_ready_at = plan.preliminary_ready_at || now
      updates.preliminary_ready_by = plan.preliminary_ready_by || context.userId
    }
    if (nextStatus === 'confirmed') {
      updates.preliminary_ready_at = plan.preliminary_ready_at || now
      updates.preliminary_ready_by = plan.preliminary_ready_by || context.userId
      updates.confirmed_at = now
      updates.confirmed_by = context.userId
    }

    const { data, error } = await db
      .from('production_month_plans')
      .update(updates)
      .eq('id', plan.id)
      .select('*')
      .single()

    if (error || !data) throw new Error(error?.message || 'Не удалось обновить статус плана')
    const updatedPlan = data as ProductionMonthPlanRow

    for (const machine of machines) {
      await notifyMachinePlanStatus(machine, updatedPlan, nextStatus, context.userId)
    }
    await syncOutsourcingTransportForProductionPlan(factoryId, productionMonth, nextStatus, context.userId)

    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.SUPPLY_TRANSPORT)
    revalidatePath(ROUTES.TASKS)
    return { success: true, data: updatedPlan, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function getMachineProductionPlanStatus(machineId: string) {
  const db = dbFrom(createAdminClient())
  const ready = await getReadyPlanForMachine(db, machineId)
  return ready?.plan.status || 'draft'
}

export async function isMachineInConfirmedProductionPlan(machineId: string) {
  const db = dbFrom(createAdminClient())
  return Boolean(await getConfirmedPlanForMachine(db, machineId))
}

export async function notifyMachineEnteredReadyProductionPlan(machineId: string, excludeUserId?: string | null) {
  const db = dbFrom(createAdminClient())
  const ready = await getReadyPlanForMachine(db, machineId)
  if (!ready) return

  const eventKey = `production_plan_status:${ready.plan.id}:${ready.plan.status}:${machineId}`
  const { data: existingData, error: existingError } = await db
    .from('machine_chat_messages')
    .select('id')
    .eq('machine_id', machineId)
    .eq('system_event_key', eventKey)
    .limit(1)

  if (existingError) throw new Error(existingError.message || 'Не удалось проверить историю чата')
  if (((existingData || []) as Array<{ id: string }>).length > 0) return

  await notifyMachinePlanStatus(ready.machine, ready.plan, ready.plan.status, excludeUserId)
}

export async function notifyProductionPlanShippingDateChanged(machineId: string, oldDate: string | null, newDate: string | null, excludeUserId?: string | null) {
  const db = dbFrom(createAdminClient())
  const ready = await getReadyPlanForMachine(db, machineId)
  if (!ready || ready.plan.status !== 'preliminary_ready') return
  if (dateOnly(oldDate) === dateOnly(newDate)) return

  const body = [
    'Изменена дата готовности к погрузке в предварительном плане производства.',
    `Месяц: ${formatProductionMonth(ready.plan.production_month)}.`,
    `Было: ${formatDate(oldDate)}.`,
    `Стало: ${formatDate(newDate)}.`,
    `Текущая дата: ${todayLabel()}.`,
  ].join('\n')

  await createSystemMachineChatMessage({
    machineId,
    body,
    eventKey: `production_plan_shipping_date_changed:${ready.plan.id}:${machineId}:${Date.now()}`,
    excludeUserId,
  })
}

export async function createProductionPlanDateChangeRequest(input: {
  machineId: string
  changes: ProductionPlanDateChangeInput[]
  comment?: string | null
}) {
  try {
    const parsed = createRequestSchema.parse(input)
    const context = await requirePermission('production', 'manage')

    const db = dbFrom(createAdminClient())
    const { data: machineData, error: machineError } = await db
      .from('machines')
      .select('id, name, factory_id, production_month, planned_material_date, is_archived')
      .eq('id', parsed.machineId)
      .maybeSingle()

    if (machineError || !machineData) throw new Error(machineError?.message || 'Машина не найдена')
    const machine = machineData as MachineForPlan
    if (machine.is_archived) throw new Error('Машина архивирована')
    if (!machine.factory_id || !machine.production_month) throw new Error('Машина не привязана к месяцу производства')
    if (!isProductionManagerScoped(context.role, context.factoryId, machine.factory_id)) throw new Error('Доступ запрещён')

    const productionMonth = normalizeMonthOrThrow(machine.production_month)
    const plan = await getPlanByFactoryMonth(db, machine.factory_id, productionMonth)
    if (!plan || plan.status !== 'confirmed') {
      throw new Error('Запрос на изменение дат нужен только для подтверждённого плана')
    }

    const stageIds = Array.from(new Set(parsed.changes.map((change) => change.production_stage_id).filter((id): id is string => Boolean(id))))
    const outsourcingOperationIds = Array.from(new Set(parsed.changes.map((change) => change.outsourcing_operation_id).filter((id): id is string => Boolean(id))))
    const stagesById = new Map<string, { id: string; machine_id: string; stage_type: StageType; date_start: string | null; date_end: string | null; night_shift_date: string | null }>()
    if (stageIds.length > 0) {
      const { data: stagesData, error: stagesError } = await db
        .from('production_stages')
        .select('id, machine_id, stage_type, date_start, date_end, night_shift_date')
        .in('id', stageIds)

      if (stagesError) throw new Error(stagesError.message || 'Не удалось загрузить этапы')
      for (const stage of (stagesData || []) as Array<{ id: string; machine_id: string; stage_type: StageType; date_start: string | null; date_end: string | null; night_shift_date: string | null }>) {
        if (stage.machine_id === machine.id) stagesById.set(stage.id, stage)
      }
    }
    const outsourcingById = new Map<string, { id: string; machine_id: string; planned_send_date: string | null; planned_return_date: string | null }>()
    if (outsourcingOperationIds.length > 0) {
      const { data: operationsData, error: operationsError } = await db
        .from('machine_outsourcing_operations')
        .select('id, machine_id, planned_send_date, planned_return_date')
        .in('id', outsourcingOperationIds)
        .is('archived_at', null)

      if (operationsError) throw new Error(operationsError.message || 'Не удалось загрузить операции аутсорсинга')
      for (const operation of (operationsData || []) as Array<{ id: string; machine_id: string; planned_send_date: string | null; planned_return_date: string | null }>) {
        if (operation.machine_id === machine.id) outsourcingById.set(operation.id, operation)
      }
    }

    const items: Array<Record<string, unknown>> = []
    parsed.changes.forEach((change, index) => {
      let oldValue: string | null = null
      let stageType: StageType | null = null
      if (change.target_type === 'machine') {
        oldValue = dateOnly(machine.planned_material_date)
      } else if (change.target_type === 'stage') {
        const stage = change.production_stage_id ? stagesById.get(change.production_stage_id) : null
        if (!stage) throw new Error('Этап производства не найден')
        oldValue = dateOnly(stage[change.field_name as 'date_start' | 'date_end' | 'night_shift_date'])
        stageType = stage.stage_type
      } else {
        const operation = change.outsourcing_operation_id ? outsourcingById.get(change.outsourcing_operation_id) : null
        if (!operation) throw new Error('Операция аутсорсинга не найдена')
        oldValue = dateOnly(operation[change.field_name as 'planned_send_date' | 'planned_return_date'])
      }

      const newValue = dateOnly(change.new_value)
      if (oldValue === newValue) return

      items.push({
        machine_id: machine.id,
        target_type: change.target_type,
        production_stage_id: change.target_type === 'stage' ? change.production_stage_id : null,
        outsourcing_operation_id: change.target_type === 'outsourcing' ? change.outsourcing_operation_id : null,
        stage_type: stageType,
        field_name: change.field_name,
        old_value: oldValue,
        new_value: newValue,
        sort_order: index,
      })
    })

    if (items.length === 0) throw new Error('Нет изменений дат для согласования')

    const approverId = await findPlanningDepartmentHead(db)
    const { data: existingData, error: existingError } = await db
      .from('production_plan_date_change_requests')
      .select('id')
      .eq('production_month_plan_id', plan.id)
      .eq('machine_id', machine.id)
      .eq('status', 'pending')
      .limit(1)

    if (existingError) throw new Error(existingError.message || 'Не удалось проверить открытые запросы')
    if (((existingData || []) as Array<{ id: string }>).length > 0) {
      throw new Error('По этой машине уже есть запрос на изменение дат')
    }

    const { data: requestData, error: requestError } = await db
      .from('production_plan_date_change_requests')
      .insert({
        production_month_plan_id: plan.id,
        machine_id: machine.id,
        requested_by: context.userId,
        comment: parsed.comment || null,
      })
      .select('id')
      .single()

    if (requestError || !requestData) throw new Error(requestError?.message || 'Не удалось создать запрос')
    const requestId = (requestData as { id: string }).id

    const { error: itemsError } = await db
      .from('production_plan_date_change_request_items')
      .insert(items.map((item) => ({ ...item, request_id: requestId })))

    if (itemsError) throw new Error(itemsError.message || 'Не удалось сохранить изменения запроса')

    const { data: taskData, error: taskError } = await db
      .from('tasks')
      .insert({
        machine_id: machine.id,
        assigned_to: approverId,
        task_type: 'production_plan_date_change_approval',
        title: `Согласовать изменение дат: ${machine.name}`,
        description: `Начальник производства запросил изменение дат в подтверждённом плане ${formatProductionMonth(plan.production_month)}.`,
        status: 'pending',
        start_date: new Date().toISOString().slice(0, 10),
        deadline: new Date().toISOString().slice(0, 10),
      })
      .select('id')
      .single()

    if (taskError || !taskData) throw new Error(taskError?.message || 'Не удалось создать задачу согласования')
    const taskId = (taskData as { id: string }).id

    const { error: linkError } = await db
      .from('production_plan_date_change_requests')
      .update({ task_id: taskId })
      .eq('id', requestId)

    if (linkError) throw new Error(linkError.message || 'Не удалось связать задачу с запросом')

    await dispatchPendingTelegramDeliveries({ userId: approverId })
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.TASKS)
    revalidatePath(`${ROUTES.SALES_PLAN}/${machine.id}`)

    return { success: true, requestId, taskId, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function getProductionPlanDateChangeApproval(taskId: string): Promise<{ data: ProductionPlanDateChangeApprovalPayload | null; error: string | null }> {
  try {
    const context = await requirePermission('tasks', 'view')
    const db = dbFrom(createAdminClient())
    const { data: taskData, error: taskError } = await db
      .from('tasks')
      .select('id, assigned_to, status, task_type')
      .eq('id', taskId)
      .maybeSingle()

    if (taskError || !taskData) throw new Error(taskError?.message || 'Задача не найдена')
    const task = taskData as TaskRow
    if (task.task_type !== 'production_plan_date_change_approval') throw new Error('Это не задача согласования дат')
    if (task.assigned_to !== context.userId && !isDirector(context.role)) throw new Error('Недостаточно прав')

    const { data: requestData, error: requestError } = await db
      .from('production_plan_date_change_requests')
      .select(`
        *,
        machine:machines(id, name, factory_id, production_month),
        plan:production_month_plans(id, production_month, status),
        requested_by_user:users!production_plan_date_change_requests_requested_by_fkey(id, full_name)
      `)
      .eq('task_id', task.id)
      .maybeSingle()

    if (requestError || !requestData) throw new Error(requestError?.message || 'Запрос не найден')
    const request = requestData as DateChangeRequestRow & {
      machine?: { id: string; name: string; factory_id: string | null; production_month: string | null } | null
      plan?: { id: string; production_month: string; status: ProductionMonthPlanStatus } | null
      requested_by_user?: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    }
    if (!request.machine || !request.plan) throw new Error('Запрос повреждён')

    const { data: itemsData, error: itemsError } = await db
      .from('production_plan_date_change_request_items')
      .select('id, target_type, production_stage_id, outsourcing_operation_id, stage_type, field_name, old_value, new_value, status')
      .eq('request_id', request.id)
      .order('sort_order', { ascending: true })

    if (itemsError) throw new Error(itemsError.message || 'Не удалось загрузить изменения')

    let factory: { id: string; name: string } | null = null
    if (request.machine.factory_id) {
      const { data: factoryData } = await db
        .from('factories')
        .select('id, name')
        .eq('id', request.machine.factory_id)
        .maybeSingle()
      factory = (factoryData as { id: string; name: string } | null) || null
    }

    return {
      data: {
        request: {
          id: request.id,
          status: request.status,
          comment: request.comment,
          decision_comment: request.decision_comment,
          created_at: request.created_at,
          machine: request.machine,
          factory,
          plan: request.plan,
          requested_by_user: relationOne(request.requested_by_user),
        },
        items: (itemsData || []) as ProductionPlanDateChangeApprovalItem[],
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

async function loadRequestWithTask(db: LooseDb, requestId: string) {
  const { data, error } = await db
    .from('production_plan_date_change_requests')
    .select(`
      *,
      task:tasks(id, assigned_to, status, task_type),
      machine:machines(id, name, factory_id, production_month),
      plan:production_month_plans(id, production_month, status)
    `)
    .eq('id', requestId)
    .maybeSingle()

  if (error || !data) throw new Error(error?.message || 'Запрос не найден')
  return data as DateChangeRequestRow & {
    task?: TaskRow | TaskRow[] | null
    machine?: { id: string; name: string; factory_id: string | null; production_month: string | null } | null
    plan?: { id: string; production_month: string; status: ProductionMonthPlanStatus } | null
  }
}

async function loadRequestItems(db: LooseDb, requestId: string) {
  const { data, error } = await db
    .from('production_plan_date_change_request_items')
    .select('*')
    .eq('request_id', requestId)
    .order('sort_order', { ascending: true })

  if (error) throw new Error(error.message || 'Не удалось загрузить изменения запроса')
  return (data || []) as DateChangeItemRow[]
}

async function findApprovalConflicts(db: LooseDb, machineId: string, items: DateChangeItemRow[]) {
  const conflicts: string[] = []
  const stageIds = items.map((item) => item.production_stage_id).filter((id): id is string => Boolean(id))
  const outsourcingOperationIds = items.map((item) => item.outsourcing_operation_id).filter((id): id is string => Boolean(id))
  const stagesById = new Map<string, Record<string, unknown>>()
  const outsourcingById = new Map<string, Record<string, unknown>>()

  if (stageIds.length > 0) {
    const { data, error } = await db
      .from('production_stages')
      .select('id, date_start, date_end, night_shift_date')
      .in('id', stageIds)
    if (error) throw new Error(error.message || 'Не удалось проверить текущие даты этапов')
    for (const stage of (data || []) as Array<Record<string, unknown> & { id: string }>) {
      stagesById.set(stage.id, stage)
    }
  }

  if (outsourcingOperationIds.length > 0) {
    const { data, error } = await db
      .from('machine_outsourcing_operations')
      .select('id, planned_send_date, planned_return_date')
      .in('id', outsourcingOperationIds)
    if (error) throw new Error(error.message || 'Не удалось проверить текущие даты аутсорсинга')
    for (const operation of (data || []) as Array<Record<string, unknown> & { id: string }>) {
      outsourcingById.set(operation.id, operation)
    }
  }

  const machineItems = items.filter((item) => item.target_type === 'machine')
  let machine: Record<string, unknown> | null = null
  if (machineItems.length > 0) {
    const { data, error } = await db
      .from('machines')
      .select('planned_material_date')
      .eq('id', machineId)
      .maybeSingle()
    if (error) throw new Error(error.message || 'Не удалось проверить текущие даты машины')
    machine = (data as Record<string, unknown> | null) || null
  }

  for (const item of items) {
    const source = item.target_type === 'machine'
      ? machine
      : item.target_type === 'stage'
        ? item.production_stage_id ? stagesById.get(item.production_stage_id) || null : null
        : item.outsourcing_operation_id ? outsourcingById.get(item.outsourcing_operation_id) || null : null
    const currentValue = dateOnly(source?.[item.field_name] as string | null | undefined)
    if (currentValue !== dateOnly(item.old_value)) {
      conflicts.push(`${fieldLabel(item)}: было в запросе ${formatDate(item.old_value)}, сейчас ${formatDate(currentValue)}`)
    }
  }

  return conflicts
}

async function applyRequestItems(db: LooseDb, items: DateChangeItemRow[]) {
  for (const item of items) {
    if (item.target_type === 'machine') {
      const { error } = await db
        .from('machines')
        .update({ [item.field_name]: dateOnly(item.new_value) })
        .eq('id', item.machine_id)
      if (error) throw new Error(error.message || 'Не удалось обновить дату машины')
      continue
    }

    if (item.target_type === 'stage') {
      if (!item.production_stage_id) throw new Error('В запросе не указан этап')
      const value = dateOnly(item.new_value)
      const patch = item.field_name === 'night_shift_date'
        ? {
            night_shift_date: value,
            night_shift_dates: normalizeNightShiftDates([], value),
            is_night_shift: Boolean(value),
          }
        : { [item.field_name]: value }
      const { error } = await db
        .from('production_stages')
        .update(patch)
        .eq('id', item.production_stage_id)
      if (error) throw new Error(error.message || 'Не удалось обновить дату этапа')
      continue
    }

    if (!item.outsourcing_operation_id) throw new Error('В запросе не указана операция аутсорсинга')
    const value = dateOnly(item.new_value)
    const patch = item.field_name === 'planned_return_date'
      ? {
          planned_return_date: value,
          supply_terms_confirmed_at: null,
          supply_terms_confirmed_by: null,
        }
      : { [item.field_name]: value }
    const { error } = await db
      .from('machine_outsourcing_operations')
      .update(patch)
      .eq('id', item.outsourcing_operation_id)
    if (error) throw new Error(error.message || 'Не удалось обновить дату аутсорсинга')
  }
}

export async function decideProductionPlanDateChangeRequest(input: {
  requestId: string
  decision: 'approved' | 'rejected'
  comment?: string | null
}) {
  try {
    const parsed = decideRequestSchema.parse(input)
    const context = await requirePermission('tasks', 'manage')
    const db = dbFrom(createAdminClient())
    const request = await loadRequestWithTask(db, parsed.requestId)
    const task = relationOne(request.task)
    if (!task) throw new Error('Задача согласования не найдена')
    if (task.assigned_to !== context.userId && !isDirector(context.role)) throw new Error('Недостаточно прав')
    if (request.status !== 'pending') throw new Error('Запрос уже обработан')
    if (!request.machine || !request.plan) throw new Error('Запрос повреждён')

    const items = await loadRequestItems(db, request.id)
    const now = new Date().toISOString()

    if (parsed.decision === 'rejected') {
      const { error: requestError } = await db
        .from('production_plan_date_change_requests')
        .update({
          status: 'rejected',
          decided_by: context.userId,
          decided_at: now,
          decision_comment: parsed.comment || null,
        })
        .eq('id', request.id)
      if (requestError) throw new Error(requestError.message || 'Не удалось отклонить запрос')

      await db.from('production_plan_date_change_request_items').update({ status: 'rejected', decided_at: now }).eq('request_id', request.id)
      await db.from('tasks').update({ status: 'completed', completed_at: now, updated_at: now }).eq('id', task.id)

      await createSystemMachineChatMessage({
        machineId: request.machine.id,
        body: [
          'Запрос на изменение дат подтверждённого плана отклонён.',
          `Месяц: ${formatProductionMonth(request.plan.production_month)}.`,
          parsed.comment ? `Причина: ${parsed.comment}.` : 'Причина не указана.',
          `Текущая дата: ${todayLabel()}.`,
        ].join('\n'),
        eventKey: `production_plan_date_change_rejected:${request.id}`,
        excludeUserId: context.userId,
      })

      revalidatePath(ROUTES.PRODUCTION)
      revalidatePath(ROUTES.TASKS)
      revalidatePath(`${ROUTES.SALES_PLAN}/${request.machine.id}`)
      return { success: true, outcome: 'rejected' as const, error: null }
    }

    const conflicts = await findApprovalConflicts(db, request.machine.id, items)
    if (conflicts.length > 0) {
      const conflictMessage = `Текущие даты уже отличаются от запроса. Создайте новый запрос.\n${conflicts.join('\n')}`
      await db
        .from('production_plan_date_change_requests')
        .update({
          status: 'conflicted',
          decided_by: context.userId,
          decided_at: now,
          decision_comment: conflictMessage,
        })
        .eq('id', request.id)
      await db.from('production_plan_date_change_request_items').update({ status: 'conflicted', decided_at: now }).eq('request_id', request.id)
      await db.from('tasks').update({ status: 'completed', completed_at: now, updated_at: now }).eq('id', task.id)

      await createSystemMachineChatMessage({
        machineId: request.machine.id,
        body: [
          'Запрос на изменение дат не применён из-за конфликта.',
          `Месяц: ${formatProductionMonth(request.plan.production_month)}.`,
          conflictMessage,
          `Текущая дата: ${todayLabel()}.`,
        ].join('\n'),
        eventKey: `production_plan_date_change_conflicted:${request.id}`,
        excludeUserId: context.userId,
      })

      revalidatePath(ROUTES.PRODUCTION)
      revalidatePath(ROUTES.TASKS)
      revalidatePath(`${ROUTES.SALES_PLAN}/${request.machine.id}`)
      return { success: true, outcome: 'conflicted' as const, error: null }
    }

    await applyRequestItems(db, items)
    if (items.some((item) => item.stage_type === 'shipping' && item.field_name === 'date_end')) {
      await syncTransportCostTask(db, request.machine.id)
    }
    const galvanizingStageIds = Array.from(new Set(items
      .filter((item) => item.stage_type === 'galvanizing' && (item.field_name === 'date_start' || item.field_name === 'date_end'))
      .map((item) => item.production_stage_id)
      .filter((id): id is string => Boolean(id))))
    for (const stageId of galvanizingStageIds) {
      const { data: stageData } = await db
        .from('production_stages')
        .select('date_start, date_end')
        .eq('id', stageId)
        .maybeSingle()
      const stage = stageData as { date_start: string | null; date_end: string | null } | null
      if (stage) {
        await syncZincOutsourcingFromStage(request.machine.id, { dateStart: stage.date_start, dateEnd: stage.date_end }, context.userId)
      }
    }
    if (items.some((item) => item.target_type === 'outsourcing') && request.machine.factory_id && request.plan.production_month) {
      await syncOutsourcingTransportForProductionPlan(request.machine.factory_id, request.plan.production_month, 'confirmed', context.userId)
    }

    const { error: requestError } = await db
      .from('production_plan_date_change_requests')
      .update({
        status: 'approved',
        decided_by: context.userId,
        decided_at: now,
        decision_comment: parsed.comment || null,
      })
      .eq('id', request.id)
    if (requestError) throw new Error(requestError.message || 'Не удалось одобрить запрос')

    await db.from('production_plan_date_change_request_items').update({ status: 'approved', decided_at: now }).eq('request_id', request.id)
    await db.from('tasks').update({ status: 'completed', completed_at: now, updated_at: now }).eq('id', task.id)

    await createSystemMachineChatMessage({
      machineId: request.machine.id,
      body: [
        'Запрос на изменение дат подтверждённого плана одобрен.',
        `Месяц: ${formatProductionMonth(request.plan.production_month)}.`,
        ...items.map(formatChangeLine),
        parsed.comment ? `Комментарий: ${parsed.comment}.` : null,
        `Текущая дата: ${todayLabel()}.`,
      ].filter(Boolean).join('\n'),
      eventKey: `production_plan_date_change_approved:${request.id}`,
      excludeUserId: context.userId,
    })

    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.TASKS)
    revalidatePath(`${ROUTES.SALES_PLAN}/${request.machine.id}`)
    return { success: true, outcome: 'approved' as const, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}
