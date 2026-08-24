import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { getSupplyOrders, type SupplyOrderItem } from '@/lib/actions/supply-orders'
import { ROUTES } from '@/lib/constants/routes'
import {
  buildTonnageMetric,
  daysBetween,
  mergeTodayOrders,
  sortPersonalItems,
  splitSupplyRisks,
} from './calculations'
import { getStageIntervals, prorateStageIntervalsForPeriod, type ProductionStageIntervalValue } from '@/lib/production-stage-intervals'
import type {
  PlanningAssemblyTonnage,
  PlanningDashboardFactory,
  PlanningOverdueShipment,
  PlanningPersonalItem,
  PlanningSupplyRisk,
  PlanningSupplyRisks,
  PlanningTodaySection,
} from './types'

type DbError = { message?: string }
type DbResult = { data: unknown; error: DbError | null; count?: number | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string, options?: { count?: 'exact'; head?: boolean }) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  neq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  lt: (column: string, value: unknown) => LooseQuery
  gte: (column: string, value: unknown) => LooseQuery
  lte: (column: string, value: unknown) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
}
type LooseDb = { from: (table: string) => LooseQuery }

type DashboardContext = {
  userId: string
  userFactoryId: string | null
}

const VISIBLE_ITEMS_LIMIT = 8

function db() {
  return createAdminClient() as unknown as LooseDb
}

function throwOnError(result: DbResult, message: string) {
  if (result.error) throw new Error(result.error.message || message)
}

export function todayInUzhgorod(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Uzhgorod',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

export function normalizeDashboardMonth(value: string | null | undefined, today = todayInUzhgorod()) {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value
  return today.slice(0, 7)
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, '0')}`,
  }
}

function normalizedFactoryName(value: string) {
  return value.trim().toLocaleLowerCase('uk-UA')
}

export async function getPlanningFactories(
  requestedFactoryId: string | null | undefined,
  userFactoryId: string | null,
) {
  const result = await db().from('factories').select('id, name').order('name')
  throwOnError(result, 'Не удалось загрузить заводы')
  const factories = ((result.data || []) as PlanningDashboardFactory[]).filter((factory) => {
    const name = normalizedFactoryName(factory.name)
    return name.includes('берег') || name.includes('ужгород')
  }).sort((left, right) => {
    const leftIsBeregovo = normalizedFactoryName(left.name).includes('берег')
    const rightIsBeregovo = normalizedFactoryName(right.name).includes('берег')
    return leftIsBeregovo === rightIsBeregovo ? left.name.localeCompare(right.name, 'uk') : leftIsBeregovo ? -1 : 1
  })
  if (factories.length === 0) throw new Error('Заводы Берегово и Ужгород не найдены')

  const selectedFactory = factories.find((factory) => factory.id === requestedFactoryId)
    || factories.find((factory) => factory.id === userFactoryId)
    || factories[0]
  return { factories, selectedFactory }
}

export async function getPlanningPersonalItems(context: DashboardContext, today = todayInUzhgorod()) {
  const admin = db()
  const [tasksResult, requestsResult] = await Promise.all([
    admin.from('tasks')
      .select('id, title, status, deadline, department_request_id, machine:machines(id, name, is_archived)')
      .eq('assigned_to', context.userId)
      .in('status', ['pending', 'in_progress'])
      .limit(250),
    admin.from('department_requests')
      .select('id, title, status, due_date, machine:machines(id, name, is_archived)')
      .eq('assigned_to', context.userId)
      .in('status', ['new', 'in_progress'])
      .limit(250),
  ])
  throwOnError(tasksResult, 'Не удалось загрузить задачи')
  throwOnError(requestsResult, 'Не удалось загрузить запросы')

  type Relation = { id: string; name: string; is_archived: boolean | null } | Array<{ id: string; name: string; is_archived: boolean | null }> | null
  type TaskRow = {
    id: string
    title: string
    status: 'pending' | 'in_progress'
    deadline: string | null
    department_request_id: string | null
    machine: Relation
  }
  type RequestRow = {
    id: string
    title: string
    status: 'new' | 'in_progress'
    due_date: string | null
    machine: Relation
  }
  const relationOne = (value: Relation) => Array.isArray(value) ? value[0] || null : value
  const visibleTasks = ((tasksResult.data || []) as TaskRow[])
    .filter((task) => relationOne(task.machine)?.is_archived !== true)
  const visibleRequests = ((requestsResult.data || []) as RequestRow[])
    .filter((request) => relationOne(request.machine)?.is_archived !== true)
  const linkedRequestIds = new Set(
    visibleTasks.map((task) => task.department_request_id).filter(Boolean),
  )
  const taskItems: PlanningPersonalItem[] = visibleTasks.map((task) => ({
    id: task.id,
    kind: task.department_request_id ? 'request' : 'task',
    title: task.title,
    status: task.status,
    deadline: task.deadline,
    machineName: relationOne(task.machine)?.name || null,
    href: task.department_request_id
      ? `${ROUTES.REQUESTS}/detail/${task.department_request_id}`
      : `${ROUTES.TASKS}?task=${task.id}`,
  }))
  const requestItems: PlanningPersonalItem[] = visibleRequests
    .filter((request) => !linkedRequestIds.has(request.id))
    .map((request) => ({
      id: request.id,
      kind: 'request',
      title: request.title,
      status: request.status === 'new' ? 'pending' : 'in_progress',
      deadline: request.due_date,
      machineName: relationOne(request.machine)?.name || null,
      href: `${ROUTES.REQUESTS}/detail/${request.id}`,
    }))
  const items = sortPersonalItems([...taskItems, ...requestItems], today)
  return { items: items.slice(0, VISIBLE_ITEMS_LIMIT), count: items.length }
}

export async function getPlanningAssemblyTonnage(
  factoryId: string,
  month: string,
  today = todayInUzhgorod(),
): Promise<PlanningAssemblyTonnage> {
  const admin = db()
  const bounds = monthBounds(month)
  const [machinesResult, sectionsResult] = await Promise.all([
    admin.from('machines_with_totals')
      .select('id, total_weight, production_stages(id, stage_type, workshop, date_start, date_end, planned_date_end, is_skipped, production_stage_intervals(id, production_stage_id, position, date_start, date_end, workshop))')
      .eq('factory_id', factoryId)
      .eq('is_archived', false),
    admin.from('production_fact_sections')
      .select('id, parent_id, name')
      .eq('factory_id', factoryId)
      .eq('is_active', true)
      .is('archived_at', null),
  ])
  throwOnError(machinesResult, 'Не удалось загрузить план тоннажа')
  throwOnError(sectionsResult, 'Не удалось загрузить участки факта')

  type Stage = {
    id: string
    stage_type: string
    workshop: number | null
    date_start: string | null
    date_end: string | null
    planned_date_end: string | null
    is_skipped: boolean | null
    production_stage_intervals: ProductionStageIntervalValue[] | null
  }
  type MachineRow = { total_weight: number | null; production_stages: Stage[] | null }
  const machineRows = (machinesResult.data || []) as MachineRow[]
  let monthPlan = 0
  let todayPlan = 0
  for (const machine of machineRows) {
    const assembly = (machine.production_stages || []).find((stage) => stage.stage_type === 'assembly' && !stage.is_skipped)
    if (!assembly) continue
    const intervals = getStageIntervals({
      ...assembly,
      date_end: assembly.production_stage_intervals?.length ? assembly.date_end : assembly.planned_date_end || assembly.date_end,
      intervals: assembly.production_stage_intervals,
    })
    const weight = Number(machine.total_weight || 0)
    monthPlan += prorateStageIntervalsForPeriod(weight, intervals, bounds.start, bounds.end).tons
    todayPlan += prorateStageIntervalsForPeriod(weight, intervals, today, today).tons
  }

  type SectionRow = { id: string; parent_id: string | null; name: string }
  const sections = (sectionsResult.data || []) as SectionRow[]
  const assemblyParents = new Set(
    sections.filter((section) => !section.parent_id && section.name.trim().toLocaleLowerCase('uk-UA') === 'сборка/сварка')
      .map((section) => section.id),
  )
  const childIds = sections
    .filter((section) => section.parent_id && assemblyParents.has(section.parent_id))
    .map((section) => section.id)
  const [monthFactResult, todayFactResult] = childIds.length > 0
    ? await Promise.all([
        admin.from('production_tonnage_facts')
          .select('tonnage')
          .eq('factory_id', factoryId)
          .in('section_id', childIds)
          .gte('fact_date', bounds.start)
          .lte('fact_date', bounds.end),
        admin.from('production_tonnage_facts')
          .select('tonnage')
          .eq('factory_id', factoryId)
          .in('section_id', childIds)
          .eq('fact_date', today),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]
  throwOnError(monthFactResult, 'Не удалось загрузить факт тоннажа за месяц')
  throwOnError(todayFactResult, 'Не удалось загрузить факт тоннажа за сегодня')
  const monthFact = ((monthFactResult.data || []) as Array<{ tonnage: number }>)
    .reduce((sum, row) => sum + Number(row.tonnage || 0), 0)
  const todayFact = ((todayFactResult.data || []) as Array<{ tonnage: number }>)
    .reduce((sum, row) => sum + Number(row.tonnage || 0), 0)
  return {
    month,
    monthMetric: buildTonnageMetric(monthPlan, monthFact),
    todayMetric: buildTonnageMetric(todayPlan, todayFact),
  }
}

export async function getPlanningOverdueShipments(
  factoryId: string,
  today = todayInUzhgorod(),
) {
  const result = await db().from('machines_with_totals')
    .select('id, name, specification_number, total_weight, desired_shipping_date, client:clients(name)', { count: 'exact' })
    .eq('factory_id', factoryId)
    .eq('is_confirmed', true)
    .eq('is_archived', false)
    .is('actual_shipping_date', null)
    .lt('desired_shipping_date', today)
    .order('desired_shipping_date')
    .limit(VISIBLE_ITEMS_LIMIT)
  throwOnError(result, 'Не удалось загрузить просроченные отгрузки')
  type Row = {
    id: string
    name: string
    specification_number: string | null
    total_weight: number | null
    desired_shipping_date: string
    client: { name: string } | Array<{ name: string }> | null
  }
  const rows: PlanningOverdueShipment[] = ((result.data || []) as Row[]).map((row) => ({
    id: row.id,
    name: row.name,
    specification: row.specification_number,
    clientName: (Array.isArray(row.client) ? row.client[0]?.name : row.client?.name) || null,
    weightTons: Number(row.total_weight || 0),
    desiredShippingDate: row.desired_shipping_date,
    overdueDays: daysBetween(row.desired_shipping_date, today),
    href: `${ROUTES.SALES_PLAN}/${row.id}`,
  }))
  return { items: rows, count: result.count ?? rows.length }
}

export async function getPlanningTodaySections(
  factoryId: string,
  today = todayInUzhgorod(),
): Promise<PlanningTodaySection[]> {
  const admin = db()
  const [sectionsResult, assignmentsResult] = await Promise.all([
    admin.from('production_fact_sections').select('id, parent_id, name, sort_order')
      .eq('factory_id', factoryId).eq('is_active', true).is('archived_at', null)
      .order('sort_order').order('name'),
    admin.from('employee_assignments')
      .select('section_id, machine_id, kg_planned, machine:machines(id, name, is_archived)')
      .eq('work_date', today)
      .is('cancelled_at', null),
  ])
  throwOnError(sectionsResult, 'Не удалось загрузить производственные участки')
  throwOnError(assignmentsResult, 'Не удалось загрузить план производства на сегодня')
  type SectionRow = { id: string; parent_id: string | null; name: string; sort_order: number }
  type AssignmentRow = {
    section_id: string
    machine_id: string
    kg_planned: number
    machine: { id: string; name: string; is_archived: boolean } | Array<{ id: string; name: string; is_archived: boolean }> | null
  }
  const sections = (sectionsResult.data || []) as SectionRow[]
  const parentNames = new Map(sections.filter((row) => !row.parent_id).map((row) => [row.id, row.name]))
  const assignments = (assignmentsResult.data || []) as AssignmentRow[]
  return sections.filter((section) => section.parent_id && parentNames.has(section.parent_id)).map((section) => ({
    id: section.id,
    name: section.name,
    parentName: parentNames.get(section.parent_id!)!,
    orders: mergeTodayOrders(assignments.filter((assignment) => assignment.section_id === section.id)
      .flatMap((assignment) => {
        const machine = Array.isArray(assignment.machine) ? assignment.machine[0] : assignment.machine
        if (!machine || machine.is_archived) return []
        return [{
          id: machine.id,
          name: machine.name,
          plannedKg: Number(assignment.kg_planned || 0),
          href: `${ROUTES.SALES_PLAN}/${machine.id}`,
        }]
      })),
  }))
}

function materialRiskFromOrderItem(item: SupplyOrderItem, factoryId: string): PlanningSupplyRisk[] {
  if (!item.machine_id || item.order_status === 'delivered') return []
  const category = 'materials' as const
  if (item.delivery_schedules.length > 0) {
    return item.delivery_schedules.flatMap((schedule) => {
      if (schedule.status === 'cancelled' || schedule.status === 'delivered') return []
      const received = Number(schedule.received_quantity || 0)
      const remaining = Math.max(0, Number(schedule.quantity || 0) - received)
      if (remaining <= 0) return []
      return [{
        id: `schedule-${schedule.id}`,
        category,
        title: item.item_name,
        context: item.machine_name,
        dueDate: schedule.delivery_date,
        remainingQuantity: remaining,
        unit: schedule.unit || item.unit,
        overdueDays: null,
        href: `${ROUTES.SUPPLY_ORDERS}?view=details&focus=${schedule.id}&factory=${factoryId}`,
      }]
    })
  }
  const remaining = Math.max(0, Number(item.to_order || 0))
  if (remaining <= 0) return []
  return [{
    id: `${item.table}-${item.id}`,
    category,
    title: item.item_name,
    context: item.machine_name,
    dueDate: item.target_delivery_date,
    remainingQuantity: remaining,
    unit: item.unit,
    overdueDays: null,
    href: `${ROUTES.SUPPLY_ORDERS}?view=details&focus=${item.id}&factory=${factoryId}`,
  }]
}

export async function getPlanningSupplyRisks(
  factoryId: string,
  today = todayInUzhgorod(),
): Promise<PlanningSupplyRisks> {
  const admin = db()
  const [ordersResult, legacySupplyResult, consumablesResult, detailingResult, inventoryResult, outsourcingResult, transportResult] = await Promise.all([
    getSupplyOrders(0, 100, null, factoryId),
    admin.from('supply_items')
      .select('id, nomenclature, quantity, unit, planned_delivery_date, status, machine:machines!inner(id, name, factory_id, is_archived)')
      .neq('status', 'received')
      .eq('machines.factory_id', factoryId)
      .eq('machines.is_archived', false),
    admin.from('consumable_requests')
      .select('id, need_by_date, requested_quantity, received_quantity, status, consumable:consumables(name, unit)')
      .eq('factory_id', factoryId)
      .in('status', ['new', 'invoice_taken', 'delivery', 'received_partial']),
    admin.from('detailing_transfers')
      .select('id, machine_id, expected_arrival_date, status, machine:machines!inner(id, name, is_archived)')
      .eq('destination_factory_id', factoryId)
      .eq('machines.is_archived', false)
      .in('status', ['needs_date', 'scheduled', 'partially_received']),
    admin.from('inventory_transfers')
      .select('id, machine_id, expected_arrival_date, status, machine:machines!inner(id, name, is_archived)')
      .eq('destination_factory_id', factoryId)
      .eq('machines.is_archived', false)
      .in('status', ['needs_date', 'scheduled', 'partially_received']),
    admin.from('machine_outsourcing_operations')
      .select('id, planned_return_date, actual_returned_at, machine:machines!inner(id, name, factory_id, is_archived), work_type:outsourcing_work_types(name)')
      .is('archived_at', null)
      .is('actual_returned_at', null)
      .eq('machines.factory_id', factoryId)
      .eq('machines.is_archived', false),
    admin.from('machine_outsourcing_transport_needs')
      .select('id, needed_date, direction, status, operation:machine_outsourcing_operations!inner(machine:machines!inner(id, name, factory_id, is_archived))')
      .in('status', ['open', 'linked'])
      .eq('operation.machine.factory_id', factoryId)
      .eq('operation.machine.is_archived', false),
  ])
  for (const [result, message] of [
    [legacySupplyResult, 'Не удалось загрузить legacy-риски снабжения'],
    [consumablesResult, 'Не удалось загрузить риски расходников'],
    [detailingResult, 'Не удалось загрузить риски деталировки'],
    [inventoryResult, 'Не удалось загрузить межзаводские перемещения'],
    [outsourcingResult, 'Не удалось загрузить риски аутсорсинга'],
    [transportResult, 'Не удалось загрузить транспортные риски'],
  ] as Array<[DbResult, string]>) throwOnError(result, message)
  if (ordersResult.error) throw new Error(ordersResult.error)

  const relationOne = <T>(value: T | T[] | null) => Array.isArray(value) ? value[0] || null : value
  const risks: PlanningSupplyRisk[] = []
  for (const item of ordersResult.data || []) {
    if (item.factory_id !== factoryId) continue
    risks.push(...materialRiskFromOrderItem(item, factoryId))
  }
  const canonicalMaterialKeys = new Set(
    risks.filter((risk) => risk.category === 'materials')
      .map((risk) => `${risk.context || ''}:${risk.title}`.trim().toLocaleLowerCase('uk-UA')),
  )
  type LegacySupplyRow = {
    id: string
    nomenclature: string | null
    quantity: number | null
    unit: string | null
    planned_delivery_date: string | null
    machine: { id: string; name: string } | Array<{ id: string; name: string }> | null
  }
  for (const row of (legacySupplyResult.data || []) as LegacySupplyRow[]) {
    const machine = relationOne(row.machine)
    const title = row.nomenclature || 'Позиция снабжения'
    const duplicateKey = `${machine?.name || ''}:${title}`.trim().toLocaleLowerCase('uk-UA')
    if (canonicalMaterialKeys.has(duplicateKey)) continue
    risks.push({
      id: `legacy-supply-${row.id}`,
      category: 'materials',
      title,
      context: machine?.name || 'Legacy-снабжение',
      dueDate: row.planned_delivery_date,
      remainingQuantity: row.quantity === null ? null : Number(row.quantity),
      unit: row.unit,
      overdueDays: null,
      href: machine?.id ? `${ROUTES.SUPPLY}/${machine.id}` : ROUTES.SUPPLY,
    })
  }

  type ConsumableRow = {
    id: string
    need_by_date: string | null
    requested_quantity: number
    received_quantity: number
    consumable: { name: string; unit: string } | Array<{ name: string; unit: string }> | null
  }
  for (const row of (consumablesResult.data || []) as ConsumableRow[]) {
    const remaining = Math.max(0, Number(row.requested_quantity || 0) - Number(row.received_quantity || 0))
    if (remaining <= 0) continue
    const consumable = relationOne(row.consumable)
    risks.push({
      id: `consumable-${row.id}`,
      category: 'consumables',
      title: consumable?.name || 'Расходник',
      context: 'Производственная заявка',
      dueDate: row.need_by_date,
      remainingQuantity: remaining,
      unit: consumable?.unit || null,
      overdueDays: null,
      href: `${ROUTES.SUPPLY_CONSUMABLE_REQUESTS}?focus=${row.id}`,
    })
  }

  type TransferRow = {
    id: string
    expected_arrival_date: string | null
    machine: { id: string; name: string } | Array<{ id: string; name: string }> | null
  }
  for (const [rows, category, prefix] of [
    [detailingResult.data || [], 'detailing', 'Деталировка'],
    [inventoryResult.data || [], 'transfers', 'Материал'],
  ] as Array<[unknown[], 'detailing' | 'transfers', string]>) {
    for (const row of rows as TransferRow[]) {
      const machine = relationOne(row.machine)
      risks.push({
        id: `${category}-${row.id}`,
        category,
        title: `${prefix}: ${machine?.name || 'заказ'}`,
        context: 'Межзаводское перемещение',
        dueDate: row.expected_arrival_date,
        remainingQuantity: null,
        unit: null,
        overdueDays: null,
        href: category === 'detailing'
          ? `${ROUTES.SUPPLY_TRANSPORT}?focus=detailing:${row.id}`
          : `${ROUTES.SUPPLY_TRANSPORT}?focus=materials:${row.id}`,
      })
    }
  }

  type OutsourcingRow = {
    id: string
    planned_return_date: string | null
    machine: { name: string } | Array<{ name: string }> | null
    work_type: { name: string } | Array<{ name: string }> | null
  }
  for (const row of (outsourcingResult.data || []) as OutsourcingRow[]) {
    risks.push({
      id: `outsourcing-${row.id}`,
      category: 'outsourcing',
      title: relationOne(row.work_type)?.name || 'Аутсорсинг / возврат',
      context: relationOne(row.machine)?.name || null,
      dueDate: row.planned_return_date,
      remainingQuantity: null,
      unit: null,
      overdueDays: null,
      href: `${ROUTES.SUPPLY_OUTSOURCING_REQUESTS}?focus=${row.id}`,
    })
  }

  type TransportRow = {
    id: string
    needed_date: string | null
    direction: string
    operation: { machine: { name: string } | Array<{ name: string }> | null } | Array<{ machine: { name: string } | Array<{ name: string }> | null }> | null
  }
  for (const row of (transportResult.data || []) as TransportRow[]) {
    const operation = relationOne(row.operation)
    risks.push({
      id: `transport-${row.id}`,
      category: 'transport',
      title: row.direction === 'return' ? 'Транспорт: возврат' : 'Транспорт: отправка',
      context: relationOne(operation?.machine || null)?.name || null,
      dueDate: row.needed_date,
      remainingQuantity: null,
      unit: null,
      overdueDays: null,
      href: `${ROUTES.SUPPLY_TRANSPORT}?focus=outsourcing:${row.id}`,
    })
  }

  const split = splitSupplyRisks(risks, today)
  return {
    overdue: split.overdue.slice(0, 20),
    undated: split.undated.slice(0, 20),
    overdueCount: split.overdue.length,
    undatedCount: split.undated.length,
  }
}

export function createPlanningDashboardPromises(input: {
  context: DashboardContext
  factoryId: string
  month: string
  today?: string
}) {
  const today = input.today || todayInUzhgorod()
  return {
    personalItems: getPlanningPersonalItems(input.context, today),
    assemblyTonnage: getPlanningAssemblyTonnage(input.factoryId, input.month, today),
    overdueShipments: getPlanningOverdueShipments(input.factoryId, today),
    todaySections: getPlanningTodaySections(input.factoryId, today),
    supplyRisks: getPlanningSupplyRisks(input.factoryId, today),
    updatedAt: new Date().toISOString(),
  }
}
