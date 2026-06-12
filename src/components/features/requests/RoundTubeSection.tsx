'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { InlineEditCell } from './InlineEditCell'
import { MaterialSearch } from './MaterialSearch'
import { addRoundTube, deleteRoundTube, updateRoundTube } from '@/lib/actions/technologist-requests'
import { cn } from '@/lib/utils'
import type { MaterialVariant, RequestRoundTube, Supplier } from '@/lib/types'
import type { MaterialWithSupplier } from '@/lib/actions/materials'

type Props = { requestId: string; items: RequestRoundTube[]; suppliers?: Supplier[]; canEdit: boolean }
const numberFields = new Set(['order_meters', 'order_kg', 'actual_meters', 'actual_kg'])

function toNumber(value: unknown) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function hasActual(row: RequestRoundTube) {
  return row.actual_meters !== null && row.actual_meters !== undefined || row.actual_kg !== null && row.actual_kg !== undefined
}

function calcScrap(row: RequestRoundTube) {
  const scrapMeters = Math.max(toNumber(row.order_meters) - toNumber(row.actual_meters), 0)
  const scrapKg = Math.max(toNumber(row.order_kg) - toNumber(row.actual_kg), 0)
  const scrapPercent = toNumber(row.order_kg) > 0 ? (scrapKg / toNumber(row.order_kg)) * 100 : 0
  return { scrapMeters, scrapKg, scrapPercent }
}

function readonlyValue(value: number | null, className?: string) {
  return (
    <div className={cn('min-h-8 rounded-md bg-slate-100 px-2 py-1 text-sm font-medium text-slate-700', className)}>
      {value === null ? '—' : value.toFixed(2)}
    </div>
  )
}

function scrapClass(percent: number) {
  if (percent < 10) return 'text-emerald-700'
  if (percent <= 30) return 'text-orange-700'
  return 'text-red-700'
}

function patchIfEmpty<T extends Record<string, unknown>>(row: RequestRoundTube, patch: T) {
  return Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => value !== undefined && value !== null && value !== '' && !row[key as keyof RequestRoundTube])
  ) as Partial<RequestRoundTube>
}

export function RoundTubeSection({ requestId, items, canEdit }: Props) {
  const [rows, setRows] = useState(items)
  const totals = rows.reduce((acc, row) => {
    const scrap = calcScrap(row)
    acc.orderMeters += toNumber(row.order_meters)
    acc.orderKg += toNumber(row.order_kg)
    acc.actualMeters += toNumber(row.actual_meters)
    acc.actualKg += toNumber(row.actual_kg)
    acc.scrapMeters += hasActual(row) ? scrap.scrapMeters : 0
    acc.scrapKg += hasActual(row) ? scrap.scrapKg : 0
    return acc
  }, { orderMeters: 0, orderKg: 0, actualMeters: 0, actualKg: 0, scrapMeters: 0, scrapKg: 0 })
  const averageScrapPercent = totals.orderKg > 0 ? (totals.scrapKg / totals.orderKg) * 100 : null

  const updateRow = async (id: string, field: keyof RequestRoundTube, value: string | number | null) => {
    const previous = rows
    setRows((current) => current.map((row) => row.id === id ? { ...row, [field]: value } : row))
    const result = await updateRoundTube(id, { [field]: value })
    if (!result.success) {
      setRows(previous)
      toast.error(result.error || 'Не удалось сохранить позицию')
    }
  }

  const updateRowPatch = async (id: string, patch: Partial<RequestRoundTube>) => {
    if (Object.keys(patch).length === 0) return
    const previous = rows
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
    const result = await updateRoundTube(id, patch)
    if (!result.success) {
      setRows(previous)
      toast.error(result.error || 'Не удалось сохранить материал')
    }
  }

  const addRow = async () => {
    const result = await addRoundTube(requestId, { material_name: 'Новый материал', order_meters: 0, order_kg: 0, sort_order: rows.length })
    if (!result.success || !result.data) return toast.error(result.error || 'Не удалось добавить позицию')
    setRows((current) => [...current, result.data as RequestRoundTube])
  }

  const selectMaterial = async (row: RequestRoundTube, material: MaterialWithSupplier, variant?: MaterialVariant) => {
    const orderKg = variant?.weight_per_m_kg && variant?.length_m ? Number(variant.weight_per_m_kg) * Number(variant.length_m) : undefined
    await updateRowPatch(row.id, {
      material_name: material.name,
      material_id: material.id,
      material_variant_id: variant?.id || null,
      ...patchIfEmpty(row, {
        order_meters: variant?.length_m,
        order_kg: orderKg,
        piece_count: variant?.piece_description,
      }),
    })
  }

  const removeRow = async (id: string) => {
    if (!confirm('Удалить позицию?')) return
    const previous = rows
    setRows((current) => current.filter((row) => row.id !== id))
    const result = await deleteRoundTube(id)
    if (!result.success) {
      setRows(previous)
      toast.error(result.error || 'Не удалось удалить позицию')
    }
  }

  const cell = (row: RequestRoundTube, field: keyof RequestRoundTube) => (
    <InlineEditCell value={row[field] as string | number | null} type={numberFields.has(String(field)) ? 'number' : 'text'} step="0.01" disabled={!canEdit} onSave={(value) => updateRow(row.id, field, value)} />
  )

  return (
    <div className="space-y-3">
      <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200 pb-2">
        <table className="min-w-[1360px] w-full text-sm [&_td]:align-top">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {['Материал', 'Заявка, м', 'Заявка, кг', 'Факт, м', 'Факт, кг', 'Кол-во', 'Отход, м', 'Отход, кг', 'Отход, %', 'Действия'].map((title, index) => (
                <th key={title} className={index === 0 ? 'sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-medium whitespace-nowrap' : 'px-3 py-2 text-left font-medium whitespace-nowrap'}>{title}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const scrap = calcScrap(row)
              const showScrap = hasActual(row)
              return (
                <tr key={row.id} className="bg-white">
                  <td className="sticky left-0 z-10 w-[360px] min-w-[360px] bg-white px-2 py-1">
                    <MaterialSearch category="round_tube" value={row.material_name} selectedMaterialId={row.material_id} disabled={!canEdit} compact placeholder="Материал..." onSelect={(material, variant) => void selectMaterial(row, material, variant)} />
                  </td>
                  <td className="px-2 py-1">{cell(row, 'order_meters')}</td>
                  <td className="px-2 py-1">{cell(row, 'order_kg')}</td>
                  <td className="px-2 py-1">{cell(row, 'actual_meters')}</td>
                  <td className="px-2 py-1">{cell(row, 'actual_kg')}</td>
                  <td className="px-2 py-1">{cell(row, 'piece_count')}</td>
                  <td className="px-2 py-1">{readonlyValue(showScrap ? scrap.scrapMeters : null)}</td>
                  <td className="px-2 py-1">{readonlyValue(showScrap ? scrap.scrapKg : null)}</td>
                  <td className="px-2 py-1">{readonlyValue(showScrap ? scrap.scrapPercent : null, showScrap ? scrapClass(scrap.scrapPercent) : undefined)}</td>
                  <td className="px-2 py-1 text-right"><Button type="button" variant="ghost" size="icon" disabled={!canEdit} onClick={() => removeRow(row.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button></td>
                </tr>
              )
            })}
            {rows.length === 0 && <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500">Нет позиций. Нажмите + чтобы добавить</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t border-slate-200 bg-slate-50 text-sm font-medium text-slate-700">
              <tr>
                <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Итого</td>
                <td className="px-3 py-2">{totals.orderMeters.toFixed(2)}</td>
                <td className="px-3 py-2">{totals.orderKg.toFixed(2)}</td>
                <td className="px-3 py-2">{totals.actualMeters.toFixed(2)}</td>
                <td className="px-3 py-2">{totals.actualKg.toFixed(2)}</td>
                <td />
                <td className="px-3 py-2">{totals.scrapMeters.toFixed(2)}</td>
                <td className="px-3 py-2">{totals.scrapKg.toFixed(2)}</td>
                <td className="px-3 py-2">{averageScrapPercent === null ? '—' : `${averageScrapPercent.toFixed(2)}%`}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="flex justify-end"><Button type="button" variant="outline" size="sm" disabled={!canEdit} onClick={addRow}><Plus className="mr-2 h-4 w-4" />Добавить позицию</Button></div>
    </div>
  )
}
