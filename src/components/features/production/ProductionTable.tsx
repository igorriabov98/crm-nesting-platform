"use client"

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowUpDown, Eraser, Loader2, PanelRightOpen, Plus, RotateCcw, Rows3, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Checkbox } from '@/components/ui/checkbox'
import { InlineEdit } from '@/components/features/shared/InlineEdit'
import { StickyTable } from '@/components/features/shared/StickyTable'
import { ProductionSummary } from './ProductionSummary'
import { ProductionFilters, type ProductionFilterValues } from './ProductionFilters'
import { STAGES, STAGE_ORDER, stageHasWorkshop, stageSupportsIntervals } from '@/lib/constants/stages'
import { useRole } from '@/lib/hooks/useRole'
import { clearProductionStageDates, mutateProductionStageInterval, updateMachineDate, updateProductionStage } from '@/lib/actions/production'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'
import { getDesiredShippingInfo } from '@/lib/utils/desired-shipping'
import { formatNightShiftDates, normalizeNightShiftDates, primaryNightShiftDate } from '@/lib/utils/night-shift-dates'
import type { ProductionRow, StageStatus } from '@/app/(protected)/production/actions'
import type { StageType } from '@/lib/types'
import type { ProductionStageIntervalValue } from '@/lib/production-stage-intervals'

interface ProductionTableProps {
  data: ProductionRow[]
  filters?: ProductionFilterValues
  onFiltersChange?: (filters: ProductionFilterValues) => void
  hideFilters?: boolean
  hideSummary?: boolean
  visibleStageTypes?: StageType[]
  selectedMachineId?: string | null
  onSelectMachine?: (machineId: string) => void
  onMachineDateUpdate?: (machineId: string, field: 'planned_material_date', value: string | null) => Promise<unknown>
  onStageDateUpdate?: (row: ProductionRow, stage: ProductionStage, field: 'date_start' | 'date_end' | 'night_shift_date', value: string | null) => Promise<unknown>
  onStageUpdate?: (stageId: string, field: string, value: string | number | boolean | string[] | null) => Promise<unknown>
  onClearStageDates?: (stage: ProductionStage) => Promise<unknown>
  onIntervalMutation?: (
    row: ProductionRow,
    stage: ProductionStage,
    mutation: {
      operation: 'create' | 'update' | 'delete'
      intervalId: string
      dateStart: string | null
      dateEnd: string | null
      workshop: number | null
    },
  ) => Promise<unknown>
}

type ProductionStage = ProductionRow['stages'][number]
type SortDirection = 'asc' | 'desc'
type SortConfig = { key: string; direction: SortDirection }
type TableDensity = 'compact' | 'normal' | 'comfortable'

const workshopOptions = [
  { value: '1', label: 'Цех 1' },
  { value: '2', label: 'Цех 2' },
]

const statusBgClass: Record<StageStatus, string> = {
  not_planned: 'bg-white',
  active: 'bg-sky-50',
  completed: 'bg-emerald-50',
  overdue: 'bg-rose-50',
  skipped: 'bg-slate-50',
}

type TableMetrics = {
  sticky: [number, number, number, number]
  materialFact: number
  workshop: number
  date: number
  night: number
  shipping: number
  groupHeaderHeight: number
  approachHeight: number
  addApproachHeight: number
  controlClass: string
  bodyTextClass: string
  cellPaddingClass: string
}

const TABLE_METRICS: Record<TableDensity, TableMetrics> = {
  compact: {
    sticky: [148, 58, 88, 94],
    materialFact: 88,
    workshop: 48,
    date: 116,
    night: 82,
    shipping: 112,
    groupHeaderHeight: 34,
    approachHeight: 32,
    addApproachHeight: 30,
    controlClass: 'h-7 text-[11px]',
    bodyTextClass: 'text-[11px]',
    cellPaddingClass: 'px-1 py-1',
  },
  normal: {
    sticky: [176, 68, 104, 112],
    materialFact: 104,
    workshop: 56,
    date: 140,
    night: 92,
    shipping: 132,
    groupHeaderHeight: 40,
    approachHeight: 38,
    addApproachHeight: 36,
    controlClass: 'h-8 text-xs',
    bodyTextClass: 'text-xs',
    cellPaddingClass: 'px-1.5 py-1.5',
  },
  comfortable: {
    sticky: [208, 82, 120, 128],
    materialFact: 120,
    workshop: 64,
    date: 164,
    night: 108,
    shipping: 152,
    groupHeaderHeight: 46,
    approachHeight: 46,
    addApproachHeight: 42,
    controlClass: 'h-10 text-sm',
    bodyTextClass: 'text-sm',
    cellPaddingClass: 'px-2 py-2',
  },
}

const getStageColumnWidths = (stageType: string, metrics: TableMetrics) => {
  if (stageType === 'shipping' || stageType === 'actual_shipping') return [metrics.shipping]
  if (stageType === 'painting') {
    return stageHasWorkshop(stageType)
      ? [metrics.workshop, metrics.date, metrics.date, metrics.night]
      : [metrics.date, metrics.date, metrics.night]
  }
  if (!stageHasWorkshop(stageType)) return [metrics.date, metrics.date]
  return [metrics.workshop, metrics.date, metrics.date]
}

const stageColumnWidth = (stageType: string, metrics: TableMetrics) => (
  getStageColumnWidths(stageType, metrics).reduce((sum, width) => sum + width, 0)
)

const machineDateSortLabels = new Set([
  'desired_shipping_date',
  'planned_material_date',
  'actual_material_date',
])

function todayDateOnly() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isCompletedMachine(row: ProductionRow) {
  const actualShipping = row.stages.find((stage) => stage.stage_type === 'actual_shipping')
  return Boolean(actualShipping?.date_end && actualShipping.date_end <= todayDateOnly())
}

function SortableHeader({
  sortKey,
  children,
  className,
  sortConfig,
  onSort,
}: {
  sortKey: string
  children: React.ReactNode
  className?: string
  sortConfig: SortConfig | null
  onSort: (key: string) => void
}) {
  const sortState = sortConfig?.key === sortKey
    ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending')
    : 'none'
  const label = typeof children === 'string' ? children : 'дате'

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={`Сортировать: ${label}`}
      aria-pressed={sortState !== 'none'}
      className={cn(
        'inline-flex min-h-8 w-full items-center justify-center gap-1 whitespace-nowrap rounded-md px-1 py-0.5 text-slate-600 transition-colors hover:bg-slate-200/70 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600',
        sortConfig?.key === sortKey && 'bg-white text-blue-950 shadow-sm'
      )}
      title="Сортировать по дате"
    >
      <span className={className}>{children}</span>
      <ArrowUpDown className={cn('h-3 w-3 shrink-0', sortState === 'none' && 'opacity-45')} />
    </button>
  )
}

export function ProductionTable({
  data,
  filters: externalFilters,
  onFiltersChange,
  hideFilters = false,
  hideSummary = false,
  visibleStageTypes,
  selectedMachineId,
  onSelectMachine,
  onMachineDateUpdate,
  onStageDateUpdate,
  onStageUpdate,
  onClearStageDates,
  onIntervalMutation,
}: ProductionTableProps) {
  const tableScrollRef = useRef<HTMLDivElement>(null)
  const { canManageProduction } = useRole()
  const canEdit = canManageProduction
  const [localData, setLocalData] = useState(data)
  const [internalFilters, setInternalFilters] = useState<ProductionFilterValues>({
    search: '',
    workshop: '',
    stageType: '',
    status: '',
    confirmation: '',
    dateFrom: undefined,
    dateTo: undefined,
  })
  const filters = externalFilters || internalFilters
  const setFilters = onFiltersChange || setInternalFilters
  const [tableDensity, setTableDensity] = useState<TableDensity>('normal')
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null)
  const [clearingStageId, setClearingStageId] = useState<string | null>(null)
  const tableMetrics = TABLE_METRICS[tableDensity]
  const stickyColumnWidths = tableMetrics.sticky

  useEffect(() => {
    setLocalData(data)
  }, [data])

  useEffect(() => {
    const stored = window.localStorage.getItem('production-table-density')
    if (stored === 'compact' || stored === 'normal' || stored === 'comfortable') {
      setTableDensity(stored)
    }
  }, [])

  const changeTableDensity = (density: TableDensity) => {
    setTableDensity(density)
    window.localStorage.setItem('production-table-density', density)
  }

  const patchLocalStage = (stageId: string, patch: Partial<ProductionStage>) => {
    setLocalData((current) => current.map((row) => {
      if (!row.stages.some((stage) => stage.id === stageId)) return row
      return {
        ...row,
        stages: row.stages.map((stage) => (
          stage.id === stageId ? { ...stage, ...patch } : stage
        )),
      }
    }))
  }

  const patchLocalMachine = (machineId: string, patch: Partial<ProductionRow['machine']>) => {
    setLocalData((current) => current.map((row) => (
      row.machine.id === machineId
        ? { ...row, machine: { ...row.machine, ...patch } }
        : row
    )))
  }

  const patchLocalIntervals = (stageId: string, intervals: ProductionStageIntervalValue[]) => {
    const sorted = [...intervals].sort((a, b) => a.position - b.position)
    const dated = sorted.filter((interval) => interval.date_start || interval.date_end)
    const workshops = new Set(dated.map((interval) => interval.workshop).filter((value): value is number => value !== null))
    patchLocalStage(stageId, {
      intervals: sorted,
      date_start: dated.map((interval) => interval.date_start).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
      date_end: dated.map((interval) => interval.date_end).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
      workshop: workshops.size === 1 && dated.every((interval) => interval.workshop !== null) ? [...workshops][0] : null,
    })
  }

  const displayStageTypes = useMemo(() => {
    if (!visibleStageTypes) return STAGE_ORDER
    const visible = new Set(visibleStageTypes)
    return STAGE_ORDER.filter((stageType) => visible.has(stageType))
  }, [visibleStageTypes])
  const tableColumnSpan = useMemo(
    () => 5 + displayStageTypes.reduce((sum, stageType) => sum + getStageColumnWidths(stageType, tableMetrics).length, 0),
    [displayStageTypes, tableMetrics]
  )

  const toggleSort = (key: string) => {
    setSortConfig((current) => {
      if (current?.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      return { key, direction: 'asc' }
    })
  }

  const getSortDate = (row: ProductionRow, key: string) => {
    if (machineDateSortLabels.has(key)) {
      const value = row.machine[key as 'desired_shipping_date' | 'planned_material_date' | 'actual_material_date']
      return typeof value === 'string' && value ? new Date(`${value}T00:00:00`).getTime() : null
    }

    const [prefix, stageType, field] = key.split(':')
    if (prefix !== 'stage') return null
    const stage = row.stages.find((item) => item.stage_type === stageType)
    if (!stage) return null
    const value = field === 'night_shift_date'
      ? primaryNightShiftDate(stage.night_shift_dates, stage.night_shift_date)
      : stage[field as 'date_start' | 'date_end']
    return value ? new Date(`${value}T00:00:00`).getTime() : null
  }

  const filtered = useMemo(() => {
    return localData.filter((row) => {
      if (filters.search) {
        const q = filters.search.toLowerCase()
        if (!row.machine.name.toLowerCase().includes(q)) return false
      }

      if (filters.workshop) {
        const ws = parseInt(filters.workshop)
        const hasWs = row.stages.some((stage) => (
          stage.stage_type === 'assembly'
          && !stage.is_skipped
          && (stage.workshop === ws || stage.intervals.some((interval) => interval.workshop === ws))
        ))
        if (!hasWs) return false
      }

      if (filters.stageType) {
        const hasStage = row.stages.some((stage) => stage.stage_type === filters.stageType)
        if (!hasStage) return false
      }

      if (visibleStageTypes && visibleStageTypes.length < STAGE_ORDER.length) {
        const visibleSet = new Set(visibleStageTypes)
        const hasVisibleStage = row.stages.some((stage) => visibleSet.has(stage.stage_type))
        if (!hasVisibleStage) return false
      }

      if (filters.status) {
        if (filters.status === 'completed') return isCompletedMachine(row)
        const hasStatus = row.stages.some((stage) => stage.status === filters.status)
        if (!hasStatus) return false
      }

      if (filters.confirmation === 'confirmed' && !row.machine.is_confirmed) return false
      if (filters.confirmation === 'unconfirmed' && row.machine.is_confirmed) return false

      if (filters.dateFrom || filters.dateTo) {
        const from = filters.dateFrom ? filters.dateFrom.getTime() : 0
        const to = filters.dateTo ? filters.dateTo.getTime() : Infinity
        const inRange = row.stages.some((stage) => {
          const start = stage.date_start ? new Date(`${stage.date_start}T00:00:00`).getTime() : null
          const end = stage.date_end ? new Date(`${stage.date_end}T00:00:00`).getTime() : null
          return Boolean((start && start >= from && start <= to) || (end && end >= from && end <= to))
        })
        if (!inRange) return false
      }

      return true
    })
  }, [localData, filters, visibleStageTypes])

  const sortedRows = useMemo(() => {
    if (!sortConfig) return filtered
    return [...filtered].sort((a, b) => {
      const aDate = getSortDate(a, sortConfig.key)
      const bDate = getSortDate(b, sortConfig.key)
      if (aDate === null && bDate === null) return a.machine.name.localeCompare(b.machine.name, 'ru')
      if (aDate === null) return 1
      if (bDate === null) return -1
      return sortConfig.direction === 'asc' ? aDate - bDate : bDate - aDate
    })
  }, [filtered, sortConfig])

  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: (index) => {
      const row = sortedRows[index]
      const maxApproaches = row
        ? Math.max(1, ...row.stages
            .filter((stage) => stageSupportsIntervals(stage.stage_type))
            .map((stage) => Math.max(1, stage.intervals.length)))
        : 1
      return Math.max(
        tableMetrics.approachHeight,
        maxApproaches * tableMetrics.approachHeight + tableMetrics.addApproachHeight,
      )
    },
    overscan: 8,
  })

  useEffect(() => {
    rowVirtualizer.measure()
  }, [rowVirtualizer, tableDensity, localData])
  const virtualRows = rowVirtualizer.getVirtualItems()
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0
  const paddingBottom = virtualRows.length > 0
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0

  const handleUpdate = async (stageId: string, field: string, value: string | number | boolean | null) => {
    const currentStage = localData.flatMap((row) => row.stages).find((stage) => stage.id === stageId)
    const rollbackPatch = currentStage && field in currentStage
      ? ({ [field]: currentStage[field as keyof ProductionStage] } as Partial<ProductionStage>)
      : null

    patchLocalStage(stageId, { [field]: value } as Partial<ProductionStage>)
    const res = onStageUpdate
      ? await onStageUpdate(stageId, field, value) as { success?: boolean; error?: string | null }
      : await updateProductionStage(stageId, { [field]: value }, { revalidate: false })
    if (!res.success) {
      if (rollbackPatch) patchLocalStage(stageId, rollbackPatch)
      toast.error(res.error || 'Ошибка сохранения')
    }
    return res
  }

  const handleStageDateUpdate = async (
    row: ProductionRow,
    stage: ProductionStage,
    field: 'date_start' | 'date_end' | 'night_shift_date',
    value: string | null
  ) => {
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

    if (onStageDateUpdate) return onStageDateUpdate(row, stage, field, value)
    return handleUpdate(stage.id, field, value)
  }

  const handleMachineDateUpdate = async (
    machineId: string,
    field: 'planned_material_date' | 'actual_shipping_date',
    value: string | null
  ) => {
    const currentMachine = localData.find((row) => row.machine.id === machineId)?.machine
    const rollbackPatch = currentMachine ? { [field]: currentMachine[field] } : null

    patchLocalMachine(machineId, { [field]: value })
    const res = field === 'planned_material_date' && onMachineDateUpdate
      ? await onMachineDateUpdate(machineId, field, value) as { success?: boolean; error?: string | null }
      : await updateMachineDate(machineId, field, value, { revalidate: false })
    if (!res.success) {
      if (rollbackPatch) patchLocalMachine(machineId, rollbackPatch)
      toast.error(res.error || 'Ошибка сохранения')
    }
    return res
  }

  const handleClearStageDates = async (stage: ProductionStage) => {
    patchLocalStage(stage.id, { date_start: null, date_end: null })
    setClearingStageId(stage.id)
    try {
      const res = onClearStageDates
        ? await onClearStageDates(stage) as { success?: boolean; error?: string | null }
        : await clearProductionStageDates(stage.id, { revalidate: false })
      if (!res.success) {
        patchLocalStage(stage.id, { date_start: stage.date_start, date_end: stage.date_end })
        toast.error(res.error || 'Ошибка очистки дат')
        return res
      }

      toast.success('Даты этапа очищены')
      return res
    } finally {
      setClearingStageId(null)
    }
  }

  const handleIntervalMutation = async (
    row: ProductionRow,
    stage: ProductionStage,
    mutation: {
      operation: 'create' | 'update' | 'delete'
      intervalId: string
      dateStart: string | null
      dateEnd: string | null
      workshop: number | null
    },
  ) => {
    const previous = stage.intervals
    let next = previous
    if (mutation.operation === 'create') {
      next = [...previous, {
        id: mutation.intervalId,
        production_stage_id: stage.id,
        position: previous.length + 1,
        date_start: mutation.dateStart,
        date_end: mutation.dateEnd,
        workshop: mutation.workshop,
      }]
    } else if (mutation.operation === 'update') {
      next = previous.map((interval) => interval.id === mutation.intervalId ? {
        ...interval,
        date_start: mutation.dateStart,
        date_end: mutation.dateEnd,
        workshop: mutation.workshop,
      } : interval)
    } else {
      next = previous
        .filter((interval) => interval.id !== mutation.intervalId)
        .map((interval, index) => ({ ...interval, position: index + 1 }))
    }
    patchLocalIntervals(stage.id, next)

    const result = onIntervalMutation
      ? await onIntervalMutation(row, stage, mutation) as { success?: boolean; error?: string | null }
      : await mutateProductionStageInterval(stage.id, {
          operation: mutation.operation,
          intervalId: mutation.intervalId,
          dateStart: mutation.dateStart,
          dateEnd: mutation.dateEnd,
          workshop: mutation.workshop,
        }, { revalidate: false })
    if (result && result.success === false) {
      patchLocalIntervals(stage.id, previous)
      toast.error(result.error || 'Не удалось сохранить подход')
    }
    return result
  }

  const isHighlighted = (stageType: string) => Boolean(
    (filters.stageType && filters.stageType === stageType) ||
    (visibleStageTypes && visibleStageTypes.length < STAGE_ORDER.length && visibleStageTypes.includes(stageType as StageType))
  )

  const renderMachineDeadline = (date: string | null) => {
    const deadline = getDesiredShippingInfo(date)
    if (!deadline) return <span className="text-[#9CA3AF]">—</span>
    return (
      <span
        className={cn(
          'font-medium',
          deadline.tone === 'overdue' && 'text-[#DC2626]',
          deadline.tone === 'soon' && 'text-[#D97706]',
          deadline.tone === 'normal' && 'text-[#374151]'
        )}
        title={deadline.label}
      >
        {deadline.shortDate}{deadline.tone === 'overdue' ? ' !' : ''}
      </span>
    )
  }

  const renderDateEdit = (
    value: string | null,
    editable: boolean,
    onSave: (value: string | null) => Promise<unknown> = async () => ({ success: true })
  ) => (
    <InlineEdit
      type="date"
      value={value}
      editable={editable}
      onSave={onSave}
      className="min-w-0 flex-1"
      controlClassName={cn('w-full border-slate-200 bg-white text-slate-900 shadow-none', tableMetrics.controlClass)}
      dateDisplayFormat="dd.MM"
      placeholder={editable ? 'дд.мм' : '—'}
      fallbackText="—"
      compact={tableDensity === 'compact'}
    />
  )

  const renderClearStageDatesButton = (
    stage: ProductionStage,
    disabled = false,
    label = 'Очистить начало и конец этапа',
  ) => {
    const isClearing = clearingStageId === stage.id
    const hasDates = Boolean(stage.date_start || stage.date_end)
    const isDisabled = !canEdit || disabled || isClearing || !hasDates

    return (
      <button
        type="button"
        disabled={isDisabled}
        title={label}
        aria-label={label}
        onClick={() => handleClearStageDates(stage)}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600',
          tableDensity === 'compact' ? 'h-7 w-7' : tableDensity === 'comfortable' ? 'h-10 w-10' : 'h-8 w-8',
          isDisabled && 'cursor-not-allowed opacity-35 hover:border-slate-200 hover:bg-white hover:text-slate-400'
        )}
      >
        {isClearing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eraser className="h-3 w-3" />}
      </button>
    )
  }

  const columnStyle = (width: number): React.CSSProperties => ({ width, minWidth: width })
  const headerCellClass = cn(
    'border-slate-200 bg-slate-100 font-semibold text-slate-700',
    tableMetrics.cellPaddingClass,
  )
  const subHeaderCellClass = 'border-slate-200 bg-slate-50 px-1 text-center font-medium text-slate-600'
  const bodyCellClass = cn('border-slate-200 text-slate-700', tableMetrics.cellPaddingClass, tableMetrics.bodyTextClass)
  const actionButtonSizeClass = tableDensity === 'compact'
    ? 'h-7 w-7'
    : tableDensity === 'comfortable'
      ? 'h-10 w-10'
      : 'h-8 w-8'

  return (
    <div className="space-y-4">
      {!hideSummary && <ProductionSummary data={filtered} />}
      {!hideFilters && <ProductionFilters filters={filters} onChange={setFilters} />}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-950">План по этапам</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Начало и конец вводятся прямо в строке. Нажатие на поле даты не открывает инспектор.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1 shadow-sm"
              role="group"
              aria-label="Масштаб всей таблицы"
            >
              <span className="inline-flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <Rows3 className="h-3.5 w-3.5" /> Масштаб
              </span>
              {[
                { value: 'compact' as const, label: 'Мелко' },
                { value: 'normal' as const, label: 'Нормально' },
                { value: 'comfortable' as const, label: 'Крупно' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={tableDensity === item.value}
                  className={cn(
                    'min-h-8 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600',
                    tableDensity === item.value
                      ? 'bg-blue-950 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                  )}
                  onClick={() => changeTableDensity(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {sortConfig && (
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 shadow-sm hover:border-slate-300 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                onClick={() => setSortConfig(null)}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Сбросить сортировку
              </button>
            )}
          </div>
        </div>

        <StickyTable
          stickyColumns={4}
          stickyColumnWidths={stickyColumnWidths}
          headerRowHeight={tableMetrics.groupHeaderHeight}
          className="max-h-[75vh] rounded-none border-0"
          scrollRef={tableScrollRef}
        >
          <colgroup>
            {stickyColumnWidths.map((width, index) => <col key={`sticky-${index}`} style={{ width }} />)}
            <col style={{ width: tableMetrics.materialFact }} />
            {displayStageTypes.flatMap((stageType) =>
              getStageColumnWidths(stageType, tableMetrics).map((width, index) => (
                <col key={`${stageType}-${index}`} style={{ width }} />
              ))
            )}
          </colgroup>
          <thead className="text-xs uppercase tracking-wide">
            <tr style={{ height: tableMetrics.groupHeaderHeight }}>
              <th className={cn(headerCellClass, 'whitespace-nowrap text-left')} rowSpan={2}>Машина</th>
              <th className={cn(headerCellClass, 'whitespace-nowrap text-center')} rowSpan={2}>Вес, т</th>
              <th className={cn(headerCellClass, 'whitespace-nowrap text-center')} rowSpan={2}>
                <SortableHeader sortKey="desired_shipping_date" sortConfig={sortConfig} onSort={toggleSort}>Дедлайн</SortableHeader>
              </th>
              <th className={cn(headerCellClass, 'whitespace-nowrap text-center')} rowSpan={2}>
                <SortableHeader sortKey="planned_material_date" sortConfig={sortConfig} onSort={toggleSort}>Мат.план</SortableHeader>
              </th>
              <th className={cn(headerCellClass, 'whitespace-nowrap border-l text-center')} rowSpan={2} style={columnStyle(tableMetrics.materialFact)}>
                <SortableHeader sortKey="actual_material_date" sortConfig={sortConfig} onSort={toggleSort}>Мат.факт</SortableHeader>
              </th>
              {displayStageTypes.map((stageType) => {
                const meta = STAGES[stageType]
                const cols = stageType === 'shipping' || stageType === 'actual_shipping'
                  ? 1
                  : stageType === 'painting'
                    ? (stageHasWorkshop(stageType) ? 4 : 3)
                    : stageHasWorkshop(stageType)
                      ? 3
                      : 2
                return (
                  <th
                    key={stageType}
                    colSpan={cols}
                    className={cn(
                      'whitespace-nowrap border-l border-slate-200 bg-slate-100 px-3 text-center font-semibold text-slate-800',
                      isHighlighted(stageType) && 'bg-blue-50 text-blue-950'
                    )}
                    style={{
                      ...columnStyle(stageColumnWidth(stageType, tableMetrics)),
                      borderTop: `3px solid ${meta.color}`,
                    }}
                  >
                    <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden="true" />
                      {meta.label}
                    </div>
                  </th>
                )
              })}
            </tr>
            <tr>
              {displayStageTypes.map((stageType) => {
                const hl = isHighlighted(stageType) ? 'bg-blue-50 text-blue-950' : 'bg-slate-50'
                if (stageType === 'shipping' || stageType === 'actual_shipping') {
                  return (
                    <th key={`${stageType}_date`} className={cn(subHeaderCellClass, 'whitespace-nowrap border-l', hl)}>
                      <SortableHeader sortKey={`stage:${stageType}:date_end`} sortConfig={sortConfig} onSort={toggleSort}>Дата</SortableHeader>
                    </th>
                  )
                }

                return [
                  ...(stageHasWorkshop(stageType)
                    ? [<th key={`${stageType}_w`} className={cn(subHeaderCellClass, 'whitespace-nowrap border-l', hl)}>Цех</th>]
                    : []),
                  <th key={`${stageType}_s`} className={cn(subHeaderCellClass, 'whitespace-nowrap', !stageHasWorkshop(stageType) && 'border-l', hl)}>
                    <SortableHeader sortKey={`stage:${stageType}:date_start`} sortConfig={sortConfig} onSort={toggleSort}>Начало</SortableHeader>
                  </th>,
                  <th key={`${stageType}_e`} className={cn(subHeaderCellClass, 'whitespace-nowrap', hl)}>
                    <SortableHeader sortKey={`stage:${stageType}:date_end`} sortConfig={sortConfig} onSort={toggleSort}>Конец</SortableHeader>
                  </th>,
                  ...(stageType === 'painting'
                    ? [<th key={`${stageType}_n`} className={cn(subHeaderCellClass, 'whitespace-nowrap', hl)}>
                        <SortableHeader sortKey={`stage:${stageType}:night_shift_date`} sortConfig={sortConfig} onSort={toggleSort}>Ночь</SortableHeader>
                      </th>]
                    : []),
                ]
              })}
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr><td colSpan={tableColumnSpan} style={{ height: paddingTop }} /></tr>
            )}
            {virtualRows.map((virtualRow) => {
              const row = sortedRows[virtualRow.index]
              const idx = virtualRow.index
              return (
                <tr
                  key={row.machine.id}
                  data-index={idx}
                  ref={rowVirtualizer.measureElement}
                  className={cn(
                    'border-b border-slate-200 bg-white transition-colors hover:bg-slate-50',
                    selectedMachineId === row.machine.id && 'outline outline-2 outline-inset outline-blue-600',
                    !row.machine.is_confirmed && 'text-slate-500'
                  )}
                  onClick={(event) => {
                    const target = event.target as HTMLElement
                    if (target.closest('button, a, input, select, textarea, [role="combobox"], [data-prevent-row-select]')) return
                    onSelectMachine?.(row.machine.id)
                  }}
                >
                  <td
                    className={cn(bodyCellClass, 'bg-white', !row.machine.is_confirmed && 'bg-amber-50')}
                    style={columnStyle(tableMetrics.sticky[0])}
                  >
                    <div className="flex items-start gap-1.5">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`${ROUTES.SALES_PLAN}/${row.machine.id}`}
                          className={cn(
                            'block truncate font-semibold text-blue-700 hover:text-blue-900 hover:underline',
                            tableDensity === 'comfortable' ? 'text-base' : tableDensity === 'compact' ? 'text-xs' : 'text-sm',
                          )}
                          title={row.machine.name}
                        >
                          {idx + 1}. {row.machine.name}
                        </Link>
                        {!row.machine.is_confirmed && (
                          <span className="mt-1 inline-flex rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            Не подтв.
                          </span>
                        )}
                      </div>
                      {onSelectMachine && (
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                          aria-label={`Открыть настройки машины ${row.machine.name}`}
                          title="Открыть настройки машины"
                          onClick={() => onSelectMachine(row.machine.id)}
                        >
                          <PanelRightOpen className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className={cn(bodyCellClass, 'bg-white text-center tabular-nums', !row.machine.is_confirmed && 'bg-amber-50')} style={columnStyle(tableMetrics.sticky[1])}>
                    {Number(row.machine.total_weight || 0).toFixed(2)}
                  </td>
                  <td className={cn(bodyCellClass, 'bg-white text-center tabular-nums', !row.machine.is_confirmed && 'bg-amber-50')} style={columnStyle(tableMetrics.sticky[2])}>
                    {renderMachineDeadline(row.machine.desired_shipping_date)}
                  </td>
                  <td className={cn(bodyCellClass, 'bg-white text-center', !row.machine.is_confirmed && 'bg-amber-50')} style={columnStyle(tableMetrics.sticky[3])}>
                    {renderDateEdit(row.machine.planned_material_date, canEdit, (value) => handleMachineDateUpdate(row.machine.id, 'planned_material_date', value))}
                  </td>
                  <td className={cn(bodyCellClass, 'border-l bg-white text-center', !row.machine.is_confirmed && 'bg-amber-50')} style={columnStyle(tableMetrics.materialFact)}>
                    {renderDateEdit(row.machine.actual_material_date, false)}
                  </td>

                  {displayStageTypes.map((stageType) => {
                    const stage = row.stages.find((item) => item.stage_type === stageType)
                    if (!stage) {
                      const cols = stageType === 'shipping' || stageType === 'actual_shipping'
                        ? 1
                        : stageType === 'painting'
                          ? (stageHasWorkshop(stageType) ? 4 : 3)
                          : stageHasWorkshop(stageType)
                            ? 3
                            : 2
                      return <td key={stageType} colSpan={cols} className={cn(bodyCellClass, 'border-l bg-slate-50 text-center text-slate-400')}>—</td>
                    }

                    const bgClass = statusBgClass[stage.status]
                    const isSkipped = stage.is_skipped
                    const meta = STAGES[stageType]
                    const fixedWs = meta.fixedWorkshop
                    const hl = isHighlighted(stageType) ? 'ring-1 ring-inset ring-blue-400/50' : ''

                    if (stageType === 'shipping' || stageType === 'actual_shipping') {
                      return (
                        <td key={stageType} className={cn(bodyCellClass, 'border-l text-center', bgClass, hl)} style={columnStyle(tableMetrics.shipping)}>
                          {isSkipped ? (
                            <span className="text-slate-400 line-through">—</span>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              {renderDateEdit(stage.date_end, canEdit && !isSkipped, (value) => handleStageDateUpdate(row, stage, 'date_end', value))}
                              {renderClearStageDatesButton(stage, isSkipped, 'Очистить дату этапа')}
                            </div>
                          )}
                        </td>
                      )
                    }

                    if (stageSupportsIntervals(stageType)) {
                      const storedIntervals = stage.intervals
                      const draftInterval: ProductionStageIntervalValue = {
                        id: `draft:${stage.id}`,
                        production_stage_id: stage.id,
                        position: 1,
                        date_start: stage.date_start,
                        date_end: stage.date_end,
                        workshop: stageType === 'assembly' ? (stage.workshop ?? 1) : stage.workshop,
                      }
                      const intervals = storedIntervals.length > 0 ? storedIntervals : [draftInterval]
                      const saveIntervalPatch = (
                        interval: ProductionStageIntervalValue,
                        patch: Partial<Pick<ProductionStageIntervalValue, 'date_start' | 'date_end' | 'workshop'>>,
                      ) => handleIntervalMutation(row, stage, {
                        operation: interval.id.startsWith('draft:') ? 'create' : 'update',
                        intervalId: interval.id.startsWith('draft:') ? crypto.randomUUID() : interval.id,
                        dateStart: patch.date_start === undefined ? interval.date_start : patch.date_start,
                        dateEnd: patch.date_end === undefined ? interval.date_end : patch.date_end,
                        workshop: patch.workshop === undefined ? interval.workshop : patch.workshop,
                      })
                      const rowClass = 'flex items-center justify-center gap-1 border-b border-slate-200/80 px-1 last:border-b-0'
                      const intervalCells: React.ReactNode[] = []

                      if (stageType === 'assembly') {
                        intervalCells.push(
                          <td key={`${stageType}_w`} className={cn(bodyCellClass, 'border-l p-0 align-top', bgClass, hl)} style={columnStyle(tableMetrics.workshop)}>
                            <div className="grid">
                              {intervals.map((interval) => (
                                <div key={interval.id} className={rowClass} style={{ minHeight: tableMetrics.approachHeight }}>
                                  <InlineEdit
                                    type="select"
                                    value={interval.workshop?.toString() || null}
                                    options={workshopOptions}
                                    editable={canEdit && !isSkipped}
                                    onSave={(value) => saveIntervalPatch(interval, { workshop: value ? parseInt(value) : null })}
                                    className="w-full min-w-0"
                                    controlClassName={cn('w-full border-slate-200 bg-white px-1 text-slate-900 shadow-none', tableMetrics.controlClass)}
                                    placeholder="Цех"
                                    compact={tableDensity === 'compact'}
                                  />
                                </div>
                              ))}
                              <div style={{ height: tableMetrics.addApproachHeight }} aria-hidden="true" />
                            </div>
                          </td>,
                        )
                      }

                      intervalCells.push(
                        <td key={`${stageType}_s`} className={cn(bodyCellClass, 'p-0 align-top', bgClass, hl, stageType !== 'assembly' && 'border-l')} style={columnStyle(tableMetrics.date)}>
                          <div className="grid">
                            {intervals.map((interval) => (
                              <div key={interval.id} className={rowClass} style={{ minHeight: tableMetrics.approachHeight }}>
                                <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-600" title={`Подход ${interval.position}`}>{interval.position}</span>
                                {renderDateEdit(interval.date_start, canEdit && !isSkipped, (value) => saveIntervalPatch(interval, { date_start: value }))}
                                {!interval.id.startsWith('draft:') && (
                                  <button
                                    type="button"
                                    disabled={!canEdit || isSkipped}
                                    title={`Удалить подход ${interval.position}`}
                                    aria-label={`Удалить подход ${interval.position}`}
                                    className={cn(
                                      'inline-flex shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 disabled:opacity-35',
                                      actionButtonSizeClass,
                                    )}
                                    onClick={() => handleIntervalMutation(row, stage, {
                                      operation: 'delete',
                                      intervalId: interval.id,
                                      dateStart: interval.date_start,
                                      dateEnd: interval.date_end,
                                      workshop: interval.workshop,
                                    })}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                            <button
                              type="button"
                              disabled={!canEdit || isSkipped || storedIntervals.length === 0}
                              className="flex items-center justify-center gap-1 rounded-none text-[10px] font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:text-slate-400 disabled:opacity-70"
                              style={{ minHeight: tableMetrics.addApproachHeight }}
                              onClick={() => handleIntervalMutation(row, stage, {
                                operation: 'create',
                                intervalId: crypto.randomUUID(),
                                dateStart: null,
                                dateEnd: null,
                                workshop: stageType === 'assembly' ? (stage.workshop ?? 1) : null,
                              })}
                            >
                              <Plus className="h-3 w-3" /> {storedIntervals.length === 0 ? 'Заполните подход 1' : 'Ещё подход'}
                            </button>
                          </div>
                        </td>,
                        <td key={`${stageType}_e`} className={cn(bodyCellClass, 'p-0 align-top', bgClass, hl)} style={columnStyle(tableMetrics.date)}>
                          <div className="grid">
                            {intervals.map((interval) => (
                              <div key={interval.id} className={rowClass} style={{ minHeight: tableMetrics.approachHeight }}>
                                {renderDateEdit(interval.date_end, canEdit && !isSkipped, (value) => saveIntervalPatch(interval, { date_end: value }))}
                                {!interval.id.startsWith('draft:') && (
                                  <button
                                    type="button"
                                    disabled={!canEdit || isSkipped || (!interval.date_start && !interval.date_end)}
                                    title={`Очистить начало и конец подхода ${interval.position}`}
                                    aria-label={`Очистить начало и конец подхода ${interval.position}`}
                                    className={cn(
                                      'inline-flex shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-35',
                                      actionButtonSizeClass,
                                    )}
                                    onClick={() => saveIntervalPatch(interval, { date_start: null, date_end: null })}
                                  >
                                    <Eraser className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                            <div style={{ height: tableMetrics.addApproachHeight }} aria-hidden="true" />
                          </div>
                        </td>,
                      )

                      if (stageType === 'painting') {
                        const nightDates = normalizeNightShiftDates(stage.night_shift_dates, stage.night_shift_date)
                        intervalCells.push(
                          <td key={`${stageType}_n`} className={cn(bodyCellClass, 'p-0 align-top', bgClass, hl)} style={columnStyle(tableMetrics.night)}>
                            <div className="flex items-center justify-center gap-1" style={{ minHeight: tableMetrics.approachHeight }}>
                              <Checkbox
                                checked={stage.is_night_shift}
                                disabled={!canEdit}
                                onCheckedChange={(checked) => handleUpdate(stage.id, 'is_night_shift', checked === true)}
                                className="h-3.5 w-3.5"
                              />
                              {stage.is_night_shift && (
                                <span className="max-w-[70px] truncate text-[10px]" title={formatNightShiftDates(nightDates)}>
                                  {nightDates.length > 0 ? formatNightShiftDates(nightDates) : 'ночь'}
                                </span>
                              )}
                            </div>
                            <div style={{ height: tableMetrics.addApproachHeight }} aria-hidden="true" />
                          </td>,
                        )
                      }

                      return intervalCells
                    }

                    const cells: React.ReactNode[] = []
                    if (stageHasWorkshop(stageType)) {
                      cells.push(
                        <td key={`${stageType}_w`} className={cn(bodyCellClass, 'border-l text-center', bgClass, hl, fixedWs !== null && 'bg-slate-50 text-slate-400')} style={columnStyle(tableMetrics.workshop)}>
                          {isSkipped ? (
                            <span className="text-slate-400 line-through">—</span>
                          ) : fixedWs !== null ? (
                            <span>{fixedWs}</span>
                          ) : (
                            <InlineEdit
                              type="select"
                              value={stage.workshop?.toString() || null}
                              options={workshopOptions}
                              editable={canEdit}
                              onSave={(value) => handleUpdate(stage.id, 'workshop', value ? parseInt(value) : null)}
                              className="w-full min-w-0"
                              controlClassName={cn('w-full border-slate-200 bg-white px-1 text-slate-900 shadow-none', tableMetrics.controlClass)}
                              placeholder="Цех"
                              compact={tableDensity === 'compact'}
                            />
                          )}
                        </td>
                      )
                    }

                    cells.push(
                      <td key={`${stageType}_s`} className={cn(bodyCellClass, 'text-center', bgClass, hl, !stageHasWorkshop(stageType) && 'border-l')} style={columnStyle(tableMetrics.date)}>
                        {isSkipped ? (
                          <span className="text-slate-400 line-through">—</span>
                        ) : (
                          renderDateEdit(stage.date_start, canEdit, (value) => handleStageDateUpdate(row, stage, 'date_start', value))
                        )}
                      </td>,
                      <td key={`${stageType}_e`} className={cn(bodyCellClass, 'text-center', bgClass, hl)} style={columnStyle(tableMetrics.date)}>
                        {isSkipped ? (
                          <span className="text-slate-400 line-through">—</span>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            {renderDateEdit(stage.date_end, canEdit, (value) => handleStageDateUpdate(row, stage, 'date_end', value))}
                            {renderClearStageDatesButton(stage, isSkipped)}
                          </div>
                        )}
                      </td>
                    )

                    if (stageType === 'painting') {
                      const nightDates = normalizeNightShiftDates(stage.night_shift_dates, stage.night_shift_date)
                      cells.push(
                        <td key={`${stageType}_n`} className={cn(bodyCellClass, 'text-center', bgClass, hl)} style={columnStyle(tableMetrics.night)}>
                          {isSkipped ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <Checkbox
                                checked={stage.is_night_shift}
                                disabled={!canEdit}
                                onCheckedChange={(checked) => handleUpdate(stage.id, 'is_night_shift', checked === true)}
                                className="h-3.5 w-3.5"
                              />
                              {stage.is_night_shift && (
                                <span
                                  className="max-w-[82px] truncate rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700"
                                  title={formatNightShiftDates(nightDates)}
                                >
                                  {nightDates.length > 0 ? formatNightShiftDates(nightDates) : 'ночь'}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      )
                    }

                    return cells
                  })}
                </tr>
              )
            })}
            {paddingBottom > 0 && (
              <tr><td colSpan={tableColumnSpan} style={{ height: paddingBottom }} /></tr>
            )}
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={tableColumnSpan} className="px-4 py-12 text-center text-slate-400">
                  Нет данных о производстве
                </td>
              </tr>
            )}
          </tbody>
        </StickyTable>
      </section>
    </div>
  )
}
