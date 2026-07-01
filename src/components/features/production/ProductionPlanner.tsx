"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { addDays, differenceInCalendarDays, format, subDays } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ChevronDown,
  Eraser,
  ExternalLink,
  Loader2,
  PackageCheck,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DatePicker } from '@/components/ui/date-picker'
import { GanttControls, type GanttFilters, type GanttMonthOption } from '@/components/features/production/gantt/GanttControls'
import { GanttTimeline } from '@/components/features/production/gantt/GanttTimeline'
import { GanttLegend } from '@/components/features/production/gantt/GanttLegend'
import { GanttBar } from '@/components/features/production/gantt/GanttBar'
import { GanttSupplyMarker } from '@/components/features/production/gantt/GanttSupplyMarker'
import { GanttMaterialMarker } from '@/components/features/production/gantt/GanttMaterialMarker'
import { STAGES, STAGE_ORDER } from '@/lib/constants/stages'
import { productionQueueLabel } from '@/lib/constants/factory-workshops'
import { clearProductionStageDates, updateMachineDate, updateProductionStage } from '@/lib/actions/production'
import { createProductionPlanDateChangeRequest, type ProductionMonthPlanSummary, type ProductionPlanDateChangeInput } from '@/lib/actions/production-plan'
import { useRole } from '@/lib/hooks/useRole'
import { ROUTES } from '@/lib/constants/routes'
import { barGeometry, generateDateScale, type GanttScale } from '@/lib/utils/gantt'
import { formatDesiredShippingDate } from '@/lib/utils/desired-shipping'
import { formatProductionMonth, normalizeProductionMonthValue } from '@/lib/utils/production-months'
import { cn } from '@/lib/utils'
import type {
  GanttData,
  GanttMachine,
  GanttMaterialItem,
  GanttStage,
  GanttSupplyItem,
} from '@/app/(protected)/production/gantt/actions'
import type { ProductionRow } from '@/app/(protected)/production/actions'
import type { StageType } from '@/lib/types'

interface ProductionPlannerProps {
  data: GanttData
  productionData: ProductionRow[]
  monthPlans?: ProductionMonthPlanSummary[]
  filters?: GanttFilters
  onFiltersChange?: (filters: GanttFilters) => void
  height?: string
}

type PlannerRow = {
  machine: GanttMachine
  visibleStages: GanttStage[]
  supplyItems: GanttSupplyItem[]
  machineIndex: number
}

type UnscheduledRow = {
  machine: GanttMachine
  productionRow: ProductionRow
  machineIndex: number
}

type WeldingLoadRow = {
  key: string
  label: string
  values: Map<string, number>
  machines: Map<string, WeldingLoadMachine[]>
  total: number
  isTotal?: boolean
}

type WeldingLoadMachine = {
  id: string
  name: string
  dailyTons: number
}

type MachineDateField = 'planned_material_date'
type StageDateField = 'date_start' | 'date_end' | 'night_shift_date'
type StageOptimisticPatch = Partial<Pick<
  ProductionStage,
  'date_start' | 'date_end' | 'night_shift_date' | 'workshop' | 'is_night_shift' | 'manual_overdue' | 'is_skipped'
>>
type ProductionStage = ProductionRow['stages'][number]
type ActionResult = { success?: boolean; error?: string | null }
type DateChangeDraft = ProductionPlanDateChangeInput & {
  key: string
  machineId: string
  label: string
  old_value: string | null
}

const MACHINE_RAIL_WIDTH = 248
const TIMELINE_HEIGHT = 56
const BAR_HEIGHT = 18
const BAR_LANE_GAP = 4
const BAR_LANES = 3
const SUPPLY_LANE_GAP = 6
const SUPPLY_LANE_HEIGHT = 44
const SUPPLY_LANE_TOP = 8
const STAGE_LANE_TOP = SUPPLY_LANE_TOP + SUPPLY_LANE_HEIGHT + SUPPLY_LANE_GAP
const STAGE_LANE_AREA_HEIGHT = BAR_LANES * BAR_HEIGHT + (BAR_LANES - 1) * BAR_LANE_GAP
const PLANNER_ROW_HEIGHT = STAGE_LANE_TOP + STAGE_LANE_AREA_HEIGHT + 8
const ZOOM_MIN = 15
const ZOOM_MAX = 80
const ZOOM_STEP = 5
const RANGE_EDGE_PX = 240
const RANGE_EXTEND_DAYS = 30
const RANGE_CHECK_DEBOUNCE_MS = 180
const scale: GanttScale = 'day'
const PRODUCTION_PLAN_STAGE_ORDER: StageType[] = STAGE_ORDER.filter((stage) => stage !== 'actual_shipping')

const defaultFilters: GanttFilters = {
  search: '',
  workshop: '',
  confirmation: '',
  productionMonth: '',
  showSupply: true,
  visibleStages: [...PRODUCTION_PLAN_STAGE_ORDER],
}

const workshopOptions = [
  { value: '1', label: 'Цех 1' },
  { value: '2', label: 'Цех 2' },
]

function clampDayWidth(value: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))
}

function findEarliestDate(data: GanttData) {
  const dates = data.machines.flatMap((machine) => [
    ...machine.stages
      .filter((stage) => stage.stage_type !== 'actual_shipping')
      .map((stage) => stage.date_start)
      .filter(Boolean),
    ...machine.supply_deadlines.map((item) => item.planned_delivery_date).filter(Boolean),
    ...machine.material_items.map((item) => item.planned_delivery_date).filter(Boolean),
    ...machine.material_items.map((item) => item.actual_delivery_date).filter(Boolean),
    machine.desired_shipping_date,
    machine.planned_material_date,
    machine.actual_material_date,
    machine.actual_shipping_date,
    machine.delivery_to_client_date,
  ]).filter((date): date is string => Boolean(date))

  if (dates.length === 0) return new Date()
  return new Date(Math.min(...dates.map((date) => new Date(date).getTime())))
}

function findLatestDate(data: GanttData) {
  const dates = data.machines.flatMap((machine) => [
    ...machine.stages
      .filter((stage) => stage.stage_type !== 'actual_shipping')
      .map((stage) => stage.date_end || stage.date_start)
      .filter(Boolean),
    ...machine.supply_deadlines.map((item) => item.planned_delivery_date).filter(Boolean),
    ...machine.material_items.map((item) => item.planned_delivery_date).filter(Boolean),
    ...machine.material_items.map((item) => item.actual_delivery_date).filter(Boolean),
    machine.desired_shipping_date,
    machine.planned_material_date,
    machine.actual_material_date,
    machine.actual_shipping_date,
    machine.delivery_to_client_date,
  ]).filter((date): date is string => Boolean(date))

  if (dates.length === 0) return new Date()
  return new Date(Math.max(...dates.map((date) => new Date(date).getTime())))
}

function parseDateOnly(value: string | null | undefined) {
  if (!value) return undefined
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

function formatDateOnly(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateValue(value: string | null | undefined, short = false) {
  const parsed = parseDateOnly(value)
  if (!parsed) return '—'
  return format(parsed, short ? 'dd.MM' : 'dd.MM.yyyy', { locale: ru })
}

function dateOffset(date: string | null | undefined, rangeStart: Date, dayWidth: number) {
  return date ? differenceInCalendarDays(new Date(date), rangeStart) * dayWidth : null
}

function dateOnlyKey(date: string | null | undefined) {
  return date ? date.slice(0, 10) : null
}

function groupMaterialItemsByDate(
  items: GanttMaterialItem[],
  getDate: (item: GanttMaterialItem) => string | null | undefined
) {
  const groups = new Map<string, GanttMaterialItem[]>()
  for (const item of items) {
    const key = dateOnlyKey(getDate(item))
    if (!key) continue
    groups.set(key, [...(groups.get(key) || []), item])
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, groupedItems]) => ({ date, items: groupedItems }))
}

function isMaterialItemReceived(item: GanttMaterialItem) {
  return item.supply_status === 'received' || Boolean(item.actual_delivery_date)
}

function hasMaterialGroupDate(groups: { date: string; items: GanttMaterialItem[] }[], date: string | null | undefined) {
  const key = dateOnlyKey(date)
  return Boolean(key && groups.some((group) => group.date === key))
}

function addMaterialDateGroup(
  groups: { date: string; items: GanttMaterialItem[] }[],
  date: string | null | undefined,
  items: GanttMaterialItem[] = []
) {
  const key = dateOnlyKey(date)
  if (!key || groups.some((group) => group.date === key)) return groups
  return [...groups, { date: key, items }].sort((a, b) => a.date.localeCompare(b.date))
}

function machineDateDraftKey(machineId: string, field: MachineDateField) {
  return `${machineId}:machine:${field}`
}

function stageDateDraftKey(machineId: string, stageId: string, field: 'date_start' | 'date_end' | 'night_shift_date') {
  return `${machineId}:stage:${stageId}:${field}`
}

function draftDateLabel(stage: ProductionStage | null, field: MachineDateField | 'date_start' | 'date_end' | 'night_shift_date') {
  if (!stage) return 'Плановая поставка материала'
  const stageLabel = STAGES[stage.stage_type]?.label || stage.stage_type
  const fieldLabel = field === 'date_start' ? 'начало' : field === 'date_end' ? 'окончание' : 'ночная смена'
  return `${stageLabel}: ${fieldLabel}`
}

function dayKey(date: Date) {
  return format(date, 'yyyy-MM-dd')
}

function productionMonthLabel(date: string | null | undefined) {
  const normalized = normalizeProductionMonthValue(date)
  if (!normalized) return null
  return formatProductionMonth(normalized)
}

function hasScheduledStage(row: ProductionRow) {
  return row.stages.some((stage) => PRODUCTION_PLAN_STAGE_ORDER.includes(stage.stage_type) && !stage.is_skipped && Boolean(stage.date_start))
}

function compareProductionMachines(
  a: Pick<GanttMachine, 'created_at' | 'production_month' | 'production_workshop' | 'production_queue_number'>,
  b: Pick<GanttMachine, 'created_at' | 'production_month' | 'production_workshop' | 'production_queue_number'>
) {
  const monthA = normalizeProductionMonthValue(a.production_month) || '9999-12-01'
  const monthB = normalizeProductionMonthValue(b.production_month) || '9999-12-01'
  if (monthA !== monthB) return monthA.localeCompare(monthB)

  const workshopA = a.production_workshop ?? 999
  const workshopB = b.production_workshop ?? 999
  if (workshopA !== workshopB) return workshopA - workshopB

  const queueA = a.production_queue_number ?? 999999
  const queueB = b.production_queue_number ?? 999999
  if (queueA !== queueB) return queueA - queueB

  return a.created_at.localeCompare(b.created_at)
}

function productionRowToGanttMachine(row: ProductionRow, fallback?: GanttMachine): GanttMachine {
  const fallbackCoatings = fallback?.coatings || []
  const coatings = fallbackCoatings.length > 0
    ? fallbackCoatings
    : [
      row.machine.has_zinc ? 'zinc' : null,
      row.machine.has_painting ? 'powder_coating' : null,
    ].filter((coating): coating is string => Boolean(coating))

  return {
    id: row.machine.id,
    name: row.machine.name,
    created_at: row.machine.created_at,
    factory_id: row.machine.factory_id,
    production_month: normalizeProductionMonthValue(row.machine.production_month) || row.machine.production_month,
    production_workshop: row.machine.production_workshop,
    production_queue_number: row.machine.production_queue_number,
    total_weight: row.machine.total_weight || 0,
    is_confirmed: row.machine.is_confirmed,
    desired_shipping_date: row.machine.desired_shipping_date,
    planned_material_date: row.machine.planned_material_date,
    actual_material_date: row.machine.actual_material_date,
    actual_shipping_date: row.machine.actual_shipping_date,
    delivery_to_client_date: row.machine.delivery_to_client_date,
    coatings,
    stages: fallback?.stages || [],
    supply_deadlines: fallback?.supply_deadlines || [],
    material_items: fallback?.material_items || [],
  }
}

function productionStageToGanttStage(stage: ProductionStage): GanttStage | null {
  if (stage.is_skipped || !stage.date_start) return null

  const startDate = new Date(stage.date_start)
  const status: GanttStage['status'] = stage.status === 'skipped' ? 'not_planned' : stage.status

  return {
    id: stage.id,
    stage_type: stage.stage_type,
    workshop: stage.workshop,
    date_start: stage.date_start,
    date_end: stage.date_end || addDays(startDate, 7).toISOString().split('T')[0],
    manual_overdue: stage.manual_overdue,
    is_night_shift: stage.is_night_shift,
    night_shift_date: stage.night_shift_date,
    status,
    delay_days: stage.delay_days,
  }
}

function formatTons(value: number) {
  if (value <= 0) return ''
  return value >= 10 ? value.toFixed(1) : value.toFixed(2)
}

function getWorkshopLabel(workshop: number | null) {
  return workshop ? `Ц${workshop}` : '—'
}

function stageHasWorkshop(stageType: StageType) {
  return !['cutting', 'galvanizing'].includes(stageType)
}

function mergeWeldingLoadMachine(items: WeldingLoadMachine[], next: WeldingLoadMachine) {
  const existing = items.find((item) => item.id === next.id)
  if (existing) {
    existing.dailyTons += next.dailyTons
    return
  }

  items.push({ ...next })
}

function weldingLoadTitle(row: WeldingLoadRow, date: Date, value: number) {
  if (value <= 0) return undefined

  const machines = (row.machines.get(dayKey(date)) || [])
    .slice()
    .sort((a, b) => b.dailyTons - a.dailyTons)
  const machineLines = machines.map((machine) => `${machine.name}: ${machine.dailyTons.toFixed(2)} т`)

  return [
    `${row.label}: ${value.toFixed(2)} т`,
    format(date, 'dd.MM.yyyy'),
    machineLines.length > 0 ? 'Машины:' : null,
    ...machineLines,
  ].filter(Boolean).join('\n')
}

function isFailedResult(result: unknown): result is { success: false; error?: string | null } {
  return Boolean(result && typeof result === 'object' && 'success' in result && result.success === false)
}

function DateField({
  label,
  value,
  editable,
  onSave,
  short = false,
}: {
  label: string
  value: string | null
  editable: boolean
  onSave?: (value: string | null) => Promise<ActionResult | void>
  short?: boolean
}) {
  const [saving, setSaving] = useState(false)
  const [displayValue, setDisplayValue] = useState(value)

  useEffect(() => {
    setDisplayValue(value)
  }, [value])

  const handleChange = async (date: Date | undefined) => {
    if (!onSave) return
    const nextValue = date ? formatDateOnly(date) : null
    if (dateOnlyKey(nextValue) === dateOnlyKey(displayValue)) return

    const previousValue = displayValue
    setDisplayValue(nextValue)
    setSaving(true)
    try {
      const result = await onSave(nextValue)
      if (isFailedResult(result)) throw new Error(result.error || 'Сохранение отменено')
    } catch (error) {
      setDisplayValue(previousValue)
      toast.error(error instanceof Error ? error.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-w-0 space-y-1">
      <div className="text-[11px] font-medium uppercase text-slate-500">{label}</div>
      {editable ? (
        <div className="relative">
          <DatePicker
            value={parseDateOnly(displayValue)}
            onChange={handleChange}
            disabled={saving}
            placeholder="Выбрать"
            className="min-h-11 w-full text-sm sm:min-h-10"
            displayFormat={short ? 'dd.MM' : 'dd.MM.yyyy'}
          />
          {saving && <Loader2 className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-blue-600" />}
        </div>
      ) : (
        <div className="flex min-h-11 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 sm:min-h-10">
          {formatDateValue(value, short)}
        </div>
      )}
    </div>
  )
}

function SelectField({
  label,
  value,
  editable,
  onSave,
}: {
  label: string
  value: number | null
  editable: boolean
  onSave: (value: number | null) => Promise<ActionResult | void>
}) {
  const [saving, setSaving] = useState(false)

  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSaving(true)
    try {
      const nextValue = event.target.value ? Number(event.target.value) : null
      const result = await onSave(nextValue)
      if (isFailedResult(result)) throw new Error(result.error || 'Сохранение отменено')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-w-0 space-y-1">
      <div className="text-[11px] font-medium uppercase text-slate-500">{label}</div>
      <div className="relative">
        <select
          value={value ? String(value) : ''}
          disabled={!editable || saving}
          onChange={handleChange}
          className={cn(
            'min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 sm:min-h-10',
            (!editable || saving) && 'cursor-not-allowed bg-slate-50 text-slate-500'
          )}
        >
          <option value="">—</option>
          {workshopOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {saving && <Loader2 className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-blue-600" />}
      </div>
    </div>
  )
}

function buildStageLanes(stages: GanttStage[], rangeStart: Date, dayWidth: number) {
  const laneEnds: number[] = []

  return stages.map((stage) => {
    const start = new Date(stage.date_start)
    const end = new Date(stage.date_end)
    const { left, width } = barGeometry(start, end, rangeStart, scale, dayWidth)
    let lane = laneEnds.findIndex((endPx) => endPx <= left - 6)

    if (lane === -1) {
      lane = laneEnds.length < BAR_LANES ? laneEnds.length : BAR_LANES - 1
    }

    laneEnds[lane] = Math.max(laneEnds[lane] || 0, left + width)
    return { stage, lane }
  })
}

function PlannerVirtualRow({
  row,
  top,
  totalWidth,
  rangeStart,
  dayWidth,
  todayOffset,
  selected,
  showSupply,
  onSelect,
}: {
  row: PlannerRow
  top: number
  totalWidth: number
  rangeStart: Date
  dayWidth: number
  todayOffset: number
  selected: boolean
  showSupply: boolean
  onSelect: (machineId: string) => void
}) {
  const machine = row.machine
  const queueLabel = productionQueueLabel(machine.production_workshop, machine.production_queue_number)
  const monthLabel = productionMonthLabel(machine.production_month)
  const stageLanes = buildStageLanes(row.visibleStages, rangeStart, dayWidth)
  const plannedMaterialGroups = groupMaterialItemsByDate(
    machine.material_items.filter((item) => !isMaterialItemReceived(item)),
    (item) => item.planned_delivery_date
  )
  const productionNeedDate = hasMaterialGroupDate(plannedMaterialGroups, machine.planned_material_date)
    ? null
    : dateOnlyKey(machine.planned_material_date)
  const actualMaterialGroups = addMaterialDateGroup(
    groupMaterialItemsByDate(
      machine.material_items,
      (item) => item.actual_delivery_date || (item.supply_status === 'received' ? item.planned_delivery_date : null)
    ),
    machine.actual_material_date,
    machine.material_items.filter((item) => item.supply_status === 'received')
  )

  return (
    <div
      className={cn(
        'absolute left-0 z-20 grid border-b border-slate-200/80 transition-colors',
        selected ? 'bg-blue-50' : row.machineIndex % 2 === 1 ? 'bg-slate-50' : 'bg-white'
      )}
      style={{
        top,
        height: PLANNER_ROW_HEIGHT,
        width: MACHINE_RAIL_WIDTH + totalWidth,
        gridTemplateColumns: `${MACHINE_RAIL_WIDTH}px ${totalWidth}px`,
        contain: 'layout style',
      }}
    >
      <div
        className={cn(
          'sticky left-0 z-30 h-full border-r border-slate-200 px-2 py-2',
          selected ? 'bg-blue-50' : row.machineIndex % 2 === 1 ? 'bg-slate-50' : 'bg-white'
        )}
        style={{ width: MACHINE_RAIL_WIDTH }}
      >
        <button
          type="button"
          className="grid h-full w-full min-w-0 rounded-md text-left transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          style={{ gridTemplateRows: `${SUPPLY_LANE_HEIGHT}px 1fr` }}
          onClick={() => onSelect(machine.id)}
        >
          <span className="flex min-w-0 items-center gap-1 border-b border-emerald-100 px-2 text-[11px] text-slate-500">
            <PackageCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span className="truncate">
              Мат.план: {formatDateValue(machine.planned_material_date, true)}
            </span>
          </span>
          <span className="flex min-w-0 flex-col justify-center px-2">
            <span className="flex w-full min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-blue-900" title={machine.name}>
                {machine.name}
              </span>
              {!machine.is_confirmed && (
                <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                  не подтв.
                </span>
              )}
            </span>
            <span className="mt-1 flex w-full min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
              <span>{Number(machine.total_weight || 0).toFixed(1)} т</span>
              <span className="truncate">{monthLabel ? `${monthLabel} · ${queueLabel}` : queueLabel}</span>
            </span>
          </span>
        </button>
      </div>

      <div
        className="relative cursor-pointer"
        style={{ width: totalWidth }}
        onClick={() => onSelect(machine.id)}
      >
        {todayOffset >= 0 && todayOffset < totalWidth && (
          <div
            className="pointer-events-none absolute inset-y-0 z-0 bg-red-50"
            style={{ left: todayOffset, width: dayWidth }}
          />
        )}

        {stageLanes.map(({ stage, lane }) => (
          <div
            key={stage.id}
            className="absolute left-0"
            style={{
              top: STAGE_LANE_TOP + lane * (BAR_HEIGHT + BAR_LANE_GAP),
              height: BAR_HEIGHT,
              width: totalWidth,
            }}
          >
            <GanttBar
              stage={stage}
              rangeStart={rangeStart}
              scale={scale}
              unitWidth={dayWidth}
              machineId={machine.id}
              isConfirmed={machine.is_confirmed}
              onSelect={() => onSelect(machine.id)}
              planOnly
            />
          </div>
        ))}

        {showSupply && (
          <div
            className="absolute left-0 border-b border-emerald-100/80 bg-emerald-50/30"
            style={{ top: SUPPLY_LANE_TOP, height: SUPPLY_LANE_HEIGHT, width: totalWidth }}
          >
            {productionNeedDate && (() => {
              const offset = dateOffset(productionNeedDate, rangeStart, dayWidth)
              if (offset === null || offset + dayWidth / 2 < 0 || offset + dayWidth / 2 > totalWidth) return null
              const label = formatDesiredShippingDate(productionNeedDate)
              return (
                <GanttMaterialMarker
                  key={`production-need:${productionNeedDate}`}
                  type="production_need"
                  date={productionNeedDate}
                  items={[]}
                  rangeStart={rangeStart}
                  unitWidth={dayWidth}
                  machineId={machine.id}
                  machineName={machine.name}
                  title={label ? `Мат.план от производства: ${label}` : undefined}
                />
              )
            })()}
            {plannedMaterialGroups.map((group) => {
              const offset = dateOffset(group.date, rangeStart, dayWidth)
              if (offset === null || offset + dayWidth / 2 < 0 || offset + dayWidth / 2 > totalWidth) return null
              const label = formatDesiredShippingDate(group.date)
              return (
                <GanttMaterialMarker
                  key={`planned:${group.date}`}
                  type="planned"
                  date={group.date}
                  items={group.items}
                  rangeStart={rangeStart}
                  unitWidth={dayWidth}
                  machineId={machine.id}
                  machineName={machine.name}
                  title={label ? `Дата снабжения материала: ${label}` : undefined}
                />
              )
            })}
            {actualMaterialGroups.map((group) => {
              const offset = dateOffset(group.date, rangeStart, dayWidth)
              if (offset === null || offset + dayWidth / 2 < 0 || offset + dayWidth / 2 > totalWidth) return null
              const label = formatDesiredShippingDate(group.date)
              return (
                <GanttMaterialMarker
                  key={`actual:${group.date}`}
                  type="actual"
                  date={group.date}
                  items={group.items}
                  rangeStart={rangeStart}
                  unitWidth={dayWidth}
                  machineId={machine.id}
                  machineName={machine.name}
                  title={label ? `Факт. поставка материала: ${label}` : undefined}
                />
              )
            })}
            {row.supplyItems.map((item) => (
              <GanttSupplyMarker
                key={item.id}
                item={item}
                rangeStart={rangeStart}
                scale={scale}
                unitWidth={dayWidth}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function UnscheduledMachinesPanel({
  rows,
  open,
  selectedMachineId,
  onToggle,
  onSelect,
}: {
  rows: UnscheduledRow[]
  open: boolean
  selectedMachineId: string | null
  onToggle: () => void
  onSelect: (machineId: string) => void
}) {
  if (rows.length === 0) return null

  return (
    <section className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
      <button
        type="button"
        className="flex min-h-12 w-full items-center justify-between gap-3 bg-amber-50/70 px-3 py-2 text-left transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-blue-950">Машины без дат</span>
          <span className="block text-xs text-slate-600">
            {rows.length} шт. не имеют запланированных дат этапов
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-2 text-xs font-medium text-slate-600">
          {open ? 'Скрыть' : 'Показать'}
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </span>
      </button>

      {open && (
        <div className="divide-y divide-slate-200 border-t border-amber-200">
          {rows.map(({ machine, machineIndex }) => {
            const selected = selectedMachineId === machine.id
            const monthLabel = productionMonthLabel(machine.production_month)
            const queueLabel = productionQueueLabel(machine.production_workshop, machine.production_queue_number)

            return (
              <button
                key={machine.id}
                type="button"
                className={cn(
                  'grid min-h-14 w-full gap-2 px-3 py-2 text-left transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 sm:grid-cols-[minmax(180px,1fr)_minmax(160px,220px)_minmax(140px,180px)_90px] sm:items-center',
                  selected ? 'bg-blue-50' : machineIndex % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'
                )}
                aria-pressed={selected}
                onClick={() => onSelect(machine.id)}
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-blue-950" title={machine.name}>
                      {machine.name}
                    </span>
                    <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                      Без дат
                    </span>
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    <span className={cn(
                      'rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                      machine.is_confirmed
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                    )}>
                      {machine.is_confirmed ? 'подтверждена' : 'не подтверждена'}
                    </span>
                  </span>
                </span>

                <span className="min-w-0 text-xs text-slate-600">
                  <span className="block truncate" title={monthLabel ? `${monthLabel} · ${queueLabel}` : queueLabel}>
                    {monthLabel ? `${monthLabel} · ${queueLabel}` : queueLabel}
                  </span>
                </span>

                <span className="flex min-w-0 items-center gap-1 text-xs text-slate-600">
                  <PackageCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span className="truncate">
                    Мат.план: {formatDateValue(machine.planned_material_date, true)}
                  </span>
                </span>

                <span className="text-xs font-semibold text-slate-700 sm:text-right">
                  {Number(machine.total_weight || 0).toFixed(1)} т
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

function StageEditor({
  row,
  stage,
  canEdit,
  clearingStageId,
  getDateValue,
  onStageDateUpdate,
  onStageUpdate,
  onClearDates,
}: {
  row: ProductionRow
  stage: ProductionStage
  canEdit: boolean
  clearingStageId: string | null
  getDateValue?: (stage: ProductionStage, field: 'date_start' | 'date_end' | 'night_shift_date') => string | null
  onStageDateUpdate: (
    row: ProductionRow,
    stage: ProductionStage,
    field: 'date_start' | 'date_end' | 'night_shift_date',
    value: string | null
  ) => Promise<ActionResult | void>
  onStageUpdate: (stageId: string, field: string, value: string | number | boolean | null) => Promise<ActionResult | void>
  onClearDates: (stage: ProductionStage) => Promise<ActionResult | void>
}) {
  const meta = STAGES[stage.stage_type]
  const isShippingDateOnly = stage.stage_type === 'shipping'
  const isSkipped = stage.is_skipped
  const editable = canEdit && !isSkipped
  const isClearing = clearingStageId === stage.id
  const hasDates = Boolean(stage.date_start || stage.date_end)

  return (
    <div className={cn('rounded-lg border bg-white p-3', isSkipped ? 'border-slate-200 opacity-75' : 'border-slate-200')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: meta.color }} />
            <span className="truncate text-sm font-semibold text-slate-900">{meta.label}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {stage.is_night_shift && (
              <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                ночь
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            disabled={!editable || isClearing || !hasDates}
            title="Очистить даты этапа"
            aria-label="Очистить даты этапа"
            onClick={() => onClearDates(stage)}
            className={cn(
              'inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600',
              (!editable || isClearing || !hasDates) && 'cursor-not-allowed opacity-40'
            )}
          >
            {isClearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eraser className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className={cn('mt-3 grid gap-2', isShippingDateOnly ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3')}>
        {isShippingDateOnly ? (
          <DateField
            label="Дата"
            value={getDateValue ? getDateValue(stage, 'date_end') : stage.date_end}
            editable={editable}
            onSave={(value) => onStageDateUpdate(row, stage, 'date_end', value)}
          />
        ) : (
          <>
            <SelectField
              label="Цех"
              value={stage.workshop}
              editable={editable && stageHasWorkshop(stage.stage_type)}
              onSave={(value) => onStageUpdate(stage.id, 'workshop', value)}
            />
            <DateField
              label="Начало"
              value={getDateValue ? getDateValue(stage, 'date_start') : stage.date_start}
              editable={editable}
              onSave={(value) => onStageDateUpdate(row, stage, 'date_start', value)}
              short
            />
            <DateField
              label="Конец"
              value={getDateValue ? getDateValue(stage, 'date_end') : stage.date_end}
              editable={editable}
              onSave={(value) => onStageDateUpdate(row, stage, 'date_end', value)}
              short
            />
          </>
        )}
      </div>

      {stage.stage_type === 'painting' && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 sm:min-h-10">
            <Checkbox
              checked={stage.is_night_shift}
              disabled={!editable}
              onCheckedChange={(checked) => onStageUpdate(stage.id, 'is_night_shift', checked === true)}
            />
            Ночная смена
          </label>
          <DateField
            label="Дата ночи"
            value={getDateValue ? getDateValue(stage, 'night_shift_date') : stage.night_shift_date}
            editable={editable && stage.is_night_shift}
            onSave={(value) => onStageDateUpdate(row, stage, 'night_shift_date', value)}
            short
          />
        </div>
      )}
    </div>
  )
}

function ProductionMachineInspector({
  machine,
  productionRow,
  canEdit,
  approvalLocked,
  pendingDateChanges,
  submittingDateRequest,
  clearingStageId,
  collapsible = false,
  defaultOpen = true,
  getMachineDateValue,
  getStageDateValue,
  onMachineDateUpdate,
  onStageDateUpdate,
  onStageUpdate,
  onClearDates,
  onSubmitDateChangeRequest,
  onResetDateChangeDraft,
  onCollapse,
}: {
  machine: GanttMachine | null
  productionRow: ProductionRow | undefined
  canEdit: boolean
  approvalLocked: boolean
  pendingDateChanges: DateChangeDraft[]
  submittingDateRequest: boolean
  clearingStageId: string | null
  collapsible?: boolean
  defaultOpen?: boolean
  getMachineDateValue?: (machine: GanttMachine, field: MachineDateField) => string | null
  getStageDateValue?: (stage: ProductionStage, field: 'date_start' | 'date_end' | 'night_shift_date') => string | null
  onMachineDateUpdate: (machineId: string, field: MachineDateField, value: string | null) => Promise<ActionResult | void>
  onStageDateUpdate: (
    row: ProductionRow,
    stage: ProductionStage,
    field: 'date_start' | 'date_end' | 'night_shift_date',
    value: string | null
  ) => Promise<ActionResult | void>
  onStageUpdate: (stageId: string, field: string, value: string | number | boolean | null) => Promise<ActionResult | void>
  onClearDates: (stage: ProductionStage) => Promise<ActionResult | void>
  onSubmitDateChangeRequest: () => Promise<void>
  onResetDateChangeDraft: () => void
  onCollapse?: () => void
}) {
  const [open, setOpen] = useState(defaultOpen)

  const sortedStages = useMemo(() => {
    if (!productionRow) return []
    return productionRow.stages.filter((stage) => PRODUCTION_PLAN_STAGE_ORDER.includes(stage.stage_type)).sort(
      (a, b) => STAGE_ORDER.indexOf(a.stage_type) - STAGE_ORDER.indexOf(b.stage_type)
    )
  }, [productionRow])

  if (!machine) {
    return (
      <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-semibold text-slate-900">Выбранная машина</div>
          {onCollapse && (
            <button
              type="button"
              className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              aria-label="Скрыть инспектор машины"
              onClick={onCollapse}
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="mt-2 text-sm text-slate-500">Выберите строку на графике, чтобы открыть редактирование дат.</p>
      </aside>
    )
  }

  const body = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-[11px] font-medium uppercase text-slate-500">Вес</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{Number(machine.total_weight || 0).toFixed(1)} т</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-[11px] font-medium uppercase text-slate-500">Очередь</div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-900" title={productionQueueLabel(machine.production_workshop, machine.production_queue_number)}>
            {productionQueueLabel(machine.production_workshop, machine.production_queue_number)}
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        <DateField
          label="Желаемая отгрузка"
          value={productionRow?.machine.desired_shipping_date || machine.desired_shipping_date}
          editable={false}
        />
        <DateField
          label="Материал план"
          value={getMachineDateValue ? getMachineDateValue(machine, 'planned_material_date') : productionRow?.machine.planned_material_date || machine.planned_material_date}
          editable={canEdit}
          onSave={(value) => onMachineDateUpdate(machine.id, 'planned_material_date', value)}
        />
      </div>

      {approvalLocked && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-semibold">План месяца подтверждён</div>
          {pendingDateChanges.length > 0 ? (
            <div className="mt-2 space-y-2">
              <div className="space-y-1">
                {pendingDateChanges.map((change) => (
                  <div key={change.key} className="rounded-md bg-white/70 px-2 py-1 text-xs leading-5">
                    {change.label}: {formatDateValue(change.old_value)}{' -> '}{formatDateValue(change.new_value)}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  size="sm"
                  disabled={submittingDateRequest}
                  onClick={onSubmitDateChangeRequest}
                  className="min-h-10 flex-1 bg-amber-700 text-white hover:bg-amber-800"
                >
                  {submittingDateRequest && <Loader2 className="h-4 w-4 animate-spin" />}
                  Отправить запрос
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={submittingDateRequest}
                  onClick={onResetDateChangeDraft}
                  className="min-h-10 flex-1 border-amber-200 bg-white text-amber-800 hover:bg-amber-50"
                >
                  Сбросить
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-1 text-amber-800">Изменения дат будут отправлены на согласование.</div>
          )}
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Этапы</h3>
          <span className="text-xs text-slate-500">{sortedStages.length}/{PRODUCTION_PLAN_STAGE_ORDER.length}</span>
        </div>
        {productionRow ? (
          <div className="space-y-2">
            {sortedStages.map((stage) => (
              <StageEditor
                key={stage.id}
                row={productionRow}
                stage={stage}
                canEdit={canEdit}
                clearingStageId={clearingStageId}
                getDateValue={getStageDateValue}
                onStageDateUpdate={onStageDateUpdate}
                onStageUpdate={onStageUpdate}
                onClearDates={onClearDates}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            Для этой машины нет строки редактирования в production data.
          </div>
        )}
      </div>
    </div>
  )

  return (
    <aside className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase text-slate-500">Выбранная машина</div>
          <h2 className="mt-0.5 truncate text-base font-semibold text-blue-950" title={machine.name}>{machine.name}</h2>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className={cn(
              'rounded border px-1.5 py-0.5 text-[10px] font-semibold',
              machine.is_confirmed
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            )}>
              {machine.is_confirmed ? 'подтверждена' : 'не подтверждена'}
            </span>
            {machine.coatings.map((coating) => (
              <span key={coating} className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                {coating}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {onCollapse && (
            <button
              type="button"
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              aria-label="Скрыть инспектор машины"
              onClick={onCollapse}
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          )}
          <Link
            href={`${ROUTES.SALES_PLAN}/${machine.id}`}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            aria-label="Открыть машину"
          >
            <ExternalLink className="h-4 w-4" />
          </Link>
          {collapsible && (
            <button
              type="button"
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              aria-label={open ? 'Свернуть инспектор' : 'Развернуть инспектор'}
              aria-expanded={open}
              onClick={() => setOpen((current) => !current)}
            >
              <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
            </button>
          )}
        </div>
      </div>
      {(!collapsible || open) && (
        <div className="max-h-none overflow-y-auto p-3 xl:max-h-[calc(100dvh-210px)]">
          {body}
        </div>
      )}
    </aside>
  )
}

export function ProductionPlanner({
  data,
  productionData,
  monthPlans = [],
  filters: externalFilters,
  onFiltersChange,
  height = 'clamp(430px, 62dvh, 700px)',
}: ProductionPlannerProps) {
  const router = useRouter()
  const { isProductionManager, isDirector } = useRole()
  const canEdit = isProductionManager || isDirector
  const [dayWidth, setDayWidth] = useState(38)
  const [rangeStart, setRangeStart] = useState<Date>(() => subDays(findEarliestDate(data), 30))
  const [rangeEnd, setRangeEnd] = useState<Date>(() => addDays(findLatestDate(data), 60))
  const [internalFilters, setInternalFilters] = useState<GanttFilters>(defaultFilters)
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null)
  const [desktopInspectorOpen, setDesktopInspectorOpen] = useState(true)
  const [unscheduledOpen, setUnscheduledOpen] = useState(true)
  const [weldingLoadOpen, setWeldingLoadOpen] = useState(true)
  const [scrollShadows, setScrollShadows] = useState({ left: false, right: false })
  const [clearingStageId, setClearingStageId] = useState<string | null>(null)
  const [dateChangeDrafts, setDateChangeDrafts] = useState<Record<string, DateChangeDraft>>({})
  const [stageOptimisticPatches, setStageOptimisticPatches] = useState<Record<string, StageOptimisticPatch>>({})
  const [machineDateOptimisticPatches, setMachineDateOptimisticPatches] = useState<Record<string, Partial<Record<MachineDateField, string | null>>>>({})
  const [submittingDateRequest, setSubmittingDateRequest] = useState(false)

  const filters = externalFilters || internalFilters
  const setFilters = onFiltersChange || setInternalFilters
  const scrollRef = useRef<HTMLDivElement>(null)
  const weldingLoadScrollRef = useRef<HTMLDivElement>(null)
  const didInitialScrollRef = useRef(false)
  const rangeExtendLockRef = useRef(false)
  const scrollCheckTimeoutRef = useRef<number | null>(null)
  const scrollSyncLockRef = useRef(false)

  const scaleItems = useMemo(() => generateDateScale(rangeStart, rangeEnd, scale), [rangeStart, rangeEnd])
  const totalWidth = scaleItems.length * dayWidth
  const rangeLabel = useMemo(
    () => `${format(rangeStart, 'dd.MM.yyyy')} - ${format(rangeEnd, 'dd.MM.yyyy')}`,
    [rangeStart, rangeEnd]
  )

  useEffect(() => {
    setStageOptimisticPatches({})
    setMachineDateOptimisticPatches({})
  }, [data, productionData])

  const effectiveProductionData = useMemo(() => productionData.map((row) => {
    const machinePatch = machineDateOptimisticPatches[row.machine.id]
    const hasStagePatches = row.stages.some((stage) => stageOptimisticPatches[stage.id])
    if (!machinePatch && !hasStagePatches) return row

    return {
      ...row,
      machine: machinePatch ? { ...row.machine, ...machinePatch } : row.machine,
      stages: hasStagePatches
        ? row.stages.map((stage) => ({ ...stage, ...(stageOptimisticPatches[stage.id] ?? {}) }))
        : row.stages,
    }
  }), [machineDateOptimisticPatches, productionData, stageOptimisticPatches])

  const effectiveData = useMemo<GanttData>(() => {
    const productionRowsByMachineId = new Map(effectiveProductionData.map((row) => [row.machine.id, row]))

    return {
      ...data,
      machines: data.machines.map((machine) => {
        const machinePatch = machineDateOptimisticPatches[machine.id]
        const productionRow = productionRowsByMachineId.get(machine.id)
        const productionStages = productionRow?.stages
          .map(productionStageToGanttStage)
          .filter((stage): stage is GanttStage => Boolean(stage))

        const stages = productionRow ? (productionStages ?? []) : machine.stages

        if (!machinePatch && stages === machine.stages) return machine

        return {
          ...machine,
          ...(machinePatch ?? {}),
          stages,
        }
      }),
    }
  }, [data, effectiveProductionData, machineDateOptimisticPatches])

  const productionByMachineId = useMemo(() => {
    return new Map(effectiveProductionData.map((row) => [row.machine.id, row]))
  }, [effectiveProductionData])

  const ganttMachineById = useMemo(() => {
    return new Map(effectiveData.machines.map((machine) => [machine.id, machine]))
  }, [effectiveData.machines])

  const productionMonthOptions = useMemo<GanttMonthOption[]>(() => {
    const months = new Set<string>()

    for (const machine of effectiveData.machines) {
      const normalized = normalizeProductionMonthValue(machine.production_month)
      if (normalized) months.add(normalized)
    }

    for (const row of effectiveProductionData) {
      const normalized = normalizeProductionMonthValue(row.machine.production_month)
      if (normalized) months.add(normalized)
    }

    return Array.from(months)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: formatProductionMonth(value) }))
  }, [effectiveData.machines, effectiveProductionData])

  const plannerRows = useMemo<PlannerRow[]>(() => {
    const selectedWorkshop = filters.workshop ? parseInt(filters.workshop) : null
    const selectedProductionMonth = normalizeProductionMonthValue(filters.productionMonth)
    const visibleStages = new Set(filters.visibleStages.filter((stage) => PRODUCTION_PLAN_STAGE_ORDER.includes(stage)))
    const query = filters.search.trim().toLowerCase()
    const rows: PlannerRow[] = []

    for (const [machineIndex, machine] of effectiveData.machines.entries()) {
      if (machine.stages.length === 0) continue
      if (query && !machine.name.toLowerCase().includes(query)) continue
      if (filters.confirmation === 'confirmed' && !machine.is_confirmed) continue
      if (filters.confirmation === 'unconfirmed' && machine.is_confirmed) continue
      if (selectedProductionMonth && normalizeProductionMonthValue(machine.production_month) !== selectedProductionMonth) continue

      const visibleMachineStages = machine.stages.filter((stage) => {
        if (!stage.date_start) return false
        if (!visibleStages.has(stage.stage_type)) return false
        if (selectedWorkshop && stage.workshop !== selectedWorkshop) return false
        return true
      })

      const supplyItems = filters.showSupply ? machine.supply_deadlines : []
      const hasSupplyTimeline =
        filters.showSupply && (
          machine.material_items.length > 0 ||
          Boolean(machine.planned_material_date) ||
          Boolean(machine.actual_material_date)
        )
      if (visibleMachineStages.length === 0 && supplyItems.length === 0 && !hasSupplyTimeline) continue

      rows.push({
        machine,
        visibleStages: visibleMachineStages,
        supplyItems,
        machineIndex,
      })
    }

    return rows
  }, [effectiveData.machines, filters])

  const unscheduledRows = useMemo<UnscheduledRow[]>(() => {
    const selectedWorkshop = filters.workshop ? parseInt(filters.workshop) : null
    const selectedProductionMonth = normalizeProductionMonthValue(filters.productionMonth)
    const query = filters.search.trim().toLowerCase()
    const rows: UnscheduledRow[] = []

    for (const row of effectiveProductionData) {
      if (hasScheduledStage(row)) continue
      if (query && !row.machine.name.toLowerCase().includes(query)) continue
      if (filters.confirmation === 'confirmed' && !row.machine.is_confirmed) continue
      if (filters.confirmation === 'unconfirmed' && row.machine.is_confirmed) continue
      if (selectedProductionMonth && normalizeProductionMonthValue(row.machine.production_month) !== selectedProductionMonth) continue
      if (selectedWorkshop && row.machine.production_workshop !== selectedWorkshop) continue

      rows.push({
        machine: productionRowToGanttMachine(row, ganttMachineById.get(row.machine.id)),
        productionRow: row,
        machineIndex: rows.length,
      })
    }

    return rows
      .sort((a, b) => compareProductionMachines(a.machine, b.machine))
      .map((row, machineIndex) => ({ ...row, machineIndex }))
  }, [effectiveProductionData, filters, ganttMachineById])

  useEffect(() => {
    if (
      selectedMachineId &&
      (
        plannerRows.some((row) => row.machine.id === selectedMachineId) ||
        unscheduledRows.some((row) => row.machine.id === selectedMachineId)
      )
    ) {
      return
    }

    setSelectedMachineId(plannerRows[0]?.machine.id ?? unscheduledRows[0]?.machine.id ?? null)
  }, [plannerRows, selectedMachineId, unscheduledRows])

  const selectedMachine = useMemo(() => (
    selectedMachineId
      ? ganttMachineById.get(selectedMachineId) ??
        unscheduledRows.find((row) => row.machine.id === selectedMachineId)?.machine ??
        null
      : null
  ), [ganttMachineById, selectedMachineId, unscheduledRows])
  const selectedProductionRow = selectedMachineId ? productionByMachineId.get(selectedMachineId) : undefined
  const selectedMachinePlanStatus = useMemo(() => {
    if (!selectedMachine?.factory_id || !selectedMachine.production_month) return 'draft'
    const month = normalizeProductionMonthValue(selectedMachine.production_month)
    const plan = month
      ? monthPlans.find((item) => item.factory_id === selectedMachine.factory_id && item.production_month === month)
      : null
    return plan?.status || 'draft'
  }, [monthPlans, selectedMachine])
  const selectedMachineRequiresApproval = Boolean(
    selectedMachine &&
    isProductionManager &&
    !isDirector &&
    selectedMachinePlanStatus === 'confirmed'
  )
  const selectedDateChanges = useMemo(
    () => Object.values(dateChangeDrafts).filter((change) => change.machineId === selectedMachineId),
    [dateChangeDrafts, selectedMachineId],
  )

  const recordDateDraft = useCallback((change: DateChangeDraft) => {
    setDateChangeDrafts((current) => {
      if (dateOnlyKey(change.old_value) === dateOnlyKey(change.new_value)) {
        const { [change.key]: _removed, ...rest } = current
        void _removed
        return rest
      }
      return { ...current, [change.key]: change }
    })
  }, [])

  const updateStageOptimisticPatch = useCallback((stageId: string, patch: StageOptimisticPatch) => {
    setStageOptimisticPatches((current) => ({
      ...current,
      [stageId]: {
        ...(current[stageId] ?? {}),
        ...patch,
      },
    }))
  }, [])

  const updateMachineDateOptimisticPatch = useCallback((machineId: string, field: MachineDateField, value: string | null) => {
    setMachineDateOptimisticPatches((current) => ({
      ...current,
      [machineId]: {
        ...(current[machineId] ?? {}),
        [field]: value,
      },
    }))
  }, [])

  const getMachineDraftValue = useCallback((machine: GanttMachine, field: MachineDateField) => {
    const key = machineDateDraftKey(machine.id, field)
    return dateChangeDrafts[key]?.new_value ?? machineDateOptimisticPatches[machine.id]?.[field] ?? machine[field]
  }, [dateChangeDrafts, machineDateOptimisticPatches])

  const getStageDraftValue = useCallback((stage: ProductionStage, field: StageDateField) => {
    if (!selectedMachineId) return stage[field]
    const key = stageDateDraftKey(selectedMachineId, stage.id, field)
    return dateChangeDrafts[key]?.new_value ?? stageOptimisticPatches[stage.id]?.[field] ?? stage[field]
  }, [dateChangeDrafts, selectedMachineId, stageOptimisticPatches])

  const clearSelectedDrafts = useCallback(() => {
    setDateChangeDrafts((current) => Object.fromEntries(
      Object.entries(current).filter(([, change]) => change.machineId !== selectedMachineId)
    ))
  }, [selectedMachineId])

  const rowVirtualizer = useVirtualizer({
    count: plannerRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => PLANNER_ROW_HEIGHT,
    overscan: 10,
  })

  const todayOffset = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const offset = differenceInCalendarDays(today, rangeStart)
    return offset < 0 ? -1 : offset * dayWidth
  }, [rangeStart, dayWidth])

  const updateScrollShadows = useCallback((el: HTMLDivElement | null) => {
    if (!el) return

    const next = {
      left: el.scrollLeft > 8,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 8,
    }

    setScrollShadows((current) => (
      current.left === next.left && current.right === next.right ? current : next
    ))
  }, [])

  const updateDayWidth = useCallback((nextValue: number) => {
    const el = scrollRef.current
    const oldWidth = dayWidth
    const nextWidth = clampDayWidth(nextValue)
    if (nextWidth === oldWidth) return

    const centerDay = el
      ? Math.max(0, (el.scrollLeft + el.clientWidth / 2 - MACHINE_RAIL_WIDTH) / oldWidth)
      : 0

    setDayWidth(nextWidth)

    window.requestAnimationFrame(() => {
      if (el) {
        el.scrollLeft = Math.max(0, MACHINE_RAIL_WIDTH + centerDay * nextWidth - el.clientWidth / 2)
      }
    })
  }, [dayWidth])

  const scrollToToday = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current
    if (!el || todayOffset < 0) return
    el.scrollTo({
      left: Math.max(0, MACHINE_RAIL_WIDTH + todayOffset - el.clientWidth / 2),
      behavior,
    })
  }, [todayOffset])

  const syncWeldingLoadScroll = useCallback((scrollLeft: number) => {
    const el = weldingLoadScrollRef.current
    if (!el || Math.abs(el.scrollLeft - scrollLeft) < 1) return

    scrollSyncLockRef.current = true
    el.scrollLeft = scrollLeft
    window.requestAnimationFrame(() => {
      scrollSyncLockRef.current = false
    })
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    updateScrollShadows(el)
    if (el && !scrollSyncLockRef.current) {
      syncWeldingLoadScroll(el.scrollLeft)
    }

    if (scrollCheckTimeoutRef.current) {
      window.clearTimeout(scrollCheckTimeoutRef.current)
    }

    scrollCheckTimeoutRef.current = window.setTimeout(() => {
      const el = scrollRef.current
      if (!el || rangeExtendLockRef.current) return

      if (el.scrollLeft + el.clientWidth > el.scrollWidth - RANGE_EDGE_PX) {
        rangeExtendLockRef.current = true
        setRangeEnd((end) => addDays(end, RANGE_EXTEND_DAYS))
        window.requestAnimationFrame(() => {
          rangeExtendLockRef.current = false
        })
      }

      if (el.scrollLeft < RANGE_EDGE_PX) {
        rangeExtendLockRef.current = true
        setRangeStart((start) => subDays(start, RANGE_EXTEND_DAYS))
        window.requestAnimationFrame(() => {
          el.scrollLeft += RANGE_EXTEND_DAYS * dayWidth
          rangeExtendLockRef.current = false
        })
      }
    }, RANGE_CHECK_DEBOUNCE_MS)
  }, [dayWidth, syncWeldingLoadScroll, updateScrollShadows])

  const handleWeldingLoadScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (scrollSyncLockRef.current) return

    const el = scrollRef.current
    if (!el || Math.abs(el.scrollLeft - event.currentTarget.scrollLeft) < 1) return

    scrollSyncLockRef.current = true
    el.scrollLeft = event.currentTarget.scrollLeft
    window.requestAnimationFrame(() => {
      scrollSyncLockRef.current = false
    })
  }, [])

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      updateDayWidth(dayWidth + (event.deltaY > 0 ? -3 : 3))
    }
  }, [dayWidth, updateDayWidth])

  useEffect(() => {
    if (didInitialScrollRef.current) return
    didInitialScrollRef.current = true
    window.setTimeout(() => scrollToToday('auto'), 50)
  }, [scrollToToday])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    updateScrollShadows(el)
    const handleResize = () => updateScrollShadows(el)
    el.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleResize)

    return () => {
      el.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)
      if (scrollCheckTimeoutRef.current) {
        window.clearTimeout(scrollCheckTimeoutRef.current)
      }
    }
  }, [handleScroll, updateScrollShadows])

  useEffect(() => {
    if (!weldingLoadOpen) return
    const source = scrollRef.current
    const target = weldingLoadScrollRef.current
    if (!source || !target) return
    target.scrollLeft = source.scrollLeft
  }, [weldingLoadOpen])

  const weldingLoadRows = useMemo<WeldingLoadRow[]>(() => {
    const selectedWorkshop = filters.workshop ? parseInt(filters.workshop) : null
    const selectedProductionMonth = normalizeProductionMonthValue(filters.productionMonth)
    const query = filters.search.trim().toLowerCase()
    const rowsByWorkshop = new Map<string, WeldingLoadRow>()
    const totalRow: WeldingLoadRow = { key: 'total', label: 'Итого', values: new Map(), machines: new Map(), total: 0, isTotal: true }
    const rangeStartKey = dayKey(rangeStart)
    const rangeEndKey = dayKey(rangeEnd)

    for (const machine of effectiveData.machines) {
      if (query && !machine.name.toLowerCase().includes(query)) continue
      if (filters.confirmation === 'confirmed' && !machine.is_confirmed) continue
      if (filters.confirmation === 'unconfirmed' && machine.is_confirmed) continue
      if (selectedProductionMonth && normalizeProductionMonthValue(machine.production_month) !== selectedProductionMonth) continue

      const machineWeight = Number(machine.total_weight || 0)
      if (machineWeight <= 0) continue

      for (const stage of machine.stages) {
        if (stage.stage_type !== 'assembly' || !stage.date_start || !stage.date_end) continue
        if (selectedWorkshop && stage.workshop !== selectedWorkshop) continue

        const start = new Date(stage.date_start)
        const end = new Date(stage.date_end)
        const durationDays = Math.max(1, differenceInCalendarDays(end, start) + 1)
        const dailyTons = machineWeight / durationDays
        const workshopKey = stage.workshop === null ? 'none' : String(stage.workshop)
        const workshopLabel = stage.workshop === null ? 'Без цеха' : getWorkshopLabel(stage.workshop)
        const row = rowsByWorkshop.get(workshopKey) || {
          key: workshopKey,
          label: workshopLabel,
          values: new Map<string, number>(),
          machines: new Map<string, WeldingLoadMachine[]>(),
          total: 0,
        }

        for (let index = 0; index < durationDays; index++) {
          const current = addDays(start, index)
          const key = dayKey(current)
          if (key < rangeStartKey || key > rangeEndKey) continue
          const loadMachine = { id: machine.id, name: machine.name, dailyTons }
          const rowMachines = row.machines.get(key) || []
          const totalMachines = totalRow.machines.get(key) || []

          mergeWeldingLoadMachine(rowMachines, loadMachine)
          mergeWeldingLoadMachine(totalMachines, loadMachine)
          row.machines.set(key, rowMachines)
          totalRow.machines.set(key, totalMachines)
          row.values.set(key, (row.values.get(key) || 0) + dailyTons)
          row.total += dailyTons
          totalRow.values.set(key, (totalRow.values.get(key) || 0) + dailyTons)
          totalRow.total += dailyTons
        }

        rowsByWorkshop.set(workshopKey, row)
      }
    }

    const rows = Array.from(rowsByWorkshop.values())
      .filter((row) => row.total > 0)
      .sort((a, b) => {
        if (a.key === 'none') return 1
        if (b.key === 'none') return -1
        return Number(a.key) - Number(b.key)
      })

    return totalRow.total > 0 ? [...rows, totalRow] : rows
  }, [effectiveData.machines, filters, rangeStart, rangeEnd])

  const saveStageField = useCallback(async (
    stageId: string,
    field: string,
    value: string | number | boolean | null,
    options: { refresh?: boolean } = {},
  ) => {
    const result = await updateProductionStage(stageId, { [field]: value })
    if (result.success) {
      toast.success('Сохранено')
      if (options.refresh !== false) {
        router.refresh()
      }
    } else {
      toast.error(result.error || 'Ошибка сохранения')
    }
    return result
  }, [router])

  const saveStageDate = useCallback(async (
    row: ProductionRow,
    stage: ProductionStage,
    field: 'date_start' | 'date_end' | 'night_shift_date',
    value: string | null
  ) => {
    if (selectedMachineRequiresApproval) {
      recordDateDraft({
        key: stageDateDraftKey(row.machine.id, stage.id, field),
        machineId: row.machine.id,
        target_type: 'stage',
        production_stage_id: stage.id,
        field_name: field,
        old_value: dateOnlyKey(stage[field]),
        new_value: dateOnlyKey(value),
        label: draftDateLabel(stage, field),
      })
      toast.success('Изменение добавлено в запрос')
      return { success: true, error: null }
    }

    if (
      stage.stage_type === 'shipping' &&
      field === 'date_end' &&
      value &&
      row.machine.desired_shipping_date &&
      value > row.machine.desired_shipping_date
    ) {
      const confirmed = confirm(
        `Готовность к погрузке ${value} позже желаемого дедлайна ${row.machine.desired_shipping_date}. Сохранить дату?`
      )
      if (!confirmed) return { success: false, error: null }
    }

    const previousValue = getStageDraftValue(stage, field)
    const nextValue = dateOnlyKey(value)
    updateStageOptimisticPatch(stage.id, { [field]: nextValue })

    const result = await saveStageField(stage.id, field, nextValue, { refresh: false })
    if (!result.success) {
      updateStageOptimisticPatch(stage.id, { [field]: previousValue })
    }
    return result
  }, [getStageDraftValue, recordDateDraft, saveStageField, selectedMachineRequiresApproval, updateStageOptimisticPatch])

  const saveMachineDate = useCallback(async (machineId: string, field: MachineDateField, value: string | null) => {
    if (selectedMachineRequiresApproval && selectedProductionRow) {
      recordDateDraft({
        key: machineDateDraftKey(machineId, field),
        machineId,
        target_type: 'machine',
        field_name: field,
        old_value: dateOnlyKey(selectedProductionRow.machine[field]),
        new_value: dateOnlyKey(value),
        label: draftDateLabel(null, field),
      })
      toast.success('Изменение добавлено в запрос')
      return { success: true, error: null }
    }

    const previousValue = selectedMachine?.id === machineId
      ? getMachineDraftValue(selectedMachine, field)
      : selectedProductionRow?.machine[field] ?? null
    const nextValue = dateOnlyKey(value)
    updateMachineDateOptimisticPatch(machineId, field, nextValue)

    const result = await updateMachineDate(machineId, field, nextValue)
    if (result.success) {
      toast.success('Сохранено')
    } else {
      updateMachineDateOptimisticPatch(machineId, field, previousValue)
      toast.error(result.error || 'Ошибка сохранения')
    }
    return result
  }, [
    getMachineDraftValue,
    recordDateDraft,
    selectedMachine,
    selectedMachineRequiresApproval,
    selectedProductionRow,
    updateMachineDateOptimisticPatch,
  ])

  const clearStageDates = useCallback(async (stage: ProductionStage) => {
    if (selectedMachineRequiresApproval && selectedProductionRow) {
      recordDateDraft({
        key: stageDateDraftKey(selectedProductionRow.machine.id, stage.id, 'date_start'),
        machineId: selectedProductionRow.machine.id,
        target_type: 'stage',
        production_stage_id: stage.id,
        field_name: 'date_start',
        old_value: dateOnlyKey(stage.date_start),
        new_value: null,
        label: draftDateLabel(stage, 'date_start'),
      })
      recordDateDraft({
        key: stageDateDraftKey(selectedProductionRow.machine.id, stage.id, 'date_end'),
        machineId: selectedProductionRow.machine.id,
        target_type: 'stage',
        production_stage_id: stage.id,
        field_name: 'date_end',
        old_value: dateOnlyKey(stage.date_end),
        new_value: null,
        label: draftDateLabel(stage, 'date_end'),
      })
      toast.success('Очистка дат добавлена в запрос')
      return { success: true, error: null }
    }

    const previousStart = getStageDraftValue(stage, 'date_start')
    const previousEnd = getStageDraftValue(stage, 'date_end')
    updateStageOptimisticPatch(stage.id, { date_start: null, date_end: null })
    setClearingStageId(stage.id)
    try {
      const result = await clearProductionStageDates(stage.id)
      if (result.success) {
        toast.success('Даты этапа очищены')
      } else {
        updateStageOptimisticPatch(stage.id, { date_start: previousStart, date_end: previousEnd })
        toast.error(result.error || 'Ошибка очистки дат')
      }
      return result
    } finally {
      setClearingStageId(null)
    }
  }, [getStageDraftValue, recordDateDraft, selectedMachineRequiresApproval, selectedProductionRow, updateStageOptimisticPatch])

  const submitDateChangeRequest = useCallback(async () => {
    if (!selectedMachineId || selectedDateChanges.length === 0) return
    const comment = window.prompt('Комментарий к запросу на изменение дат', '') || null
    setSubmittingDateRequest(true)
    try {
      const result = await createProductionPlanDateChangeRequest({
        machineId: selectedMachineId,
        changes: selectedDateChanges.map(({ target_type, production_stage_id, field_name, new_value }) => ({
          target_type,
          production_stage_id,
          field_name,
          new_value,
        })),
        comment,
      })
      if (!result.success) throw new Error(result.error || 'Не удалось отправить запрос')
      toast.success('Запрос отправлен руководителю планирования')
      clearSelectedDrafts()
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось отправить запрос')
    } finally {
      setSubmittingDateRequest(false)
    }
  }, [clearSelectedDrafts, router, selectedDateChanges, selectedMachineId])

  const confirmedCount = [
    ...plannerRows.map((row) => row.machine),
    ...unscheduledRows.map((row) => row.machine),
  ].filter((machine) => machine.is_confirmed).length
  const visibleStageCount = plannerRows.reduce((sum, row) => sum + row.visibleStages.length, 0)

  return (
    <div
      className={cn(
        'grid gap-4 transition-[grid-template-columns] duration-200 ease-out',
        desktopInspectorOpen ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : 'xl:grid-cols-[minmax(0,1fr)]'
      )}
    >
      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-[11px] font-medium uppercase text-slate-500">На графике</div>
            <div className="mt-1 text-lg font-semibold text-blue-950">{plannerRows.length}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-[11px] font-medium uppercase text-slate-500">Без дат</div>
            <div className="mt-1 text-lg font-semibold text-blue-950">{unscheduledRows.length}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-[11px] font-medium uppercase text-slate-500">Подтверждены</div>
            <div className="mt-1 text-lg font-semibold text-blue-950">{confirmedCount}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-[11px] font-medium uppercase text-slate-500">Этапы на экране</div>
            <div className="mt-1 text-lg font-semibold text-blue-950">{visibleStageCount}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-[11px] font-medium uppercase text-slate-500">Окно графика</div>
            <div className="mt-1 truncate text-sm font-semibold text-blue-950" title={rangeLabel}>{rangeLabel}</div>
          </div>
        </div>

        <GanttControls
          onToday={() => scrollToToday()}
          dayWidth={dayWidth}
          onDayWidthChange={updateDayWidth}
          onZoomIn={() => updateDayWidth(dayWidth + ZOOM_STEP)}
          onZoomOut={() => updateDayWidth(dayWidth - ZOOM_STEP)}
          filters={filters}
          onFiltersChange={setFilters}
          productionMonthOptions={productionMonthOptions}
          stageOptions={PRODUCTION_PLAN_STAGE_ORDER}
        />

        <UnscheduledMachinesPanel
          rows={unscheduledRows}
          open={unscheduledOpen}
          selectedMachineId={selectedMachineId}
          onToggle={() => setUnscheduledOpen((current) => !current)}
          onSelect={(machineId) => {
            setSelectedMachineId(machineId)
            setDesktopInspectorOpen(true)
          }}
        />

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-200 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-blue-950">Планировщик производства</h2>
              <p className="text-xs text-slate-500">Одна строка - одна машина. Этапы выбираются на timeline, редактирование справа.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs font-medium text-slate-600">{rangeLabel}</div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="hidden min-h-10 gap-1.5 px-3 text-xs xl:inline-flex"
                aria-label={desktopInspectorOpen ? 'Скрыть инспектор машины' : 'Показать инспектор машины'}
                aria-expanded={desktopInspectorOpen}
                onClick={() => setDesktopInspectorOpen((current) => !current)}
              >
                {desktopInspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                {desktopInspectorOpen ? 'Скрыть инспектор' : 'Показать инспектор'}
              </Button>
            </div>
          </div>

          <div className="relative">
            <div
              ref={scrollRef}
              className="relative overflow-auto scroll-smooth bg-white will-change-transform"
              style={{ height, WebkitOverflowScrolling: 'touch' }}
              onWheel={handleWheel}
            >
              <div style={{ width: MACHINE_RAIL_WIDTH + totalWidth, minWidth: '100%' }}>
                <div
                  className="sticky top-0 z-40 grid border-b border-slate-300 bg-slate-100"
                  style={{
                    height: TIMELINE_HEIGHT,
                    gridTemplateColumns: `${MACHINE_RAIL_WIDTH}px ${totalWidth}px`,
                  }}
                >
                  <div
                    className="sticky left-0 z-50 flex items-end border-r border-slate-300 bg-slate-100 px-4 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600"
                    style={{ width: MACHINE_RAIL_WIDTH }}
                  >
                    Машина
                  </div>
                  <GanttTimeline
                    rangeStart={rangeStart}
                    rangeEnd={rangeEnd}
                    scale={scale}
                    todayOffset={todayOffset}
                    unitWidth={dayWidth}
                  />
                </div>

                <div
                  className="relative"
                  style={{ height: rowVirtualizer.getTotalSize(), width: MACHINE_RAIL_WIDTH + totalWidth }}
                >
                  <div className="pointer-events-none absolute inset-y-0 flex" style={{ left: MACHINE_RAIL_WIDTH }}>
                    {scaleItems.map((item, index) => (
                      <div
                        key={index}
                        className={cn(
                          'shrink-0 border-r border-slate-100',
                          item.isWeekend && 'bg-slate-100/70',
                          item.isToday && 'bg-red-50'
                        )}
                        style={{ width: dayWidth }}
                      />
                    ))}
                  </div>

                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = plannerRows[virtualRow.index]
                    if (!row) return null

                    return (
                      <PlannerVirtualRow
                        key={virtualRow.key}
                        row={row}
                        top={virtualRow.start}
                        totalWidth={totalWidth}
                        rangeStart={rangeStart}
                        dayWidth={dayWidth}
                        todayOffset={todayOffset}
                        selected={row.machine.id === selectedMachineId}
                        showSupply={filters.showSupply}
                        onSelect={setSelectedMachineId}
                      />
                    )
                  })}

                  {plannerRows.length === 0 && (
                    <div className="flex items-center justify-center py-16 text-sm text-slate-500">
                      Нет данных для отображения на графике
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div
              className={cn(
                'pointer-events-none absolute inset-y-0 w-6 bg-gradient-to-r from-slate-300/30 to-transparent transition-opacity',
                scrollShadows.left ? 'opacity-100' : 'opacity-0'
              )}
              style={{ left: MACHINE_RAIL_WIDTH }}
            />
            <div
              className={cn(
                'pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent transition-opacity',
                scrollShadows.right ? 'opacity-100' : 'opacity-0'
              )}
            />
          </div>
        </div>

        <div className="xl:hidden">
          <ProductionMachineInspector
            key={selectedMachine?.id ?? 'mobile-empty'}
            machine={selectedMachine}
            productionRow={selectedProductionRow}
            canEdit={canEdit}
            approvalLocked={selectedMachineRequiresApproval}
            pendingDateChanges={selectedDateChanges}
            submittingDateRequest={submittingDateRequest}
            clearingStageId={clearingStageId}
            collapsible
            defaultOpen
            getMachineDateValue={getMachineDraftValue}
            getStageDateValue={getStageDraftValue}
            onMachineDateUpdate={saveMachineDate}
            onStageDateUpdate={saveStageDate}
            onStageUpdate={saveStageField}
            onClearDates={clearStageDates}
            onSubmitDateChangeRequest={submitDateChangeRequest}
            onResetDateChangeDraft={clearSelectedDrafts}
          />
        </div>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            aria-expanded={weldingLoadOpen}
            onClick={() => setWeldingLoadOpen((current) => !current)}
          >
            <span>
              <span className="block text-sm font-semibold text-blue-950">Нагрузка сварки по цехам</span>
              <span className="block text-xs text-slate-500">Синхронизирована с горизонтальным scroll timeline.</span>
            </span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-500 transition-transform', weldingLoadOpen && 'rotate-180')} />
          </button>

          {weldingLoadOpen && (
            <div ref={weldingLoadScrollRef} className="overflow-x-auto" onScroll={handleWeldingLoadScroll}>
              <div className="min-w-full" style={{ width: Math.max(MACHINE_RAIL_WIDTH + totalWidth, 860) }}>
                <div
                  className="grid border-b border-slate-200 bg-slate-100"
                  style={{ gridTemplateColumns: `64px ${totalWidth}px ${Math.max(0, MACHINE_RAIL_WIDTH - 64)}px` }}
                >
                  <div className="sticky left-0 z-10 border-r border-slate-300 bg-slate-100 px-2 py-2 text-center text-xs font-semibold text-blue-950">Цех</div>
                  <div className="relative h-9">
                    {scaleItems.map((item, index) => (
                      <div
                        key={index}
                        className={cn(
                          'absolute top-0 flex h-full items-center justify-center border-r border-slate-200 text-[10px]',
                          item.isWeekend && 'bg-slate-200/70 text-slate-400',
                          item.isToday && 'bg-red-50 text-red-700'
                        )}
                        style={{ left: index * dayWidth, width: dayWidth }}
                      >
                        {format(item.date, 'dd.MM')}
                      </div>
                    ))}
                  </div>
                  <div className="bg-slate-100" />
                </div>

                {weldingLoadRows.map((row) => (
                  <div
                    key={row.key}
                    className={cn('grid border-b border-slate-200 last:border-b-0', row.isTotal ? 'bg-slate-50' : 'bg-white')}
                    style={{ gridTemplateColumns: `64px ${totalWidth}px ${Math.max(0, MACHINE_RAIL_WIDTH - 64)}px` }}
                  >
                    <div className={cn('sticky left-0 z-10 border-r border-slate-300 px-2 py-2 text-center text-xs font-semibold', row.isTotal ? 'bg-slate-50 text-blue-950' : 'bg-white text-slate-700')}>
                      {row.label}
                    </div>
                    <div className="relative h-9">
                      {scaleItems.map((item, index) => {
                        const value = row.values.get(dayKey(item.date)) || 0
                        return (
                          <div
                            key={`${row.key}-${index}`}
                            className={cn(
                              'absolute top-0 flex h-full items-center justify-center border-r border-slate-100 px-1 text-[10px]',
                              value > 0 ? (row.isTotal ? 'font-semibold text-blue-950' : 'text-slate-700') : 'text-slate-300'
                            )}
                            style={{ left: index * dayWidth, width: dayWidth }}
                            title={weldingLoadTitle(row, item.date, value)}
                          >
                            {formatTons(value)}
                          </div>
                        )
                      })}
                    </div>
                    <div className={row.isTotal ? 'bg-slate-50' : 'bg-white'} />
                  </div>
                ))}

                {weldingLoadRows.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-slate-500">
                    Нет данных по сварке в текущем диапазоне
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <GanttLegend defaultOpen={false} stages={PRODUCTION_PLAN_STAGE_ORDER} />
      </div>

      {desktopInspectorOpen && (
        <div className="hidden xl:block">
          <div className="sticky top-4">
            <ProductionMachineInspector
              key={selectedMachine?.id ?? 'desktop-empty'}
              machine={selectedMachine}
              productionRow={selectedProductionRow}
              canEdit={canEdit}
              approvalLocked={selectedMachineRequiresApproval}
              pendingDateChanges={selectedDateChanges}
              submittingDateRequest={submittingDateRequest}
              clearingStageId={clearingStageId}
              getMachineDateValue={getMachineDraftValue}
              getStageDateValue={getStageDraftValue}
              onMachineDateUpdate={saveMachineDate}
              onStageDateUpdate={saveStageDate}
              onStageUpdate={saveStageField}
              onClearDates={clearStageDates}
              onSubmitDateChangeRequest={submitDateChangeRequest}
              onResetDateChangeDraft={clearSelectedDrafts}
              onCollapse={() => setDesktopInspectorOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
