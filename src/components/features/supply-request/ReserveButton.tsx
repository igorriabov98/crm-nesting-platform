'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Pin } from 'lucide-react'
import { reserveItemFromStock } from '@/lib/actions/supply-request'
import type { SupplyStockItem } from '@/lib/actions/supply-request'

type ReserveButtonProps = {
  table: 'request_sheet_metal' | 'request_round_tube' | 'request_circle' | 'request_pipe' | 'request_knives' | 'request_components' | 'request_paint' | 'request_mesh' | 'request_chain_cord'
  itemId: string
  materialId: string | null
  machineId: string
  needed: number
  reserved: number
  covered?: number
  available: number | null
  unit: string
  stockItems?: SupplyStockItem[]
}

export function ReserveButton({ table, itemId, materialId, machineId, needed, reserved, covered, available, unit, stockItems = [] }: ReserveButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const selectableStockItems = useMemo(
    () => stockItems.filter((item) => Number(item.available_quantity || 0) > 0),
    [stockItems],
  )
  const defaultStockItem = useMemo(
    () => selectableStockItems.find((item) => item.is_local_factory)
      || selectableStockItems.find((item) => Number(item.available_quantity || 0) > 0)
      || selectableStockItems[0]
      || null,
    [selectableStockItems],
  )
  const localStockItems = useMemo(
    () => selectableStockItems.filter((item) => item.is_local_factory),
    [selectableStockItems],
  )
  const remoteStockGroups = useMemo(() => {
    const groups = new Map<string, SupplyStockItem[]>()
    for (const item of selectableStockItems.filter((stock) => !stock.is_local_factory)) {
      groups.set(item.factory_name, [...(groups.get(item.factory_name) || []), item])
    }
    return [...groups.entries()]
  }, [selectableStockItems])
  const [selectedStockId, setSelectedStockId] = useState(() => defaultStockItem?.id || '')
  const selectedStock = useMemo(() => {
    if (!selectedStockId) return defaultStockItem
    return selectableStockItems.find((item) => item.id === selectedStockId) || defaultStockItem
  }, [defaultStockItem, selectableStockItems, selectedStockId])
  const effectiveAvailable = selectedStock ? selectedStock.available_quantity : available
  const hasAvailableStock = Number(effectiveAvailable || 0) > 0
  const remaining = Math.max(needed - (covered ?? reserved), 0)
  const suggested = useMemo(() => Math.max(Math.min(remaining, effectiveAvailable || 0), 0), [effectiveAvailable, remaining])
  const [quantity, setQuantity] = useState(() => suggested > 0 ? String(Number(suggested.toFixed(2))) : '')

  if (!materialId) return <span className="text-xs text-amber-700">Материал не привязан</span>
  if (remaining <= 0) return <span className="text-xs text-slate-400">Забронировано</span>

  const submit = () => {
    if (!hasAvailableStock) {
      toast.error('Нет доступного остатка для бронирования')
      return
    }
    const value = Number(quantity)
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Введите количество для бронирования')
      return
    }
    if (selectedStock && !selectedStock.is_local_factory) {
      const confirmed = window.confirm(
        `Выбран склад «${selectedStock.factory_name}». После бронирования будет создана межзаводская перевозка. Продолжить?`,
      )
      if (!confirmed) return
    }
    startTransition(async () => {
      const result = await reserveItemFromStock({
        request_item_table: table,
        request_item_id: itemId,
        inventory_id: selectedStock?.id || '',
        material_id: materialId,
        material_variant_id: selectedStock?.material_variant_id ?? null,
        machine_id: machineId,
        quantity: value,
        piece_length_mm: selectedStock?.piece_length_mm ?? null,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось забронировать')
        return
      }
      toast.success(selectedStock && !selectedStock.is_local_factory
        ? 'Материал забронирован, перевозка создана'
        : 'Материал забронирован')
      router.refresh()
    })
  }

  return (
    <div className="min-w-[230px] space-y-1.5">
      <div className="flex items-center gap-1">
      {selectableStockItems.length > 1 && (
        <select
          value={selectedStock?.id || ''}
          disabled={isPending || !hasAvailableStock}
          onChange={(event) => {
            const next = event.target.value
            setSelectedStockId(next)
            const nextStock = selectableStockItems.find((item) => item.id === next)
            const nextSuggested = Math.max(Math.min(remaining, nextStock?.available_quantity || 0), 0)
            setQuantity(nextSuggested > 0 ? String(Number(nextSuggested.toFixed(2))) : '')
          }}
          className="h-8 w-44 rounded-md border border-[#E8ECF0] px-2 text-xs"
          aria-label="Складской остаток и завод"
        >
          {localStockItems.length > 0 && (
            <optgroup label="Склад завода машины">
              {localStockItems.map((item) => (
                <option key={item.id} value={item.id}>{formatStockItemOption(item, unit)}</option>
              ))}
            </optgroup>
          )}
          {remoteStockGroups.map(([factoryName, items]) => (
            <optgroup key={factoryName} label={`Остатки других заводов · ${factoryName}`}>
              {items.map((item) => (
                <option key={item.id} value={item.id}>{formatStockItemOption(item, unit)}</option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      <input
        type="number"
        min={0}
        max={Math.min(remaining, effectiveAvailable || 0)}
        step="0.01"
        value={quantity}
        disabled={isPending || !hasAvailableStock}
        onChange={(event) => setQuantity(event.target.value)}
        className="h-8 w-24 rounded-md border border-[#E8ECF0] px-2 text-sm disabled:bg-slate-50"
        aria-label={`Забронировать ${unit}`}
        placeholder={hasAvailableStock ? '0' : 'Нет'}
      />
      <button
        type="button"
        onClick={submit}
        disabled={isPending || suggested <= 0}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#1B3A6B] text-white hover:bg-[#254B87] disabled:opacity-50"
        title={hasAvailableStock ? 'Забронировать' : 'Нет доступного остатка'}
      >
        <Pin className="h-4 w-4" />
      </button>
      </div>
      {selectedStock && !selectedStock.is_local_factory && (
        <div className="flex max-w-[330px] items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Подтвердите маршрут: склад {selectedStock.factory_name} → склад завода машины.
            После бронирования будет создана перевозка.
          </span>
        </div>
      )}
    </div>
  )
}

function formatPieceLength(value: number | null) {
  const length = Number(value || 0)
  if (length > 0 && length % 1000 === 0) return `${length / 1000} м`
  return `${length} мм`
}

function formatStockItemOption(item: SupplyStockItem, fallbackUnit: string) {
  const prefix = item.is_business_scrap ? 'Отход ' : ''
  const piece = item.piece_length_mm !== null ? `${formatPieceLength(item.piece_length_mm)} ` : ''
  const label = item.label ? `${item.label} ` : ''
  return `${item.factory_name}: ${prefix}${piece}${label}(${formatStockQuantity(item.available_quantity, item.unit || fallbackUnit, item.available_secondary_quantity, item.secondary_unit)})`
}

function formatStockQuantity(quantity: number, unit: string, secondaryQuantity: number | null, secondaryUnit: string | null) {
  const primary = `${formatAmount(quantity)} ${unit}`
  if (secondaryQuantity === null || secondaryQuantity === undefined || !secondaryUnit) return primary
  return `${primary} / ${formatAmount(secondaryQuantity)} ${secondaryUnit}`
}

function formatAmount(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}
