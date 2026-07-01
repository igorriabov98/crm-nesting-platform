"use server"

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { STAGE_ORDER } from '@/lib/constants/stages'
import { differenceInCalendarDays, isPast, addDays } from 'date-fns'
import type { StageType } from '@/lib/types'

export type GanttStageStatus = 'not_planned' | 'active' | 'completed' | 'overdue'

export interface GanttStage {
  id: string
  stage_type: StageType
  workshop: number | null
  date_start: string
  date_end: string
  manual_overdue: boolean
  is_night_shift: boolean
  night_shift_date: string | null
  status: GanttStageStatus
  delay_days: number
}

export interface GanttSupplyItem {
  id: string
  nomenclature: string
  planned_delivery_date: string
  supply_status: string
  is_overdue: boolean
}

export interface GanttMaterialItem {
  id: string
  nomenclature: string
  planned_delivery_date: string | null
  actual_delivery_date: string | null
  supply_status: string
  unit: string | null
  quantity: number | null
  supplier: string | null
  price_per_unit: number | null
  comment: string | null
  source?: 'legacy_supply' | 'supply_order'
}

export interface GanttMachine {
  id: string
  name: string
  created_at: string
  factory_id: string | null
  production_month: string | null
  production_workshop: number | null
  production_queue_number: number | null
  total_weight: number
  is_confirmed: boolean
  desired_shipping_date: string | null
  planned_material_date: string | null
  actual_material_date: string | null
  actual_shipping_date: string | null
  delivery_to_client_date: string | null
  coatings: string[]
  stages: GanttStage[]
  supply_deadlines: GanttSupplyItem[]
  material_items: GanttMaterialItem[]
}

export interface GanttData {
  machines: GanttMachine[]
  dateRange: { start: string; end: string }
}

type RawGanttStage = {
  stage_type: StageType
  date_start: string | null
  date_end: string | null
  manual_overdue?: boolean | null
}

type SelectedGanttStage = RawGanttStage & {
  id: string
  workshop: number | null
  is_skipped: boolean | null
  is_night_shift: boolean | null
  night_shift_date: string | null
}

type PlannedGanttStage = SelectedGanttStage & {
  date_start: string
}

type SelectedMachineItem = {
  coating: string | null
}

type SelectedSupplyItem = {
  id: string
  nomenclature: string | null
  planned_delivery_date: string | null
  status: string | null
  unit: string | null
  quantity: number | null
  supplier: string | null
  price_per_unit: number | null
  comment: string | null
}

type SelectedGanttMachine = {
  id: string
  name: string
  created_at: string
  total_weight: number | null
  factory_id: string | null
  production_month: string | null
  production_workshop: number | null
  production_queue_number: number | null
  is_confirmed?: boolean | null
  desired_shipping_date?: string | null
  planned_material_date?: string | null
  actual_material_date?: string | null
  actual_shipping_date?: string | null
  delivery_to_client_date?: string | null
  machine_items?: SelectedMachineItem[] | null
  production_stages?: SelectedGanttStage[] | null
  supply_items?: SelectedSupplyItem[] | null
}

type ProfileScope = {
  factory_id: string | null
  role: string | null
}

type GanttDbResult = { data: unknown; error: { message?: string } | null }
type LooseGanttQuery = PromiseLike<GanttDbResult> & {
  select: (columns?: string) => LooseGanttQuery
  eq: (column: string, value: unknown) => LooseGanttQuery
  in: (column: string, values: unknown[]) => LooseGanttQuery
}
type LooseGanttDb = { from: (table: string) => LooseGanttQuery }

type GanttRequestRow = {
  id: string
  machine_id: string
}

type GanttRequestItemRow = Record<string, unknown> & {
  id: string
  request_id: string
  materials?: { id: string; name: string } | null
  supplier_id?: string | null
  custom_delivery_date?: string | null
  order_status?: string | null
  calculated_weight_kg?: number | null
}

type GanttSupplyOrderItem = {
  table: string
  id: string
  request_id: string
  machine_id: string
  nomenclature: string
  quantity: number
  unit: string
  supplier_id: string | null
  planned_delivery_date: string | null
  order_status: string
}

type GanttScheduleRow = {
  id: string
  request_item_table: string
  request_item_id: string
  delivery_date: string
  quantity: number | null
  unit: string | null
  supplier_id: string | null
  status: 'planned' | 'delivered' | string
  received_quantity: number | null
  delivered_at: string | null
}
type GanttSteelTypeRow = {
  id: string
  name: string
}

const GANTT_ORDER_TABLES = [
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

function isPlannedStage(stage: SelectedGanttStage): stage is PlannedGanttStage {
  return !stage.is_skipped && Boolean(stage.date_start)
}

function computeGanttStatus(s: RawGanttStage): { status: GanttStageStatus; delay_days: number } {
  if (!s.date_start) return { status: 'not_planned', delay_days: 0 }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const startDate = new Date(s.date_start)
  const endDate = s.date_end ? new Date(s.date_end) : null

  if (s.stage_type === 'actual_shipping' && endDate) {
    return { status: 'completed', delay_days: 0 }
  }

  if (s.manual_overdue) {
    return {
      status: 'overdue',
      delay_days: endDate ? Math.max(0, differenceInCalendarDays(today, endDate)) : 0,
    }
  }

  if (differenceInCalendarDays(today, startDate) >= 0) {
    return { status: 'active', delay_days: 0 }
  }

  return { status: 'not_planned', delay_days: 0 }
}

function applyProductionManagerFactoryScope<T>(query: T, factoryId: string | null): T {
  const scopedQuery = query as { or: (filters: string) => T; is: (column: string, value: unknown) => T }
  if (!factoryId) return scopedQuery.is('factory_id', null)
  return scopedQuery.or(`factory_id.eq.${factoryId},factory_id.is.null`)
}

function valueText(value: unknown) {
  const text = String(value || '').trim()
  return text.length > 0 ? text : null
}

function compactParts(parts: unknown[]) {
  const seen = new Set<string>()
  return parts
    .map((part) => typeof part === 'number' ? String(part) : valueText(part))
    .filter((part): part is string => Boolean(part))
    .filter((part) => {
      const key = part.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function formatGanttNumber(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(number)
}

function steelName(row: GanttRequestItemRow, steelTypeNames: Map<string, string>) {
  const steelTypeId = valueText(row.steel_type_id)
  return (
    (steelTypeId ? steelTypeNames.get(steelTypeId) : null) ||
    valueText(row.material_grade) ||
    valueText(row.steel_grade)
  )
}

function dimensionText(...values: unknown[]) {
  const dimensions = values.map(formatGanttNumber).filter(Boolean)
  return dimensions.length > 0 ? `${dimensions.join('x')} мм` : null
}

function pipeTypeLabel(value: unknown) {
  if (value === 'round') return 'Труба круглая'
  if (value === 'square') return 'Труба квадратная'
  if (value === 'rectangular') return 'Труба прямоугольная'
  if (value === 'wire') return 'Проволока'
  return 'Труба'
}

function ganttItemName(
  table: string,
  row: GanttRequestItemRow,
  fallback: unknown,
  steelTypeNames: Map<string, string>,
) {
  const materialName = valueText(row.material_name) || row.materials?.name || null
  const steel = steelName(row, steelTypeNames)

  if (table === 'request_sheet_metal') {
    const thickness = formatGanttNumber(row.thickness_mm)
    return compactParts([
      materialName || 'Листовой металл',
      steel,
      row.sheet_size,
      thickness ? `${thickness} мм` : null,
    ]).join(' · ')
  }

  if (table === 'request_round_tube') {
    return compactParts([
      materialName || 'Круг / труба',
      row.piece_count,
    ]).join(' · ')
  }

  if (table === 'request_circle') {
    const diameter = formatGanttNumber(row.diameter_mm)
    return compactParts([
      row.materials?.name || 'Круг',
      steel,
      diameter ? `Ø${diameter} мм` : null,
      row.is_calibrated ? 'калиброванный' : null,
    ]).join(' · ')
  }

  if (table === 'request_pipe') {
    const diameter = formatGanttNumber(row.diameter_mm)
    const wall = formatGanttNumber(row.wall_thickness_mm)
    return compactParts([
      pipeTypeLabel(row.pipe_type),
      steel,
      row.size || (diameter ? `Ø${diameter} мм` : null),
      wall ? `стенка ${wall} мм` : null,
    ]).join(' · ')
  }

  if (table === 'request_knives') {
    return compactParts([
      row.knife_type || row.materials?.name || 'Ножи',
      steel,
      dimensionText(row.length_mm, row.width_mm, row.height_mm),
    ]).join(' · ')
  }

  if (table === 'request_components') {
    const diameter = formatGanttNumber(row.diameter_mm)
    return compactParts([
      row.component_name || row.materials?.name || 'Комплектация',
      diameter ? `Ø${diameter} мм` : null,
    ]).join(' · ')
  }

  if (table === 'request_paint') {
    return compactParts([
      row.paint_type || row.materials?.name || 'Краска',
      row.ral_code,
      row.finish,
    ]).join(' · ')
  }

  if (table === 'request_mesh') {
    return compactParts([
      row.materials?.name || 'Сетка',
      row.description,
      dimensionText(row.length_mm, row.width_mm),
    ]).join(' · ')
  }

  if (table === 'request_chain_cord') {
    return compactParts([
      row.item_type || row.materials?.name || 'Цепь / Шнур',
      row.parameters,
    ]).join(' · ')
  }

  return row.materials?.name || String(fallback || 'Материал')
}

function ganttRequestedQuantity(table: string, row: GanttRequestItemRow) {
  if (table === 'request_sheet_metal') return Number(row.remainder_qty || row.to_order_kg || 0)
  if (table === 'request_round_tube') return Number(row.order_kg || 0)
  if (table === 'request_circle') return Number(row.remainder_mm || 0)
  if (table === 'request_pipe') return row.pipe_type === 'wire' ? Number(row.remainder_kg || 0) : Number(row.remainder_length_mm || 0)
  if (table === 'request_knives') {
    const meters = Number(row.remainder_meters || 0)
    return meters > 0 ? meters * 1000 : Number(row.to_order_mm || 0)
  }
  if (table === 'request_components') return Math.max(Number(row.quantity_needed || 0) - Number(row.stock_remainder || 0), 0)
  if (table === 'request_mesh') return Number(row.remainder_qty || 0)
  if (table === 'request_chain_cord') return Number(row.remainder_meters || 0) * 1000
  return Number(row.remainder_kg || row.to_order_kg || 0)
}

function ganttReservedQuantity(table: string, row: GanttRequestItemRow) {
  if (table === 'request_sheet_metal') return Number(row.reserved_from_stock_kg || 0)
  if (table === 'request_round_tube') return Number(row.reserved_from_stock_kg || 0)
  if (table === 'request_circle') return Number(row.reserved_from_stock_mm || 0)
  if (table === 'request_pipe') return row.pipe_type === 'wire' ? Number(row.reserved_from_stock_kg || 0) : Number(row.reserved_from_stock_length_mm || 0)
  if (table === 'request_knives') return Number(row.reserved_from_stock_mm || 0)
  if (table === 'request_components') return Number(row.reserved_from_stock || 0)
  if (table === 'request_mesh') return Number(row.reserved_from_stock_qty || 0)
  if (table === 'request_chain_cord') return Number(row.reserved_from_stock_meters || 0) * 1000
  return Number(row.reserved_from_stock_kg || 0)
}

function ganttPrimaryUnit(table: string, row: GanttRequestItemRow) {
  if (table === 'request_sheet_metal') return 'шт'
  if (table === 'request_round_tube') return 'кг'
  if (table === 'request_circle') return 'мм'
  if (table === 'request_pipe') return row.pipe_type === 'wire' ? 'кг' : 'мм'
  if (table === 'request_knives') return 'мм'
  if (table === 'request_components') return String(row.unit || 'шт')
  if (table === 'request_mesh') return 'шт'
  if (table === 'request_chain_cord') return 'мм'
  return 'кг'
}

function ganttNameFallback(table: string, row: GanttRequestItemRow) {
  if (table === 'request_sheet_metal') return row.material_name
  if (table === 'request_round_tube') return row.material_name
  if (table === 'request_circle') return row.steel_grade
  if (table === 'request_pipe') return row.size
  if (table === 'request_knives') return row.knife_type
  if (table === 'request_components') return row.component_name
  if (table === 'request_paint') return row.paint_type || row.ral_code
  if (table === 'request_mesh') return row.description
  if (table === 'request_chain_cord') return row.parameters
  return row.material_name
}

async function loadGanttRequestRows(db: LooseGanttDb, table: string, requestIds: string[]) {
  if (requestIds.length === 0) return []
  const { data, error } = await db
    .from(table)
    .select('*, materials(id, name)')
    .in('request_id', requestIds)
  if (error) throw new Error(error.message || 'Не удалось загрузить материалы для Gantt')
  return (data || []) as GanttRequestItemRow[]
}

async function loadGanttSchedules(db: LooseGanttDb, items: GanttSupplyOrderItem[]) {
  const byTable = new Map<string, string[]>()
  for (const item of items) {
    byTable.set(item.table, [...(byTable.get(item.table) || []), item.id])
  }

  const rows = await Promise.all(Array.from(byTable.entries()).map(async ([table, ids]) => {
    const { data, error } = await db
      .from('supply_order_delivery_schedules')
      .select('id, request_item_table, request_item_id, delivery_date, quantity, unit, supplier_id, status, received_quantity, delivered_at')
      .eq('request_item_table', table)
      .in('request_item_id', ids)
    if (error) throw new Error(error.message || 'Не удалось загрузить график поставок для Gantt')
    return (data || []) as GanttScheduleRow[]
  }))

  return rows.flat()
}

async function loadGanttSupplierNames(db: LooseGanttDb, supplierIds: string[]) {
  const uniqueIds = Array.from(new Set(supplierIds.filter(Boolean)))
  if (uniqueIds.length === 0) return new Map<string, string>()

  const { data, error } = await db
    .from('suppliers')
    .select('id, name')
    .in('id', uniqueIds)

  if (error) throw new Error(error.message || 'Не удалось загрузить поставщиков для Gantt')
  return new Map(((data || []) as { id: string; name: string }[]).map((supplier) => [supplier.id, supplier.name]))
}

async function loadGanttSteelTypeNames(db: LooseGanttDb, steelTypeIds: string[]) {
  const uniqueIds = Array.from(new Set(steelTypeIds.filter(Boolean)))
  if (uniqueIds.length === 0) return new Map<string, string>()

  const { data, error } = await db
    .from('steel_types')
    .select('id, name')
    .in('id', uniqueIds)

  if (error) throw new Error(error.message || 'Не удалось загрузить марки стали для Gantt')
  return new Map(((data || []) as GanttSteelTypeRow[]).map((steelType) => [steelType.id, steelType.name]))
}

async function loadSupplyOrderMaterialMarkers(db: LooseGanttDb, machines: SelectedGanttMachine[]) {
  const machineIds = machines.map((machine) => machine.id).filter(Boolean)
  const machineDateMap = new Map(machines.map((machine) => [machine.id, machine.planned_material_date || null]))
  const result = new Map<string, GanttMaterialItem[]>()
  if (machineIds.length === 0) return result

  const { data: requestsData, error: requestsError } = await db
    .from('technologist_requests')
    .select('id, machine_id')
    .in('machine_id', machineIds)
    .in('status', ['submitted_to_supply', 'completed'])

  if (requestsError) throw new Error(requestsError.message || 'Не удалось загрузить заявки для Gantt')

  const requests = (requestsData || []) as GanttRequestRow[]
  const requestIds = requests.map((request) => request.id)
  if (requestIds.length === 0) return result

  const requestMachineMap = new Map(requests.map((request) => [request.id, request.machine_id]))
  const rowSets = await Promise.all(GANTT_ORDER_TABLES.map(async (table) => ({
    table,
    rows: await loadGanttRequestRows(db, table, requestIds),
  })))
  const steelTypeNames = await loadGanttSteelTypeNames(db, rowSets.flatMap(({ rows }) => (
    rows.map((row) => valueText(row.steel_type_id)).filter((id): id is string => Boolean(id))
  )))

  const items: GanttSupplyOrderItem[] = []
  for (const { table, rows } of rowSets) {
    for (const row of rows) {
      const machineId = requestMachineMap.get(row.request_id)
      if (!machineId) continue
      const requested = ganttRequestedQuantity(table, row)
      const reserved = ganttReservedQuantity(table, row)
      const quantity = Math.max(requested - reserved, 0)
      const orderStatus = row.order_status || 'pending'
      items.push({
        table,
        id: row.id,
        request_id: row.request_id,
        machine_id: machineId,
        nomenclature: ganttItemName(table, row, ganttNameFallback(table, row), steelTypeNames),
        quantity,
        unit: ganttPrimaryUnit(table, row),
        supplier_id: row.supplier_id || null,
        planned_delivery_date: row.custom_delivery_date || machineDateMap.get(machineId) || null,
        order_status: orderStatus,
      })
    }
  }

  if (items.length === 0) return result

  const schedules = await loadGanttSchedules(db, items)
  const schedulesByItem = new Map<string, GanttScheduleRow[]>()
  for (const schedule of schedules) {
    const key = `${schedule.request_item_table}:${schedule.request_item_id}`
    schedulesByItem.set(key, [...(schedulesByItem.get(key) || []), schedule])
  }

  const supplierNames = await loadGanttSupplierNames(db, [
    ...items.map((item) => item.supplier_id),
    ...schedules.map((schedule) => schedule.supplier_id),
  ].filter(Boolean) as string[])

  for (const item of items) {
    const itemSchedules = schedulesByItem.get(`${item.table}:${item.id}`) || []
    if (itemSchedules.length > 0) {
      for (const schedule of itemSchedules) {
        const isDelivered = schedule.status === 'delivered'
        const marker: GanttMaterialItem = {
          id: `supply-order-schedule:${schedule.id}`,
          nomenclature: item.nomenclature,
          planned_delivery_date: schedule.delivery_date,
          actual_delivery_date: isDelivered ? (schedule.delivered_at?.slice(0, 10) || schedule.delivery_date) : null,
          supply_status: isDelivered ? 'received' : (item.order_status === 'ordered' ? 'ordered' : 'not_ordered'),
          unit: schedule.unit || item.unit,
          quantity: Number(isDelivered ? (schedule.received_quantity ?? schedule.quantity ?? 0) : (schedule.quantity ?? 0)),
          supplier: schedule.supplier_id ? supplierNames.get(schedule.supplier_id) || 'Поставщик' : (item.supplier_id ? supplierNames.get(item.supplier_id) || 'Поставщик' : null),
          price_per_unit: null,
          comment: 'График снабжения',
          source: 'supply_order',
        }
        result.set(item.machine_id, [...(result.get(item.machine_id) || []), marker])
      }
      continue
    }

    if (!['pending', 'ordered'].includes(item.order_status) || item.quantity <= 0 || !item.planned_delivery_date) continue
    result.set(item.machine_id, [
      ...(result.get(item.machine_id) || []),
      {
        id: `supply-order:${item.table}:${item.id}`,
        nomenclature: item.nomenclature,
        planned_delivery_date: item.planned_delivery_date,
        actual_delivery_date: null,
        supply_status: item.order_status === 'ordered' ? 'ordered' : 'not_ordered',
        unit: item.unit,
        quantity: item.quantity,
        supplier: item.supplier_id ? supplierNames.get(item.supplier_id) || 'Поставщик' : null,
        price_per_unit: null,
        comment: 'Позиция снабжения',
        source: 'supply_order',
      },
    ])
  }

  return result
}

export async function getGanttData(
  factoryFilter?: string | null,
  filters?: {
    workshop?: number
    stageTypes?: string[]
    search?: string
    showSupply?: boolean
  }
): Promise<GanttData> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Не авторизован')

  const { data: profile } = await supabase.from('users').select('factory_id, role').eq('id', user.id).single()
  if (!profile) throw new Error('Профиль не найден')
  const profileScope = profile as ProfileScope
  const userFactoryId = profileScope.factory_id
  const userRole = profileScope.role

  const selectWithDeadline = `
    id, name, created_at, total_weight, factory_id, production_month, production_workshop,
    production_queue_number, is_confirmed, desired_shipping_date, planned_material_date,
    actual_material_date, actual_shipping_date, delivery_to_client_date,
    machine_items(coating),
    production_stages(
      id, stage_type, workshop, date_start, date_end, manual_overdue,
      is_skipped, is_night_shift, night_shift_date
    ),
    supply_items(
      id, nomenclature, planned_delivery_date, status,
      unit, quantity, supplier, price_per_unit, comment
    )
  `

  const selectWithoutDeadline = `
    id, name, created_at, total_weight, factory_id, production_month, production_workshop,
    production_queue_number,
    machine_items(coating),
    production_stages(
      id, stage_type, workshop, date_start, date_end, manual_overdue,
      is_skipped, is_night_shift, night_shift_date
    ),
    supply_items(
      id, nomenclature, planned_delivery_date, status,
      unit, quantity, supplier, price_per_unit, comment
    )
  `

  const buildQuery = (columns: string) => {
    let builtQuery = supabase
      .from('machines_with_totals')
      .select(columns)
      .eq('is_archived', false)

    if (userRole === 'production_manager') {
      builtQuery = applyProductionManagerFactoryScope(builtQuery, userFactoryId)
    } else if (factoryFilter && factoryFilter !== 'all') {
      builtQuery = builtQuery.eq('factory_id', factoryFilter)
    } else {
      builtQuery = builtQuery.not('factory_id', 'is', null)
    }

    return builtQuery.order('created_at', { ascending: false })
  }

  const selectWithDeadlineLegacy = selectWithDeadline.replace(', manual_overdue', '')
  const selectWithoutDeadlineLegacy = selectWithoutDeadline.replace(', manual_overdue', '')

  let { data: machines, error } = await buildQuery(selectWithDeadline)

  if (error && error.message?.includes('manual_overdue')) {
    const fallback = await buildQuery(selectWithDeadlineLegacy)
    machines = fallback.data
    error = fallback.error
  }

  if (error && error.message?.includes('desired_shipping_date')) {
    const fallback = await buildQuery(selectWithoutDeadline)
    machines = fallback.data
    error = fallback.error

    if (error && error.message?.includes('manual_overdue')) {
      const legacyFallback = await buildQuery(selectWithoutDeadlineLegacy)
      machines = legacyFallback.data
      error = legacyFallback.error
    }
  }

  if (error) throw new Error(error.message)

  let minDate: Date | null = null
  let maxDate: Date | null = null
  const today = new Date()
  const selectedMachines = (machines as SelectedGanttMachine[] | null) || []
  const supplyOrderMaterialMap = await loadSupplyOrderMaterialMarkers(supabase as unknown as LooseGanttDb, selectedMachines)

  const result: GanttMachine[] = []

  for (const m of selectedMachines) {
    // Filter by search
    if (filters?.search) {
      const q = filters.search.toLowerCase()
      if (!m.name.toLowerCase().includes(q)) continue
    }

    const rawStages = (m.production_stages || [])
      .filter(isPlannedStage) // only planned, not skipped
      .sort((a, b) => STAGE_ORDER.indexOf(a.stage_type) - STAGE_ORDER.indexOf(b.stage_type))

    // Filter by workshop
    if (filters?.workshop) {
      const hasWs = rawStages.some((s) => s.workshop === filters.workshop)
      if (!hasWs) continue
    }

    // Filter by stage type
    let stages = rawStages
    if (filters?.stageTypes && filters.stageTypes.length > 0) {
      stages = stages.filter((s) => filters.stageTypes!.includes(s.stage_type))
    }

    const ganttStages: GanttStage[] = stages.map((s) => {
      const { status, delay_days } = computeGanttStatus(s)
      const startDate = new Date(s.date_start)
      const endDate = s.date_end ? new Date(s.date_end) : addDays(startDate, 7)

      if (!minDate || startDate < minDate) minDate = startDate
      if (!maxDate || endDate > maxDate) maxDate = endDate

      return {
        id: s.id,
        stage_type: s.stage_type,
        workshop: s.workshop,
        date_start: s.date_start,
        date_end: s.date_end || addDays(startDate, 7).toISOString().split('T')[0],
        manual_overdue: Boolean(s.manual_overdue),
        is_night_shift: Boolean(s.is_night_shift),
        night_shift_date: s.night_shift_date,
        status,
        delay_days,
      }
    })

    ;[
      m.desired_shipping_date,
      m.planned_material_date,
      m.actual_material_date,
      m.actual_shipping_date,
      m.delivery_to_client_date,
    ].forEach((dateValue) => {
      if (!dateValue) return
      const markerDate = new Date(dateValue)
      if (!minDate || markerDate < minDate) minDate = markerDate
      if (!maxDate || markerDate > maxDate) maxDate = markerDate
    })

    // Supply deadlines
    const legacyMaterialItems: GanttMaterialItem[] = (m.supply_items || []).map((si) => ({
      id: si.id,
      nomenclature: si.nomenclature || '',
      planned_delivery_date: si.planned_delivery_date,
      actual_delivery_date: si.status === 'received' ? si.planned_delivery_date : null,
      supply_status: si.status || 'not_ordered',
      unit: si.unit,
      quantity: si.quantity,
      supplier: si.supplier,
      price_per_unit: si.price_per_unit,
      comment: si.comment,
      source: 'legacy_supply',
    }))
    const material_items: GanttMaterialItem[] = legacyMaterialItems.concat(supplyOrderMaterialMap.get(m.id) || [])

    material_items.forEach((item) => {
      ;[item.planned_delivery_date, item.actual_delivery_date].forEach((dateValue) => {
        if (!dateValue) return
        const markerDate = new Date(dateValue)
        if (!minDate || markerDate < minDate) minDate = markerDate
        if (!maxDate || markerDate > maxDate) maxDate = markerDate
      })
    })

    const supply_deadlines: GanttSupplyItem[] = (m.supply_items || [])
      .filter((si): si is SelectedSupplyItem & { planned_delivery_date: string } => Boolean(si.planned_delivery_date))
      .map((si) => {
        const d = new Date(si.planned_delivery_date)
        const is_overdue = si.status !== 'received' && isPast(d) &&
          differenceInCalendarDays(today, d) > 0
        return {
          id: si.id,
          nomenclature: si.nomenclature || '',
          planned_delivery_date: si.planned_delivery_date,
          supply_status: si.status || 'not_ordered',
          is_overdue,
        }
      })

    if (ganttStages.length === 0 && supply_deadlines.length === 0 && material_items.length === 0) continue
    
    const coatings = Array.from(new Set((m.machine_items || []).map((i) => i.coating).filter((coating): coating is string => Boolean(coating))))
    result.push({
      id: m.id,
      name: m.name,
      created_at: m.created_at,
      factory_id: m.factory_id,
      production_month: m.production_month,
      production_workshop: m.production_workshop,
      production_queue_number: m.production_queue_number,
      total_weight: m.total_weight || 0,
      is_confirmed: Boolean(m.is_confirmed),
      desired_shipping_date: m.desired_shipping_date || null,
      planned_material_date: m.planned_material_date || null,
      actual_material_date: m.actual_material_date || null,
      actual_shipping_date: m.actual_shipping_date || null,
      delivery_to_client_date: m.delivery_to_client_date || null,
      coatings,
      stages: ganttStages,
      supply_deadlines,
      material_items,
    })
  }

  // Default dateRange: current month ± buffer
  result.sort((a, b) => {
    const monthA = a.production_month || '9999-12-01'
    const monthB = b.production_month || '9999-12-01'
    if (monthA !== monthB) return monthA.localeCompare(monthB)

    const workshopA = a.production_workshop ?? 999
    const workshopB = b.production_workshop ?? 999
    if (workshopA !== workshopB) return workshopA - workshopB

    const queueA = a.production_queue_number ?? 999999
    const queueB = b.production_queue_number ?? 999999
    if (queueA !== queueB) return queueA - queueB

    return a.created_at.localeCompare(b.created_at)
  })

  if (!minDate) minDate = new Date(today.getFullYear(), today.getMonth(), 1)
  if (!maxDate) maxDate = new Date(today.getFullYear(), today.getMonth() + 3, 0)

  // Add 3-day padding
  const paddedStart = addDays(minDate, -3)
  const paddedEnd = addDays(maxDate, 3)

  return {
    machines: result,
    dateRange: {
      start: paddedStart.toISOString().split('T')[0],
      end: paddedEnd.toISOString().split('T')[0],
    },
  }
}
