"use client"

import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { CalendarDays, Minus, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STAGE_ORDER } from '@/lib/constants/stages'
import type { StageType } from '@/lib/types'
import { getGanttStageLabel } from './types'

export interface GanttFilters {
  search: string
  workshop: string
  confirmation: string
  showSupply: boolean
  visibleStages: StageType[]
}

interface GanttControlsProps {
  onToday: () => void
  dayWidth: number
  onDayWidthChange: (value: number) => void
  onZoomIn: () => void
  onZoomOut: () => void
  filters: GanttFilters
  onFiltersChange: (f: GanttFilters) => void
  showStageFilters?: boolean
}

export function GanttControls({
  onToday,
  dayWidth,
  onDayWidthChange,
  onZoomIn,
  onZoomOut,
  filters,
  onFiltersChange,
  showStageFilters = true,
}: GanttControlsProps) {
  const setF = (partial: Partial<GanttFilters>) => onFiltersChange({ ...filters, ...partial })

  const toggleStage = (stage: StageType, checked: boolean) => {
    const current = new Set(filters.visibleStages)
    if (checked) current.add(stage)
    else current.delete(stage)
    setF({ visibleStages: STAGE_ORDER.filter((st) => current.has(st)) })
  }

  return (
    <div className="space-y-3 rounded-md border border-[#E8ECF0] bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={onToday} className="h-8 px-3 text-xs gap-1.5">
          <CalendarDays className="h-3.5 w-3.5" />
          Сегодня
        </Button>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#6B7280]">Масштаб:</span>
          <Button variant="outline" size="icon-sm" onClick={onZoomOut} aria-label="Уменьшить масштаб">
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <input
            type="range"
            min={15}
            max={80}
            value={dayWidth}
            onChange={(event) => onDayWidthChange(Number(event.target.value))}
            className="w-32"
          />
          <Button variant="outline" size="icon-sm" onClick={onZoomIn} aria-label="Увеличить масштаб">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-[#374151]">
          <Checkbox
            checked={filters.showSupply}
            onCheckedChange={(c) => setF({ showSupply: c === true })}
            className="h-4 w-4"
          />
          Показать снабжение
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[#E8ECF0] pt-3">
        <div className="flex rounded-md bg-[#F8F9FA] p-0.5 gap-0.5">
          {[{ v: '', l: 'Все' }, { v: '1', l: 'Цех 1' }, { v: '2', l: 'Цех 2' }].map(({ v, l }) => (
            <button
              key={v}
              onClick={() => setF({ workshop: v })}
              className={cn(
                "px-3 py-1.5 text-xs rounded font-medium transition-colors",
                filters.workshop === v
                  ? "bg-[#E8ECF0] text-[#1B3A6B]"
                  : "text-[#6B7280] hover:text-[#374151] hover:bg-[#E8ECF0]"
              )}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
          <Input
            placeholder="Поиск..."
            value={filters.search}
            onChange={(e) => setF({ search: e.target.value })}
            className="h-8 w-[190px] border-[#E8ECF0] bg-[#F8F9FA] pl-8 text-xs text-[#1B3A6B]"
          />
        </div>

        <div className="flex rounded-md bg-[#F8F9FA] p-0.5 gap-0.5">
          {[
            { v: '', l: 'Все' },
            { v: 'confirmed', l: 'Подтв.' },
            { v: 'unconfirmed', l: 'Не подтв.' },
          ].map(({ v, l }) => (
            <button
              key={v}
              onClick={() => setF({ confirmation: v })}
              className={cn(
                "px-3 py-1.5 text-xs rounded font-medium transition-colors",
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
        <span className="text-xs font-medium text-[#6B7280]">Этапы:</span>
        {STAGE_ORDER.map((stage) => (
          <label key={stage} className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-[#374151]">
            <Checkbox
              checked={filters.visibleStages.includes(stage)}
              onCheckedChange={(c) => toggleStage(stage, c === true)}
              className="h-3.5 w-3.5"
            />
            {getGanttStageLabel(stage)}
          </label>
        ))}
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setF({ visibleStages: [...STAGE_ORDER] })}>
          Показать все
        </Button>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setF({ visibleStages: [] })}>
          Скрыть все
        </Button>
      </div>}
    </div>
  )
}
