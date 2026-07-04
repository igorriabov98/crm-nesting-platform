"use client"

import React, { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowUpDown, Eraser, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Checkbox } from '@/components/ui/checkbox'
import { InlineEdit } from '@/components/features/shared/InlineEdit'
import { StickyTable } from '@/components/features/shared/StickyTable'
import { ProductionSummary } from './ProductionSummary'
import { ProductionFilters, type ProductionFilterValues } from './ProductionFilters'
import { STAGES, STAGE_ORDER, stageHasWorkshop } from '@/lib/constants/stages'
import { useRole } from '@/lib/hooks/useRole'
import { clearProductionStageDates, updateMachineDate, updateProductionStage } from '@/lib/actions/production'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'
import { getDesiredShippingInfo } from '@/lib/utils/desired-shipping'
import type { ProductionRow, StageStatus } from '@/app/(protected)/production/actions'
import type { StageType } from '@/lib/types'

interface ProductionTableProps {
  data: ProductionRow[]
  filters?: ProductionFilterValues
  onFiltersChange?: (filters: ProductionFilterValues) => void
  hideFilters?: boolean
  visibleStageTypes?: StageType[]
}

type ProductionStage = ProductionRow['stages'][number]
type SortDirection = 'asc' | 'desc'
type SortConfig = { key: string; direction: SortDirection }
type TableDensity = 'compact' | 'normal' | 'comfortable'

const workshopOptions = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
]

const statusBgClass: Record<StageStatus, string> = {
  not_planned: '',
  active: 'bg-blue-900/30',
  completed: 'bg-green-900/30',
  overdue: 'bg-red-900/30',
  skipped: 'bg-[#FAFBFC]',
}

const stickyColumnWidths = [164, 70, 104, 112]
const workshopCellClass = 'w-[50px] min-w-[50px] px-1 py-1 text-center text-xs'
const dateCellClass = 'w-[110px] min-w-[110px] px-1 py-1 text-center text-xs'
const nightCellClass = 'w-[40px] min-w-[40px] px-1 py-1 text-center text-xs'

const getStageColumnWidths = (stageType: string) => {
  if (stageType === 'shipping' || stageType === 'actual_shipping') return [132]
  if (stageType === 'painting') return stageHasWorkshop(stageType) ? [50, 110, 110, 40] : [110, 110, 40]
  if (!stageHasWorkshop(stageType)) return [110, 110]
  return [50, 110, 110]
}

const stageColumnWidth = (stageType: string) => {
  if (stageType === 'shipping' || stageType === 'actual_shipping') return 'w-[132px] min-w-[132px]'
  if (stageType === 'painting') return stageHasWorkshop(stageType) ? 'w-[310px] min-w-[310px]' : 'w-[260px] min-w-[260px]'
  if (!stageHasWorkshop(stageType)) return 'w-[220px] min-w-[220px]'
  return 'w-[270px] min-w-[270px]'
}

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

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label="Sort by date"
      aria-sort={sortState}
      aria-pressed={sortState !== 'none'}
      className={cn(
        'inline-flex min-h-8 w-full items-center justify-center gap-1 whitespace-nowrap rounded px-1 py-0.5 hover:bg-[#E8ECF0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]',
        sortConfig?.key === sortKey && 'text-[#1B3A6B]'
      )}
      title="Сортировать по дате"
    >
      <span className={className}>{children}</span>
      <ArrowUpDown className="h-3 w-3 shrink-0" />
    </button>
  )
}

export function ProductionTable({ data, filters: externalFilters, onFiltersChange, hideFilters = false, visibleStageTypes }: ProductionTableProps) {
  const tableScrollRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { isProductionManager, isDirector } = useRole()
  const canEdit = isProductionManager || isDirector
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

  const compactControls = tableDensity === 'compact'
  const displayStageTypes = useMemo(() => {
    if (!visibleStageTypes) return STAGE_ORDER
    const visible = new Set(visibleStageTypes)
    return STAGE_ORDER.filter((stageType) => visible.has(stageType))
  }, [visibleStageTypes])
  const tableColumnSpan = useMemo(
    () => 5 + displayStageTypes.reduce((sum, stageType) => sum + getStageColumnWidths(stageType).length, 0),
    [displayStageTypes]
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
    const value = stage[field as 'date_start' | 'date_end' | 'night_shift_date']
    return value ? new Date(`${value}T00:00:00`).getTime() : null
  }

  const filtered = useMemo(() => {
    return data.filter((row) => {
      if (filters.search) {
        const q = filters.search.toLowerCase()
        if (!row.machine.name.toLowerCase().includes(q)) return false
      }

      if (filters.workshop) {
        const ws = parseInt(filters.workshop)
        const hasWs = row.stages.some((stage) => stageHasWorkshop(stage.stage_type) && !stage.is_skipped && stage.workshop === ws)
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
  }, [data, filters, visibleStageTypes])

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

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 48,
    overscan: 8,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0
  const paddingBottom = virtualRows.length > 0
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0

  const handleUpdate = async (stageId: string, field: string, value: string | number | boolean | null) => {
    const res = await updateProductionStage(stageId, { [field]: value })
    if (res.success) router.refresh()
    if (!res.success) toast.error(res.error || 'Ошибка сохранения')
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

    return handleUpdate(stage.id, field, value)
  }

  const handleMachineDateUpdate = async (
    machineId: string,
    field: 'planned_material_date' | 'actual_shipping_date',
    value: string | null
  ) => {
    const res = await updateMachineDate(machineId, field, value)
    if (res.success) router.refresh()
    if (!res.success) toast.error(res.error || 'Ошибка сохранения')
    return res
  }

  const handleClearStageDates = async (stage: ProductionStage) => {
    setClearingStageId(stage.id)
    try {
      const res = await clearProductionStageDates(stage.id)
      if (!res.success) {
        toast.error(res.error || 'Ошибка очистки дат')
        return res
      }

      toast.success('Даты этапа очищены')
      router.refresh()
      return res
    } finally {
      setClearingStageId(null)
    }
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
      className="w-[82px] max-w-[86px]"
      dateDisplayFormat="dd.MM"
      placeholder="—"
      fallbackText="—"
      compact={compactControls}
    />
  )

  const renderClearStageDatesButton = (stage: ProductionStage, disabled = false) => {
    const isClearing = clearingStageId === stage.id
    const hasDates = Boolean(stage.date_start || stage.date_end)
    const isDisabled = !canEdit || disabled || isClearing || !hasDates

    return (
      <button
        type="button"
        disabled={isDisabled}
        title="Очистить даты этапа"
        aria-label="Clear stage dates"
        onClick={() => handleClearStageDates(stage)}
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]',
          'border-[#E8ECF0] bg-white text-[#9CA3AF] hover:border-[#1B3A6B] hover:text-[#1B3A6B]',
          isDisabled && 'cursor-not-allowed opacity-40 hover:border-[#E8ECF0] hover:text-[#9CA3AF]'
        )}
      >
        {isClearing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eraser className="h-3 w-3" />}
      </button>
    )
  }

  const renderManualOverdueToggle = (stage: ProductionStage, disabled = false) => {
    const isDisabled = !canEdit || disabled
    return (
      <button
        type="button"
        disabled={isDisabled}
        title={stage.manual_overdue ? 'Снять ручную просрочку' : 'Отметить ручную просрочку'}
        aria-label={stage.manual_overdue ? 'Clear manual overdue flag' : 'Set manual overdue flag'}
        onClick={() => handleUpdate(stage.id, 'manual_overdue', !stage.manual_overdue)}
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]',
          stage.manual_overdue
            ? 'border-[#DC2626] bg-[#FEE2E2] text-[#DC2626]'
            : 'border-[#E8ECF0] bg-white text-[#9CA3AF] hover:border-[#DC2626] hover:text-[#DC2626]',
          isDisabled && 'cursor-not-allowed opacity-40 hover:border-[#E8ECF0] hover:text-[#9CA3AF]'
        )}
      >
        !
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <ProductionSummary data={filtered} />
      {!hideFilters && <ProductionFilters filters={filters} onChange={setFilters} />}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E8ECF0] bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-sm text-[#374151]">
          <span className="text-xs uppercase text-[#9CA3AF]">Масштаб таблицы</span>
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
                'min-h-9 rounded border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]',
                tableDensity === item.value
                  ? 'border-[#1B3A6B] bg-[#EEF2FF] text-[#1B3A6B]'
                  : 'border-[#E8ECF0] text-[#6B7280] hover:border-[#1B3A6B] hover:text-[#1B3A6B]'
              )}
              onClick={() => setTableDensity(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {sortConfig && (
          <button type="button" className="text-xs text-[#6B7280] hover:text-[#1B3A6B]" onClick={() => setSortConfig(null)}>
            Сбросить сортировку
          </button>
        )}
      </div>

      <div className={cn(tableDensity === 'compact' && 'text-[12px]', tableDensity === 'comfortable' && 'text-[14px]')}>
        <StickyTable
          stickyColumns={4}
          stickyColumnWidths={stickyColumnWidths}
          className="max-h-[75vh]"
          scrollRef={tableScrollRef}
        >
          <colgroup>
            {stickyColumnWidths.map((width, index) => <col key={`sticky-${index}`} style={{ width }} />)}
            <col style={{ width: 110 }} />
            {displayStageTypes.flatMap((stageType) =>
              getStageColumnWidths(stageType).map((width, index) => (
                <col key={`${stageType}-${index}`} style={{ width }} />
              ))
            )}
          </colgroup>
          <thead className="bg-[#F8F9FA] text-[#6B7280] text-xs uppercase">
            <tr>
              <th className="px-2 py-2 bg-[#F8F9FA] whitespace-nowrap" rowSpan={2}>Машина</th>
              <th className="px-2 py-2 bg-[#F8F9FA] text-center whitespace-nowrap" rowSpan={2}>Вес,т</th>
              <th className="px-2 py-2 bg-[#F8F9FA] text-center whitespace-nowrap" rowSpan={2}>
                <SortableHeader sortKey="desired_shipping_date" sortConfig={sortConfig} onSort={toggleSort}>Дедлайн</SortableHeader>
              </th>
              <th className="px-2 py-2 bg-[#F8F9FA] text-center whitespace-nowrap" rowSpan={2}>
                <SortableHeader sortKey="planned_material_date" sortConfig={sortConfig} onSort={toggleSort}>Мат.план</SortableHeader>
              </th>
              <th className="px-2 py-2 bg-[#F8F9FA] text-center whitespace-nowrap border-l border-[#E8ECF0]" rowSpan={2}>
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
                      'px-2 py-2 text-center border-l border-[#E8ECF0] bg-[#F8F9FA] whitespace-nowrap',
                      stageColumnWidth(stageType),
                      isHighlighted(stageType) && 'bg-blue-900/40'
                    )}
                  >
                    <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
                      {meta.label}
                    </div>
                  </th>
                )
              })}
            </tr>
            <tr>
              {displayStageTypes.map((stageType) => {
                const hl = isHighlighted(stageType) ? 'bg-blue-900/20' : 'bg-[#F8F9FA]'
                if (stageType === 'shipping' || stageType === 'actual_shipping') {
                  return (
                    <th key={`${stageType}_date`} className={cn('px-1 py-1 text-center border-l border-[#E8ECF0] text-[10px] whitespace-nowrap', hl)}>
                      <SortableHeader sortKey={`stage:${stageType}:date_end`} sortConfig={sortConfig} onSort={toggleSort}>Дата</SortableHeader>
                    </th>
                  )
                }

                return [
                  ...(stageHasWorkshop(stageType)
                    ? [<th key={`${stageType}_w`} className={cn('px-1 py-1 text-center border-l border-[#E8ECF0] text-[10px] whitespace-nowrap', hl)}>Ц</th>]
                    : []),
                  <th key={`${stageType}_s`} className={cn('px-1 py-1 text-center text-[10px] whitespace-nowrap', stageHasWorkshop(stageType) ? hl : `${hl} border-l border-[#E8ECF0]`)}>
                    <SortableHeader sortKey={`stage:${stageType}:date_start`} sortConfig={sortConfig} onSort={toggleSort}>Нач</SortableHeader>
                  </th>,
                  <th key={`${stageType}_e`} className={cn('px-1 py-1 text-center text-[10px] whitespace-nowrap', hl)}>
                    <SortableHeader sortKey={`stage:${stageType}:date_end`} sortConfig={sortConfig} onSort={toggleSort}>Кон</SortableHeader>
                  </th>,
                  ...(stageType === 'painting'
                    ? [<th key={`${stageType}_n`} className={cn('px-1 py-1 text-center text-[10px] whitespace-nowrap', hl)}>
                        <SortableHeader sortKey={`stage:${stageType}:night_shift_date`} sortConfig={sortConfig} onSort={toggleSort}>Ноч</SortableHeader>
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
                    'border-b border-[#E8ECF0] bg-white hover:bg-[#FAFBFC]',
                    !row.machine.is_confirmed && 'bg-amber-50/45 text-slate-500'
                  )}
                >
                  <td className={cn('w-[164px] min-w-[164px] px-2 py-1.5 bg-white', !row.machine.is_confirmed && 'bg-amber-50')}>
                    <Link href={`${ROUTES.SALES_PLAN}/${row.machine.id}`} className="text-[#2563EB] hover:underline font-medium text-sm truncate block max-w-[154px]" title={row.machine.name}>
                      {idx + 1}. {row.machine.name}
                    </Link>
                    {!row.machine.is_confirmed && (
                      <span className="mt-1 inline-flex rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        Не подтв.
                      </span>
                    )}
                  </td>
                  <td className={cn('w-[70px] min-w-[70px] px-2 py-1.5 text-center text-xs text-[#374151] bg-white', !row.machine.is_confirmed && 'bg-amber-50')}>
                    {Number(row.machine.total_weight || 0).toFixed(2)}
                  </td>
                  <td className={cn('w-[104px] min-w-[104px] px-2 py-1.5 text-center text-xs bg-white', !row.machine.is_confirmed && 'bg-amber-50')}>
                    {renderMachineDeadline(row.machine.desired_shipping_date)}
                  </td>
                  <td className={cn('w-[112px] min-w-[112px] px-1 py-1.5 text-center text-xs bg-white', !row.machine.is_confirmed && 'bg-amber-50')}>
                    {renderDateEdit(row.machine.planned_material_date, canEdit, (value) => handleMachineDateUpdate(row.machine.id, 'planned_material_date', value))}
                  </td>
                  <td className={cn('w-[110px] min-w-[110px] px-1 py-1.5 text-center text-xs border-l border-[#E8ECF0]', !row.machine.is_confirmed ? 'bg-amber-50' : 'bg-white')}>
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
                      return <td key={stageType} colSpan={cols} className="px-1 py-1 text-center text-[#9CA3AF] border-l border-[#E8ECF0]">—</td>
                    }

                    const bgClass = statusBgClass[stage.status]
                    const isSkipped = stage.is_skipped
                    const meta = STAGES[stageType]
                    const fixedWs = meta.fixedWorkshop
                    const hl = isHighlighted(stageType) ? 'ring-1 ring-inset ring-blue-500/30' : ''

                    if (stageType === 'shipping' || stageType === 'actual_shipping') {
                      return (
                        <td key={stageType} className={cn('w-[132px] min-w-[132px] px-1 py-1 text-center text-xs', 'border-l border-[#E8ECF0]', bgClass, hl)}>
                          {isSkipped ? (
                            <span className="text-[#9CA3AF] line-through text-xs">—</span>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              {renderDateEdit(stage.date_end, canEdit && !isSkipped, (value) => handleStageDateUpdate(row, stage, 'date_end', value))}
                              {renderClearStageDatesButton(stage, isSkipped)}
                              {renderManualOverdueToggle(stage, isSkipped)}
                            </div>
                          )}
                        </td>
                      )
                    }

                    const cells: React.ReactNode[] = []
                    if (stageHasWorkshop(stageType)) {
                      cells.push(
                        <td key={`${stageType}_w`} className={cn(workshopCellClass, 'border-l border-[#E8ECF0]', bgClass, hl, fixedWs !== null && 'text-[#9CA3AF] bg-[#FAFBFC]')}>
                          {isSkipped ? (
                            <span className="text-[#9CA3AF] line-through">—</span>
                          ) : fixedWs !== null ? (
                            <span>{fixedWs}</span>
                          ) : (
                            <InlineEdit
                              type="select"
                              value={stage.workshop?.toString() || null}
                              options={workshopOptions}
                              editable={canEdit}
                              onSave={(value) => handleUpdate(stage.id, 'workshop', parseInt(value))}
                              className="w-[45px] max-w-[50px]"
                              placeholder="—"
                              compact={compactControls}
                            />
                          )}
                        </td>
                      )
                    }

                    cells.push(
                      <td key={`${stageType}_s`} className={cn(dateCellClass, bgClass, hl, !stageHasWorkshop(stageType) && 'border-l border-[#E8ECF0]')}>
                        {isSkipped ? (
                          <span className="text-[#9CA3AF] line-through">—</span>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            {renderDateEdit(stage.date_start, canEdit, (value) => handleStageDateUpdate(row, stage, 'date_start', value))}
                            {renderClearStageDatesButton(stage, isSkipped)}
                          </div>
                        )}
                      </td>,
                      <td key={`${stageType}_e`} className={cn(dateCellClass, bgClass, hl)}>
                        {isSkipped ? (
                          <span className="text-[#9CA3AF] line-through">—</span>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            {renderDateEdit(stage.date_end, canEdit, (value) => handleStageDateUpdate(row, stage, 'date_end', value))}
                            {renderManualOverdueToggle(stage, isSkipped)}
                          </div>
                        )}
                      </td>
                    )

                    if (stageType === 'painting') {
                      cells.push(
                        <td key={`${stageType}_n`} className={cn(nightCellClass, bgClass, hl)}>
                          {isSkipped ? (
                            <span className="text-[#9CA3AF]">—</span>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <Checkbox
                                checked={stage.is_night_shift}
                                disabled={!canEdit}
                                onCheckedChange={(checked) => handleUpdate(stage.id, 'is_night_shift', checked === true)}
                                className="h-3.5 w-3.5"
                              />
                              {stage.is_night_shift && renderDateEdit(stage.night_shift_date, canEdit, (value) => handleStageDateUpdate(row, stage, 'night_shift_date', value))}
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
                <td colSpan={tableColumnSpan} className="px-4 py-12 text-center text-[#9CA3AF]">
                  Нет данных о производстве
                </td>
              </tr>
            )}
          </tbody>
        </StickyTable>
      </div>
    </div>
  )
}
