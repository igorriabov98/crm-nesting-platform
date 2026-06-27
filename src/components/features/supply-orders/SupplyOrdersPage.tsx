'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { addDays, endOfWeek, isWithinInterval, startOfWeek } from 'date-fns'
import { OrderActions } from './OrderActions'
import { OrderDateGroup } from './OrderDateGroup'
import { OrderFilters, type OrderFiltersState } from './OrderFilters'
import { markOrderDelivered, markOrderPlacedWithFinance, type SupplyFinancePaymentInput, type SupplyOrderItem } from '@/lib/actions/supply-orders'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'
import type { OrderItemStatus } from '@/lib/types'

type SupplyOrdersPageProps = {
 items: SupplyOrderItem[]
 suppliers: SupplierWithRelations[]
 page: number
 pageSize: number
 total: number
 initialStatus?: OrderFiltersState['status']
 lockedStatus?: OrderItemStatus
 showActions?: boolean
 emptyMessage?: string
}

export function SupplyOrdersPage({
 items,
 suppliers,
 page,
 pageSize,
 total,
 initialStatus = 'pending',
 lockedStatus,
 showActions = true,
 emptyMessage,
}: SupplyOrdersPageProps) {
 const router = useRouter()
 const [selected, setSelected] = useState<Set<string>>(new Set())
 const [isPending, startTransition] = useTransition()
 const [showFinanceStep, setShowFinanceStep] = useState(false)
 const [financeDrafts, setFinanceDrafts] = useState<Record<string, { amount: string; currency: 'UAH' | 'EUR'; plannedDate: string }>>({})
 const [filters, setFilters] = useState<OrderFiltersState>({
  period: 'all',
  supplier: 'all',
  category: 'all',
  status: lockedStatus || initialStatus,
 })

 const filteredItems = useMemo(() => {
  const now = new Date()
  const thisWeek = { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
  const nextWeekStart = addDays(thisWeek.end, 1)
  const nextWeek = { start: nextWeekStart, end: endOfWeek(nextWeekStart, { weekStartsOn: 1 }) }

  return items.filter((item) => {
   const statusFilter = lockedStatus || filters.status
   if (statusFilter !== 'all' && item.order_status !== statusFilter) return false
   if (filters.supplier !== 'all' && item.supplier_id !== filters.supplier) return false
   if (filters.category !== 'all' && item.category !== filters.category) return false
   if (filters.period !== 'all') {
    if (!item.target_delivery_date) return false
    const date = new Date(`${item.target_delivery_date}T00:00:00`)
    if (filters.period === 'this_week' && !isWithinInterval(date, thisWeek)) return false
    if (filters.period === 'next_week' && !isWithinInterval(date, nextWeek)) return false
   }
   return true
  })
 }, [filters, items, lockedStatus])

 const grouped = useMemo(() => {
  const byDate = new Map<string, Map<string, { supplierName: string; items: SupplyOrderItem[] }>>()
  for (const item of filteredItems) {
   const dateKey = item.supplier_id ? item.target_delivery_date || 'no_date' : 'no_supplier'
   const supplierKey = item.supplier_id || 'no_supplier'
   const supplierName = item.supplier_name || 'Без поставщика — требует назначения'
   if (!byDate.has(dateKey)) byDate.set(dateKey, new Map())
   const dateGroup = byDate.get(dateKey)!
   if (!dateGroup.has(supplierKey)) dateGroup.set(supplierKey, { supplierName, items: [] })
   dateGroup.get(supplierKey)!.items.push(item)
  }

  return Array.from(byDate.entries())
   .sort(([a], [b]) => {
    if (a === 'no_supplier') return 1
    if (b === 'no_supplier') return -1
    if (a === 'no_date') return 1
    if (b === 'no_date') return -1
    return a.localeCompare(b)
   })
   .map(([dateKey, supplierMap]) => ({
    dateKey,
    groups: Array.from(supplierMap.entries()).map(([supplierKey, group]) => ({
     supplierKey,
     supplierName: group.supplierName,
     items: group.items,
    })),
   }))
 }, [filteredItems])

 const toggle = (item: SupplyOrderItem) => {
  if (!showActions || item.to_order <= 0) return
  const key = `${item.table}:${item.id}`
  setSelected((prev) => {
   const next = new Set(prev)
   if (next.has(key)) next.delete(key)
   else next.add(key)
   return next
  })
 }

 const selectedOrderItems = useMemo(() => {
  const selectedKeys = selected
  return items.filter((item) => selectedKeys.has(`${item.table}:${item.id}`) && item.to_order > 0)
 }, [items, selected])

 const selectedItems = () => {
  return selectedOrderItems.map((item) => ({ table: item.table, id: item.id }))
 }

 const financeGroups = useMemo(() => {
  const groups = new Map<string, { supplierId: string; supplierName: string; plannedDate: string; itemKeys: string[]; items: SupplyOrderItem[] }>()
  for (const item of selectedOrderItems) {
   if (!item.supplier_id) continue
   const plannedDate = item.target_delivery_date || new Date().toISOString().slice(0, 10)
   const key = `${item.supplier_id}:${plannedDate}`
   const current = groups.get(key) || {
    supplierId: item.supplier_id,
    supplierName: item.supplier_name || 'Поставщик',
    plannedDate,
    itemKeys: [],
    items: [],
   }
   current.itemKeys.push(`${item.table}:${item.id}`)
   current.items.push(item)
   groups.set(key, current)
  }
  return Array.from(groups.entries()).map(([key, group]) => ({ key, ...group }))
 }, [selectedOrderItems])

 const makeFinancePayments = (): SupplyFinancePaymentInput[] => financeGroups.map((group) => {
  const draft = financeDrafts[group.key]
  return {
   supplierId: group.supplierId,
   plannedDate: draft?.plannedDate || group.plannedDate,
   amount: Number((draft?.amount || '').replace(',', '.')),
   currency: draft?.currency || 'EUR',
   itemKeys: group.itemKeys,
  }
 })

 const openFinanceStep = () => {
  if (selected.size === 0 || isPending) return
  const defaults: Record<string, { amount: string; currency: 'UAH' | 'EUR'; plannedDate: string }> = {}
  for (const group of financeGroups) {
   defaults[group.key] = financeDrafts[group.key] || { amount: '', currency: 'EUR', plannedDate: group.plannedDate }
  }
  setFinanceDrafts(defaults)
  setShowFinanceStep(true)
 }

 const runAction = (mode: 'ordered' | 'delivered') => {
  startTransition(async () => {
   const payload = selectedItems()
   const result = mode === 'ordered'
    ? await markOrderPlacedWithFinance(payload, makeFinancePayments())
    : await markOrderDelivered(payload)
   if (!result.success) {
    toast.error(result.error || 'Не удалось обновить позиции')
    return
   }
   toast.success(mode === 'ordered' ? 'Позиции отмечены как заказанные' : 'Позиции отмечены как доставленные')
   setSelected(new Set())
   setShowFinanceStep(false)
   setFinanceDrafts({})
   router.refresh()
  })
 }

 const pageCount = Math.max(1, Math.ceil(total / pageSize))
 const currentFrom = total === 0 ? 0 : page * pageSize + 1
 const currentTo = Math.min(total, (page + 1) * pageSize)
 const hasActiveFilters = filters.period !== 'all' || filters.supplier !== 'all' || filters.category !== 'all' || filters.status !== 'all'
 const goToPage = (nextPage: number) => {
  const params = new URLSearchParams()
  params.set('page', String(nextPage + 1))
  router.push(`/supply/orders?${params.toString()}`)
 }

 return (
  <div className="space-y-5">
   <OrderFilters
   value={filters}
   suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
   onChange={setFilters}
   statusDisabled={Boolean(lockedStatus)}
   />

   {showActions && (
    <OrderActions
     selectedCount={selected.size}
     isPending={isPending}
     onMarkOrdered={openFinanceStep}
     onMarkDelivered={() => runAction('delivered')}
    />
   )}

   {showActions && showFinanceStep && (
    <section className="rounded-xl border border-[#E8ECF0] bg-white p-4">
     <div className="mb-3 font-semibold text-[#1B3A6B]">Плановые платежи по заказу</div>
     <div className="space-y-3">
      {financeGroups.map((group) => {
       const draft = financeDrafts[group.key] || { amount: '', currency: 'EUR' as const, plannedDate: group.plannedDate }
       return (
        <div key={group.key} className="grid gap-2 rounded-md border border-[#E8ECF0] p-3 md:grid-cols-[1fr_140px_120px_150px] md:items-center">
         <div className="text-sm">
          <div className="font-medium text-[#1B3A6B]">{group.supplierName}</div>
          <div className="text-[#6B7280]">{group.items.length} поз.</div>
         </div>
         <input
          value={draft.amount}
          onChange={(event) => setFinanceDrafts((prev) => ({ ...prev, [group.key]: { ...draft, amount: event.target.value } }))}
          placeholder="Сумма"
          className="h-9 rounded-md border border-[#E8ECF0] px-3 text-sm"
         />
         <select
          value={draft.currency}
          onChange={(event) => setFinanceDrafts((prev) => ({ ...prev, [group.key]: { ...draft, currency: event.target.value as 'UAH' | 'EUR' } }))}
          className="h-9 rounded-md border border-[#E8ECF0] bg-white px-3 text-sm"
         >
          <option value="EUR">EUR</option>
          <option value="UAH">UAH</option>
         </select>
         <input
          type="date"
          value={draft.plannedDate}
          onChange={(event) => setFinanceDrafts((prev) => ({ ...prev, [group.key]: { ...draft, plannedDate: event.target.value } }))}
          className="h-9 rounded-md border border-[#E8ECF0] px-3 text-sm"
         />
        </div>
       )
      })}
     </div>
     <div className="mt-3 flex flex-wrap gap-2">
      <button
       type="button"
       disabled={isPending || financeGroups.length === 0 || makeFinancePayments().some((payment) => !payment.plannedDate || !Number.isFinite(payment.amount) || payment.amount <= 0)}
       onClick={() => runAction('ordered')}
       className="rounded-md bg-[#1B3A6B] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
       Подтвердить заказ и создать платежи
      </button>
      <button
       type="button"
       disabled={isPending}
       onClick={() => setShowFinanceStep(false)}
       className="rounded-md border border-[#E8ECF0] px-4 py-2 text-sm font-medium text-[#1B3A6B] disabled:cursor-not-allowed disabled:opacity-50"
      >
       Отмена
      </button>
     </div>
    </section>
   )}

   <div className="flex flex-col gap-2 rounded-xl border border-[#E8ECF0] bg-white px-4 py-3 text-sm text-[#6B7280] sm:flex-row sm:items-center sm:justify-between">
   <span>
     Заявки {currentFrom}-{currentTo} из {total}. Показано позиций: {filteredItems.length} из {items.length}. Страница {page + 1} из {pageCount}.
    </span>
    <div className="flex gap-2">
     <button
      type="button"
      className="rounded-md border border-[#E8ECF0] px-3 py-1.5 font-medium text-[#1B3A6B] disabled:cursor-not-allowed disabled:opacity-50"
      disabled={page <= 0 || isPending}
      onClick={() => goToPage(page - 1)}
     >
      Назад
     </button>
     <button
      type="button"
      className="rounded-md border border-[#E8ECF0] px-3 py-1.5 font-medium text-[#1B3A6B] disabled:cursor-not-allowed disabled:opacity-50"
      disabled={page + 1 >= pageCount || isPending}
      onClick={() => goToPage(page + 1)}
     >
      Вперёд
     </button>
    </div>
   </div>

   {grouped.length === 0 ? (
    <div className="rounded-xl border border-[#E8ECF0] bg-white p-10 text-center text-[#9CA3AF]">
     {emptyMessage ||
      (items.length === 0
      ? 'На этой странице нет позиций к заказу.'
      : hasActiveFilters
        ? 'Позиций к заказу по выбранным фильтрам нет.'
        : 'Позиций к заказу нет.')}
    </div>
   ) : (
    grouped.map((group) => (
     <OrderDateGroup
      key={group.dateKey}
      dateKey={group.dateKey}
      groups={group.groups}
      suppliers={suppliers}
            selected={selected}
            onToggle={toggle}
      readOnly={!showActions}
     />
    ))
   )}
  </div>
 )
}
