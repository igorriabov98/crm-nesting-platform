import 'server-only'

import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestItemSelect } from '@/lib/supply-orders/pipe-steel-grade'
import { requestedSupplyQuantity, reservedSupplyStockQuantity, supplyQuantityUnit } from '@/lib/supply-orders/demand-quantity'
import {
  resolveSupplyDeadlineFactoryAccess,
  type ReportFactory as Factory, type ReportFactoryGrant as Grant,
  type ReportMatrixPermission as MatrixRow,
} from './supply-deadline-access'
import {
  localReceiptDate, projectSupplyDeadlineRows,
  type DeadlineExclusion, type DeadlineSchedule, type DeadlineSnapshot,
  type DeadlineSource, type SupplyDeadlineRow,
} from './supply-deadline-projection'

type Query = PromiseLike<{ data: unknown; error: { message?: string } | null }> & {
  select: (columns: string) => Query
  in: (column: string, values: string[]) => Query
  eq: (column: string, value: unknown) => Query
  order: (column: string, options?: { ascending?: boolean }) => Query
  range: (from: number, to: number) => Query
}
type ReadDb = { from: (table: string) => Query }

type Request = {
  id: string
  request_kind: 'machine' | 'stock'
  factory_id: string | null
  machine_id: string | null
  title: string | null
  needed_by: string | null
  machines: {
    id: string
    name: string
    factory_id: string | null
    planned_material_date: string | null
    is_archived: boolean | null
  } | null
}
type Item = Record<string, unknown> & {
  id: string
  request_id: string
  order_status?: string | null
  supplier_id?: string | null
  materials?: { name?: string | null } | null
  steel_types?: { name?: string | null } | null
}
type Stage = { id: string; machine_id: string; stage_type: string; date_start: string | null; is_skipped: boolean | null }
type ExclusionRow = Omit<DeadlineExclusion, 'changed_by_name'> & { factory_id: string; changed_by: string }

const ITEM_TABLES = [
  'request_sheet_metal', 'request_round_tube', 'request_circle', 'request_pipe',
  'request_knives', 'request_components', 'request_paint', 'request_mesh', 'request_chain_cord',
] as const
const PAGE_SIZE = 30

export type SupplyDeadlineFilters = {
  tab: 'overdue' | 'shortages' | 'excluded'
  factory: string
  status: string
  search: string
  supplier: string
  requestKind: 'all' | 'machine' | 'stock'
  deadlineFrom: string
  deadlineTo: string
  receiptFrom: string
  receiptTo: string
  sort: 'deadline' | 'accepted' | 'material'
  page: number
}

export type SupplyDeadlinePageData = {
  filters: SupplyDeadlineFilters
  rows: SupplyDeadlineRow[]
  total: number
  pageCount: number
  counts: { overdue: number; shortages: number; excluded: number }
  factories: Factory[]
  suppliers: Array<{ id: string; name: string }>
  canManageFactoryIds: string[]
  generatedAt: string
}

function asRows<T>(result: { data: unknown; error: { message?: string } | null }, label: string): T[] {
  if (result.error) throw new Error(`${label}: ${result.error.message || 'ошибка базы данных'}`)
  return (result.data || []) as T[]
}

function batches<T>(values: T[], size = 200) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

async function loadByIds<T>(db: ReadDb, table: string, columns: string, field: string, ids: string[], orderBy = 'id') {
  const result: T[] = []
  for (const batch of batches(ids)) {
    for (let offset = 0; ; offset += 1000) {
      const page = asRows<T>(await db.from(table).select(columns).in(field, batch)
        .order(orderBy).range(offset, offset + 999), `Не удалось загрузить ${table}`)
      result.push(...page)
      if (page.length < 1000) break
    }
  }
  return result
}

async function reportFactoryAccess(db: ReadDb, auth: Awaited<ReturnType<typeof requirePermission>>) {
  const factories = asRows<Factory>(await db.from('factories').select('id, name').order('name'), 'Заводы')
  if (auth.permissionDetails.isAdminPosition) return resolveSupplyDeadlineFactoryAccess(factories, [], [], [], true)
  const memberships = auth.permissionDetails.memberships
  const departmentIds = [...new Set(memberships.map((member) => member.departmentId))]
  if (departmentIds.length === 0) return { factories: [], canManageFactoryIds: [] }
  const [grantRows, permissionRows] = await Promise.all([
    db.from('supply_deadline_factory_grants').select('department_id, subject_scope, factory_id, can_view, can_manage').in('department_id', departmentIds),
    db.from('department_access_permissions').select('department_id, subject_scope, can_view, can_manage')
      .in('department_id', departmentIds).eq('resource_key', 'supply_deadline_report'),
  ])
  const grants = asRows<Grant>(grantRows, 'Права по заводам')
  const matrix = asRows<MatrixRow>(permissionRows, 'Матрица доступа')
  return resolveSupplyDeadlineFactoryAccess(factories, memberships, grants, matrix, false)
}

function requestFactory(request: Request) {
  return request.request_kind === 'stock' ? request.factory_id : request.machines?.factory_id || null
}

function itemMaterialName(table: string, item: Item) {
  const material = item.materials?.name
  if (material) return material
  const fallback: Record<string, unknown> = {
    request_sheet_metal: item.material_name, request_round_tube: item.material_name,
    request_circle: item.steel_grade, request_pipe: item.size,
    request_knives: item.knife_type, request_components: item.component_name,
    request_paint: item.paint_type || item.ral_code, request_mesh: item.description,
    request_chain_cord: item.parameters,
  }
  return String(fallback[table] || table)
}

function itemCharacteristics(table: string, item: Item) {
  const values: Array<[string, unknown]> = table === 'request_sheet_metal'
    ? [['Тип стали', item.steel_types?.name || item.steel_grade], ['Толщина', item.thickness], ['Размер листа', item.size]]
    : table === 'request_paint'
      ? [['RAL', item.ral_code], ['Поверхность', item.finish]]
      : [['Тип стали', item.steel_types?.name], ['Размер', item.size], ['Марка', item.steel_grade], ['Параметры', item.parameters]]
  return values.filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    .map(([label, value]) => `${label}: ${value}`).join(' · ')
}

function parseDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

export function parseSupplyDeadlineFilters(input: Record<string, string | undefined>): SupplyDeadlineFilters {
  return {
    tab: input.tab === 'shortages' || input.tab === 'excluded' ? input.tab : 'overdue',
    factory: input.factory || 'all',
    status: input.status || 'all',
    search: (input.search || '').trim().slice(0, 120),
    supplier: input.supplier || 'all',
    requestKind: input.requestKind === 'machine' || input.requestKind === 'stock' ? input.requestKind : 'all',
    deadlineFrom: parseDate(input.deadlineFrom), deadlineTo: parseDate(input.deadlineTo),
    receiptFrom: parseDate(input.receiptFrom), receiptTo: parseDate(input.receiptTo),
    sort: input.sort === 'accepted' || input.sort === 'material' ? input.sort : 'deadline',
    page: Math.max(1, Math.min(100000, Number.parseInt(input.page || '1', 10) || 1)),
  }
}

function matchesFilters(row: SupplyDeadlineRow, filters: SupplyDeadlineFilters) {
  if (filters.factory !== 'all' && row.source.factoryId !== filters.factory) return false
  if (filters.status !== 'all' && row.status !== filters.status) return false
  if (filters.requestKind !== 'all' && row.source.requestKind !== filters.requestKind) return false
  if (filters.supplier !== 'all' && row.supplierId !== filters.supplier) return false
  if (filters.deadlineFrom && (!row.deadline || row.deadline < filters.deadlineFrom)) return false
  if (filters.deadlineTo && (!row.deadline || row.deadline > filters.deadlineTo)) return false
  const receiptDate = localReceiptDate(row.acceptedAt)
  if (filters.receiptFrom && (!receiptDate || receiptDate < filters.receiptFrom)) return false
  if (filters.receiptTo && (!receiptDate || receiptDate > filters.receiptTo)) return false
  if (filters.search) {
    const haystack = [row.source.materialName, row.source.characteristics, row.source.sourceName,
      row.supplierName, row.source.requestId].join(' ').toLocaleLowerCase('ru-RU')
    if (!haystack.includes(filters.search.toLocaleLowerCase('ru-RU'))) return false
  }
  return true
}

function sortRows(rows: SupplyDeadlineRow[], sort: SupplyDeadlineFilters['sort']) {
  return [...rows].sort((left, right) => {
    if (sort === 'material') return left.source.materialName.localeCompare(right.source.materialName, 'ru') || left.id.localeCompare(right.id)
    if (sort === 'accepted') return (right.acceptedAt || '').localeCompare(left.acceptedAt || '') || left.id.localeCompare(right.id)
    return (left.deadline || '9999-12-31').localeCompare(right.deadline || '9999-12-31') || left.id.localeCompare(right.id)
  })
}

export async function loadSupplyDeadlinePageData(input: Record<string, string | undefined>): Promise<SupplyDeadlinePageData> {
  const auth = await requirePermission('supply_deadline_report', 'view')
  const db = createAdminClient() as unknown as ReadDb
  const filters = parseSupplyDeadlineFilters(input)
  const access = await reportFactoryAccess(db, auth)
  if (filters.factory !== 'all' && !access.factories.some((factory) => factory.id === filters.factory)) {
    throw new Error('Недостаточно прав для выбранного завода')
  }
  const factoryIds = access.factories.map((factory) => factory.id)
  const empty = (suppliers: Array<{ id: string; name: string }> = []): SupplyDeadlinePageData => ({
    filters, rows: [], total: 0, pageCount: 0, counts: { overdue: 0, shortages: 0, excluded: 0 },
    factories: access.factories, suppliers, canManageFactoryIds: access.canManageFactoryIds,
    generatedAt: new Date().toISOString(),
  })
  if (factoryIds.length === 0) return empty()

  const requests: Request[] = []
  for (let offset = 0; ; offset += 1000) {
    const batch = asRows<Request>(await db.from('technologist_requests')
      .select('id, request_kind, factory_id, machine_id, title, needed_by, machines(id, name, factory_id, planned_material_date, is_archived)')
      .in('status', ['submitted_to_supply', 'completed']).order('id').range(offset, offset + 999), 'Заявки снабжения')
    requests.push(...batch.filter((request) => factoryIds.includes(requestFactory(request) || '')))
    if (batch.length < 1000) break
  }
  const requestIds = requests.map((request) => request.id)
  if (requestIds.length === 0) return empty()
  const requestById = new Map(requests.map((request) => [request.id, request]))
  const itemGroups = await Promise.all(ITEM_TABLES.map(async (table) => {
    const rows = await loadByIds<Item>(db, table, getRequestItemSelect(table), 'request_id', requestIds)
    return rows.filter((row) => row.is_cutting_plan_draft !== true)
      .map((row) => ({ table, row }))
  }))
  const items = itemGroups.flat()
  const itemIds = items.map(({ row }) => row.id)
  const scheduleRows = await loadByIds<DeadlineSchedule>(db, 'supply_order_delivery_schedules',
    'id, request_item_table, request_item_id, receipt_parent_schedule_id, redelivery_of_schedule_id, status, delivery_date, delivered_at, quantity, received_quantity, allocated_quantity, allocated_physical_quantity, received_piece_length_mm, received_piece_count, planned_piece_length_mm, allocated_piece_count, supplier_id, unit',
    'request_item_id', itemIds)
  const itemKeys = new Set(items.map(({ table, row }) => `${table}:${row.id}`))
  const schedules = scheduleRows.filter((row) => itemKeys.has(`${row.request_item_table}:${row.request_item_id}`))
  const scheduleIds = schedules.map((row) => row.id)
  const snapshots = await loadByIds<DeadlineSnapshot>(db, 'supply_deadline_receipt_snapshots',
    'schedule_id, material_deadline, cutting_start', 'schedule_id', scheduleIds, 'schedule_id')
  const exclusionRows = await loadByIds<ExclusionRow>(db, 'supply_deadline_exclusions',
    'id, factory_id, target_kind, request_item_table, request_item_id, schedule_id, active, reason, changed_at, changed_by',
    'factory_id', factoryIds)
  const actorIds = [...new Set(exclusionRows.map((row) => row.changed_by))]
  const actors = await loadByIds<{ id: string; full_name: string | null }>(db, 'users', 'id, full_name', 'id', actorIds)
  const actorName = new Map(actors.map((row) => [row.id, row.full_name]))
  const exclusions: DeadlineExclusion[] = exclusionRows.map((row) => ({
    ...row, changed_by_name: actorName.get(row.changed_by) || null,
  }))
  const supplierIds = [...new Set([...items.map(({ row }) => row.supplier_id), ...schedules.map((row) => row.supplier_id)]
    .filter((id): id is string => typeof id === 'string' && Boolean(id)))]
  const suppliers = await loadByIds<{ id: string; name: string }>(db, 'suppliers', 'id, name', 'id', supplierIds)
  suppliers.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  const supplierNames = new Map(suppliers.map((row) => [row.id, row.name]))
  for (const row of schedules) row.supplier_name = row.supplier_id ? supplierNames.get(row.supplier_id) || null : null
  const machineIds = [...new Set(requests.map((row) => row.machines?.id).filter((id): id is string => Boolean(id)))]
  const stages = await loadByIds<Stage>(db, 'production_stages', 'id, machine_id, stage_type, date_start, is_skipped', 'machine_id', machineIds)
  const cuttingStages = stages.filter((stage) => stage.stage_type === 'cutting' && !stage.is_skipped)
  const intervals = await loadByIds<{ production_stage_id: string; date_start: string | null }>(db,
    'production_stage_intervals', 'production_stage_id, date_start', 'production_stage_id', cuttingStages.map((stage) => stage.id))
  const stageDates = new Map<string, string>()
  for (const stage of cuttingStages) {
    const candidates = intervals.filter((row) => row.production_stage_id === stage.id).map((row) => row.date_start)
      .filter((date): date is string => Boolean(date))
    if (candidates.length === 0 && stage.date_start) candidates.push(stage.date_start)
    const date = candidates.sort()[0]
    if (date && (!stageDates.get(stage.machine_id) || date < stageDates.get(stage.machine_id)!)) stageDates.set(stage.machine_id, date)
  }
  const scheduleByItem = new Map<string, DeadlineSchedule[]>()
  for (const schedule of schedules) {
    const key = `${schedule.request_item_table}:${schedule.request_item_id}`
    scheduleByItem.set(key, [...(scheduleByItem.get(key) || []), schedule])
  }
  const factoryNames = new Map(access.factories.map((row) => [row.id, row.name]))
  const sources: DeadlineSource[] = items.flatMap(({ table, row }) => {
    const request = requestById.get(row.request_id)
    if (!request) return []
    const factoryId = requestFactory(request)
    if (!factoryId) return []
    const requested = requestedSupplyQuantity(table, row)
    const reserved = reservedSupplyStockQuantity(table, row)
    const procurementQuantity = row.order_status === 'cancelled' ? 0 : Math.max(requested - reserved, 0)
    const itemSchedules = scheduleByItem.get(`${table}:${row.id}`) || []
    if (procurementQuantity <= 0 && !itemSchedules.some((schedule) => schedule.status === 'delivered')) return []
    const machine = request.machines
    return [{
      table, itemId: row.id, requestId: request.id, requestKind: request.request_kind,
      sourceName: request.request_kind === 'stock' ? `На склад · ${request.title || 'Заявка'}` : machine?.name || 'Машина',
      factoryId, factoryName: factoryNames.get(factoryId) || 'Завод',
      materialName: itemMaterialName(table, row), characteristics: itemCharacteristics(table, row),
      supplierId: row.supplier_id || null, supplierName: row.supplier_id ? supplierNames.get(row.supplier_id) || null : null,
      materialDeadline: request.request_kind === 'stock' ? request.needed_by : machine?.planned_material_date || null,
      cuttingStart: request.request_kind === 'stock' ? null : stageDates.get(machine?.id || '') || null,
      procurementQuantity, unit: supplyQuantityUnit(table, row),
      legacyDelivered: row.order_status === 'delivered',
      legacyAcceptedAt: typeof row.delivered_at === 'string' ? row.delivered_at : null,
      schedules: itemSchedules,
    }]
  })
  const today = localReceiptDate(new Date().toISOString()) || new Date().toISOString().slice(0, 10)
  const projected = projectSupplyDeadlineRows(sources, snapshots, exclusions, today)
  const groups = {
    overdue: projected.overdue.filter((row) => matchesFilters(row, filters)),
    shortages: projected.shortages.filter((row) => matchesFilters(row, filters)),
    excluded: projected.excluded.filter((row) => matchesFilters(row, filters)),
  }
  const sorted = sortRows(groups[filters.tab], filters.sort)
  const total = sorted.length
  const pageCount = Math.ceil(total / PAGE_SIZE)
  const page = Math.min(filters.page, Math.max(pageCount, 1))
  return {
    filters: { ...filters, page }, rows: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total, pageCount,
    counts: { overdue: groups.overdue.length, shortages: groups.shortages.length, excluded: groups.excluded.length },
    factories: access.factories, suppliers, canManageFactoryIds: access.canManageFactoryIds,
    generatedAt: new Date().toISOString(),
  }
}
