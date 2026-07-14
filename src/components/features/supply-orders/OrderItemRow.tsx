'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CalendarDays, FileText, PackageCheck, Plus, Save, Trash2, Warehouse } from 'lucide-react'
import { MATERIAL_CATEGORY_LABELS, ORDER_STATUS_LABELS } from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'
import {
 addOrderDeliverySchedule,
 deleteOrderDeliverySchedule,
 receiveOrderDeliverySchedule,
 updateOrderCustomDeliveryDate,
 updateOrderDeliverySchedule,
 updateOrderSupplier,
 type SupplyOrderDeliverySchedule,
 type SupplyOrderItem,
} from '@/lib/actions/supply-orders'
import { reserveForMachine, unreserveFromMachine } from '@/lib/actions/inventory'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'

type OrderItemRowProps = {
 item: SupplyOrderItem
 suppliers: SupplierWithRelations[]
 checked: boolean
 onToggle: () => void
 readOnly?: boolean
}

const statusVariant = {
 pending: 'secondary',
 ordered: 'default',
 delivered: 'outline',
} as const

export function OrderItemRow({ item, suppliers, checked, onToggle, readOnly = false }: OrderItemRowProps) {
 const router = useRouter()
 const [isPending, startTransition] = useTransition()
 const canSelect = !readOnly && item.to_order > 0
 const isCoveredByStock = item.to_order <= 0 && item.reserved_quantity > 0
 const lengthStockItems = useMemo(() => item.stock_items.filter((row) => row.piece_length_mm !== null), [item.stock_items])
 const lengthStockKey = useMemo(() => lengthStockItems.map((row) => `${row.id}:${row.piece_length_mm}`).join('|'), [lengthStockItems])
 const defaultPieceLength = useMemo(() => {
  if (lengthStockItems.length !== 1) return ''
  const only = lengthStockItems[0]?.piece_length_mm
  return only === null || only === undefined ? '' : String(only)
 }, [lengthStockItems])
 const [pieceLengthState, setPieceLengthState] = useState(() => ({ key: lengthStockKey, value: defaultPieceLength }))
 const pieceLength = pieceLengthState.key === lengthStockKey ? pieceLengthState.value : defaultPieceLength
 const setPieceLength = (value: string) => setPieceLengthState({ key: lengthStockKey, value })
 const lengthRequiresChoice = lengthStockItems.length > 1
 const [newSchedule, setNewSchedule] = useState({
  delivery_date: item.target_delivery_date || '',
  quantity: '',
  supplier_id: item.supplier_id || '',
 })
 const scheduleKey = useMemo(() => item.delivery_schedules.map((schedule) => `${schedule.id}:${schedule.delivery_date}:${schedule.quantity}:${schedule.supplier_id || ''}:${schedule.change_reason || ''}:${schedule.status}`).join('|'), [item.delivery_schedules])
 const defaultScheduleDrafts = useMemo(() => makeScheduleDrafts(item.delivery_schedules), [item.delivery_schedules])
 const [scheduleDraftState, setScheduleDraftState] = useState(() => ({ key: scheduleKey, drafts: defaultScheduleDrafts }))
 const scheduleDrafts = scheduleDraftState.key === scheduleKey ? scheduleDraftState.drafts : defaultScheduleDrafts
 const setScheduleDrafts = (updater: (drafts: ReturnType<typeof makeScheduleDrafts>) => ReturnType<typeof makeScheduleDrafts>) => {
  setScheduleDraftState((current) => ({
   key: scheduleKey,
   drafts: updater(current.key === scheduleKey ? current.drafts : defaultScheduleDrafts),
  }))
 }

 const saveSupplier = (supplierId: string) => {
  startTransition(async () => {
   const result = await updateOrderSupplier({ table: item.table, id: item.id, material_id: item.material_id }, supplierId === 'none' ? null : supplierId)
   if (!result.success) toast.error(result.error || 'Не удалось назначить поставщика')
  })
 }

 const saveDate = (date: string) => {
  startTransition(async () => {
   const result = await updateOrderCustomDeliveryDate({ table: item.table, id: item.id }, date || null)
   if (!result.success) toast.error(result.error || 'Не удалось обновить дату')
  })
 }

 const addSchedule = () => {
  const quantity = Number(newSchedule.quantity)
  startTransition(async () => {
   const result = await addOrderDeliverySchedule(
    { table: item.table, id: item.id },
    {
     delivery_date: newSchedule.delivery_date,
     quantity,
     supplier_id: newSchedule.supplier_id || null,
    }
   )
   if (!result.success) {
    toast.error(result.error || 'Не удалось добавить дату поставки')
    return
   }
   toast.success('Дата поставки добавлена')
   setNewSchedule({ delivery_date: '', quantity: '', supplier_id: item.supplier_id || '' })
   router.refresh()
  })
 }

 const updateSchedule = (schedule: SupplyOrderDeliverySchedule) => {
  const draft = scheduleDrafts[schedule.id]
  if (!draft) return
  startTransition(async () => {
   const result = await updateOrderDeliverySchedule(schedule.id, {
    delivery_date: draft.delivery_date,
    quantity: Number(draft.quantity),
    supplier_id: draft.supplier_id || null,
    change_reason: draft.change_reason,
   })
   if (!result.success) {
    toast.error(result.error || 'Не удалось обновить дату поставки')
    return
   }
   toast.success('Дата поставки обновлена')
   router.refresh()
  })
 }

 const receiveSchedule = (schedule: SupplyOrderDeliverySchedule) => {
  startTransition(async () => {
   const result = await receiveOrderDeliverySchedule(schedule.id)
   if (!result.success) {
    toast.error(result.error || 'Не удалось принять поставку')
    return
   }
   toast.success('Поставка принята на склад')
   router.refresh()
  })
 }

 const deleteSchedule = (schedule: SupplyOrderDeliverySchedule) => {
  startTransition(async () => {
   const result = await deleteOrderDeliverySchedule(schedule.id)
   if (!result.success) {
    toast.error(result.error || 'Не удалось удалить дату поставки')
    return
   }
   toast.success('Дата поставки удалена')
   router.refresh()
  })
 }

 const reserve = () => {
  if (!item.material_id) {
   toast.error('Материал не привязан к справочнику')
   return
  }
  if (lengthRequiresChoice && !pieceLength) {
   toast.error('Выберите длину складской позиции')
   return
  }
  startTransition(async () => {
   const result = await reserveForMachine({
    material_id: item.material_id!,
    material_variant_id: item.material_variant_id,
    piece_length_mm: pieceLength ? Number(pieceLength) : null,
    machine_id: item.machine_id,
    quantity: item.to_order,
    secondary_quantity: item.secondary_requested_quantity !== null
     ? Math.max((item.secondary_requested_quantity || 0) - (item.secondary_reserved_quantity || 0), 0)
     : null,
    request_item_table: item.table,
    request_item_id: item.id,
   })
   if (!result.success) toast.error(result.error || 'Не удалось забронировать материал')
   else toast.success('Материал забронирован')
  })
 }

 const unreserve = () => {
  if (!item.reservation_id) return
  startTransition(async () => {
   const result = await unreserveFromMachine(item.reservation_id!)
   if (!result.success) toast.error(result.error || 'Не удалось снять бронь')
   else toast.success('Бронь снята')
  })
 }

 return (
  <article className="relative grid grid-cols-1 items-start gap-3 border-t border-border/60 p-4 text-sm transition-colors duration-200 hover:bg-muted/20 motion-reduce:transition-none sm:grid-cols-2 xl:grid-cols-[44px_minmax(210px,1.2fr)_96px_170px_170px_190px_200px_132px] xl:items-center">
   <label className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-muted max-xl:absolute max-xl:ml-1 max-xl:mt-1">
    <input
     type="checkbox"
     checked={canSelect && checked}
     disabled={!canSelect}
     onChange={onToggle}
     className="h-5 w-5 rounded border-border accent-primary disabled:cursor-not-allowed disabled:opacity-40"
    />
    <span className="sr-only">Выбрать {item.item_name} для машины {item.machine_name}</span>
   </label>
   <div className="min-w-0 rounded-xl bg-muted/25 p-3 pl-10 xl:bg-transparent xl:p-0">
    <Link href={`${ROUTES.SALES_PLAN}/${item.machine_id}`} className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
     {item.machine_name}
    </Link>
    <div className="mt-1 break-words font-medium text-foreground">{item.item_name}</div>
    <Badge variant="outline" className="mt-2 border-border bg-background text-muted-foreground">{MATERIAL_CATEGORY_LABELS[item.category]}</Badge>
   </div>
   <Link
    href={`${ROUTES.SUPPLY_REQUEST}/${item.request_id}`}
    className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-border bg-background px-3 text-xs font-medium text-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    title="Открыть заявку для снабжения"
   >
    <FileText className="h-4 w-4" />
    Заявка
   </Link>
   <select
   value={item.supplier_id || 'none'}
    aria-label={`Поставщик для ${item.item_name}`}
    disabled={isPending || readOnly || isCoveredByStock}
    onChange={(event) => saveSupplier(event.target.value)}
    className="h-11 min-w-0 rounded-xl border border-border bg-background px-3 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
   >
    <option value="none">Не назначен</option>
    {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
   </select>
   {isCoveredByStock ? (
    <div className="flex min-h-11 items-center rounded-xl bg-emerald-500/10 px-3 text-xs font-medium text-emerald-700">Поставка не нужна</div>
   ) : item.delivery_schedules.length === 0 ? (
    <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
     Дата поставки
     <input
      type="date"
      defaultValue={item.target_delivery_date || ''}
      disabled={isPending || readOnly}
      onBlur={(event) => saveDate(event.target.value)}
      className="h-11 min-w-0 rounded-xl border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
     />
     {item.is_custom_delivery_date && <span className="text-[11px] text-amber-700">Ручная дата</span>}
    </label>
   ) : (
    <div className="flex min-h-11 flex-col justify-center rounded-xl bg-sky-500/10 px-3 text-xs text-sky-800">
     <div>По графику</div>
     <div className="font-semibold">{item.delivery_schedules.length} дат</div>
    </div>
   )}
   <div className="rounded-xl border border-border/60 bg-background p-3 font-medium text-foreground xl:border-0 xl:bg-transparent xl:p-0">
    <div className="text-xs font-normal text-muted-foreground">К заказу</div>
    <div className="mt-1 font-semibold tabular-nums">{formatAmount(item.to_order)} {item.unit}</div>
    {item.calculated_weight_kg && <div className="text-xs font-normal text-muted-foreground">Вес: {formatAmount(item.calculated_weight_kg)} кг</div>}
    <div className="text-xs font-normal text-muted-foreground">Заявка: {formatAmount(item.requested_quantity)} {item.unit}</div>
    {item.reserved_quantity > 0 && <div className="text-xs font-normal text-emerald-700">Бронь: {formatAmount(item.reserved_quantity)} {item.unit}</div>}
   </div>
   <div className="rounded-xl border border-border/60 bg-background p-3 text-xs text-muted-foreground xl:border-0 xl:bg-transparent xl:p-0">
    {item.stock_available !== null ? (
     <>
      <div className="flex items-center gap-1"><Warehouse className="h-3.5 w-3.5" />На складе доступно</div>
      {stockBreakdown(item) || <div className="mt-1 font-semibold tabular-nums text-foreground">{formatAmount(item.stock_available)} {item.stock_unit || item.unit}</div>}
      {lengthRequiresChoice && !item.reservation_id && (
       <select
        value={pieceLength}
        disabled={isPending || readOnly}
        onChange={(event) => setPieceLength(event.target.value)}
        aria-label={`Длина складской позиции для ${item.item_name}`}
        className="mt-2 h-10 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground"
       >
        <option value="">Выберите длину</option>
        {lengthStockItems.map((row) => (
         <option key={row.id} value={String(row.piece_length_mm)}>
          {formatAmount(row.piece_length_mm ?? 0)} мм
         </option>
        ))}
       </select>
      )}
     </>
    ) : (
     <span>Нет остатка</span>
    )}
    {item.reservation_id ? (
     <button type="button" disabled={isPending || readOnly} onClick={unreserve} className="mt-2 min-h-8 font-medium text-orange-700 hover:underline disabled:text-muted-foreground">Снять бронь</button>
    ) : (
     <button type="button" disabled={isPending || readOnly || !item.material_id || item.to_order <= 0 || (lengthRequiresChoice && !pieceLength)} onClick={reserve} className="mt-2 min-h-8 font-medium text-primary hover:underline disabled:text-muted-foreground">Забронировать</button>
    )}
   </div>
   {isCoveredByStock ? (
    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Закрыто складом</Badge>
   ) : item.supplier_id ? (
    <Badge variant={statusVariant[item.order_status]}>{ORDER_STATUS_LABELS[item.order_status]}</Badge>
   ) : (
    <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Не назначен</Badge>
   )}
   {!isCoveredByStock && <div className="col-span-full rounded-xl border border-border/70 bg-muted/25 p-3">
    <div className="mb-2 flex items-center justify-between gap-3">
     <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground"><CalendarDays className="h-4 w-4 text-primary" />График поставок</div>
     <div className="text-xs text-muted-foreground">
      Запланировано: {formatAmount(item.delivery_schedules.reduce((sum, schedule) => sum + Number(schedule.quantity || 0), 0))} / {formatAmount(item.to_order)} {item.unit}
     </div>
    </div>
    <div className="space-y-2">
     {item.delivery_schedules.map((schedule) => {
      const draft = scheduleDrafts[schedule.id] || {
       delivery_date: schedule.delivery_date,
       quantity: String(schedule.quantity),
       supplier_id: schedule.supplier_id || '',
       change_reason: '',
      }
      const dateChanged = draft.delivery_date !== schedule.delivery_date
      return (
       <div key={schedule.id} className="grid gap-2 rounded-xl border border-border/70 bg-background p-3 text-xs sm:grid-cols-2 xl:grid-cols-[100px_150px_130px_190px_minmax(180px,1fr)_260px] xl:items-end">
        <Badge variant={schedule.status === 'delivered' ? 'outline' : 'secondary'}>{schedule.status === 'delivered' ? 'Принято' : 'План'}</Badge>
        <input aria-label="Дата в графике" type="date" value={draft.delivery_date} disabled={isPending || readOnly || schedule.status === 'delivered'} onChange={(event) => setScheduleDrafts((prev) => ({ ...prev, [schedule.id]: { ...draft, delivery_date: event.target.value } }))} className="h-11 rounded-lg border border-border bg-background px-2" />
        <input aria-label={`Количество в графике, ${item.unit}`} type="number" min="0" step="0.01" value={draft.quantity} disabled={isPending || readOnly || schedule.status === 'delivered'} onChange={(event) => setScheduleDrafts((prev) => ({ ...prev, [schedule.id]: { ...draft, quantity: event.target.value } }))} className="h-11 rounded-lg border border-border bg-background px-2" />
        <select aria-label="Поставщик в графике" value={draft.supplier_id} disabled={isPending || readOnly || schedule.status === 'delivered'} onChange={(event) => setScheduleDrafts((prev) => ({ ...prev, [schedule.id]: { ...draft, supplier_id: event.target.value } }))} className="h-11 min-w-0 rounded-lg border border-border bg-background px-2">
         <option value="">Поставщик позиции</option>
         {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
        <input aria-label="Комментарий к изменению графика" type="text" value={draft.change_reason} disabled={isPending || readOnly || schedule.status === 'delivered'} onChange={(event) => setScheduleDrafts((prev) => ({ ...prev, [schedule.id]: { ...draft, change_reason: event.target.value } }))} placeholder={dateChanged ? 'Причина изменения даты' : 'Комментарий к изменению'} className="h-11 min-w-0 rounded-lg border border-border bg-background px-2" />
        {schedule.status === 'delivered' ? (
         <div className="text-[#64748B]">{schedule.delivered_at ? `Приход: ${new Date(schedule.delivered_at).toLocaleDateString('ru-RU')}` : 'Принято'}</div>
        ) : (
         <div className="grid grid-cols-3 gap-1">
          <Button type="button" variant="outline" size="sm" className="min-h-10 px-2" disabled={isPending || readOnly || (dateChanged && !draft.change_reason.trim())} onClick={() => updateSchedule(schedule)}><Save className="h-3.5 w-3.5" /><span className="sr-only sm:not-sr-only">Сохранить</span></Button>
          <Button type="button" variant="outline" size="sm" className="min-h-10 border-destructive/30 px-2 text-destructive" disabled={isPending || readOnly} onClick={() => deleteSchedule(schedule)}><Trash2 className="h-3.5 w-3.5" /><span className="sr-only sm:not-sr-only">Удалить</span></Button>
          <Button type="button" size="sm" className="min-h-10 bg-emerald-700 px-2 text-white hover:bg-emerald-800" disabled={isPending || readOnly || item.order_status !== 'ordered'} onClick={() => receiveSchedule(schedule)}><PackageCheck className="h-3.5 w-3.5" /><span className="sr-only sm:not-sr-only">Принять</span></Button>
         </div>
        )}
       </div>
      )
     })}
     <div className="grid gap-2 rounded-xl border border-dashed border-border bg-background/70 p-3 text-xs sm:grid-cols-2 xl:grid-cols-[150px_130px_200px_130px] xl:items-end">
      <input aria-label="Новая дата поставки" type="date" value={newSchedule.delivery_date} disabled={isPending || readOnly || item.order_status === 'delivered'} onChange={(event) => setNewSchedule((prev) => ({ ...prev, delivery_date: event.target.value }))} className="h-11 rounded-lg border border-border bg-background px-2" />
      <input aria-label={`Новое количество, ${item.unit}`} type="number" min="0" step="0.01" value={newSchedule.quantity} disabled={isPending || readOnly || item.order_status === 'delivered'} onChange={(event) => setNewSchedule((prev) => ({ ...prev, quantity: event.target.value }))} placeholder={`Кол-во, ${item.unit}`} className="h-11 rounded-lg border border-border bg-background px-2" />
      <select aria-label="Поставщик новой поставки" value={newSchedule.supplier_id} disabled={isPending || readOnly || item.order_status === 'delivered'} onChange={(event) => setNewSchedule((prev) => ({ ...prev, supplier_id: event.target.value }))} className="h-11 min-w-0 rounded-lg border border-border bg-background px-2">
       <option value="">Поставщик позиции</option>
       {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
      </select>
      <Button type="button" disabled={isPending || readOnly || item.order_status === 'delivered' || !newSchedule.delivery_date || !newSchedule.quantity} onClick={addSchedule} className="min-h-11"><Plus className="h-4 w-4" />Добавить</Button>
     </div>
    </div>
   </div>}
  </article>
 )
}

function formatAmount(value: number) {
 return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}

function makeScheduleDrafts(schedules: SupplyOrderDeliverySchedule[]) {
 return Object.fromEntries(schedules.map((schedule) => [
  schedule.id,
  {
   delivery_date: schedule.delivery_date,
   quantity: String(schedule.quantity),
   supplier_id: schedule.supplier_id || '',
   change_reason: '',
  },
 ]))
}

function stockBreakdown(item: SupplyOrderItem) {
 const isPieceCategory = item.category === 'pipe' || item.category === 'knives'
 const lengthItems = isPieceCategory ? item.stock_items.filter((row) => row.piece_length_mm !== null) : []
 if (lengthItems.length === 0) return null
 return (
  <div className="mt-1 space-y-1 font-medium text-foreground">
   {lengthItems.map((row) => (
    <div key={row.id}>
     {formatAmount(row.piece_length_mm ?? 0)} мм × {formatAmount(row.total_quantity)} {row.unit || item.unit}
     <span className="font-normal text-muted-foreground"> (доступно: {formatAmount(row.available_quantity)} {row.unit || item.unit})</span>
    </div>
   ))}
  </div>
 )
}
