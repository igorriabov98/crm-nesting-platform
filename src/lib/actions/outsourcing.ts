'use server'

import { revalidatePath } from 'next/cache'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import { hasPermission } from '@/lib/permissions/resources'
import { ROUTES } from '@/lib/constants/routes'
import { STAGE_ORDER } from '@/lib/constants/stages'
import { isDirector } from '@/lib/utils/permissions'
import { formatProductionMonth, normalizeProductionMonthValue } from '@/lib/utils/production-months'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import { createSystemMachineChatMessage } from '@/lib/actions/machine-activity'
import { dispatchPendingTelegramDeliveries } from '@/lib/services/task-notifications'
import type { CoatingType, ProductionMonthPlanStatus, StageType, UserRole } from '@/lib/types'

type DbResult = { data: unknown; error: { message?: string; code?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  upsert: (values: unknown, options?: { onConflict?: string }) => LooseQuery
  delete: () => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  neq: (column: string, value: unknown) => LooseQuery
  ilike: (column: string, pattern: string) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  not: (column: string, operator: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  maybeSingle: () => Promise<DbResult>
  single: () => Promise<DbResult>
}
type LooseDb = { from: (table: string) => LooseQuery }

type ExecutorType = 'supplier' | 'factory'
type TransportDirection = 'outbound' | 'return'
type TransportPlanState = 'preliminary' | 'confirmed'
type TransportNeedStatus = 'open' | 'linked' | 'completed' | 'cancelled'
type TransportOrderStatus = 'needed' | 'found' | 'in_transit' | 'completed' | 'cancelled'

type MachineRow = {
  id: string
  name: string
  factory_id: string | null
  production_month: string | null
  is_archived?: boolean | null
}

type SupplierBaseOption = {
  id: string
  name: string
  is_active: boolean
}

export type OutsourcingWorkType = {
  id: string
  code: string | null
  name: string
  description: string | null
  is_zinc: boolean
  is_active: boolean
}

export type OutsourcingMachineItem = {
  id: string
  drawing_number: string
  product_name: string
  quantity: number
  weight: number
  coating: CoatingType
  ral_number: string | null
  sort_order: number
}

export type OutsourcingSupplierOption = {
  id: string
  name: string
  can_outsource: boolean
  can_transport: boolean
  is_active: boolean
}

export type OutsourcingFactoryOption = {
  id: string
  name: string
}

export type MachineOutsourcingTransportNeed = {
  id: string
  operation_id: string
  direction: TransportDirection
  plan_state: TransportPlanState
  status: TransportNeedStatus
  needed_date: string
  task_id: string | null
  transport_order_id: string | null
}

export type MachineOutsourcingTransportOrder = {
  id: string
  direction: TransportDirection
  status: TransportOrderStatus
  carrier_supplier_id: string | null
  carrier_name: string | null
  scheduled_date: string | null
  price: number | null
  comment: string | null
}

export type MachineOutsourcingOperation = {
  id: string
  machine_id: string
  work_type_id: string
  work_type_name: string
  position_after_stage_type: StageType | null
  source_stage_type: StageType | null
  is_zinc_operation: boolean
  executor_type: ExecutorType
  supplier_id: string | null
  supplier_name: string | null
  executor_factory_id: string | null
  executor_factory_name: string | null
  note: string | null
  planned_send_date: string | null
  planned_return_date: string | null
  actual_sent_at: string | null
  actual_returned_at: string | null
  service_cost_planned: number | null
  service_cost_actual: number | null
  supply_terms_confirmed_at: string | null
  supply_terms_confirmed_by: string | null
  incoming_production_month: string | null
  incoming_workshop: number | null
  incoming_queue_number: number | null
  incoming_date_start: string | null
  incoming_date_end: string | null
  items: OutsourcingMachineItem[]
  needs: MachineOutsourcingTransportNeed[]
}

export type MachineOutsourcingData = {
  machine: MachineRow
  planStatus: ProductionMonthPlanStatus
  canManage: boolean
  canManageDatesDirectly: boolean
  workTypes: OutsourcingWorkType[]
  suppliers: OutsourcingSupplierOption[]
  transportSuppliers: OutsourcingSupplierOption[]
  factories: OutsourcingFactoryOption[]
  items: OutsourcingMachineItem[]
  operations: MachineOutsourcingOperation[]
  zincDefault: {
    factory_id: string
    executor_type: ExecutorType
    supplier_id: string | null
    executor_factory_id: string | null
  } | null
}

export type ProductionOutsourcingSummaryOperation = MachineOutsourcingOperation & {
  machine_name: string
  source_factory_id: string | null
  source_factory_name: string | null
}

export type ProductionOutsourcingSummary = {
  outgoing: ProductionOutsourcingSummaryOperation[]
  incoming: ProductionOutsourcingSummaryOperation[]
}

export type TransportWorkspaceNeed = MachineOutsourcingTransportNeed & {
  machine_id: string
  machine_name: string
  source_factory_id: string | null
  source_factory_name: string | null
  work_type_name: string
  executor_label: string
  item_labels: string[]
}

export type TransportWorkspaceOrder = MachineOutsourcingTransportOrder & {
  needs: TransportWorkspaceNeed[]
}

export type SupplyOutsourcingAgreement = {
  operation_id: string
  machine_id: string
  machine_name: string
  source_factory_name: string | null
  work_type_name: string
  supplier_name: string | null
  planned_send_date: string | null
  planned_return_date: string | null
  service_cost_planned: number | null
  supply_terms_confirmed_at: string | null
}

export type OutsourcingTransportWorkspace = {
  agreements: SupplyOutsourcingAgreement[]
  needs: TransportWorkspaceNeed[]
  orders: TransportWorkspaceOrder[]
  carriers: OutsourcingSupplierOption[]
}

const executorTypeSchema = z.enum(['supplier', 'factory'])
const dateValueSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()

const operationSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  machineId: z.string().uuid(),
  workTypeId: z.string().uuid().nullable().optional(),
  workTypeName: z.string().trim().min(1).max(120).nullable().optional(),
  positionAfterStageType: z.enum(STAGE_ORDER as [StageType, ...StageType[]]).nullable().optional(),
  executorType: executorTypeSchema,
  supplierId: z.string().uuid().nullable().optional(),
  executorFactoryId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  plannedSendDate: dateValueSchema,
  plannedReturnDate: dateValueSchema,
  itemIds: z.array(z.string().uuid()).min(1),
}).refine((value) => Boolean(value.workTypeId || value.workTypeName), {
  message: 'Выберите тип работы или введите свой',
  path: ['workTypeId'],
})

const zincDefaultSchema = z.object({
  factoryId: z.string().uuid(),
  executorType: executorTypeSchema,
  supplierId: z.string().uuid().nullable().optional(),
  executorFactoryId: z.string().uuid().nullable().optional(),
})

const incomingPlanSchema = z.object({
  operationId: z.string().uuid(),
  incomingProductionMonth: dateValueSchema,
  incomingWorkshop: z.number().int().positive().nullable().optional(),
  incomingQueueNumber: z.number().int().positive().nullable().optional(),
  incomingDateStart: dateValueSchema,
  incomingDateEnd: dateValueSchema,
})

const createOrderSchema = z.object({
  needIds: z.array(z.string().uuid()).min(1),
  carrierSupplierId: z.string().uuid().nullable().optional(),
  scheduledDate: dateValueSchema,
  price: z.number().min(0).nullable().optional(),
  comment: z.string().trim().max(1000).nullable().optional(),
})

const updateOrderSchema = z.object({
  orderId: z.string().uuid(),
  status: z.enum(['needed', 'found', 'in_transit', 'completed', 'cancelled']).optional(),
  carrierSupplierId: z.string().uuid().nullable().optional(),
  scheduledDate: dateValueSchema,
  price: z.number().min(0).nullable().optional(),
  comment: z.string().trim().max(1000).nullable().optional(),
})

const supplyTermsSchema = z.object({
  operationId: z.string().uuid(),
  plannedReturnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  serviceCostPlanned: z.number().min(0).nullable().optional(),
})

function dbFrom(value: unknown): LooseDb {
  return value as LooseDb
}

function dateOnly(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10)
}

function normalizeMonthOrNull(value: string | null | undefined) {
  return normalizeProductionMonthValue(value)
}

function normalizeWorkTypeName(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

function isMissingSupplierCapabilityColumns(error: DbResult['error']) {
  const message = error?.message || ''
  return error?.code === '42703'
    || /suppliers\.can_(outsource|transport)/i.test(message)
    || /column .*can_(outsource|transport).* does not exist/i.test(message)
}

function withLegacySupplierCapabilities(suppliers: SupplierBaseOption[]) {
  return suppliers.map((supplier) => ({
    ...supplier,
    can_outsource: true,
    can_transport: true,
  }))
}

function formatDate(value: string | null | undefined) {
  const date = dateOnly(value)
  if (!date) return 'не указана'
  const [year, month, day] = date.split('-').map(Number)
  return format(new Date(year, month - 1, day), 'dd.MM.yyyy', { locale: ru })
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function isProductionManagerScoped(role: UserRole, userFactoryId: string | null, factoryId: string | null) {
  return role !== 'production_manager' || Boolean(factoryId && userFactoryId === factoryId)
}

function canManageSource(
  role: UserRole,
  userFactoryId: string | null,
  factoryId: string | null,
  isAdminPosition = false,
) {
  return isAdminPosition
    || isDirector(role)
    || role === 'sales_manager'
    || Boolean(factoryId && userFactoryId === factoryId)
}

async function getMachineOrThrow(db: LooseDb, machineId: string) {
  const { data, error } = await db
    .from('machines')
    .select('id, name, factory_id, production_month, is_archived')
    .eq('id', machineId)
    .maybeSingle()

  if (error || !data) throw new Error(error?.message || 'Машина не найдена')
  const machine = data as MachineRow
  if (machine.is_archived) throw new Error('Машина архивирована')
  return machine
}

async function getProductionPlanStatus(db: LooseDb, machine: Pick<MachineRow, 'factory_id' | 'production_month'>) {
  const productionMonth = normalizeMonthOrNull(machine.production_month)
  if (!machine.factory_id || !productionMonth) return 'draft' as ProductionMonthPlanStatus

  const { data, error } = await db
    .from('production_month_plans')
    .select('status')
    .eq('factory_id', machine.factory_id)
    .eq('production_month', productionMonth)
    .maybeSingle()

  if (error) throw new Error(error.message || 'Не удалось проверить статус плана')
  return ((data as { status?: ProductionMonthPlanStatus } | null)?.status || 'draft') as ProductionMonthPlanStatus
}

async function requireMachineOutsourcingAccess(machineId: string, manage = false) {
  const context = await requirePermission('production', manage ? 'manage' : 'view')
  const db = dbFrom(createAdminClient())
  const machine = await getMachineOrThrow(db, machineId)
  const planStatus = await getProductionPlanStatus(db, machine)
  const canManage = hasPermission(context.permissions, 'production', 'manage')
    && canManageSource(context.role, context.factoryId, machine.factory_id, context.permissionDetails.isAdminPosition)

  if (manage && !canManage) throw new Error('Недостаточно прав для управления аутсорсингом')
  if (!canManage && context.role === 'production_manager' && !isProductionManagerScoped(context.role, context.factoryId, machine.factory_id)) {
    throw new Error('Доступ запрещён')
  }

  return { db, context, machine, planStatus, canManage }
}

async function requireExecutorFactoryAccess(operationId: string) {
  const context = await requirePermission('production_fact', 'manage')
  const db = dbFrom(createAdminClient())
  const { data, error } = await db
    .from('machine_outsourcing_operations')
    .select('id, executor_type, executor_factory_id, machine_id, archived_at')
    .eq('id', operationId)
    .maybeSingle()

  if (error || !data) throw new Error(error?.message || 'Операция аутсорсинга не найдена')
  const operation = data as { id: string; executor_type: ExecutorType; executor_factory_id: string | null; machine_id: string; archived_at: string | null }
  if (operation.archived_at) throw new Error('Операция архивирована')
  if (operation.executor_type !== 'factory' || !operation.executor_factory_id) throw new Error('Это не внутренняя работа завода')
  if (!canManageSource(context.role, context.factoryId, operation.executor_factory_id, context.permissionDetails.isAdminPosition)) {
    throw new Error('Недостаточно прав для управления входящей работой')
  }

  return { db, context, operation }
}

async function findSupplyDepartmentHead(db: LooseDb) {
  const { data: departmentsData, error: departmentsError } = await db
    .from('departments')
    .select('id, name, head_user_id, is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (departmentsError) throw new Error(departmentsError.message || 'Не удалось найти отдел снабжения')

  const departments = ((departmentsData || []) as Array<{ id: string; name: string | null; head_user_id: string | null }>)
    .filter((department) => {
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
    if (user && user.is_active !== false) return department.head_user_id
  }

  if (departments.length > 0) {
    const { data: membersData, error: membersError } = await db
      .from('department_members')
      .select('user_id, department_id, is_department_head, user:users!department_members_user_id_fkey(id, is_active)')
      .in('department_id', departments.map((department) => department.id))
      .eq('is_department_head', true)

    if (membersError) throw new Error(membersError.message || 'Не удалось найти руководителя снабжения')
    for (const member of (membersData || []) as Array<{ user_id: string; user?: { id: string; is_active: boolean | null } | { id: string; is_active: boolean | null }[] | null }>) {
      const user = relationOne(member.user)
      if (user?.is_active !== false) return member.user_id
    }
  }

  const { data: usersData, error: usersError } = await db
    .from('users')
    .select('id, role, is_active')
    .eq('role', 'procurement_head')
    .eq('is_active', true)
    .limit(1)

  if (usersError) throw new Error(usersError.message || 'Не удалось проверить руководителя снабжения')
  const fallback = ((usersData || []) as Array<{ id: string }>)[0]
  if (fallback) return fallback.id

  throw new Error('Не найден руководитель активного отдела снабжения/закупок. Настройте руководителя отдела или пользователя с ролью начальника снабжения.')
}

async function loadWorkTypes(db: LooseDb) {
  const { data, error } = await db
    .from('outsourcing_work_types')
    .select('id, code, name, description, is_zinc, is_active')
    .eq('is_active', true)
    .order('name')
  if (error) throw new Error(error.message || 'Не удалось загрузить типы работ')
  return (data || []) as OutsourcingWorkType[]
}

async function resolveWorkTypeId(db: LooseDb, workTypeId?: string | null, workTypeName?: string | null) {
  if (workTypeId) return workTypeId

  const name = normalizeWorkTypeName(workTypeName || '')
  if (!name) throw new Error('Введите тип работы')

  const { data: existingData, error: existingError } = await db
    .from('outsourcing_work_types')
    .select('id, is_active')
    .ilike('name', escapeLikePattern(name))
    .limit(1)
    .maybeSingle()
  if (existingError) throw new Error(existingError.message || 'Не удалось проверить тип работы')

  const existing = existingData as { id: string; is_active: boolean } | null
  if (existing) {
    if (!existing.is_active) {
      const { error: activateError } = await db
        .from('outsourcing_work_types')
        .update({ is_active: true })
        .eq('id', existing.id)
      if (activateError) throw new Error(activateError.message || 'Не удалось восстановить тип работы')
    }
    return existing.id
  }

  const { data, error } = await db
    .from('outsourcing_work_types')
    .insert({ name, code: null, is_active: true })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message || 'Не удалось добавить тип работы')
  return (data as { id: string }).id
}

async function loadSuppliers(db: LooseDb) {
  const { data, error } = await db
    .from('suppliers')
    .select('id, name, can_outsource, can_transport, is_active')
    .eq('is_active', true)
    .order('name')
  if (error && !isMissingSupplierCapabilityColumns(error)) throw new Error(error.message || 'Не удалось загрузить поставщиков')
  if (error) {
    const fallback = await db
      .from('suppliers')
      .select('id, name, is_active')
      .eq('is_active', true)
      .order('name')
    if (fallback.error) throw new Error(fallback.error.message || 'Не удалось загрузить поставщиков')
    return withLegacySupplierCapabilities((fallback.data || []) as SupplierBaseOption[])
  }
  return (data || []) as OutsourcingSupplierOption[]
}

async function loadSuppliersByIds(db: LooseDb, supplierIds: string[]): Promise<DbResult> {
  if (supplierIds.length === 0) return { data: [], error: null }
  const result = await db
    .from('suppliers')
    .select('id, name, can_outsource, can_transport, is_active')
    .in('id', supplierIds)
  if (!result.error || !isMissingSupplierCapabilityColumns(result.error)) return result

  const fallback = await db
    .from('suppliers')
    .select('id, name, is_active')
    .in('id', supplierIds)
  if (fallback.error) return fallback
  return {
    data: withLegacySupplierCapabilities((fallback.data || []) as SupplierBaseOption[]),
    error: null,
  }
}

async function loadFactories(db: LooseDb) {
  const { data, error } = await db.from('factories').select('id, name').order('name')
  if (error) throw new Error(error.message || 'Не удалось загрузить заводы')
  return (data || []) as OutsourcingFactoryOption[]
}

async function loadMachineItems(db: LooseDb, machineId: string) {
  const { data, error } = await db
    .from('machine_items')
    .select('id, drawing_number, product_name, quantity, weight, coating, ral_number, sort_order')
    .eq('machine_id', machineId)
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message || 'Не удалось загрузить товары машины')
  return (data || []) as OutsourcingMachineItem[]
}

async function loadZincDefault(db: LooseDb, factoryId: string | null) {
  if (!factoryId) return null
  const { data, error } = await db
    .from('factory_zinc_outsourcing_defaults')
    .select('factory_id, executor_type, supplier_id, executor_factory_id')
    .eq('factory_id', factoryId)
    .maybeSingle()
  if (error) throw new Error(error.message || 'Не удалось загрузить настройку цинка')
  return data as MachineOutsourcingData['zincDefault']
}

async function loadOperationsByMachineIds(db: LooseDb, machineIds: string[]) {
  if (machineIds.length === 0) return [] as MachineOutsourcingOperation[]
  const { data: operationsData, error: operationsError } = await db
    .from('machine_outsourcing_operations')
    .select('*')
    .in('machine_id', machineIds)
    .is('archived_at', null)
    .order('created_at', { ascending: true })
  if (operationsError) throw new Error(operationsError.message || 'Не удалось загрузить операции аутсорсинга')

  return hydrateOperations(db, (operationsData || []) as Array<Record<string, unknown> & { id: string; machine_id: string }>)
}

async function hydrateOperations(db: LooseDb, rawOperations: Array<Record<string, unknown> & { id: string; machine_id: string }>) {
  if (rawOperations.length === 0) return [] as MachineOutsourcingOperation[]

  const operationIds = rawOperations.map((operation) => operation.id)
  const workTypeIds = Array.from(new Set(rawOperations.map((operation) => operation.work_type_id).filter((id): id is string => typeof id === 'string')))
  const supplierIds = Array.from(new Set(rawOperations.map((operation) => operation.supplier_id).filter((id): id is string => typeof id === 'string')))
  const factoryIds = Array.from(new Set(rawOperations.map((operation) => operation.executor_factory_id).filter((id): id is string => typeof id === 'string')))
  const machineIds = Array.from(new Set(rawOperations.map((operation) => operation.machine_id)))

  const [workTypesRes, suppliersRes, factoriesRes, itemLinksRes, needsRes, itemsRes] = await Promise.all([
    workTypeIds.length > 0 ? db.from('outsourcing_work_types').select('id, name, code, is_zinc, is_active').in('id', workTypeIds) : Promise.resolve({ data: [], error: null }),
    loadSuppliersByIds(db, supplierIds),
    factoryIds.length > 0 ? db.from('factories').select('id, name').in('id', factoryIds) : Promise.resolve({ data: [], error: null }),
    db.from('machine_outsourcing_operation_items').select('operation_id, machine_item_id').in('operation_id', operationIds),
    db.from('machine_outsourcing_transport_needs').select('*').in('operation_id', operationIds),
    db
      .from('machine_items')
      .select('id, machine_id, drawing_number, product_name, quantity, weight, coating, ral_number, sort_order')
      .in('machine_id', machineIds)
      .order('sort_order', { ascending: true }),
  ])

  for (const result of [workTypesRes, suppliersRes, factoriesRes, itemLinksRes, needsRes, itemsRes]) {
    if (result.error) throw new Error(result.error.message || 'Не удалось загрузить данные аутсорсинга')
  }

  const workTypeById = new Map(((workTypesRes.data || []) as Array<{ id: string; name: string }>).map((row) => [row.id, row]))
  const supplierById = new Map(((suppliersRes.data || []) as Array<{ id: string; name: string }>).map((row) => [row.id, row]))
  const factoryById = new Map(((factoriesRes.data || []) as Array<{ id: string; name: string }>).map((row) => [row.id, row]))
  const itemById = new Map(((itemsRes.data || []) as Array<OutsourcingMachineItem & { machine_id: string }>).map((row) => {
    const { machine_id: _machineId, ...item } = row
    void _machineId
    return [row.id, item as OutsourcingMachineItem]
  }))
  const linksByOperation = new Map<string, string[]>()
  for (const link of (itemLinksRes.data || []) as Array<{ operation_id: string; machine_item_id: string }>) {
    linksByOperation.set(link.operation_id, [...(linksByOperation.get(link.operation_id) || []), link.machine_item_id])
  }
  const needsByOperation = new Map<string, MachineOutsourcingTransportNeed[]>()
  for (const need of (needsRes.data || []) as MachineOutsourcingTransportNeed[]) {
    needsByOperation.set(need.operation_id, [...(needsByOperation.get(need.operation_id) || []), need])
  }

  return rawOperations.map((operation) => {
    const supplierId = operation.supplier_id as string | null
    const executorFactoryId = operation.executor_factory_id as string | null
    const itemIds = linksByOperation.get(operation.id) || []
    return {
      id: operation.id,
      machine_id: operation.machine_id,
      work_type_id: operation.work_type_id as string,
      work_type_name: workTypeById.get(operation.work_type_id as string)?.name || 'Аутсорсинг',
      position_after_stage_type: operation.position_after_stage_type as StageType | null,
      source_stage_type: operation.source_stage_type as StageType | null,
      is_zinc_operation: Boolean(operation.is_zinc_operation),
      executor_type: operation.executor_type as ExecutorType,
      supplier_id: supplierId,
      supplier_name: supplierId ? supplierById.get(supplierId)?.name || null : null,
      executor_factory_id: executorFactoryId,
      executor_factory_name: executorFactoryId ? factoryById.get(executorFactoryId)?.name || null : null,
      note: operation.note as string | null,
      planned_send_date: dateOnly(operation.planned_send_date as string | null),
      planned_return_date: dateOnly(operation.planned_return_date as string | null),
      actual_sent_at: dateOnly(operation.actual_sent_at as string | null),
      actual_returned_at: dateOnly(operation.actual_returned_at as string | null),
      service_cost_planned: operation.service_cost_planned == null ? null : Number(operation.service_cost_planned),
      service_cost_actual: operation.service_cost_actual == null ? null : Number(operation.service_cost_actual),
      supply_terms_confirmed_at: operation.supply_terms_confirmed_at as string | null,
      supply_terms_confirmed_by: operation.supply_terms_confirmed_by as string | null,
      incoming_production_month: dateOnly(operation.incoming_production_month as string | null),
      incoming_workshop: operation.incoming_workshop == null ? null : Number(operation.incoming_workshop),
      incoming_queue_number: operation.incoming_queue_number == null ? null : Number(operation.incoming_queue_number),
      incoming_date_start: dateOnly(operation.incoming_date_start as string | null),
      incoming_date_end: dateOnly(operation.incoming_date_end as string | null),
      items: itemIds.map((id) => itemById.get(id)).filter((item): item is OutsourcingMachineItem => Boolean(item)),
      needs: (needsByOperation.get(operation.id) || []).sort((a, b) => a.direction.localeCompare(b.direction)),
    } satisfies MachineOutsourcingOperation
  })
}

async function ensureSelectedItemsBelongToMachine(db: LooseDb, machineId: string, itemIds: string[]) {
  const uniqueItemIds = Array.from(new Set(itemIds))
  const { data, error } = await db
    .from('machine_items')
    .select('id')
    .eq('machine_id', machineId)
    .in('id', uniqueItemIds)

  if (error) throw new Error(error.message || 'Не удалось проверить товары')
  if (((data || []) as Array<{ id: string }>).length !== uniqueItemIds.length) {
    throw new Error('Один или несколько товаров не относятся к этой машине')
  }
  return uniqueItemIds
}

async function createNeedAndTask(
  db: LooseDb,
  operation: MachineOutsourcingOperation & { machine_name?: string; source_factory_name?: string | null },
  direction: TransportDirection,
  planState: TransportPlanState,
  assigneeId: string,
) {
  const usesExecutorFactoryDates = operation.executor_type === 'factory'
  const neededDate = direction === 'outbound'
    ? (usesExecutorFactoryDates ? operation.incoming_date_start : operation.planned_send_date)
    : (usesExecutorFactoryDates ? operation.incoming_date_end : operation.planned_return_date)
  if (!neededDate) return

  const directionLabel = direction === 'outbound' ? 'забрать с производства' : 'вернуть на производство'
  const planLabel = planState === 'preliminary' ? 'Дата предварительная' : 'План утверждён'
  const executorLabel = operation.executor_factory_name || operation.supplier_name || 'исполнитель не указан'
  const sourceLabel = operation.source_factory_name || 'исходное производство'
  const routeLabel = direction === 'outbound'
    ? `${sourceLabel} → ${executorLabel}`
    : `${executorLabel} → ${sourceLabel}`
  const itemLabel = operation.items.length > 0
    ? operation.items.map((item) => `${item.product_name} — ${item.quantity} шт.`).join('; ')
    : 'состав не указан'
  const title = planState === 'preliminary'
    ? `Предварительный транспорт аутсорсинга: ${operation.machine_name || 'машина'}`
    : `Найти транспорт аутсорсинга: ${operation.machine_name || 'машина'}`
  const description = [
    `${planLabel}.`,
    `Направление: ${directionLabel}.`,
    `Маршрут: ${routeLabel}.`,
    `Работа: ${operation.work_type_name}.`,
    operation.note ? `Описание работы: ${operation.note}.` : null,
    `Что забрать: ${operation.machine_name || 'машина'}; ${itemLabel}.`,
    `Дата: ${formatDate(neededDate)}.`,
    `Исполнитель: ${executorLabel}.`,
  ].filter(Boolean).join('\n')

  const { data: existingNeedData, error: existingNeedError } = await db
    .from('machine_outsourcing_transport_needs')
    .select('id, task_id, status')
    .eq('operation_id', operation.id)
    .eq('direction', direction)
    .eq('plan_state', planState)
    .in('status', ['open', 'linked'])
    .maybeSingle()

  if (existingNeedError) throw new Error(existingNeedError.message || 'Не удалось проверить транспортную потребность')
  const existingNeed = existingNeedData as { id: string; task_id: string | null; status: TransportNeedStatus } | null

  if (existingNeed) {
    const { error: needUpdateError } = await db
      .from('machine_outsourcing_transport_needs')
      .update({ needed_date: neededDate })
      .eq('id', existingNeed.id)
    if (needUpdateError) throw new Error(needUpdateError.message || 'Не удалось обновить транспортную потребность')

    if (existingNeed.task_id) {
      const { error: taskUpdateError } = await db
        .from('tasks')
        .update({
          assigned_to: assigneeId,
          title,
          description,
          start_date: neededDate,
          deadline: neededDate,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingNeed.task_id)
      if (taskUpdateError) throw new Error(taskUpdateError.message || 'Не удалось обновить задачу снабжения')
    }
    return
  }

  const { data: taskData, error: taskError } = await db
    .from('tasks')
    .insert({
      machine_id: operation.machine_id,
      assigned_to: assigneeId,
      task_type: 'outsourcing_transport',
      title,
      description,
      status: 'pending',
      start_date: neededDate,
      deadline: neededDate,
    })
    .select('id')
    .single()
  if (taskError || !taskData) throw new Error(taskError?.message || 'Не удалось создать задачу снабжения')
  const taskId = (taskData as { id: string }).id

  const { error: needError } = await db
    .from('machine_outsourcing_transport_needs')
    .insert({
      operation_id: operation.id,
      direction,
      plan_state: planState,
      status: 'open',
      needed_date: neededDate,
      task_id: taskId,
    })
  if (needError) throw new Error(needError.message || 'Не удалось создать транспортную потребность')
}

async function cancelActiveTransportNeed(
  db: LooseDb,
  operationId: string,
  direction: TransportDirection,
  planState: TransportPlanState,
) {
  const { data, error } = await db
    .from('machine_outsourcing_transport_needs')
    .select('id, task_id')
    .eq('operation_id', operationId)
    .eq('direction', direction)
    .eq('plan_state', planState)
    .in('status', ['open', 'linked'])
  if (error) throw new Error(error.message || 'Не удалось проверить транспортную потребность')

  const needs = (data || []) as Array<{ id: string; task_id: string | null }>
  if (needs.length === 0) return
  const now = new Date().toISOString()
  const { error: needError } = await db
    .from('machine_outsourcing_transport_needs')
    .update({ status: 'cancelled' })
    .in('id', needs.map((need) => need.id))
  if (needError) throw new Error(needError.message || 'Не удалось отменить транспортную потребность')

  const taskIds = needs.map((need) => need.task_id).filter((id): id is string => Boolean(id))
  if (taskIds.length > 0) {
    const { error: taskError } = await db
      .from('tasks')
      .update({ status: 'completed', completed_at: now, updated_at: now })
      .in('id', taskIds)
    if (taskError) throw new Error(taskError.message || 'Не удалось закрыть транспортную задачу')
  }
}

async function closePreliminaryTransport(db: LooseDb, operationIds: string[]) {
  if (operationIds.length === 0) return
  const { data: needsData, error: needsError } = await db
    .from('machine_outsourcing_transport_needs')
    .select('id, task_id')
    .in('operation_id', operationIds)
    .eq('plan_state', 'preliminary')
    .in('status', ['open', 'linked'])
  if (needsError) throw new Error(needsError.message || 'Не удалось закрыть предварительные транспортные потребности')

  const needs = (needsData || []) as Array<{ id: string; task_id: string | null }>
  if (needs.length === 0) return
  const now = new Date().toISOString()
  const { error: needUpdateError } = await db
    .from('machine_outsourcing_transport_needs')
    .update({ status: 'cancelled' })
    .in('id', needs.map((need) => need.id))
  if (needUpdateError) throw new Error(needUpdateError.message || 'Не удалось закрыть предварительные потребности')

  const taskIds = needs.map((need) => need.task_id).filter((id): id is string => Boolean(id))
  if (taskIds.length > 0) {
    const { error: taskUpdateError } = await db
      .from('tasks')
      .update({ status: 'completed', completed_at: now, updated_at: now })
      .in('id', taskIds)
    if (taskUpdateError) throw new Error(taskUpdateError.message || 'Не удалось закрыть предварительные задачи')
  }
}

async function loadOperationsForSourcePlan(db: LooseDb, factoryId: string, productionMonth: string) {
  const [{ data: machineData, error: machineError }, { data: factoryData, error: factoryError }] = await Promise.all([
    db
      .from('machines')
      .select('id, name')
      .eq('factory_id', factoryId)
      .eq('production_month', productionMonth)
      .eq('is_archived', false),
    db.from('factories').select('id, name').eq('id', factoryId).maybeSingle(),
  ])
  if (machineError) throw new Error(machineError.message || 'Не удалось загрузить машины плана')
  if (factoryError) throw new Error(factoryError.message || 'Не удалось загрузить исходный завод')
  const machines = (machineData || []) as Array<{ id: string; name: string }>
  const machineNameById = new Map(machines.map((machine) => [machine.id, machine.name]))
  const sourceFactoryName = (factoryData as { name?: string } | null)?.name || null
  const operations = await loadOperationsByMachineIds(db, machines.map((machine) => machine.id))
  return operations
    .filter((operation) => operation.executor_type === 'factory'
      ? Boolean(operation.incoming_date_start && operation.incoming_date_end)
      : Boolean(operation.planned_send_date && operation.planned_return_date))
    .map((operation) => ({
      ...operation,
      machine_name: machineNameById.get(operation.machine_id) || 'Машина',
      source_factory_name: sourceFactoryName,
    }))
}

async function syncConfirmedTransportForIncomingPlan(db: LooseDb, operationId: string) {
  const { data: rawOperationData, error: operationError } = await db
    .from('machine_outsourcing_operations')
    .select('*')
    .eq('id', operationId)
    .maybeSingle()
  if (operationError || !rawOperationData) {
    throw new Error(operationError?.message || 'Не удалось загрузить входящую работу для транспорта')
  }

  const [operation] = await hydrateOperations(
    db,
    [rawOperationData as Record<string, unknown> & { id: string; machine_id: string }],
  )
  if (!operation || operation.executor_type !== 'factory') return

  const machine = await getMachineOrThrow(db, operation.machine_id)
  let sourceFactoryName: string | null = null
  if (machine.factory_id) {
    const { data: factoryData, error: factoryError } = await db
      .from('factories')
      .select('id, name')
      .eq('id', machine.factory_id)
      .maybeSingle()
    if (factoryError) throw new Error(factoryError.message || 'Не удалось загрузить исходный завод')
    sourceFactoryName = (factoryData as { name?: string } | null)?.name || null
  }

  const enrichedOperation = {
    ...operation,
    machine_name: machine.name,
    source_factory_name: sourceFactoryName,
  }
  const supplyHeadId = await findSupplyDepartmentHead(db)

  if (operation.incoming_date_start) {
    await createNeedAndTask(db, enrichedOperation, 'outbound', 'confirmed', supplyHeadId)
  } else {
    await cancelActiveTransportNeed(db, operation.id, 'outbound', 'confirmed')
  }
  if (operation.incoming_date_end) {
    await createNeedAndTask(db, enrichedOperation, 'return', 'confirmed', supplyHeadId)
  } else {
    await cancelActiveTransportNeed(db, operation.id, 'return', 'confirmed')
  }

  await dispatchPendingTelegramDeliveries({ userId: supplyHeadId })
}

export async function syncOutsourcingTransportForProductionPlan(
  factoryId: string,
  productionMonth: string,
  planStatus: ProductionMonthPlanStatus,
  actorUserId?: string | null,
) {
  if (planStatus !== 'preliminary_ready' && planStatus !== 'confirmed') return

  const db = dbFrom(createAdminClient())
  const loadedOperations = await loadOperationsForSourcePlan(db, factoryId, productionMonth)
  const planState: TransportPlanState = planStatus === 'confirmed' ? 'confirmed' : 'preliminary'
  const operations = planState === 'preliminary'
    ? loadedOperations.filter((operation) => operation.executor_type === 'supplier')
    : loadedOperations
  if (operations.length === 0) return

  const supplyHeadId = await findSupplyDepartmentHead(db)

  if (planState === 'confirmed') {
    await closePreliminaryTransport(db, operations.map((operation) => operation.id))
  }

  for (const operation of operations) {
    await createNeedAndTask(db, operation, 'outbound', planState, supplyHeadId)
    await createNeedAndTask(db, operation, 'return', planState, supplyHeadId)
  }

  await dispatchPendingTelegramDeliveries({ userId: supplyHeadId })
  revalidatePath(ROUTES.SUPPLY_TRANSPORT)
  revalidatePath(ROUTES.TASKS)

  if (actorUserId) {
    for (const operation of operations) {
      await createSystemMachineChatMessage({
        machineId: operation.machine_id,
        body: planState === 'preliminary'
          ? `Созданы предварительные задачи снабжению на транспорт аутсорсинга. Месяц: ${formatProductionMonth(productionMonth)}.`
          : `Созданы утверждённые задачи снабжению на транспорт аутсорсинга. Месяц: ${formatProductionMonth(productionMonth)}.`,
        eventKey: `outsourcing_transport_plan:${operation.id}:${planState}`,
        excludeUserId: actorUserId,
      })
    }
  }
}

async function syncOutsourcingTransportForMachine(db: LooseDb, machine: MachineRow) {
  const productionMonth = normalizeMonthOrNull(machine.production_month)
  if (!machine.factory_id || !productionMonth) return
  const planStatus = await getProductionPlanStatus(db, machine)
  if (planStatus === 'draft') return
  await syncOutsourcingTransportForProductionPlan(machine.factory_id, productionMonth, planStatus)
}

export async function getMachineOutsourcingData(machineId: string): Promise<{ data: MachineOutsourcingData | null; error: string | null }> {
  try {
    const { db, context, machine, planStatus, canManage } = await requireMachineOutsourcingAccess(machineId)
    const [workTypes, suppliers, factories, items, operations, zincDefault] = await Promise.all([
      loadWorkTypes(db),
      loadSuppliers(db),
      loadFactories(db),
      loadMachineItems(db, machine.id),
      loadOperationsByMachineIds(db, [machine.id]),
      loadZincDefault(db, machine.factory_id),
    ])

    return {
      data: {
        machine,
        planStatus,
        canManage,
        canManageDatesDirectly: planStatus !== 'confirmed' || isDirector(context.role) || context.role === 'sales_manager',
        workTypes,
        suppliers: suppliers.filter((supplier) => supplier.can_outsource || supplier.can_transport),
        transportSuppliers: suppliers.filter((supplier) => supplier.can_transport),
        factories,
        items,
        operations,
        zincDefault,
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function saveOutsourcingOperation(input: z.infer<typeof operationSchema>) {
  try {
    const parsed = operationSchema.parse(input)
    const { db, context, machine, planStatus } = await requireMachineOutsourcingAccess(parsed.machineId, true)
    if (parsed.executorType === 'supplier' && !parsed.supplierId) throw new Error('Выберите поставщика-исполнителя')
    if (parsed.executorType === 'factory' && !parsed.executorFactoryId) throw new Error('Выберите завод-исполнитель')
    if (parsed.plannedSendDate && parsed.plannedReturnDate && parsed.plannedReturnDate < parsed.plannedSendDate) {
      throw new Error('Дата возврата не может быть раньше даты отправки')
    }

    let current: {
      planned_send_date: string | null
      planned_return_date: string | null
      work_type_id: string
      executor_type: ExecutorType
      supplier_id: string | null
    } | null = null
    if (parsed.id) {
      const { data: currentData, error: currentError } = await db
        .from('machine_outsourcing_operations')
        .select('planned_send_date, planned_return_date, work_type_id, executor_type, supplier_id')
        .eq('id', parsed.id)
        .eq('machine_id', parsed.machineId)
        .maybeSingle()
      if (currentError) throw new Error(currentError.message || 'Не удалось проверить текущие даты')
      current = currentData as {
        planned_send_date: string | null
        planned_return_date: string | null
        work_type_id: string
        executor_type: ExecutorType
        supplier_id: string | null
      } | null
      if (!current) throw new Error('Операция аутсорсинга не найдена')
    }

    if (current && context.role === 'production_manager' && planStatus === 'confirmed') {
      if (
        (dateOnly(current.planned_send_date) !== dateOnly(parsed.plannedSendDate) ||
          dateOnly(current.planned_return_date) !== dateOnly(parsed.plannedReturnDate))
      ) {
        throw new Error('План месяца подтверждён. Отправьте запрос на изменение дат аутсорсинга руководителю отдела планирования.')
      }
    }

    const workTypeId = await resolveWorkTypeId(db, parsed.workTypeId, parsed.workTypeName)
    const itemIds = await ensureSelectedItemsBelongToMachine(db, parsed.machineId, parsed.itemIds)
    const payload: Record<string, unknown> = {
      machine_id: parsed.machineId,
      work_type_id: workTypeId,
      position_after_stage_type: parsed.positionAfterStageType || null,
      executor_type: parsed.executorType,
      supplier_id: parsed.executorType === 'supplier' ? parsed.supplierId : null,
      executor_factory_id: parsed.executorType === 'factory' ? parsed.executorFactoryId : null,
      note: parsed.note || null,
      planned_send_date: dateOnly(parsed.plannedSendDate),
      planned_return_date: dateOnly(parsed.plannedReturnDate),
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    }
    const supplyScopeChanged = Boolean(current && (
      current.work_type_id !== workTypeId
      || current.executor_type !== parsed.executorType
      || current.supplier_id !== (parsed.executorType === 'supplier' ? parsed.supplierId || null : null)
    ))
    if (current && (supplyScopeChanged || dateOnly(current.planned_return_date) !== dateOnly(parsed.plannedReturnDate))) {
      payload.supply_terms_confirmed_at = null
      payload.supply_terms_confirmed_by = null
    }
    if (supplyScopeChanged) payload.service_cost_planned = null

    let operationId = parsed.id || null
    if (operationId) {
      const { error } = await db
        .from('machine_outsourcing_operations')
        .update(payload)
        .eq('id', operationId)
        .eq('machine_id', parsed.machineId)
      if (error) throw new Error(error.message || 'Не удалось обновить операцию аутсорсинга')
    } else {
      const { data, error } = await db
        .from('machine_outsourcing_operations')
        .insert({ ...payload, created_by: context.userId })
        .select('id')
        .single()
      if (error || !data) throw new Error(error?.message || 'Не удалось создать операцию аутсорсинга')
      operationId = (data as { id: string }).id
    }

    const { error: deleteItemsError } = await db.from('machine_outsourcing_operation_items').delete().eq('operation_id', operationId)
    if (deleteItemsError) throw new Error(deleteItemsError.message || 'Не удалось обновить товары аутсорсинга')
    const { error: insertItemsError } = await db
      .from('machine_outsourcing_operation_items')
      .insert(itemIds.map((machine_item_id) => ({ operation_id: operationId, machine_item_id })))
    if (insertItemsError) throw new Error(insertItemsError.message || 'Не удалось сохранить товары аутсорсинга')

    await syncOutsourcingTransportForMachine(db, machine)
    revalidatePath(`${ROUTES.SALES_PLAN}/${machine.id}`)
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.PRODUCTION_OUTSOURCING_REQUESTS)
    revalidatePath(ROUTES.SUPPLY_OUTSOURCING_REQUESTS)
    revalidatePath(ROUTES.SUPPLY_TRANSPORT)
    revalidatePath(ROUTES.TASKS)
    return { success: true, id: operationId, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function archiveOutsourcingOperation(operationId: string) {
  try {
    const db = dbFrom(createAdminClient())
    const { data, error } = await db
      .from('machine_outsourcing_operations')
      .select('id, machine_id')
      .eq('id', operationId)
      .maybeSingle()
    if (error || !data) throw new Error(error?.message || 'Операция не найдена')
    const operation = data as { id: string; machine_id: string }
    const { context } = await requireMachineOutsourcingAccess(operation.machine_id, true)
    const now = new Date().toISOString()

    const { error: updateError } = await db
      .from('machine_outsourcing_operations')
      .update({ archived_at: now, archived_by: context.userId, updated_by: context.userId, updated_at: now })
      .eq('id', operation.id)
    if (updateError) throw new Error(updateError.message || 'Не удалось архивировать операцию')

    const { data: needsData } = await db
      .from('machine_outsourcing_transport_needs')
      .select('id, task_id')
      .eq('operation_id', operation.id)
      .in('status', ['open', 'linked'])
    const needs = (needsData || []) as Array<{ id: string; task_id: string | null }>
    if (needs.length > 0) {
      await db.from('machine_outsourcing_transport_needs').update({ status: 'cancelled' }).in('id', needs.map((need) => need.id))
      const taskIds = needs.map((need) => need.task_id).filter((id): id is string => Boolean(id))
      if (taskIds.length > 0) {
        await db.from('tasks').update({ status: 'cancelled', updated_at: now }).in('id', taskIds)
      }
    }

    revalidatePath(`${ROUTES.SALES_PLAN}/${operation.machine_id}`)
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.PRODUCTION_OUTSOURCING_REQUESTS)
    revalidatePath(ROUTES.SUPPLY_OUTSOURCING_REQUESTS)
    revalidatePath(ROUTES.SUPPLY_TRANSPORT)
    revalidatePath(ROUTES.TASKS)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function upsertZincOutsourcingDefault(input: z.infer<typeof zincDefaultSchema>) {
  try {
    const parsed = zincDefaultSchema.parse(input)
    const context = await requirePermission('production', 'manage')
    if (!canManageSource(context.role, context.factoryId, parsed.factoryId, context.permissionDetails.isAdminPosition)) {
      throw new Error('Недостаточно прав для настройки цинка')
    }
    if (parsed.executorType === 'supplier' && !parsed.supplierId) throw new Error('Выберите поставщика для цинка')
    if (parsed.executorType === 'factory' && !parsed.executorFactoryId) throw new Error('Выберите завод-исполнитель для цинка')

    const db = dbFrom(createAdminClient())
    const { error } = await db
      .from('factory_zinc_outsourcing_defaults')
      .upsert({
        factory_id: parsed.factoryId,
        executor_type: parsed.executorType,
        supplier_id: parsed.executorType === 'supplier' ? parsed.supplierId : null,
        executor_factory_id: parsed.executorType === 'factory' ? parsed.executorFactoryId : null,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'factory_id' })
    if (error) throw new Error(error.message || 'Не удалось сохранить настройку цинка')

    revalidatePath(ROUTES.PRODUCTION)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

async function syncZincOperation(db: LooseDb, machineId: string, stageDates: { dateStart?: string | null; dateEnd?: string | null }, actorUserId?: string | null) {
  const machine = await getMachineOrThrow(db, machineId)
  if (!machine.factory_id) return

  const [workTypes, defaultExecutor, items] = await Promise.all([
    loadWorkTypes(db),
    loadZincDefault(db, machine.factory_id),
    loadMachineItems(db, machine.id),
  ])
  const zincWorkType = workTypes.find((workType) => workType.is_zinc || workType.code === 'zinc')
  if (!zincWorkType || !defaultExecutor) return

  const zincItems = items.filter((item) => item.coating === 'zinc')
  if (zincItems.length === 0) return

  const { data: currentData, error: currentError } = await db
    .from('machine_outsourcing_operations')
    .select('id')
    .eq('machine_id', machine.id)
    .eq('is_zinc_operation', true)
    .is('archived_at', null)
    .maybeSingle()
  if (currentError) throw new Error(currentError.message || 'Не удалось проверить операцию цинка')
  const current = currentData as { id: string } | null

  const payload = {
    machine_id: machine.id,
    work_type_id: zincWorkType.id,
    position_after_stage_type: 'cleaning',
    source_stage_type: 'galvanizing',
    is_zinc_operation: true,
    executor_type: defaultExecutor.executor_type,
    supplier_id: defaultExecutor.executor_type === 'supplier' ? defaultExecutor.supplier_id : null,
    executor_factory_id: defaultExecutor.executor_type === 'factory' ? defaultExecutor.executor_factory_id : null,
    planned_send_date: dateOnly(stageDates.dateStart),
    planned_return_date: dateOnly(stageDates.dateEnd),
    note: 'Синхронизировано с этапом Цинк',
    updated_by: actorUserId || null,
    updated_at: new Date().toISOString(),
  }

  let operationId = current?.id || null
  if (operationId) {
    const { error } = await db.from('machine_outsourcing_operations').update(payload).eq('id', operationId)
    if (error) throw new Error(error.message || 'Не удалось обновить цинковую операцию')
  } else {
    const { data, error } = await db
      .from('machine_outsourcing_operations')
      .insert({ ...payload, created_by: actorUserId || null })
      .select('id')
      .single()
    if (error || !data) throw new Error(error?.message || 'Не удалось создать цинковую операцию')
    operationId = (data as { id: string }).id
  }

  await db.from('machine_outsourcing_operation_items').delete().eq('operation_id', operationId)
  const { error: itemsError } = await db
    .from('machine_outsourcing_operation_items')
    .insert(zincItems.map((item) => ({ operation_id: operationId, machine_item_id: item.id })))
  if (itemsError) throw new Error(itemsError.message || 'Не удалось сохранить товары цинка')

  await syncOutsourcingTransportForMachine(db, machine)
}

export async function syncZincOutsourcingFromStage(
  machineId: string,
  stageDates: { dateStart?: string | null; dateEnd?: string | null },
  actorUserId?: string | null,
) {
  const db = dbFrom(createAdminClient())
  await syncZincOperation(db, machineId, stageDates, actorUserId)
}

export async function syncZincOutsourcingForMachine(machineId: string) {
  try {
    const { db, context, machine } = await requireMachineOutsourcingAccess(machineId, true)
    const { data, error } = await db
      .from('production_stages')
      .select('date_start, date_end')
      .eq('machine_id', machine.id)
      .eq('stage_type', 'galvanizing')
      .maybeSingle()
    if (error) throw new Error(error.message || 'Не удалось загрузить этап цинка')
    const stage = data as { date_start: string | null; date_end: string | null } | null
    if (!stage) throw new Error('Этап цинка не найден')
    await syncZincOperation(db, machine.id, { dateStart: stage.date_start, dateEnd: stage.date_end }, context.userId)
    revalidatePath(`${ROUTES.SALES_PLAN}/${machine.id}`)
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.SUPPLY_TRANSPORT)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function getProductionOutsourcingSummary(factoryId: string): Promise<{ data: ProductionOutsourcingSummary; error: string | null }> {
  try {
    const context = await requirePermission('production', 'view')
    if (!isProductionManagerScoped(context.role, context.factoryId, factoryId)) throw new Error('Доступ запрещён')
    const db = dbFrom(createAdminClient())
    const [{ data: outgoingMachinesData, error: outgoingMachinesError }, { data: incomingData, error: incomingError }] = await Promise.all([
      db.from('machines').select('id, name, factory_id').eq('factory_id', factoryId).eq('is_archived', false),
      db.from('machine_outsourcing_operations').select('*').eq('executor_type', 'factory').eq('executor_factory_id', factoryId).is('archived_at', null),
    ])
    if (outgoingMachinesError) throw new Error(outgoingMachinesError.message || 'Не удалось загрузить исходящие операции')
    if (incomingError) throw new Error(incomingError.message || 'Не удалось загрузить входящие операции')

    const outgoingMachines = (outgoingMachinesData || []) as Array<{ id: string; name: string; factory_id: string | null }>
    const outgoingByMachine = new Map(outgoingMachines.map((machine) => [machine.id, machine]))
    const outgoing = (await loadOperationsByMachineIds(db, outgoingMachines.map((machine) => machine.id)))
      .map((operation) => ({
        ...operation,
        machine_name: outgoingByMachine.get(operation.machine_id)?.name || 'Машина',
        source_factory_id: factoryId,
        source_factory_name: null,
      }))

    const incomingRaw = (incomingData || []) as Array<Record<string, unknown> & { id: string; machine_id: string }>
    const incomingOperations = await hydrateOperations(db, incomingRaw)
    const incomingMachineIds = Array.from(new Set(incomingOperations.map((operation) => operation.machine_id)))
    let machineRows: Array<{ id: string; name: string; factory_id: string | null }> = []
    if (incomingMachineIds.length > 0) {
      const { data: machinesData, error: machinesError } = await db
        .from('machines')
        .select('id, name, factory_id')
        .in('id', incomingMachineIds)
      if (machinesError) throw new Error(machinesError.message || 'Не удалось загрузить машины входящего аутсорсинга')
      machineRows = (machinesData || []) as Array<{ id: string; name: string; factory_id: string | null }>
    }
    const sourceFactoryIds = Array.from(new Set(machineRows.map((machine) => machine.factory_id).filter((id): id is string => Boolean(id))))
    let sourceFactories: Array<{ id: string; name: string }> = []
    if (sourceFactoryIds.length > 0) {
      const { data: factoriesData, error: factoriesError } = await db.from('factories').select('id, name').in('id', sourceFactoryIds)
      if (factoriesError) throw new Error(factoriesError.message || 'Не удалось загрузить заводы')
      sourceFactories = (factoriesData || []) as Array<{ id: string; name: string }>
    }
    const machineById = new Map(machineRows.map((machine) => [machine.id, machine]))
    const factoryById = new Map(sourceFactories.map((factory) => [factory.id, factory]))
    const incoming = incomingOperations.map((operation) => {
      const machine = machineById.get(operation.machine_id)
      const factory = machine?.factory_id ? factoryById.get(machine.factory_id) : null
      return {
        ...operation,
        machine_name: machine?.name || 'Машина',
        source_factory_id: machine?.factory_id || null,
        source_factory_name: factory?.name || null,
      }
    })

    return { data: { outgoing, incoming }, error: null }
  } catch (error) {
    return { data: { outgoing: [], incoming: [] }, error: getErrorMessage(error) }
  }
}

export async function updateIncomingOutsourcingPlan(input: z.infer<typeof incomingPlanSchema>) {
  try {
    const parsed = incomingPlanSchema.parse(input)
    const { db, context, operation } = await requireExecutorFactoryAccess(parsed.operationId)
    if (parsed.incomingDateStart && parsed.incomingDateEnd && parsed.incomingDateEnd < parsed.incomingDateStart) {
      throw new Error('Дата окончания не может быть раньше даты начала')
    }
    const month = normalizeMonthOrNull(parsed.incomingProductionMonth || null)
    const { error } = await db
      .from('machine_outsourcing_operations')
      .update({
        incoming_production_month: month,
        incoming_workshop: parsed.incomingWorkshop ?? null,
        incoming_queue_number: parsed.incomingQueueNumber ?? null,
        incoming_date_start: dateOnly(parsed.incomingDateStart),
        incoming_date_end: dateOnly(parsed.incomingDateEnd),
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', operation.id)
    if (error) throw new Error(error.message || 'Не удалось обновить входящую работу')

    await syncConfirmedTransportForIncomingPlan(db, operation.id)
    await createSystemMachineChatMessage({
      machineId: operation.machine_id,
      body: parsed.incomingDateStart && parsed.incomingDateEnd
        ? `Принимающий завод подтвердил даты аутсорсинга: ${formatDate(parsed.incomingDateStart)} — ${formatDate(parsed.incomingDateEnd)}. Создан запрос на транспорт.`
        : 'Принимающий завод обновил план входящей работы аутсорсинга.',
      eventKey: `outsourcing_incoming_plan:${operation.id}:${parsed.incomingDateStart || 'none'}:${parsed.incomingDateEnd || 'none'}`,
      excludeUserId: context.userId,
    })
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.PRODUCTION_OUTSOURCING_REQUESTS)
    revalidatePath(ROUTES.SUPPLY_OUTSOURCING_REQUESTS)
    revalidatePath(ROUTES.SUPPLY_TRANSPORT)
    revalidatePath(ROUTES.TASKS)
    revalidatePath(`${ROUTES.SALES_PLAN}/${operation.machine_id}`)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function getIncomingOutsourcingPlanBlockers(factoryId: string, productionMonth: string) {
  const db = dbFrom(createAdminClient())
  const { data, error } = await db
    .from('machine_outsourcing_operations')
    .select('id, incoming_date_start, incoming_date_end, machine_id')
    .eq('executor_type', 'factory')
    .eq('executor_factory_id', factoryId)
    .eq('incoming_production_month', productionMonth)
    .is('archived_at', null)
  if (error) throw new Error(error.message || 'Не удалось проверить входящий аутсорсинг')
  const operations = (data || []) as Array<{ id: string; incoming_date_start: string | null; incoming_date_end: string | null; machine_id: string }>
  const missing = operations.filter((operation) => !operation.incoming_date_start || !operation.incoming_date_end)
  if (missing.length === 0) return []

  const machineIds = Array.from(new Set(missing.map((operation) => operation.machine_id)))
  const { data: machinesData } = await db.from('machines').select('id, name').in('id', machineIds)
  const machineNameById = new Map(((machinesData || []) as Array<{ id: string; name: string }>).map((machine) => [machine.id, machine.name]))
  return missing.map((operation) => machineNameById.get(operation.machine_id) || operation.id)
}

async function loadTransportNeeds(db: LooseDb, orderIds?: string[]) {
  let query = db
    .from('machine_outsourcing_transport_needs')
    .select('*')
    .order('needed_date', { ascending: true })
  if (orderIds && orderIds.length > 0) query = query.in('transport_order_id', orderIds)
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Не удалось загрузить транспортные потребности')
  return (data || []) as MachineOutsourcingTransportNeed[]
}

async function enrichTransportNeeds(db: LooseDb, needs: MachineOutsourcingTransportNeed[]) {
  if (needs.length === 0) return [] as TransportWorkspaceNeed[]
  const operationIds = Array.from(new Set(needs.map((need) => need.operation_id)))
  const { data: operationsData, error: operationsError } = await db
    .from('machine_outsourcing_operations')
    .select('*')
    .in('id', operationIds)
  if (operationsError) throw new Error(operationsError.message || 'Не удалось загрузить операции транспорта')
  const operations = await hydrateOperations(db, (operationsData || []) as Array<Record<string, unknown> & { id: string; machine_id: string }>)

  const machineIds = Array.from(new Set(operations.map((operation) => operation.machine_id)))
  const [machinesRes, workTypes] = await Promise.all([
    machineIds.length > 0 ? db.from('machines').select('id, name, factory_id').in('id', machineIds) : Promise.resolve({ data: [], error: null }),
    loadWorkTypes(db),
  ])
  if (machinesRes.error) throw new Error(machinesRes.error.message || 'Не удалось загрузить машины')

  const machines = (machinesRes.data || []) as Array<{ id: string; name: string; factory_id: string | null }>
  const factoryIds = Array.from(new Set(machines.map((machine) => machine.factory_id).filter((id): id is string => Boolean(id))))
  let factories: Array<{ id: string; name: string }> = []
  if (factoryIds.length > 0) {
    const { data, error } = await db.from('factories').select('id, name').in('id', factoryIds)
    if (error) throw new Error(error.message || 'Не удалось загрузить заводы')
    factories = (data || []) as Array<{ id: string; name: string }>
  }
  const machineById = new Map(machines.map((machine) => [machine.id, machine]))
  const factoryById = new Map(factories.map((factory) => [factory.id, factory]))
  const operationById = new Map(operations.map((operation) => [operation.id, operation]))
  const workTypeById = new Map(workTypes.map((workType) => [workType.id, workType.name]))

  return needs.map((need) => {
    const operation = operationById.get(need.operation_id)
    const machine = operation ? machineById.get(operation.machine_id) : null
    const factory = machine?.factory_id ? factoryById.get(machine.factory_id) : null
    return {
      ...need,
      machine_id: operation?.machine_id || '',
      machine_name: machine?.name || 'Машина',
      source_factory_id: machine?.factory_id || null,
      source_factory_name: factory?.name || null,
      work_type_name: operation ? workTypeById.get(operation.work_type_id) || operation.work_type_name : 'Аутсорсинг',
      executor_label: operation?.executor_factory_name || operation?.supplier_name || 'Исполнитель не указан',
      item_labels: (operation?.items || []).map((item) => `${item.product_name} (${item.quantity} шт.)`),
    }
  })
}

async function loadSupplyOutsourcingAgreements(db: LooseDb) {
  const { data, error } = await db
    .from('machine_outsourcing_operations')
    .select('id, machine_id, work_type_id, supplier_id, planned_send_date, planned_return_date, service_cost_planned, supply_terms_confirmed_at')
    .eq('executor_type', 'supplier')
    .is('archived_at', null)
    .is('actual_returned_at', null)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message || 'Не удалось загрузить условия аутсорсинга')

  const operations = (data || []) as Array<{
    id: string
    machine_id: string
    work_type_id: string
    supplier_id: string | null
    planned_send_date: string | null
    planned_return_date: string | null
    service_cost_planned: number | null
    supply_terms_confirmed_at: string | null
  }>
  if (operations.length === 0) return [] as SupplyOutsourcingAgreement[]

  const machineIds = Array.from(new Set(operations.map((operation) => operation.machine_id)))
  const workTypeIds = Array.from(new Set(operations.map((operation) => operation.work_type_id)))
  const supplierIds = Array.from(new Set(operations.map((operation) => operation.supplier_id).filter((id): id is string => Boolean(id))))
  const [machinesRes, workTypesRes, suppliersRes] = await Promise.all([
    db.from('machines').select('id, name, factory_id').in('id', machineIds),
    db.from('outsourcing_work_types').select('id, name').in('id', workTypeIds),
    loadSuppliersByIds(db, supplierIds),
  ])
  for (const result of [machinesRes, workTypesRes, suppliersRes]) {
    if (result.error) throw new Error(result.error.message || 'Не удалось дополнить условия аутсорсинга')
  }

  const machines = (machinesRes.data || []) as Array<{ id: string; name: string; factory_id: string | null }>
  const factoryIds = Array.from(new Set(machines.map((machine) => machine.factory_id).filter((id): id is string => Boolean(id))))
  const factoriesRes = factoryIds.length > 0
    ? await db.from('factories').select('id, name').in('id', factoryIds)
    : { data: [], error: null }
  if (factoriesRes.error) throw new Error(factoriesRes.error.message || 'Не удалось загрузить заводы')

  const machineById = new Map(machines.map((machine) => [machine.id, machine]))
  const workTypeById = new Map(((workTypesRes.data || []) as Array<{ id: string; name: string }>).map((workType) => [workType.id, workType.name]))
  const supplierById = new Map(((suppliersRes.data || []) as Array<{ id: string; name: string }>).map((supplier) => [supplier.id, supplier.name]))
  const factoryById = new Map(((factoriesRes.data || []) as Array<{ id: string; name: string }>).map((factory) => [factory.id, factory.name]))

  return operations.map((operation) => {
    const machine = machineById.get(operation.machine_id)
    return {
      operation_id: operation.id,
      machine_id: operation.machine_id,
      machine_name: machine?.name || 'Машина',
      source_factory_name: machine?.factory_id ? factoryById.get(machine.factory_id) || null : null,
      work_type_name: workTypeById.get(operation.work_type_id) || 'Аутсорсинг',
      supplier_name: operation.supplier_id ? supplierById.get(operation.supplier_id) || null : null,
      planned_send_date: dateOnly(operation.planned_send_date),
      planned_return_date: dateOnly(operation.planned_return_date),
      service_cost_planned: operation.service_cost_planned == null ? null : Number(operation.service_cost_planned),
      supply_terms_confirmed_at: operation.supply_terms_confirmed_at,
    } satisfies SupplyOutsourcingAgreement
  })
}

export async function getSupplyOutsourcingRequests(): Promise<{ data: SupplyOutsourcingAgreement[]; error: string | null }> {
  try {
    await requirePermission('supply_transport', 'view')
    const agreements = await loadSupplyOutsourcingAgreements(dbFrom(createAdminClient()))
    return { data: agreements, error: null }
  } catch (error) {
    return { data: [], error: getErrorMessage(error) }
  }
}

export async function getOutsourcingTransportWorkspace(): Promise<{ data: OutsourcingTransportWorkspace; error: string | null }> {
  try {
    await requirePermission('supply_transport', 'view')
    const db = dbFrom(createAdminClient())
    const [{ data: ordersData, error: ordersError }, carriers, allNeeds, agreements] = await Promise.all([
      db.from('machine_outsourcing_transport_orders').select('*').order('created_at', { ascending: false }),
      loadSuppliers(db),
      loadTransportNeeds(db),
      loadSupplyOutsourcingAgreements(db),
    ])
    if (ordersError) throw new Error(ordersError.message || 'Не удалось загрузить транспортные заказы')

    const ordersRaw = (ordersData || []) as Array<Record<string, unknown> & { id: string }>
    const orderIds = ordersRaw.map((order) => order.id)
    const activeNeeds = allNeeds.filter((need) => need.status !== 'cancelled')
    const enrichedNeeds = await enrichTransportNeeds(db, activeNeeds)
    const needsByOrder = new Map<string, TransportWorkspaceNeed[]>()
    const openNeeds: TransportWorkspaceNeed[] = []
    for (const need of enrichedNeeds) {
      if (need.transport_order_id) {
        needsByOrder.set(need.transport_order_id, [...(needsByOrder.get(need.transport_order_id) || []), need])
      } else if (need.status === 'open') {
        openNeeds.push(need)
      }
    }

    const carriersById = new Map(carriers.map((supplier) => [supplier.id, supplier]))
    const orders = ordersRaw
      .filter((order) => orderIds.includes(order.id))
      .map((order) => ({
        id: order.id,
        direction: order.direction as TransportDirection,
        status: order.status as TransportOrderStatus,
        carrier_supplier_id: order.carrier_supplier_id as string | null,
        carrier_name: order.carrier_supplier_id ? carriersById.get(order.carrier_supplier_id as string)?.name || null : null,
        scheduled_date: dateOnly(order.scheduled_date as string | null),
        price: order.price == null ? null : Number(order.price),
        comment: order.comment as string | null,
        needs: needsByOrder.get(order.id) || [],
      }))

    return {
      data: {
        agreements,
        needs: openNeeds,
        orders,
        carriers: carriers.filter((supplier) => supplier.can_transport),
      },
      error: null,
    }
  } catch (error) {
    return { data: { agreements: [], needs: [], orders: [], carriers: [] }, error: getErrorMessage(error) }
  }
}

async function requireTransportAccess() {
  const context = await requirePermission('supply_transport', 'manage')
  return { db: dbFrom(createAdminClient()), context }
}

export async function confirmOutsourcingServiceTerms(input: z.infer<typeof supplyTermsSchema>) {
  try {
    const parsed = supplyTermsSchema.parse(input)
    const context = await requirePermission('supply_transport', 'manage')
    const db = dbFrom(createAdminClient())
    const { data, error } = await db
      .from('machine_outsourcing_operations')
      .select('id, machine_id, executor_type, planned_send_date, archived_at')
      .eq('id', parsed.operationId)
      .maybeSingle()
    if (error || !data) throw new Error(error?.message || 'Операция аутсорсинга не найдена')

    const operation = data as {
      id: string
      machine_id: string
      executor_type: ExecutorType
      planned_send_date: string | null
      archived_at: string | null
    }
    if (operation.archived_at) throw new Error('Операция аутсорсинга архивирована')
    if (operation.executor_type !== 'supplier') throw new Error('Снабжение подтверждает только внешний аутсорсинг')
    const plannedSendDate = dateOnly(operation.planned_send_date)
    if (plannedSendDate && parsed.plannedReturnDate < plannedSendDate) {
      throw new Error('Дата возврата не может быть раньше даты отправки')
    }

    const now = new Date().toISOString()
    const { error: updateError } = await db
      .from('machine_outsourcing_operations')
      .update({
        planned_return_date: parsed.plannedReturnDate,
        service_cost_planned: parsed.serviceCostPlanned ?? null,
        supply_terms_confirmed_at: now,
        supply_terms_confirmed_by: context.userId,
        updated_by: context.userId,
        updated_at: now,
      })
      .eq('id', operation.id)
    if (updateError) throw new Error(updateError.message || 'Не удалось подтвердить условия аутсорсинга')

    const machine = await getMachineOrThrow(db, operation.machine_id)
    await syncOutsourcingTransportForMachine(db, machine)
    revalidatePath(ROUTES.SUPPLY_TRANSPORT)
    revalidatePath(ROUTES.SUPPLY_OUTSOURCING_REQUESTS)
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(`${ROUTES.SALES_PLAN}/${operation.machine_id}`)
    revalidatePath(ROUTES.TASKS)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function createOutsourcingTransportOrder(input: z.infer<typeof createOrderSchema>) {
  try {
    const parsed = createOrderSchema.parse(input)
    const { db, context } = await requireTransportAccess()
    const { data: needsData, error: needsError } = await db
      .from('machine_outsourcing_transport_needs')
      .select('*')
      .in('id', parsed.needIds)
    if (needsError) throw new Error(needsError.message || 'Не удалось загрузить потребности')
    const needs = (needsData || []) as MachineOutsourcingTransportNeed[]
    if (needs.length !== parsed.needIds.length) throw new Error('Одна или несколько потребностей не найдены')
    if (needs.some((need) => need.plan_state !== 'confirmed')) throw new Error('Предварительные потребности нельзя объединять в рейс')
    if (needs.some((need) => need.status !== 'open' || need.transport_order_id)) throw new Error('В рейс можно добавить только открытые потребности')
    const direction = needs[0]?.direction
    if (!direction || needs.some((need) => need.direction !== direction)) throw new Error('Один рейс не может смешивать направления туда и обратно')

    const { data: orderData, error: orderError } = await db
      .from('machine_outsourcing_transport_orders')
      .insert({
        direction,
        status: parsed.carrierSupplierId || parsed.scheduledDate ? 'found' : 'needed',
        carrier_supplier_id: parsed.carrierSupplierId || null,
        scheduled_date: dateOnly(parsed.scheduledDate),
        price: parsed.price ?? null,
        comment: parsed.comment || null,
        created_by: context.userId,
        updated_by: context.userId,
      })
      .select('id')
      .single()
    if (orderError || !orderData) throw new Error(orderError?.message || 'Не удалось создать рейс')
    const orderId = (orderData as { id: string }).id

    const { error: needsUpdateError } = await db
      .from('machine_outsourcing_transport_needs')
      .update({ status: 'linked', transport_order_id: orderId })
      .in('id', needs.map((need) => need.id))
    if (needsUpdateError) throw new Error(needsUpdateError.message || 'Не удалось связать потребности с рейсом')

    const taskIds = needs.map((need) => need.task_id).filter((id): id is string => Boolean(id))
    if (taskIds.length > 0) {
      await db.from('tasks').update({ status: 'in_progress', updated_at: new Date().toISOString() }).in('id', taskIds)
    }

    revalidatePath(ROUTES.SUPPLY_TRANSPORT)
    revalidatePath(ROUTES.TASKS)
    return { success: true, id: orderId, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function updateOutsourcingTransportOrder(input: z.infer<typeof updateOrderSchema>) {
  try {
    const parsed = updateOrderSchema.parse(input)
    const { db, context } = await requireTransportAccess()
    const { data: currentData, error: currentError } = await db
      .from('machine_outsourcing_transport_orders')
      .select('*')
      .eq('id', parsed.orderId)
      .maybeSingle()
    if (currentError || !currentData) throw new Error(currentError?.message || 'Рейс не найден')
    const current = currentData as MachineOutsourcingTransportOrder
    const nextStatus = parsed.status || current.status
    const now = new Date().toISOString()

    const { error: updateError } = await db
      .from('machine_outsourcing_transport_orders')
      .update({
        status: nextStatus,
        carrier_supplier_id: parsed.carrierSupplierId === undefined ? current.carrier_supplier_id : parsed.carrierSupplierId,
        scheduled_date: parsed.scheduledDate === undefined ? current.scheduled_date : dateOnly(parsed.scheduledDate),
        price: parsed.price === undefined ? current.price : parsed.price,
        comment: parsed.comment === undefined ? current.comment : parsed.comment,
        updated_by: context.userId,
        updated_at: now,
      })
      .eq('id', parsed.orderId)
    if (updateError) throw new Error(updateError.message || 'Не удалось обновить рейс')

    const { data: needsData, error: needsError } = await db
      .from('machine_outsourcing_transport_needs')
      .select('*')
      .eq('transport_order_id', parsed.orderId)
    if (needsError) throw new Error(needsError.message || 'Не удалось загрузить потребности рейса')
    const needs = (needsData || []) as MachineOutsourcingTransportNeed[]

    if (nextStatus === 'completed' && needs.length > 0) {
      const factDate = dateOnly(parsed.scheduledDate === undefined ? current.scheduled_date : parsed.scheduledDate) || todayDateOnly()
      const { error: needsCompleteError } = await db
        .from('machine_outsourcing_transport_needs')
        .update({ status: 'completed' })
        .in('id', needs.map((need) => need.id))
      if (needsCompleteError) throw new Error(needsCompleteError.message || 'Не удалось закрыть потребности рейса')

      const taskIds = needs.map((need) => need.task_id).filter((id): id is string => Boolean(id))
      if (taskIds.length > 0) {
        await db.from('tasks').update({ status: 'completed', completed_at: now, updated_at: now }).in('id', taskIds)
      }

      for (const need of needs) {
        const factField = need.direction === 'outbound' ? 'actual_sent_at' : 'actual_returned_at'
        await db.from('machine_outsourcing_operations').update({ [factField]: factDate, updated_by: context.userId, updated_at: now }).eq('id', need.operation_id)
      }
    }

    if (nextStatus === 'cancelled' && needs.length > 0) {
      const { error: needsOpenError } = await db
        .from('machine_outsourcing_transport_needs')
        .update({ status: 'open', transport_order_id: null })
        .in('id', needs.map((need) => need.id))
      if (needsOpenError) throw new Error(needsOpenError.message || 'Не удалось вернуть потребности в работу')
      const taskIds = needs.map((need) => need.task_id).filter((id): id is string => Boolean(id))
      if (taskIds.length > 0) {
        await db.from('tasks').update({ status: 'pending', updated_at: now }).in('id', taskIds)
      }
    }

    revalidatePath(ROUTES.SUPPLY_TRANSPORT)
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.TASKS)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}
