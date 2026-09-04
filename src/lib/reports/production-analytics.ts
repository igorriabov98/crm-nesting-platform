import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import {
  factoryWorkingDates,
  getStageIntervals,
  isFactoryWorkingDay,
  isoWeekKey,
  type FactoryCalendarExceptionValue,
  type ProductionStageIntervalValue,
} from '@/lib/production-stage-intervals'
import type { Database } from '@/lib/types/database'
import { productionProgressStatus, weightedProgress } from '@/lib/reports/production-analytics-core'

export const PRODUCTION_REPORT_STAGE_KEYS = ['assembly', 'cleaning', 'painting', 'packaging'] as const
export type ProductionReportStageKey = typeof PRODUCTION_REPORT_STAGE_KEYS[number]
export type ProductionReportTab = 'overview' | 'progress' | 'load'

const STAGE_LABELS: Record<ProductionReportStageKey, string> = {
  assembly: 'Сборка/Сварка',
  cleaning: 'Слесарка/Зачистка',
  painting: 'Малярка',
  packaging: 'Упаковка',
}

type FactoryOption = { id: string; name: string }
type CalendarRow = FactoryCalendarExceptionValue & { factory_id: string; reason: string }
type SectionRow = {
  id: string
  factory_id: string
  parent_id: string | null
  name: string
  production_stage_type: Database['public']['Enums']['stage_type'] | null
}
type CapacityRow = {
  id: string
  factory_id: string
  section_id: string
  valid_from: string
  valid_to: string | null
  tons_per_workday: number
}
type ItemRow = {
  id: string
  machine_id: string
  quantity: number
  weight: number
  coating: Database['public']['Enums']['coating_type']
}
type ItemFactRow = {
  production_machine_fact_id: string
  machine_item_snapshot_id: string
  stage_type: Database['public']['Enums']['stage_type']
  quantity: number
  ordered_quantity: number
  unit_weight_kg: number
  coating: Database['public']['Enums']['coating_type']
  total_weight_kg: number
  machine_id: string
}
type TonnageFactRow = {
  factory_id: string
  fact_date: string
  section_id: string
  tonnage: number
  source: 'legacy_manual' | 'itemized'
}
type StageRow = {
  id: string
  stage_type: Database['public']['Enums']['stage_type']
  workshop: number | null
  date_start: string | null
  date_end: string | null
  planned_date_end: string | null
  is_skipped: boolean
  production_stage_intervals: ProductionStageIntervalValue[] | null
}
type MachineRow = {
  id: string
  name: string
  factory_id: string | null
  production_month: string | null
  production_workshop: number | null
  production_queue_number: number | null
  total_weight: number | null
  actual_material_date: string | null
  actual_shipping_date: string | null
  is_archived: boolean
  production_stages: StageRow[] | null
}

export type ProductionReportFilters = {
  month: string
  factoryId: string
  tab: ProductionReportTab
  stage: ProductionReportStageKey
  sectionId: string
}

export type ProductionReportPageData = {
  filters: ProductionReportFilters
  factories: FactoryOption[]
  canSelectAllFactories: boolean
  canManage: boolean
  generatedAt: string
  today: string
  overview: {
    freeze: { orders: number; tons: number }
    assemblyMonth: Metric
    assemblyToday: Metric
    accumulatedLagTons: number
    weekly: Array<{ week: string; plan: number; fact: number }>
    sections: Array<{
      id: string
      label: string
      stage: ProductionReportStageKey
      plan: number
      fact: number
      capacity: number | null
      utilizationPercent: number | null
      overloaded: boolean | null
    }>
  }
  progress: Array<{
    id: string
    label: string
    href: string
    factoryName: string
    stages: Array<{
      stage: ProductionReportStageKey
      label: string
      completedKg: number
      applicableKg: number
      percent: number | null
      status: 'ahead' | 'on_plan' | 'late' | 'upcoming' | 'data_error'
      statusLabel: string
    }>
  }>
  load: {
    sections: Array<{ id: string; label: string }>
    selectedSectionId: string
    days: Array<{
      date: string
      week: string
      isWorking: boolean
      plan: number
      fact: number
      capacity: number | null
      activeOrders: number
      overloaded: boolean | null
      nonWorkingFact: boolean
      deviationPercent: number | null
    }>
    weeks: Array<{
      week: string
      plan: number
      fact: number
      capacity: number | null
      activeOrders: number
      overloaded: boolean | null
    }>
  }
  warnings: string[]
}

type Metric = { plan: number; fact: number; deviation: number | null; percent: number | null }

function todayInUzhgorod(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Uzhgorod',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function normalizeMonth(value: string | null | undefined, today: string) {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : today.slice(0, 7)
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` }
}

function calendarForFactory(rows: CalendarRow[], factoryId: string | null) {
  return rows.filter((row) => row.factory_id === factoryId)
}

function stageIntervals(stage: StageRow): ProductionStageIntervalValue[] {
  const intervals = getStageIntervals({
    ...stage,
    date_end: stage.production_stage_intervals?.length ? stage.date_end : stage.planned_date_end || stage.date_end,
    intervals: stage.production_stage_intervals,
  })
  if (intervals.length > 0) return intervals
  if (!stage.date_start || !(stage.planned_date_end || stage.date_end)) return []
  return [{
    id: `direct:${stage.id}`,
    production_stage_id: stage.id,
    position: 1,
    date_start: stage.date_start,
    date_end: stage.planned_date_end || stage.date_end,
    workshop: stage.stage_type === 'assembly' ? stage.workshop : null,
  }]
}

function metric(plan: number, fact: number, isFuture = false): Metric {
  return {
    plan,
    fact,
    deviation: isFuture ? null : fact - plan,
    percent: isFuture || plan <= 0 ? null : fact / plan * 100,
  }
}

function sectionStage(section: SectionRow, byId: Map<string, SectionRow>): ProductionReportStageKey | null {
  const raw = section.production_stage_type || (section.parent_id ? byId.get(section.parent_id)?.production_stage_type : null)
  return PRODUCTION_REPORT_STAGE_KEYS.includes(raw as ProductionReportStageKey) ? raw as ProductionReportStageKey : null
}

function sectionWorkshop(section: SectionRow) {
  const match = section.name.match(/(?:цех|workshop)\s*(\d+)/i)
  return match ? Number(match[1]) : null
}

function capacityForDate(capacities: CapacityRow[], sectionId: string, date: string) {
  const row = capacities.find((item) => (
    item.section_id === sectionId
    && item.valid_from <= date
    && (!item.valid_to || item.valid_to >= date)
  ))
  return row ? Number(row.tons_per_workday || 0) : null
}

function chunks<T>(items: T[], size = 100) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

const REPORT_PAGE_SIZE = 1000

async function loadAllPages<T>(loader: (from: number, to: number) => Promise<{
  data: T[] | null
  error: { message?: string } | null
}>) {
  const rows: T[] = []
  for (let offset = 0; ; offset += REPORT_PAGE_SIZE) {
    const result = await loader(offset, offset + REPORT_PAGE_SIZE - 1)
    if (result.error) throw result.error
    const page = result.data || []
    rows.push(...page)
    if (page.length < REPORT_PAGE_SIZE) break
  }
  return rows
}

async function loadMachines(admin: ReturnType<typeof createAdminClient>, factoryIds: string[]) {
  return loadAllPages<MachineRow>(async (from, to) => {
    const result = await admin.from('machines_with_totals')
      .select('id, name, factory_id, production_month, production_workshop, production_queue_number, total_weight, actual_material_date, actual_shipping_date, is_archived, production_stages(id, stage_type, workshop, date_start, date_end, planned_date_end, is_skipped, production_stage_intervals(id, production_stage_id, position, date_start, date_end, workshop))')
      .in('factory_id', factoryIds)
      .eq('is_archived', false)
      .order('id')
      .range(from, to)
    return { data: (result.data || []) as unknown as MachineRow[], error: result.error }
  })
}

async function loadTonnageFacts(
  admin: ReturnType<typeof createAdminClient>,
  factoryIds: string[],
  start: string,
  end: string,
) {
  return loadAllPages<TonnageFactRow>(async (from, to) => {
    const result = await admin.from('production_tonnage_facts')
      .select('factory_id, fact_date, section_id, tonnage, source')
      .in('factory_id', factoryIds)
      .gte('fact_date', start)
      .lte('fact_date', end)
      .order('id')
      .range(from, to)
    return { data: (result.data || []) as TonnageFactRow[], error: result.error }
  })
}

async function loadRelatedRows(admin: ReturnType<typeof createAdminClient>, machineIds: string[]) {
  if (machineIds.length === 0) return { items: [] as ItemRow[], itemFacts: [] as ItemFactRow[] }
  const [itemGroups, headerGroups] = await Promise.all([
    Promise.all(chunks(machineIds).map((ids) => loadAllPages<ItemRow>(async (from, to) => {
      const result = await admin.from('machine_items')
        .select('id, machine_id, quantity, weight, coating')
        .in('machine_id', ids)
        .order('id')
        .range(from, to)
      return { data: (result.data || []) as ItemRow[], error: result.error }
    }))),
    Promise.all(chunks(machineIds).map((ids) => loadAllPages<{ id: string; machine_id: string }>(async (from, to) => {
      const result = await admin.from('production_machine_facts')
        .select('id, machine_id')
        .in('machine_id', ids)
        .order('id')
        .range(from, to)
      return { data: (result.data || []) as Array<{ id: string; machine_id: string }>, error: result.error }
    }))),
  ])
  const items = itemGroups.flat()
  const headers = headerGroups.flat()
  if (headers.length === 0) return { items, itemFacts: [] as ItemFactRow[] }
  const factGroups = await Promise.all(chunks(headers.map((header) => header.id)).map((ids) => (
    loadAllPages<Omit<ItemFactRow, 'machine_id'>>(async (from, to) => {
      const result = await admin.from('production_machine_item_facts')
        .select('production_machine_fact_id, machine_item_snapshot_id, stage_type, quantity, ordered_quantity, unit_weight_kg, coating, total_weight_kg')
        .in('production_machine_fact_id', ids)
        .order('id')
        .range(from, to)
      return {
        data: (result.data || []) as unknown as Omit<ItemFactRow, 'machine_id'>[],
        error: result.error,
      }
    })
  )))
  const machineByHeader = new Map(headers.map((header) => [header.id, header.machine_id]))
  return {
    items,
    itemFacts: factGroups.flat()
      .map((fact) => ({ ...fact, machine_id: machineByHeader.get(fact.production_machine_fact_id) || '' }))
      .filter((fact) => Boolean(fact.machine_id)),
  }
}

export async function loadProductionReportPageData(input: Partial<ProductionReportFilters> = {}): Promise<ProductionReportPageData> {
  const auth = await requirePermission('production_reports', 'view')
  const canManage = Boolean(auth.permissions.production_reports?.canManage)
  const scope = auth.permissionDetails.factoryScopes.production_reports?.view || 'own'
  const canSelectAllFactories = scope === 'all'
  const admin = createAdminClient()
  const today = todayInUzhgorod()
  const month = normalizeMonth(input.month, today)
  const factoriesResult = scope === 'all'
    ? await admin.from('factories').select('id, name').order('name')
    : auth.factoryId
      ? await admin.from('factories').select('id, name').eq('id', auth.factoryId)
      : { data: [], error: null }
  if (factoriesResult.error) throw factoriesResult.error
  const factories = (factoriesResult.data || []) as FactoryOption[]
  const requestedFactory = input.factoryId || ''
  const factoryId = requestedFactory === 'all' && canSelectAllFactories
    ? 'all'
    : factories.some((factory) => factory.id === requestedFactory)
      ? requestedFactory
      : factories[0]?.id || ''
  const factoryIds = factoryId === 'all' ? factories.map((factory) => factory.id) : factoryId ? [factoryId] : []
  const tab: ProductionReportTab = input.tab === 'progress' || input.tab === 'load' ? input.tab : 'overview'
  const stage: ProductionReportStageKey = PRODUCTION_REPORT_STAGE_KEYS.includes(input.stage as ProductionReportStageKey)
    ? input.stage as ProductionReportStageKey
    : 'assembly'
  const bounds = monthBounds(month)

  if (factoryIds.length === 0) {
    return {
      filters: { month, factoryId, tab, stage, sectionId: '' }, factories, canSelectAllFactories, canManage,
      generatedAt: new Date().toISOString(), today,
      overview: { freeze: { orders: 0, tons: 0 }, assemblyMonth: metric(0, 0), assemblyToday: metric(0, 0), accumulatedLagTons: 0, weekly: [], sections: [] },
      progress: [], load: { sections: [], selectedSectionId: '', days: [], weeks: [] }, warnings: [],
    }
  }

  const [machines, sectionsResult, calendarResult, capacityResult, tonnageFacts] = await Promise.all([
    loadMachines(admin, factoryIds),
    admin.from('production_fact_sections')
      .select('id, factory_id, parent_id, name, production_stage_type')
      .in('factory_id', factoryIds)
      .eq('is_active', true)
      .is('archived_at', null),
    admin.from('factory_work_calendar_exceptions')
      .select('factory_id, work_date, is_working, reason')
      .in('factory_id', factoryIds),
    admin.from('production_section_capacity_periods')
      .select('id, factory_id, section_id, valid_from, valid_to, tons_per_workday')
      .in('factory_id', factoryIds),
    loadTonnageFacts(admin, factoryIds, bounds.start, bounds.end),
  ])
  const firstError = [sectionsResult, calendarResult, capacityResult]
    .find((result) => result.error)?.error
  if (firstError) throw firstError

  const sections = (sectionsResult.data || []) as SectionRow[]
  const calendar = (calendarResult.data || []) as CalendarRow[]
  const capacities = (capacityResult.data || []) as CapacityRow[]
  const sectionById = new Map(sections.map((section) => [section.id, section]))
  const parentIds = new Set(sections.map((section) => section.parent_id).filter(Boolean))
  const applicableSections = sections.filter((section) => sectionStage(section, sectionById) && !parentIds.has(section.id))
  const loadSections = applicableSections
    .filter((section) => sectionStage(section, sectionById) === stage)
    .map((section) => ({
      id: section.id,
      label: factoryId === 'all'
        ? `${factories.find((item) => item.id === section.factory_id)?.name || 'Завод'} · ${section.name}`
        : section.name,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'ru'))
  const selectedSectionId = loadSections.some((section) => section.id === input.sectionId)
    ? input.sectionId!
    : loadSections[0]?.id || ''
  const selectedSection = sectionById.get(selectedSectionId) || null
  const { items, itemFacts } = await loadRelatedRows(admin, machines.map((machine) => machine.id))
  const itemsByMachine = new Map<string, ItemRow[]>()
  for (const item of items) itemsByMachine.set(item.machine_id, [...(itemsByMachine.get(item.machine_id) || []), item])
  const factoryName = new Map(factories.map((factory) => [factory.id, factory.name]))
  const warnings = new Set<string>()
  if (tonnageFacts.some((fact) => fact.source === 'legacy_manual')) {
    warnings.add('В периоде есть исторический ручной факт: он учтён в агрегатах, но не распределён по заказам.')
  }

  const planForMachinePeriod = (
    machine: MachineRow,
    stageKey: ProductionReportStageKey,
    start: string,
    end: string,
    section: SectionRow | null = null,
  ) => {
    const stageRow = (machine.production_stages || []).find((candidate) => candidate.stage_type === stageKey && !candidate.is_skipped)
    if (!stageRow) return { tons: 0, active: false }
    const intervals = stageIntervals(stageRow)
    if (intervals.length === 0) {
      warnings.add(`Нет корректного интервала этапа «${STAGE_LABELS[stageKey]}» у заказа «${machine.name}».`)
      return { tons: 0, active: false }
    }
    if (stageKey === 'assembly' && intervals.some((interval) => interval.workshop === null) && stageRow.workshop === null) {
      warnings.add(`Не назначен цех сборки у заказа «${machine.name}».`)
    }
    const calendarRows = calendarForFactory(calendar, machine.factory_id)
    const totalWorkingDays = intervals.reduce((total, interval) => (
      total + (interval.date_start && interval.date_end
        ? factoryWorkingDates(interval.date_start, interval.date_end, calendarRows).length
        : 0)
    ), 0)
    if (totalWorkingDays === 0) {
      warnings.add(`В интервале этапа «${STAGE_LABELS[stageKey]}» заказа «${machine.name}» нет рабочих дней.`)
      return { tons: 0, active: false }
    }
    const machineItems = itemsByMachine.get(machine.id) || []
    const applicableKg = machineItems
      .filter((item) => stageKey !== 'painting' || item.coating === 'powder_coating')
      .reduce((total, item) => total + Number(item.quantity || 0) * Number(item.weight || 0), 0)
    const weightTons = stageKey === 'painting'
      ? applicableKg / 1000
      : machineItems.length > 0 ? applicableKg / 1000 : Number(machine.total_weight || 0)
    if (section && sectionStage(section, sectionById) !== stageKey) return { tons: 0, active: false }
    const workshop = section && stageKey === 'assembly' ? sectionWorkshop(section) : null
    const targetIntervals = workshop === null
      ? intervals
      : intervals.filter((interval) => (interval.workshop ?? stageRow.workshop) === workshop)
    const overlapWorkingDays = targetIntervals.reduce((total, interval) => total + (
      interval.date_start && interval.date_end
        ? factoryWorkingDates(interval.date_start, interval.date_end, calendarRows)
            .filter((date) => date >= start && date <= end).length
        : 0
    ), 0)
    return {
      tons: totalWorkingDays > 0 ? weightTons * overlapWorkingDays / totalWorkingDays : 0,
      active: overlapWorkingDays > 0,
    }
  }

  const factFor = (start: string, end: string, sectionIds: Set<string>) => tonnageFacts
    .filter((fact) => fact.fact_date >= start && fact.fact_date <= end && sectionIds.has(fact.section_id))
    .reduce((total, fact) => total + Number(fact.tonnage || 0), 0)
  const assemblySectionIds = new Set(applicableSections
    .filter((section) => sectionStage(section, sectionById) === 'assembly')
    .map((section) => section.id))
  const assemblyMonthPlan = machines.reduce((total, machine) => total + planForMachinePeriod(machine, 'assembly', bounds.start, bounds.end).tons, 0)
  const assemblyMonthFact = factFor(bounds.start, bounds.end, assemblySectionIds)
  const assemblyTodayPlan = machines.reduce((total, machine) => total + planForMachinePeriod(machine, 'assembly', today, today).tons, 0)
  const assemblyTodayFact = today >= bounds.start && today <= bounds.end ? factFor(today, today, assemblySectionIds) : 0
  const throughDate = today < bounds.start ? null : today > bounds.end ? bounds.end : today
  const planThroughToday = throughDate
    ? machines.reduce((total, machine) => total + planForMachinePeriod(machine, 'assembly', bounds.start, throughDate).tons, 0)
    : 0
  const factThroughToday = throughDate ? factFor(bounds.start, throughDate, assemblySectionIds) : 0

  const monthDates = factoryWorkingDates(bounds.start, bounds.end, [{ work_date: '1900-01-01', is_working: true }])
    .concat(Array.from(new Set(calendar.filter((row) => row.work_date >= bounds.start && row.work_date <= bounds.end).map((row) => row.work_date))))
    .concat(tonnageFacts.map((fact) => fact.fact_date))
  const allMonthDates = Array.from(new Set(monthDates)).filter((date) => date >= bounds.start && date <= bounds.end).sort()
  const weeklyMap = new Map<string, { week: string; plan: number; fact: number }>()
  for (const date of allMonthDates) {
    const week = isoWeekKey(date)
    const row = weeklyMap.get(week) || { week, plan: 0, fact: 0 }
    row.plan += machines.reduce((total, machine) => total + planForMachinePeriod(machine, 'assembly', date, date).tons, 0)
    row.fact += factFor(date, date, assemblySectionIds)
    weeklyMap.set(week, row)
  }

  const sectionMetrics = applicableSections.map((section) => {
    const stageKey = sectionStage(section, sectionById)!
    const plan = machines.reduce((total, machine) => total + planForMachinePeriod(machine, stageKey, bounds.start, bounds.end, section).tons, 0)
    const fact = factFor(bounds.start, bounds.end, new Set([section.id]))
    const sectionCalendar = calendarForFactory(calendar, section.factory_id)
    const workingDates = factoryWorkingDates(bounds.start, bounds.end, sectionCalendar)
    const capacityValues = workingDates.map((date) => capacityForDate(capacities, section.id, date))
    const configured = workingDates.length > 0 && capacityValues.every((value) => value !== null)
    const capacity = configured
      ? capacityValues.reduce((total, value) => total + Number(value || 0), 0)
      : 0
    return {
      id: section.id,
      label: factoryId === 'all' ? `${factoryName.get(section.factory_id) || 'Завод'} · ${section.name}` : section.name,
      stage: stageKey,
      plan,
      fact,
      capacity: configured ? capacity : null,
      utilizationPercent: configured && capacity > 0 ? fact / capacity * 100 : null,
      overloaded: configured ? fact > capacity : null,
    }
  }).sort((left, right) => left.label.localeCompare(right.label, 'ru'))

  const progressMachines = machines.filter((machine) => machine.production_month?.slice(0, 7) === month)
  const itemFactsByMachineStage = new Map<string, Array<{ itemId: string; totalWeightKg: number }>>()
  for (const fact of itemFacts) {
    const key = `${fact.machine_id}:${fact.stage_type}`
    itemFactsByMachineStage.set(key, [
      ...(itemFactsByMachineStage.get(key) || []),
      { itemId: fact.machine_item_snapshot_id, totalWeightKg: Number(fact.total_weight_kg || 0) },
    ])
  }
  const progress = progressMachines.map((machine) => ({
    id: machine.id,
    label: `${machine.production_queue_number ? `${machine.production_queue_number}. ` : ''}${machine.name}`,
    href: `/sales-plan/${machine.id}`,
    factoryName: factoryName.get(machine.factory_id || '') || '—',
    stages: PRODUCTION_REPORT_STAGE_KEYS.map((stageKey) => {
      const factRows = itemFacts.filter((fact) => fact.machine_id === machine.id && fact.stage_type === stageKey)
      const machineItemsById = new Map((itemsByMachine.get(machine.id) || []).map((item) => [item.id, {
        id: item.id,
        quantity: Number(item.quantity || 0),
        unitWeightKg: Number(item.weight || 0),
        coating: item.coating,
      }]))
      for (const fact of factRows) {
        machineItemsById.set(fact.machine_item_snapshot_id, {
          id: fact.machine_item_snapshot_id,
          quantity: Number(fact.ordered_quantity || 0),
          unitWeightKg: Number(fact.unit_weight_kg || 0),
          coating: fact.coating,
        })
      }
      const machineItems = Array.from(machineItemsById.values())
      const stageProgress = weightedProgress(
        machineItems,
        itemFactsByMachineStage.get(`${machine.id}:${stageKey}`) || [],
        stageKey,
      )
      const { applicableKg, completedKg } = stageProgress
      const stageRow = (machine.production_stages || []).find((candidate) => candidate.stage_type === stageKey && !candidate.is_skipped)
      const intervals = stageRow ? stageIntervals(stageRow) : []
      const calendarRows = calendarForFactory(calendar, machine.factory_id)
      const status = stageRow
        ? productionProgressStatus({ applicableKg, completedKg, intervals, today, exceptions: calendarRows })
        : 'data_error'
      const statusLabel = status === 'data_error' ? 'Ошибка плана'
        : status === 'upcoming' ? 'Ещё не начат'
          : status === 'late' ? 'Отставание'
            : status === 'ahead' ? 'Опережение'
              : 'По плану'
      return {
        stage: stageKey,
        label: STAGE_LABELS[stageKey],
        completedKg,
        applicableKg,
        percent: applicableKg > 0 ? completedKg / applicableKg * 100 : null,
        status,
        statusLabel,
      }
    }),
  })).sort((left, right) => left.label.localeCompare(right.label, 'ru'))

  const loadDays: ProductionReportPageData['load']['days'] = []
  const allCalendarDates = (() => {
    const result: string[] = []
    const cursor = new Date(`${bounds.start}T00:00:00Z`)
    const end = new Date(`${bounds.end}T00:00:00Z`)
    while (cursor <= end) {
      result.push(cursor.toISOString().slice(0, 10))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return result
  })()
  for (const date of allCalendarDates) {
    const sectionCalendar = selectedSection ? calendarForFactory(calendar, selectedSection.factory_id) : []
    const isWorking = selectedSection ? isFactoryWorkingDay(date, sectionCalendar) : false
    const planRows = machines.map((machine) => planForMachinePeriod(machine, stage, date, date, selectedSection))
    const plan = planRows.reduce((total, row) => total + row.tons, 0)
    const fact = selectedSection ? factFor(date, date, new Set([selectedSection.id])) : 0
    const configuredCapacity = selectedSection && isWorking ? capacityForDate(capacities, selectedSection.id, date) : null
    loadDays.push({
      date,
      week: isoWeekKey(date),
      isWorking,
      plan,
      fact,
      capacity: configuredCapacity,
      activeOrders: planRows.filter((row) => row.active).length,
      overloaded: configuredCapacity === null ? null : fact > configuredCapacity,
      nonWorkingFact: !isWorking && fact > 0,
      deviationPercent: date > today || plan <= 0 ? null : (fact - plan) / plan * 100,
    })
  }
  const loadWeeks = Array.from(new Set(loadDays.map((day) => day.week))).map((week) => {
    const days = loadDays.filter((day) => day.week === week)
    const workingDays = days.filter((day) => day.isWorking)
    const configured = workingDays.length > 0 && workingDays.every((day) => day.capacity !== null)
    const capacity = configured ? days.reduce((total, day) => total + Number(day.capacity || 0), 0) : null
    const fact = days.reduce((total, day) => total + day.fact, 0)
    return {
      week,
      plan: days.reduce((total, day) => total + day.plan, 0),
      fact,
      capacity,
      activeOrders: Math.max(0, ...days.map((day) => day.activeOrders)),
      overloaded: capacity === null ? null : fact > capacity,
    }
  })

  return {
    filters: { month, factoryId, tab, stage, sectionId: selectedSectionId },
    factories,
    canSelectAllFactories,
    canManage,
    generatedAt: new Date().toISOString(),
    today,
    overview: {
      freeze: {
        orders: machines.filter((machine) => machine.actual_material_date && !machine.actual_shipping_date).length,
        tons: machines.filter((machine) => machine.actual_material_date && !machine.actual_shipping_date)
          .reduce((total, machine) => total + Number(machine.total_weight || 0), 0),
      },
      assemblyMonth: metric(assemblyMonthPlan, assemblyMonthFact, bounds.start > today),
      assemblyToday: metric(assemblyTodayPlan, assemblyTodayFact, today < bounds.start || today > bounds.end),
      accumulatedLagTons: throughDate ? factThroughToday - planThroughToday : 0,
      weekly: Array.from(weeklyMap.values()).sort((left, right) => left.week.localeCompare(right.week)),
      sections: sectionMetrics,
    },
    progress,
    load: { sections: loadSections, selectedSectionId, days: loadDays, weeks: loadWeeks },
    warnings: Array.from(warnings).slice(0, 30),
  }
}
