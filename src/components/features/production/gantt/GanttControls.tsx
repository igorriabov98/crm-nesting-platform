"use client"

import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CalendarDays, Check, ChevronDown, Minus, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STAGE_ORDER } from '@/lib/constants/stages'
import type { StageType } from '@/lib/types'
import { getGanttStageLabel } from './types'

export interface GanttFilters {
  search: string
  workshop: string
  confirmation: string
  productionMonth: string
  showSupply: boolean
  visibleStages: StageType[]
}

export type GanttMonthOption = {
  value: string
  label: string
}

interface GanttControlsProps {
  onToday: () => void
  dayWidth: number
  onDayWidthChange: (value: number) => void
  onZoomIn: () => void
  onZoomOut: () => void
  filters: GanttFilters
  onFiltersChange: (f: GanttFilters) => void
  productionMonthOptions?: GanttMonthOption[]
  showStageFilters?: boolean
  stageOptions?: StageType[]
}

export function GanttControls({
  onToday,
  dayWidth,
  onDayWidthChange,
  onZoomIn,
  onZoomOut,
  filters,
  onFiltersChange,
  productionMonthOptions = [],
  showStageFilters = true,
  stageOptions = STAGE_ORDER,
}: GanttControlsProps) {
  const setF = (partial: Partial<GanttFilters>) => onFiltersChange({ ...filters, ...partial })
  const availableStageSet = new Set(stageOptions)
  const selectedStageCount = filters.visibleStages.filter((stage) => availableStageSet.has(stage)).length

  const toggleStage = (stage: StageType, checked: boolean) => {
    const current = new Set(filters.visibleStages)
    if (checked) current.add(stage)
    else current.delete(stage)
    setF({ visibleStages: stageOptions.filter((st) => current.has(st)) })
  }

  return (
    <div className="space-y-3 rounded-lg border border-[#E8ECF0] bg-white px-3 py-3 shadow-sm sm:px-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <Button variant="outline" size="sm" onClick={onToday} className="min-h-11 gap-1.5 px-3 text-sm sm:min-h-10">
          <CalendarDays className="h-3.5 w-3.5" />
          Сегодня
        </Button>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[#6B7280]">Масштаб:</span>
          <Button variant="outline" size="icon-sm" className="min-h-11 min-w-11 sm:min-h-10 sm:min-w-10" onClick={onZoomOut} aria-label="Уменьшить масштаб">
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <input
            type="range"
            min={15}
            max={80}
            aria-label="Масштаб дней на графике"
            value={dayWidth}
            onChange={(event) => onDayWidthChange(Number(event.target.value))}
            className="h-10 min-w-32 flex-1 accent-[#1B3A6B] sm:flex-none"
          />
          <Button variant="outline" size="icon-sm" className="min-h-11 min-w-11 sm:min-h-10 sm:min-w-10" onClick={onZoomIn} aria-label="Увеличить масштаб">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        <label className={cn(
          'flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-md border px-3 text-sm transition-colors sm:min-h-10',
          filters.showSupply
            ? 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1B3A6B]'
            : 'border-[#E8ECF0] text-[#374151] hover:bg-[#F8F9FA]'
        )}>
          <input
            type="checkbox"
            checked={filters.showSupply}
            onChange={(event) => setF({ showSupply: event.target.checked })}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={cn(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[#2563EB]/30',
              filters.showSupply
                ? 'border-[#2563EB] bg-[#2563EB] text-white'
                : 'border-[#D1D5DB] bg-white text-transparent'
            )}
          >
            <Check className="h-3 w-3" />
          </span>
          <span>Показать снабжение</span>
        </label>
      </div>

      <div className="flex flex-col gap-3 border-t border-[#E8ECF0] pt-3 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="grid grid-cols-3 rounded-md bg-[#F8F9FA] p-0.5 gap-0.5 sm:inline-grid">
          {[{ v: '', l: 'Все' }, { v: '1', l: 'Цех 1' }, { v: '2', l: 'Цех 2' }].map(({ v, l }) => (
            <button
              key={v}
              onClick={() => setF({ workshop: v })}
              className={cn(
                "min-h-11 rounded px-3 py-1.5 text-sm font-medium transition-colors sm:min-h-10",
                filters.workshop === v
                  ? "bg-[#E8ECF0] text-[#1B3A6B]"
                  : "text-[#6B7280] hover:text-[#374151] hover:bg-[#E8ECF0]"
              )}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-[240px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
          <Input
            placeholder="Поиск..."
            value={filters.search}
            onChange={(e) => setF({ search: e.target.value })}
            className="min-h-11 w-full border-[#E8ECF0] bg-[#F8F9FA] pl-9 text-sm text-[#1B3A6B] sm:min-h-10"
          />
        </div>

        <div className="relative w-full sm:w-[210px]">
          <select
            aria-label="Фильтр по месяцу производства"
            value={filters.productionMonth || ''}
            onChange={(event) => setF({ productionMonth: event.target.value })}
            className="min-h-11 w-full appearance-none rounded-md border border-[#E8ECF0] bg-[#F8F9FA] px-3 pr-9 text-sm font-medium text-[#1B3A6B] outline-none transition-colors focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 sm:min-h-10"
          >
            <option value="">Все месяцы</option>
            {productionMonthOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" />
        </div>

        <div className="grid grid-cols-3 rounded-md bg-[#F8F9FA] p-0.5 gap-0.5 sm:inline-grid">
          {[
            { v: '', l: 'Все' },
            { v: 'confirmed', l: 'Подтв.' },
            { v: 'unconfirmed', l: 'Не подтв.' },
          ].map(({ v, l }) => (
            <button
              key={v}
              onClick={() => setF({ confirmation: v })}
              className={cn(
                "min-h-11 rounded px-3 py-1.5 text-sm font-medium transition-colors sm:min-h-10",
                filters.confirmation === v
                  ? "bg-[#E8ECF0] text-[#1B3A6B]"
                  : "text-[#6B7280] hover:text-[#374151] hover:bg-[#E8ECF0]"
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {showStageFilters && <div className="flex flex-wrap items-center gap-2 border-t border-[#E8ECF0] pt-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#D7DEE8] bg-white px-3 text-sm font-medium text-[#1B3A6B] transition-colors hover:bg-[#F8F9FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] sm:min-h-10">
            Этапы: {selectedStageCount}/{stageOptions.length}
            <ChevronDown className="h-4 w-4 text-[#6B7280]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72 border-[#D7DEE8] bg-white">
            <div className="px-2 py-1.5 text-xs font-medium uppercase text-[#6B7280]">Этапы производства</div>
            {stageOptions.map((stage) => (
              <DropdownMenuCheckboxItem
                key={stage}
                checked={filters.visibleStages.includes(stage)}
                onCheckedChange={(checked) => toggleStage(stage, checked === true)}
                className="min-h-9 text-sm text-[#374151]"
              >
                {getGanttStageLabel(stage)}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <div className="grid grid-cols-2 gap-2 p-2">
              <Button variant="outline" size="sm" className="min-h-9 px-2 text-xs" onClick={() => setF({ visibleStages: [...stageOptions] })}>
                Показать все
              </Button>
              <Button variant="outline" size="sm" className="min-h-9 px-2 text-xs" onClick={() => setF({ visibleStages: [] })}>
                Скрыть все
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        {selectedStageCount < stageOptions.length && (
          <span className="rounded-md bg-[#EEF2FF] px-2.5 py-1 text-xs font-medium text-[#1B3A6B]">
            Активно: {selectedStageCount}
          </span>
        )}
      </div>}
    </div>
  )
}
