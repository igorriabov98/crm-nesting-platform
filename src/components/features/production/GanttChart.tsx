"use client"

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { addDays, subDays, differenceInCalendarDays, format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown } from 'lucide-react'
import { GanttControls, type GanttFilters, type GanttMonthOption } from './gantt/GanttControls'
import { GanttTimeline } from './gantt/GanttTimeline'
import { GanttLegend } from './gantt/GanttLegend'
import { GanttBar } from './gantt/GanttBar'
import { GanttSupplyMarker } from './gantt/GanttSupplyMarker'
import { GanttMaterialMarker } from './gantt/GanttMaterialMarker'
import { STAGE_ORDER } from '@/lib/constants/stages'
import { generateDateScale, type GanttScale } from '@/lib/utils/gantt'
import { formatDesiredShippingDate } from '@/lib/utils/desired-shipping'
import { formatProductionMonth, normalizeProductionMonthValue } from '@/lib/utils/production-months'
import { cn } from '@/lib/utils'
import { productionQueueLabel } from '@/lib/constants/factory-workshops'
import type { GanttData, GanttMaterialItem } from '@/app/(protected)/production/gantt/actions'
import {
  GANTT_LEFT_WIDTH,
  GANTT_MACHINE_COL_WIDTH,
  GANTT_MARKER_SIZE,
  GANTT_ROW_HEIGHT,
  GANTT_SHIPPING_MARKER_HEIGHT,
  GANTT_STAGE_DOT_SIZE,
  GANTT_STAGE_COL_WIDTH,
  GANTT_TIMELINE_HEIGHT,
  GANTT_WORKSHOP_COL_WIDTH,
  getGanttStageColor,
  getGanttStageLabel,
  getWorkshopLabel,
  type GanttGroupRow,
} from './gantt/types'

interface GanttChartProps {
  data: GanttData
  filters?: GanttFilters
  onFiltersChange?: (filters: GanttFilters) => void
  hideControls?: boolean
  height?: string
}

type FlatGanttRow = GanttGroupRow & {
  groupStart: boolean
  groupEnd: boolean
  groupRowCount: number
  machineIndex: number
  productionMarkerRow: boolean
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

const ZOOM_MIN = 15
const ZOOM_MAX = 80
const ZOOM_STEP = 5
const RANGE_EDGE_PX = 240
const RANGE_EXTEND_DAYS = 30
const RANGE_CHECK_DEBOUNCE_MS = 180
const scale: GanttScale = 'day'

function clampDayWidth(value: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))
}

function findEarliestDate(data: GanttData) {
  const dates = data.machines.flatMap((machine) => [
    ...machine.stages.map((stage) => stage.date_start).filter(Boolean),
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
    ...machine.stages.map((stage) => stage.date_end || stage.date_start).filter(Boolean),
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

function productionMonthLabel(date: string | null | undefined) {
  if (!date) return null
  return format(new Date(date), 'LLLL yyyy', { locale: ru })
}

function dayKey(date: Date) {
  return format(date, 'yyyy-MM-dd')
}

function formatTons(value: number) {
  if (value <= 0) return ''
  return value >= 10 ? value.toFixed(1) : value.toFixed(2)
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

const GanttVirtualRow = React.memo(function GanttVirtualRow({
  row,
  top,
  totalWidth,
  rangeStart,
  dayWidth,
  todayOffset,
}: {
  row: FlatGanttRow
  top: number
  totalWidth: number
  rangeStart: Date
  dayWidth: number
  todayOffset: number
}) {
  const deadlineOffset = row.machine.desired_shipping_date
    ? differenceInCalendarDays(new Date(row.machine.desired_shipping_date), rangeStart) * dayWidth
    : null
  const deadlineLabel = formatDesiredShippingDate(row.machine.desired_shipping_date)
  const actualShippingOffset = dateOffset(row.machine.actual_shipping_date, rangeStart, dayWidth)
  const actualShippingLabel = formatDesiredShippingDate(row.machine.actual_shipping_date)
  const isStripedMachine = row.machineIndex % 2 === 1
  const queueLabel = productionQueueLabel(row.machine.production_workshop, row.machine.production_queue_number)
  const monthLabel = productionMonthLabel(row.machine.production_month)
  const shippingMarkerTop = Math.max(4, GANTT_ROW_HEIGHT - GANTT_SHIPPING_MARKER_HEIGHT - 8)
  const plannedMaterialGroups = groupMaterialItemsByDate(
    row.machine.material_items,
    (item) => item.planned_delivery_date
  )
  const actualMaterialGroups = groupMaterialItemsByDate(
    row.machine.material_items,
    (item) => item.actual_delivery_date || (item.supply_status === 'received' ? item.planned_delivery_date : null)
  )
  const plannedGroups = plannedMaterialGroups.length > 0
    ? plannedMaterialGroups
    : row.machine.planned_material_date
      ? [{ date: row.machine.planned_material_date, items: [] }]
      : []
  const actualGroups = actualMaterialGroups.length > 0
    ? actualMaterialGroups
    : row.machine.actual_material_date
      ? [{ date: row.machine.actual_material_date, items: row.machine.material_items.filter((item) => item.supply_status === 'received') }]
      : []

  return (
    <div
      className={cn(
        "absolute left-0 z-20 grid hover:bg-[#F8F9FA]/70",
        isStripedMachine ? "bg-slate-50" : "bg-white"
      )}
      style={{
        top,
        height: GANTT_ROW_HEIGHT,
        width: GANTT_LEFT_WIDTH + totalWidth,
        gridTemplateColumns: `${GANTT_MACHINE_COL_WIDTH}px ${GANTT_STAGE_COL_WIDTH}px ${GANTT_WORKSHOP_COL_WIDTH}px ${totalWidth}px`,
        contain: 'layout style',
      }}
    >
      <div
        className={cn(
          "sticky left-0 z-30 flex h-full items-center border-r border-[#E8ECF0] px-3",
          isStripedMachine ? "bg-slate-50" : "bg-white"
        )}
        style={{ width: GANTT_MACHINE_COL_WIDTH }}
      >
        {row.groupStart && (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[#2563EB]" title={row.machine.name}>
              {row.machine.name}
            </div>
            <div className="mt-0.5 text-xs text-[#6B7280]">
              {Number(row.machine.total_weight || 0).toFixed(1)} т
            </div>
            <div className="mt-0.5 truncate text-xs text-[#6B7280]" title={monthLabel ? `${monthLabel} · ${queueLabel}` : queueLabel}>
              {monthLabel ? `${monthLabel} · ${queueLabel}` : queueLabel}
            </div>
          </div>
        )}
      </div>

      <div
        className={cn(
          "sticky z-30 flex h-full items-center gap-2 border-r border-[#E8ECF0] px-3 text-xs text-[#374151]",
          isStripedMachine ? "bg-slate-50" : "bg-white"
        )}
        style={{ left: GANTT_MACHINE_COL_WIDTH, width: GANTT_STAGE_COL_WIDTH }}
      >
        {row.type === 'stage' ? (
          <>
            <span className="shrink-0 rounded-sm" style={{ width: GANTT_STAGE_DOT_SIZE, height: GANTT_STAGE_DOT_SIZE, backgroundColor: getGanttStageColor(row.stage.stage_type) }} />
            <span className="truncate">{getGanttStageLabel(row.stage.stage_type)}</span>
          </>
        ) : (
          <>
            <span className="shrink-0 rounded-sm bg-[#16A34A]" style={{ width: GANTT_STAGE_DOT_SIZE, height: GANTT_STAGE_DOT_SIZE }} />
            <span className="truncate" title="Материалы / снабжение">Снабжение</span>
          </>
        )}
      </div>

      <div
        className={cn(
          "sticky z-30 flex h-full items-center justify-center border-r border-[#D7DEE8] text-xs font-medium text-[#374151]",
          isStripedMachine ? "bg-slate-50" : "bg-white"
        )}
        style={{ left: GANTT_MACHINE_COL_WIDTH + GANTT_STAGE_COL_WIDTH, width: GANTT_WORKSHOP_COL_WIDTH }}
      >
        {row.type === 'stage' ? getWorkshopLabel(row.stage.workshop) : ''}
      </div>

      <div
        className={cn(
          "relative",
          row.groupEnd ? "border-b-2 border-slate-300" : "border-b border-slate-100"
        )}
        style={{ width: totalWidth }}
      >
        {todayOffset >= 0 && todayOffset < totalWidth && (
          <div
            className="pointer-events-none absolute inset-y-0 z-0 bg-red-100/80"
            style={{ left: todayOffset, width: dayWidth }}
          />
        )}
        {deadlineOffset !== null && deadlineOffset >= 0 && deadlineOffset <= totalWidth && (
          <div
            className="absolute top-0 bottom-0 z-10 border-l-2 border-dashed border-[#DC2626]"
            style={{ left: deadlineOffset }}
            title={deadlineLabel ? `Желаемая отгрузка: ${deadlineLabel}` : undefined}
          />
        )}
        {row.type === 'supply' && plannedGroups.map((group) => {
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
              machineId={row.machine.id}
              machineName={row.machine.name}
              title={label ? `План. поставка материала: ${label}` : undefined}
            />
          )
        })}
        {row.type === 'supply' && actualGroups.map((group) => {
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
              machineId={row.machine.id}
              machineName={row.machine.name}
              title={label ? `Факт. поставка материала: ${label}` : undefined}
            />
          )
        })}
        {row.productionMarkerRow && actualShippingOffset !== null && actualShippingOffset >= 0 && actualShippingOffset <= totalWidth && (
          <div
            className="absolute z-20 h-0 w-0 -translate-x-1/2 border-l-transparent border-r-transparent border-t-[#DC2626] drop-shadow-sm"
            style={{
              left: actualShippingOffset,
              top: shippingMarkerTop,
              borderLeftWidth: GANTT_MARKER_SIZE / 2,
              borderRightWidth: GANTT_MARKER_SIZE / 2,
              borderTopWidth: GANTT_SHIPPING_MARKER_HEIGHT,
            }}
            title={actualShippingLabel ? `Факт. отгрузка с завода: ${actualShippingLabel}` : undefined}
          />
        )}
        {row.type === 'stage' ? (
          <GanttBar
            stage={row.stage}
            rangeStart={rangeStart}
            scale={scale}
            unitWidth={dayWidth}
            machineId={row.machine.id}
            isConfirmed={row.machine.is_confirmed}
          />
        ) : (
          row.items.map((item) => (
            <GanttSupplyMarker
              key={item.id}
              item={item}
              rangeStart={rangeStart}
              scale={scale}
              unitWidth={dayWidth}
            />
          ))
        )}
      </div>

      {row.groupEnd && (
        <div
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-slate-300"
          style={{ width: GANTT_LEFT_WIDTH + totalWidth }}
        />
      )}
    </div>
  )
})

export function GanttChart({ data, filters: externalFilters, onFiltersChange, hideControls = false, height = 'calc(100vh - 300px)' }: GanttChartProps) {
  const [dayWidth, setDayWidth] = useState(40)
  const [rangeStart, setRangeStart] = useState<Date>(() => subDays(findEarliestDate(data), 30))
  const [rangeEnd, setRangeEnd] = useState<Date>(() => addDays(findLatestDate(data), 60))
  const [weldingLoadOpen, setWeldingLoadOpen] = useState(true)
  const [scrollShadows, setScrollShadows] = useState({ left: false, right: false })
  const [internalFilters, setInternalFilters] = useState<GanttFilters>({
    search: '',
    workshop: '',
    confirmation: '',
    productionMonth: '',
    showSupply: false,
    visibleStages: [...STAGE_ORDER],
  })
  const filters = externalFilters || internalFilters
  const setFilters = onFiltersChange || setInternalFilters

  const productionMonthOptions = useMemo<GanttMonthOption[]>(() => {
    const months = new Set<string>()
    for (const machine of data.machines) {
      const normalized = normalizeProductionMonthValue(machine.production_month)
      if (normalized) months.add(normalized)
    }
    return Array.from(months)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: formatProductionMonth(value) }))
  }, [data.machines])

  const scrollRef = useRef<HTMLDivElement>(null)
  const weldingLoadScrollRef = useRef<HTMLDivElement>(null)
  const didInitialScrollRef = useRef(false)
  const rangeExtendLockRef = useRef(false)
  const scrollCheckTimeoutRef = useRef<number | null>(null)
  const scrollSyncLockRef = useRef(false)

  const flatRows = useMemo<FlatGanttRow[]>(() => {
    const selectedWorkshop = filters.workshop ? parseInt(filters.workshop) : null
    const selectedProductionMonth = normalizeProductionMonthValue(filters.productionMonth)
    const visibleStages = new Set(filters.visibleStages)
    const query = filters.search.trim().toLowerCase()
    const result: FlatGanttRow[] = []

    for (const [machineIndex, machine] of data.machines.entries()) {
      if (query && !machine.name.toLowerCase().includes(query)) continue
      if (filters.confirmation === 'confirmed' && !machine.is_confirmed) continue
      if (filters.confirmation === 'unconfirmed' && machine.is_confirmed) continue
      if (selectedProductionMonth && normalizeProductionMonthValue(machine.production_month) !== selectedProductionMonth) continue

      const rows: GanttGroupRow[] = machine.stages
        .filter((stage) => {
          if (!stage.date_start) return false
          if (!visibleStages.has(stage.stage_type)) return false
          if (selectedWorkshop && stage.workshop !== selectedWorkshop) return false
          return true
        })
        .map((stage) => ({
          id: `${machine.id}:${stage.id}`,
          type: 'stage',
          machine,
          stage,
        }))

      const supplyItems = filters.showSupply ? machine.supply_deadlines : []
      const hasMaterialTimeline =
        machine.material_items.length > 0 ||
        Boolean(machine.planned_material_date) ||
        Boolean(machine.actual_material_date)

      if (hasMaterialTimeline || supplyItems.length > 0) {
        rows.push({
          id: `${machine.id}:supply`,
          type: 'supply',
          machine,
          items: supplyItems,
        })
      }

      const lastStageRowIndex = rows.reduce((lastIndex, row, index) => (
        row.type === 'stage' ? index : lastIndex
      ), -1)
      const productionMarkerRowIndex = lastStageRowIndex >= 0 ? lastStageRowIndex : rows.length - 1

      rows.forEach((row, index) => {
        result.push({
          ...row,
          groupStart: index === 0,
          groupEnd: index === rows.length - 1,
          groupRowCount: rows.length,
          machineIndex,
          productionMarkerRow: index === productionMarkerRowIndex,
        })
      })
    }

    return result
  }, [data.machines, filters])

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GANTT_ROW_HEIGHT,
    overscan: 12,
  })

  const scaleItems = useMemo(() => generateDateScale(rangeStart, rangeEnd, scale), [rangeStart, rangeEnd])
  const totalWidth = scaleItems.length * dayWidth
  const weldingLoadSpacerWidth = GANTT_LEFT_WIDTH - GANTT_WORKSHOP_COL_WIDTH
  const rangeLabel = useMemo(
    () => `${format(rangeStart, 'dd.MM.yyyy')} - ${format(rangeEnd, 'dd.MM.yyyy')}`,
    [rangeStart, rangeEnd]
  )

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

  const weldingLoadRows = useMemo<WeldingLoadRow[]>(() => {
    const selectedWorkshop = filters.workshop ? parseInt(filters.workshop) : null
    const selectedProductionMonth = normalizeProductionMonthValue(filters.productionMonth)
    const query = filters.search.trim().toLowerCase()
    const rowsByWorkshop = new Map<string, WeldingLoadRow>()
    const totalRow: WeldingLoadRow = { key: 'total', label: 'Итого', values: new Map(), machines: new Map(), total: 0, isTotal: true }
    const rangeStartKey = dayKey(rangeStart)
    const rangeEndKey = dayKey(rangeEnd)

    for (const machine of data.machines) {
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
  }, [data.machines, filters, rangeStart, rangeEnd])

  const todayOffset = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const offset = differenceInCalendarDays(today, rangeStart)
    return offset < 0 ? -1 : offset * dayWidth
  }, [rangeStart, dayWidth])

  const scrollToToday = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current
    if (!el || todayOffset < 0) return
    el.scrollTo({
      left: Math.max(0, GANTT_LEFT_WIDTH + todayOffset - el.clientWidth / 2),
      behavior,
    })
  }, [todayOffset])

  useEffect(() => {
    if (didInitialScrollRef.current) return
    didInitialScrollRef.current = true
    window.setTimeout(() => scrollToToday('auto'), 50)
  }, [scrollToToday])

  const updateDayWidth = useCallback((nextValue: number) => {
    const el = scrollRef.current
    const oldWidth = dayWidth
    const nextWidth = clampDayWidth(nextValue)
    if (nextWidth === oldWidth) return

    const centerDay = el
      ? Math.max(0, (el.scrollLeft + el.clientWidth / 2 - GANTT_LEFT_WIDTH) / oldWidth)
      : 0

    setDayWidth(nextWidth)

    window.requestAnimationFrame(() => {
      if (el) {
        el.scrollLeft = Math.max(0, GANTT_LEFT_WIDTH + centerDay * nextWidth - el.clientWidth / 2)
      }
    })
  }, [dayWidth])

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

  useEffect(() => {
    if (!weldingLoadOpen) return
    const source = scrollRef.current
    const target = weldingLoadScrollRef.current
    if (!source || !target) return
    target.scrollLeft = source.scrollLeft
  }, [weldingLoadOpen])

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

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      updateDayWidth(dayWidth + (event.deltaY > 0 ? -3 : 3))
    }
  }, [dayWidth, updateDayWidth])

  return (
    <div className="flex h-full flex-col gap-4">
      {!hideControls && (
        <GanttControls
          onToday={() => scrollToToday()}
          dayWidth={dayWidth}
          onDayWidthChange={updateDayWidth}
          onZoomIn={() => updateDayWidth(dayWidth + ZOOM_STEP)}
          onZoomOut={() => updateDayWidth(dayWidth - ZOOM_STEP)}
          filters={filters}
          onFiltersChange={setFilters}
          productionMonthOptions={productionMonthOptions}
        />
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-[#E8ECF0] bg-white px-3 py-2 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-semibold text-[#1B3A6B]">Окно графика: {rangeLabel}</div>
        <div className="text-xs text-[#6B7280]">Горизонтальный скролл синхронизирован с нагрузкой сварки</div>
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          className="relative overflow-auto scroll-smooth rounded-lg border border-[#D7DEE8] bg-white will-change-transform"
          style={{ height, WebkitOverflowScrolling: 'touch' }}
          onWheel={handleWheel}
        >
        <div style={{ width: GANTT_LEFT_WIDTH + totalWidth, minWidth: '100%' }}>
          <div
            className="sticky top-0 z-30 grid border-b border-[#D7DEE8] bg-[#F8F9FA]"
            style={{
              height: GANTT_TIMELINE_HEIGHT,
              gridTemplateColumns: `${GANTT_MACHINE_COL_WIDTH}px ${GANTT_STAGE_COL_WIDTH}px ${GANTT_WORKSHOP_COL_WIDTH}px ${totalWidth}px`,
            }}
          >
            <div className="sticky left-0 z-40 flex items-end border-r border-[#D7DEE8] bg-[#F8F9FA] px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
              Машина
            </div>
            <div
              className="sticky z-40 flex items-end border-r border-[#D7DEE8] bg-[#F8F9FA] px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]"
              style={{ left: GANTT_MACHINE_COL_WIDTH }}
            >
              Этап
            </div>
            <div
              className="sticky z-40 flex items-end justify-center border-r border-[#D7DEE8] bg-[#F8F9FA] pb-2 text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]"
              style={{ left: GANTT_MACHINE_COL_WIDTH + GANTT_STAGE_COL_WIDTH }}
            >
              Ц
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
            style={{ height: rowVirtualizer.getTotalSize(), width: GANTT_LEFT_WIDTH + totalWidth }}
          >
            <div className="absolute inset-y-0 flex pointer-events-none" style={{ left: GANTT_LEFT_WIDTH }}>
              {scaleItems.map((item, index) => (
                <div
                  key={index}
                  className={[
                    "shrink-0 border-r border-[#EEF2F6]",
                    item.isWeekend ? "bg-[#EEF2F6]/70" : "",
                    item.isToday ? "bg-red-100/70" : "",
                  ].join(' ')}
                  style={{ width: dayWidth }}
                />
              ))}
            </div>

            {todayOffset >= 0 && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-0 w-0.5 bg-red-500"
                style={{ left: GANTT_LEFT_WIDTH + todayOffset + dayWidth / 2 }}
              />
            )}

            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = flatRows[virtualRow.index]
              if (!row) return null

              return (
                <GanttVirtualRow
                  key={virtualRow.key}
                  row={row}
                  top={virtualRow.start}
                  totalWidth={totalWidth}
                  rangeStart={rangeStart}
                  dayWidth={dayWidth}
                  todayOffset={todayOffset}
                />
              )
            })}

            {flatRows.length === 0 && (
              <div className="flex items-center justify-center py-16 text-sm text-[#9CA3AF]">
                Нет данных для отображения на Гант-графике
              </div>
            )}
          </div>
        </div>
        </div>
        <div
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-8 rounded-l-lg bg-gradient-to-r from-white to-transparent transition-opacity',
            scrollShadows.left ? 'opacity-100' : 'opacity-0'
          )}
        />
        <div
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-lg bg-gradient-to-l from-white to-transparent transition-opacity',
            scrollShadows.right ? 'opacity-100' : 'opacity-0'
          )}
        />
      </div>

      <section className="rounded-lg border border-[#D7DEE8] bg-white shadow-sm">
        <button
          type="button"
          className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-[#E8ECF0] px-3 py-2 text-left transition-colors hover:bg-[#F8F9FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
          aria-expanded={weldingLoadOpen}
          onClick={() => setWeldingLoadOpen((current) => !current)}
        >
          <span>
            <span className="block text-sm font-semibold text-[#1B3A6B]">Нагрузка сварки по цехам</span>
            <span className="block text-xs text-[#6B7280]">Тоннаж машины делится равномерно на каждый день этапа «Сборка», затем суммируется по цеху.</span>
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-[#6B7280] transition-transform", weldingLoadOpen && "rotate-180")} />
        </button>
        {weldingLoadOpen && <div ref={weldingLoadScrollRef} className="overflow-x-auto" onScroll={handleWeldingLoadScroll}>
          <div className="min-w-full" style={{ width: Math.max(GANTT_LEFT_WIDTH + totalWidth, 900) }}>
            <div className="grid border-b border-[#E8ECF0] bg-[#F8F9FA]" style={{ gridTemplateColumns: `${GANTT_WORKSHOP_COL_WIDTH}px ${totalWidth}px ${weldingLoadSpacerWidth}px` }}>
              <div className="sticky left-0 z-10 border-r border-[#D7DEE8] bg-[#F8F9FA] px-2 py-2 text-center text-xs font-semibold text-[#1B3A6B]">Цех</div>
              <div className="relative h-9">
                {scaleItems.map((item, index) => (
                  <div
                    key={index}
                    className={cn('absolute top-0 flex h-full items-center justify-center border-r border-[#E8ECF0] text-[10px]', item.isWeekend && 'bg-[#EEF2F6]/70 text-[#9CA3AF]', item.isToday && 'bg-red-50 text-red-700')}
                    style={{ left: index * dayWidth, width: dayWidth }}
                  >
                    {format(item.date, 'dd.MM')}
                  </div>
                ))}
              </div>
              <div className="bg-[#F8F9FA]" />
            </div>

            {weldingLoadRows.map((row) => (
              <div
                key={row.key}
                className={cn('grid border-b border-[#E8ECF0] last:border-b-0', row.isTotal ? 'bg-[#F8F9FA]' : 'bg-white')}
                style={{ gridTemplateColumns: `${GANTT_WORKSHOP_COL_WIDTH}px ${totalWidth}px ${weldingLoadSpacerWidth}px` }}
              >
                <div className={cn('sticky left-0 z-10 border-r border-[#D7DEE8] px-2 py-2 text-center text-xs font-semibold', row.isTotal ? 'bg-[#F8F9FA] text-[#1B3A6B]' : 'bg-white text-[#374151]')}>
                  {row.label}
                </div>
                <div className="relative h-9">
                  {scaleItems.map((item, index) => {
                    const value = row.values.get(dayKey(item.date)) || 0
                    return (
                      <div
                        key={`${row.key}-${index}`}
                        className={cn('absolute top-0 flex h-full items-center justify-center border-r border-[#F1F5F9] px-1 text-[10px]', value > 0 ? (row.isTotal ? 'font-semibold text-[#1B3A6B]' : 'text-[#374151]') : 'text-[#CBD5E1]')}
                        style={{ left: index * dayWidth, width: dayWidth }}
                        title={weldingLoadTitle(row, item.date, value)}
                      >
                        {formatTons(value)}
                      </div>
                    )
                  })}
                </div>
                <div className={row.isTotal ? 'bg-[#F8F9FA]' : 'bg-white'} />
              </div>
            ))}

            {weldingLoadRows.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-[#9CA3AF]">
                Нет данных по сварке в текущем диапазоне
              </div>
            )}
          </div>
        </div>}
      </section>

      <GanttLegend defaultOpen={false} />
    </div>
  )
}
