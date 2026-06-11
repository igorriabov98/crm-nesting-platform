"use client"

import React from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import { Search, X } from 'lucide-react'
import { STAGES, STAGE_ORDER } from '@/lib/constants/stages'

export interface ProductionFilterValues {
  search: string
  workshop: string       // '' | '1' | '2'
  stageType: string      // '' | StageType
  status: string         // '' | StageStatus
  confirmation: string   // '' | 'confirmed' | 'unconfirmed'
  dateFrom: Date | undefined
  dateTo: Date | undefined
}

interface ProductionFiltersProps {
  filters: ProductionFilterValues
  onChange: (filters: ProductionFilterValues) => void
}

const statusOptions = [
  { value: 'active', label: 'По плану сейчас' },
  { value: 'completed', label: 'Отгружено' },
  { value: 'overdue', label: 'Просрочено вручную' },
  { value: 'not_planned', label: 'Не началось / нет плана' },
  { value: 'skipped', label: 'Пропущен' },
]

const workshopLabels: Record<string, string> = {
  all: 'Все',
  '1': 'Цех 1',
  '2': 'Цех 2',
}

const confirmationLabels: Record<string, string> = {
  all: 'Все',
  confirmed: 'Подтверждённые',
  unconfirmed: 'Не подтверждённые',
}

export function ProductionFilters({ filters, onChange }: ProductionFiltersProps) {
  const update = (partial: Partial<ProductionFilterValues>) => {
    onChange({ ...filters, ...partial })
  }

  const reset = () => {
    onChange({
      search: '',
      workshop: '',
      stageType: '',
      status: '',
      confirmation: '',
      dateFrom: undefined,
      dateTo: undefined,
    })
  }

  const hasFilters = filters.search || filters.workshop || filters.stageType || filters.status || filters.confirmation || filters.dateFrom || filters.dateTo

  return (
    <div className="bg-white border border-[#E8ECF0] rounded-lg p-4 space-y-3">
      {/* Row 1: Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
        <Input
          placeholder="Поиск по названию машины..."
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
          className="pl-10 bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B] h-9"
        />
      </div>

      {/* Row 2: Selects + Dates */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Цех */}
        <div className="w-[130px]">
          <label className="text-xs text-[#9CA3AF] mb-1 block">Цех</label>
          <Select value={filters.workshop || 'all'} onValueChange={(v) => update({ workshop: (v ?? 'all') === 'all' ? '' : (v ?? '') })}>
            <SelectTrigger className="h-9 bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
              <SelectValue>{workshopLabels[filters.workshop || 'all']}</SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="1">Цех 1</SelectItem>
              <SelectItem value="2">Цех 2</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Этап */}
        <div className="w-[160px]">
          <label className="text-xs text-[#9CA3AF] mb-1 block">Этап</label>
          <Select value={filters.stageType || 'all'} onValueChange={(v) => update({ stageType: (v ?? 'all') === 'all' ? '' : (v ?? '') })}>
            <SelectTrigger className="h-9 bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
              <SelectValue>{filters.stageType ? STAGES[filters.stageType as keyof typeof STAGES]?.label : 'Все этапы'}</SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
              <SelectItem value="all">Все этапы</SelectItem>
              {STAGE_ORDER.map((st) => (
                <SelectItem key={st} value={st}>{STAGES[st].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Статус */}
        <div className="w-[170px]">
          <label className="text-xs text-[#9CA3AF] mb-1 block">Статус</label>
          <Select value={filters.status || 'all'} onValueChange={(v) => update({ status: (v ?? 'all') === 'all' ? '' : (v ?? '') })}>
            <SelectTrigger className="h-9 bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
              <SelectValue>{filters.status ? statusOptions.find((o) => o.value === filters.status)?.label : 'Все статусы'}</SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
              <SelectItem value="all">Все статусы</SelectItem>
              {statusOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[190px]">
          <label className="text-xs text-[#9CA3AF] mb-1 block">Подтверждение</label>
          <Select value={filters.confirmation || 'all'} onValueChange={(v) => update({ confirmation: (v ?? 'all') === 'all' ? '' : (v ?? '') })}>
            <SelectTrigger className="h-9 bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
              <SelectValue>{confirmationLabels[filters.confirmation || 'all']}</SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="confirmed">Подтверждённые</SelectItem>
              <SelectItem value="unconfirmed">Не подтверждённые</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Период */}
        <div className="w-[150px]">
          <label className="text-xs text-[#9CA3AF] mb-1 block">Период от</label>
          <DatePicker
            value={filters.dateFrom}
            onChange={(d) => update({ dateFrom: d })}
            placeholder="От..."
            className="h-9"
          />
        </div>
        <div className="w-[150px]">
          <label className="text-xs text-[#9CA3AF] mb-1 block">Период до</label>
          <DatePicker
            value={filters.dateTo}
            onChange={(d) => update({ dateTo: d })}
            placeholder="До..."
            className="h-9"
          />
        </div>

        {/* Сброс */}
        {hasFilters && (
          <Button variant="ghost" onClick={reset} className="h-9 text-[#6B7280] hover:text-[#1B3A6B] hover:bg-[#F8F9FA]">
            <X className="w-4 h-4 mr-1" />
            Сбросить
          </Button>
        )}
      </div>
    </div>
  )
}
