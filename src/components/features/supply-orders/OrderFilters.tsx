'use client'

import { Filter, RotateCcw, Search, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABELS, ORDER_STATUS_LABELS } from '@/lib/constants/procurement'
import type { MaterialCategory, OrderItemStatus } from '@/lib/types'
import type {
  OrderAttentionFilter,
  OrderFiltersState,
  OrderPeriodFilter,
  SupplyOrderSort,
} from './supply-order-view'

export type { OrderFiltersState } from './supply-order-view'

type SupplierOption = { id: string; name: string }

type OrderFiltersProps = {
  value: OrderFiltersState
  suppliers: SupplierOption[]
  activeFilterCount: number
  onChange: (value: OrderFiltersState) => void
  onReset: () => void
  statusDisabled?: boolean
}

const periodLabels: Record<OrderPeriodFilter, string> = {
  this_week: 'Эта неделя',
  next_week: 'Следующая неделя',
  all: 'Любой период',
}

const attentionLabels: Record<OrderAttentionFilter, string> = {
  all: 'Все позиции',
  needs_supplier: 'Без поставщика',
  needs_schedule: 'Без даты поставки',
  stock_covered: 'Закрыто складом',
}

const sortLabels: Record<SupplyOrderSort, string> = {
  delivery_asc: 'Дата поставки: сначала ранние',
  delivery_desc: 'Дата поставки: сначала поздние',
  material_asc: 'Материал: А–Я',
  machine_asc: 'Машина: А–Я',
  quantity_desc: 'Количество: по убыванию',
  quantity_asc: 'Количество: по возрастанию',
}

export function OrderFilters({
  value,
  suppliers,
  activeFilterCount,
  onChange,
  onReset,
  statusDisabled = false,
}: OrderFiltersProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm" aria-label="Фильтры и сортировка заказов">
      <div className="flex flex-col gap-3 border-b border-border/60 bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Поиск и отбор</h2>
            <p className="text-xs text-muted-foreground">Фильтры применяются к текущей странице из 50 позиций</p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={activeFilterCount === 0}
          onClick={onReset}
          className="min-h-9 justify-start sm:justify-center"
        >
          <RotateCcw className="h-4 w-4" />
          Сбросить{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </Button>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-12">
        <label className="grid gap-1.5 md:col-span-2 xl:col-span-4">
          <span className="text-xs font-medium text-muted-foreground">Поиск</span>
          <span className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={value.query}
              onChange={(event) => onChange({ ...value, query: event.target.value })}
              placeholder="Материал, машина или поставщик"
              className="h-11 pl-9"
            />
          </span>
        </label>

        <FilterSelect
          className="xl:col-span-2"
          label="Период"
          value={value.period}
          display={periodLabels[value.period]}
          onValueChange={(period) => onChange({ ...value, period: period as OrderPeriodFilter })}
          items={[
            ['all', 'Любой период'],
            ['this_week', 'Эта неделя'],
            ['next_week', 'Следующая неделя'],
          ]}
        />
        <FilterSelect
          className="xl:col-span-3"
          label="Поставщик"
          value={value.supplier}
          display={value.supplier === 'all' ? 'Все поставщики' : suppliers.find((supplier) => supplier.id === value.supplier)?.name || 'Все поставщики'}
          onValueChange={(supplier) => onChange({ ...value, supplier })}
          items={[
            ['all', 'Все поставщики'],
            ...suppliers.map((supplier) => [supplier.id, supplier.name] as [string, string]),
          ]}
        />
        <FilterSelect
          className="xl:col-span-3"
          label="Категория"
          value={value.category}
          display={value.category === 'all' ? 'Все категории' : MATERIAL_CATEGORY_LABELS[value.category]}
          onValueChange={(category) => onChange({ ...value, category: category as MaterialCategory | 'all' })}
          items={[
            ['all', 'Все категории'],
            ...MATERIAL_CATEGORIES.map((category) => [category, MATERIAL_CATEGORY_LABELS[category]] as [string, string]),
          ]}
        />
        <FilterSelect
          className="xl:col-span-3"
          label="Статус"
          value={value.status}
          display={value.status === 'all' ? 'Все статусы' : ORDER_STATUS_LABELS[value.status]}
          disabled={statusDisabled}
          onValueChange={(status) => onChange({ ...value, status: status as OrderItemStatus | 'all' })}
          items={[
            ['pending', ORDER_STATUS_LABELS.pending],
            ['ordered', ORDER_STATUS_LABELS.ordered],
            ['delivered', ORDER_STATUS_LABELS.delivered],
            ['all', 'Все статусы'],
          ]}
        />
        <FilterSelect
          className="xl:col-span-3"
          label="Требует внимания"
          value={value.attention}
          display={attentionLabels[value.attention]}
          onValueChange={(attention) => onChange({ ...value, attention: attention as OrderAttentionFilter })}
          items={Object.entries(attentionLabels)}
        />
        <FilterSelect
          className="md:col-span-2 xl:col-span-6"
          label="Сортировка"
          value={value.sort}
          display={sortLabels[value.sort]}
          onValueChange={(sort) => onChange({ ...value, sort: sort as SupplyOrderSort })}
          items={Object.entries(sortLabels)}
          icon={<Filter className="h-3.5 w-3.5" />}
        />
      </div>
    </section>
  )
}

function FilterSelect({
  label,
  value,
  display,
  items,
  disabled = false,
  className,
  icon,
  onValueChange,
}: {
  label: string
  value: string
  display: string
  items: [string, string][]
  disabled?: boolean
  className?: string
  icon?: React.ReactNode
  onValueChange: (value: string) => void
}) {
  return (
    <label className={`grid min-w-0 gap-1.5 ${className || ''}`}>
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">{icon}{label}</span>
      <Select value={value} disabled={disabled} onValueChange={(nextValue) => onValueChange(nextValue || '')}>
        <SelectTrigger className="h-11 w-full bg-background">
          <SelectValue>{display}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map(([itemValue, itemLabel]) => (
            <SelectItem key={itemValue} value={itemValue}>{itemLabel}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
