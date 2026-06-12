'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABELS, ORDER_STATUS_LABELS } from '@/lib/constants/procurement'
import type { MaterialCategory, OrderItemStatus } from '@/lib/types'

export type OrderPeriodFilter = 'this_week' | 'next_week' | 'all'
export type OrderFiltersState = {
 period: OrderPeriodFilter
 supplier: string
 category: MaterialCategory | 'all'
 status: OrderItemStatus | 'all'
}

type SupplierOption = { id: string; name: string }

type OrderFiltersProps = {
 value: OrderFiltersState
 suppliers: SupplierOption[]
 onChange: (value: OrderFiltersState) => void
}

const periodLabels: Record<OrderPeriodFilter, string> = {
 this_week: 'Эта неделя',
 next_week: 'Следующая неделя',
 all: 'Все',
}

export function OrderFilters({ value, suppliers, onChange }: OrderFiltersProps) {
 return (
  <div className="grid gap-3 rounded-xl border border-[#E8ECF0] bg-white p-4 md:grid-cols-4">
   <FilterSelect
    label="Период"
    value={value.period}
    display={periodLabels[value.period]}
    onValueChange={(period) => onChange({ ...value, period: period as OrderPeriodFilter })}
    items={[
     ['this_week', 'Эта неделя'],
     ['next_week', 'Следующая неделя'],
     ['all', 'Все'],
    ]}
   />
   <FilterSelect
    label="Поставщик"
    value={value.supplier}
    display={value.supplier === 'all' ? 'Все поставщики' : suppliers.find((supplier) => supplier.id === value.supplier)?.name || 'Все поставщики'}
    onValueChange={(supplier) => onChange({ ...value, supplier })}
    items={[['all', 'Все поставщики'], ...suppliers.map((supplier) => [supplier.id, supplier.name] as [string, string])]}
   />
   <FilterSelect
    label="Категория"
    value={value.category}
    display={value.category === 'all' ? 'Все категории' : MATERIAL_CATEGORY_LABELS[value.category]}
    onValueChange={(category) => onChange({ ...value, category: category as MaterialCategory | 'all' })}
    items={[['all', 'Все категории'], ...MATERIAL_CATEGORIES.map((category) => [category, MATERIAL_CATEGORY_LABELS[category]] as [string, string])]}
   />
   <FilterSelect
    label="Статус"
    value={value.status}
    display={value.status === 'all' ? 'Все статусы' : ORDER_STATUS_LABELS[value.status]}
    onValueChange={(status) => onChange({ ...value, status: status as OrderItemStatus | 'all' })}
    items={[
     ['pending', ORDER_STATUS_LABELS.pending],
     ['ordered', ORDER_STATUS_LABELS.ordered],
     ['delivered', ORDER_STATUS_LABELS.delivered],
     ['all', 'Все статусы'],
    ]}
   />
  </div>
 )
}

function FilterSelect({
 label,
 value,
 display,
 items,
 onValueChange,
}: {
 label: string
 value: string
 display: string
 items: [string, string][]
 onValueChange: (value: string) => void
}) {
 return (
  <label className="grid gap-1.5 text-sm font-medium text-[#374151]">
   {label}
   <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue || '')}>
    <SelectTrigger className="w-full border-[#E8ECF0] bg-white">
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
