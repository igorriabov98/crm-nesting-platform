"use server"

import { requirePermission } from '@/lib/permissions/server'
import type { StageType } from '@/lib/types'
import { STAGE_ORDER, stageHasSingleDate } from '@/lib/constants/stages'
import { normalizeNightShiftDates } from '@/lib/utils/night-shift-dates'

export type StageStatus = 'not_planned' | 'active' | 'completed' | 'overdue' | 'skipped'

export type ProductionStageRow = {
  id: string
  stage_type: StageType
  workshop: number | null
  date_start: string | null
  date_end: string | null
  manual_overdue: boolean
  is_skipped: boolean
  is_night_shift: boolean
  night_shift_date: string | null
  night_shift_dates: string[]
  status: StageStatus
  delay_days: number
}

export type ProductionRow = {
  machine: {
    id: string
    name: string
    created_at: string
    total_weight: number
    has_zinc: boolean
    has_painting: boolean
    factory_id: string | null
    production_month: string | null
    production_workshop: number | null
    production_queue_number: number | null
    is_confirmed: boolean
    desired_shipping_date: string | null
    planned_material_date: string | null
    actual_material_date: string | null
    actual_shipping_date: string | null
    delivery_to_client_date: string | null
    is_fully_paid: boolean
  }
  stages: ProductionStageRow[]
}

type SelectedProductionStage = {
  id: string
  stage_type: StageType
  workshop: number | null
  date_start: string | null
  date_end: string | null
  manual_overdue?: boolean | null
  is_skipped: boolean | null
  is_night_shift: boolean | null
  night_shift_date: string | null
  night_shift_dates?: string[] | null
}

type SelectedProductionMachine = {
  id: string
  name: string
  created_at: string
  total_weight: number | null
  has_zinc: boolean | null
  has_painting: boolean | null
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
  production_stages?: SelectedProductionStage[] | null
}

type InvoicePaymentRow = {
  machine_id: string | null
  status: string | null
  amount: number | null
  paid_amount: number | null
}

function todayDateOnly() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function computeStatus(stage: SelectedProductionStage): { status: StageStatus; delay_days: number } {
  if (stage.is_skipped) return { status: 'skipped', delay_days: 0 }

  if (stage.stage_type === 'actual_shipping' && stage.date_end) {
    return { status: 'completed', delay_days: 0 }
  }

  if (stage.manual_overdue) {
    let delayDays = 0
    const today = todayDateOnly()
    if (stage.date_end && stage.date_end < today) {
      delayDays = Math.max(
        1,
        Math.ceil((new Date(`${today}T00:00:00`).getTime() - new Date(`${stage.date_end}T00:00:00`).getTime()) / 86400000)
      )
    }
    return { status: 'overdue', delay_days: delayDays }
  }

  if (!stage.date_start && !stage.date_end) return { status: 'not_planned', delay_days: 0 }

  const today = todayDateOnly()
  if (stageHasSingleDate(stage.stage_type)) {
    if (stage.date_end && stage.date_end <= today) {
      return { status: 'active', delay_days: 0 }
    }
    return { status: 'not_planned', delay_days: 0 }
  }

  if (stage.date_start && stage.date_start <= today) {
    return { status: 'active', delay_days: 0 }
  }

  return { status: 'not_planned', delay_days: 0 }
}

function isInvoiceFullyPaid(invoice: InvoicePaymentRow) {
  if (!invoice) return false
  if (invoice.status === 'paid') return true
  const amount = Number(invoice.amount || 0)
  const paid = Number(invoice.paid_amount || 0)
  return amount > 0 && paid >= amount
}

function applyProductionManagerFactoryScope<T>(query: T, factoryId: string | null): T {
  const scopedQuery = query as { or: (filters: string) => T; is: (column: string, value: unknown) => T }
  if (!factoryId) return scopedQuery.is('factory_id', null)
  return scopedQuery.or(`factory_id.eq.${factoryId},factory_id.is.null`)
}

export async function getProductionData(factoryFilter?: string | null) {
  const { supabase, role: userRole, factoryId: userFactoryId } = await requirePermission('production', 'view')

  const selectWithDeadline = `
    id, name, created_at, total_weight, has_zinc, has_painting, factory_id,
    production_month, production_workshop, production_queue_number,
    is_confirmed, desired_shipping_date, planned_material_date,
    actual_material_date, actual_shipping_date, delivery_to_client_date,
    production_stages(
      id, stage_type, workshop, date_start, date_end, manual_overdue,
      is_skipped, is_night_shift, night_shift_date, night_shift_dates
    )
  `

  const selectWithDeadlineLegacy = `
    id, name, created_at, total_weight, has_zinc, has_painting, factory_id,
    production_month, production_workshop, production_queue_number,
    is_confirmed, desired_shipping_date, planned_material_date,
    actual_material_date, actual_shipping_date, delivery_to_client_date,
    production_stages(
      id, stage_type, workshop, date_start, date_end,
      is_skipped, is_night_shift, night_shift_date
    )
  `

  const selectWithoutDeadline = `
    id, name, created_at, total_weight, has_zinc, has_painting, factory_id,
    production_month, production_workshop, production_queue_number,
    production_stages(
      id, stage_type, workshop, date_start, date_end, manual_overdue,
      is_skipped, is_night_shift, night_shift_date, night_shift_dates
    )
  `

  const selectWithoutDeadlineLegacy = `
    id, name, created_at, total_weight, has_zinc, has_painting, factory_id,
    production_month, production_workshop, production_queue_number,
    production_stages(
      id, stage_type, workshop, date_start, date_end,
      is_skipped, is_night_shift, night_shift_date
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
    }

    return builtQuery.order('created_at', { ascending: false })
  }

  let { data: machines, error } = await buildQuery(selectWithDeadline)

  if (error && error.message?.includes('night_shift_dates')) {
    const fallback = await buildQuery(selectWithDeadlineLegacy)
    machines = fallback.data
    error = fallback.error
  }

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

    if (error && error.message?.includes('night_shift_dates')) {
      const legacyFallback = await buildQuery(selectWithoutDeadlineLegacy)
      machines = legacyFallback.data
      error = legacyFallback.error
    }
  }

  if (error) {
    return { data: [] as ProductionRow[], error: error.message }
  }

  const machineRows = ((machines as SelectedProductionMachine[] | null) || [])
  const machineIds = machineRows.map((machine) => machine.id).filter(Boolean)
  const fullyPaidMachineIds = new Set<string>()

  if (machineIds.length > 0) {
    const { data: invoices, error: invoicesError } = await supabase
      .from('invoices')
      .select('machine_id, status, amount, paid_amount')
      .in('machine_id', machineIds)

    if (invoicesError) {
      return { data: [] as ProductionRow[], error: invoicesError.message }
    }

    for (const invoice of (invoices || []) as InvoicePaymentRow[]) {
      if (invoice.machine_id && isInvoiceFullyPaid(invoice)) fullyPaidMachineIds.add(invoice.machine_id)
    }
  }

  const rows: ProductionRow[] = machineRows
    .filter((m) => !fullyPaidMachineIds.has(m.id))
    .map((m) => {
    const rawStages = m.production_stages || []
    const sortedStages = [...rawStages].sort((a, b) =>
      STAGE_ORDER.indexOf(a.stage_type) - STAGE_ORDER.indexOf(b.stage_type)
    )

    const stages: ProductionStageRow[] = sortedStages.map((s) => {
      const { status, delay_days } = computeStatus(s)
      return {
        id: s.id,
        stage_type: s.stage_type,
        workshop: s.workshop,
        date_start: s.date_start,
        date_end: s.date_end,
        manual_overdue: Boolean(s.manual_overdue),
        is_skipped: Boolean(s.is_skipped),
        is_night_shift: Boolean(s.is_night_shift),
        night_shift_date: s.night_shift_date,
        night_shift_dates: normalizeNightShiftDates(s.night_shift_dates, s.night_shift_date),
        status,
        delay_days,
      }
    })

    return {
      machine: {
        id: m.id,
        name: m.name,
        created_at: m.created_at,
        total_weight: m.total_weight || 0,
        has_zinc: Boolean(m.has_zinc),
        has_painting: Boolean(m.has_painting),
        factory_id: m.factory_id,
        production_month: m.production_month,
        production_workshop: m.production_workshop,
        production_queue_number: m.production_queue_number,
        is_confirmed: Boolean(m.is_confirmed),
        desired_shipping_date: m.desired_shipping_date || null,
        planned_material_date: m.planned_material_date || null,
        actual_material_date: m.actual_material_date || null,
        actual_shipping_date: m.actual_shipping_date || null,
        delivery_to_client_date: m.delivery_to_client_date || null,
        is_fully_paid: false,
      },
      stages,
    }
  })

  return { data: rows, error: null }
}
