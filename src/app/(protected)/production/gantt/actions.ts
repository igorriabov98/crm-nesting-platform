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
  supply_status: string
  unit: string | null
  quantity: number | null
  supplier: string | null
  price_per_unit: number | null
  comment: string | null
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

  const result: GanttMachine[] = []

  for (const m of (machines as SelectedGanttMachine[] | null) || []) {
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
    const material_items: GanttMaterialItem[] = (m.supply_items || []).map((si) => ({
      id: si.id,
      nomenclature: si.nomenclature || '',
      planned_delivery_date: si.planned_delivery_date,
      supply_status: si.status || 'not_ordered',
      unit: si.unit,
      quantity: si.quantity,
      supplier: si.supplier,
      price_per_unit: si.price_per_unit,
      comment: si.comment,
    }))

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

    if (ganttStages.length === 0 && supply_deadlines.length === 0) continue
    
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
