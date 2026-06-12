'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PAINT_FINISH_OPTIONS } from '@/lib/constants/procurement'
import { addPaint, deletePaint, updatePaint, type WithMaterialName } from '@/lib/actions/technologist-requests'
import { InlineEditCell } from './InlineEditCell'
import { MaterialSearch, type MaterialSelectionSource } from './MaterialSearch'
import { canEditMaterialCharacteristics, isCustomVariantSource } from './materialVariantMode'
import type { MaterialWithSupplier } from '@/lib/actions/materials'
import type { MaterialVariant, RequestPaint } from '@/lib/types'
import type { PaintInput } from '@/lib/types/request-schemas'

type PaintRow = WithMaterialName<RequestPaint>
type PaintPatch = Partial<PaintInput> & { is_custom_material_variant?: boolean }

type Props = {
  requestId: string
  items: PaintRow[]
  canEdit: boolean
  canEditStock?: boolean
  onRowsChange?: (rows: PaintRow[]) => void
}

function materialDisplayName(row: PaintRow) {
  return row.materials?.name || row.paint_type || row.ral_code || ''
}

export function PaintSection({ requestId, items, canEdit, onRowsChange }: Props) {
  const [rows, setRows] = useState(items)
  const [materialNames, setMaterialNames] = useState<Record<string, string>>({})

  useEffect(() => {
    setRows(items)
    onRowsChange?.(items)
  }, [items, onRowsChange])

  const applyRows = (nextRows: PaintRow[]) => {
    setRows(nextRows)
    onRowsChange?.(nextRows)
  }

  const handleAdd = async () => {
    const result = await addPaint(requestId, {
      paint_type: null,
      ral_code: null,
      finish: undefined,
      remainder_kg: 0,
    })
    if (!result.success || !result.data) {
      toast.error(result.error || 'Ошибка при добавлении')
      return
    }
    applyRows([...rows, result.data as PaintRow])
    toast.success('Позиция добавлена')
  }

  const handleUpdate = async (id: string, patch: PaintPatch) => {
    const previous = rows
    const nextRows = rows.map((row) => row.id === id ? ({ ...row, ...patch } as PaintRow) : row)
    applyRows(nextRows)
    const result = await updatePaint(id, patch)
    if (!result.success) {
      applyRows(previous)
      toast.error(result.error || 'Ошибка при сохранении')
      return
    }
    if (result.data) {
      applyRows(nextRows.map((row) => row.id === id ? ({ ...row, ...(result.data as PaintRow) }) : row))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить позицию?')) return
    const previous = rows
    applyRows(rows.filter((row) => row.id !== id))
    const result = await deletePaint(id)
    if (!result.success) {
      applyRows(previous)
      toast.error(result.error || 'Ошибка при удалении')
      return
    }
    toast.success('Позиция удалена')
  }

  const selectMaterial = (row: PaintRow, material: MaterialWithSupplier, variant: MaterialVariant | undefined, source: MaterialSelectionSource) => {
    const isCustomVariant = isCustomVariantSource(source)
    setMaterialNames((current) => ({ ...current, [row.id]: material.name }))
    const updates: PaintPatch = {
      material_id: material.id,
      material_variant_id: variant?.id ?? null,
      paint_type: material.name,
      is_custom_material_variant: isCustomVariant,
    }
    if (variant?.ral_code) updates.ral_code = variant.ral_code
    if (variant?.finish && PAINT_FINISH_OPTIONS.includes(variant.finish as typeof PAINT_FINISH_OPTIONS[number])) {
      updates.finish = variant.finish as typeof PAINT_FINISH_OPTIONS[number]
    }
    void handleUpdate(row.id, updates)
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-[760px] w-full text-sm">
          <thead className="bg-slate-50 text-sm font-medium text-gray-500">
            <tr>
              <th className="min-w-[200px] px-3 py-2 text-left">Материал</th>
              <th className="min-w-[100px] px-3 py-2 text-left">RAL</th>
              <th className="min-w-[140px] px-3 py-2 text-left">Тип покрытия</th>
              <th className="min-w-[100px] px-3 py-2 text-left">Необходимо, кг</th>
              <th className="w-[60px] px-3 py-2 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const canEditCharacteristics = canEditMaterialCharacteristics(row, canEdit)
              return (
              <tr key={row.id} className="border-b last:border-b-0">
                <td className="px-3 py-2">
                  <MaterialSearch category="paint" value={materialNames[row.id] ?? materialDisplayName(row)} initialValue={materialDisplayName(row)} selectedMaterialId={row.material_id} disabled={!canEdit} compact onSelect={(material, variant, source) => selectMaterial(row, material, variant, source)} />
                </td>
                <td className="px-3 py-2"><InlineEditCell value={row.ral_code} disabled={!canEditCharacteristics} onSave={(value) => handleUpdate(row.id, { ral_code: value === null ? null : String(value) })} /></td>
                <td className="px-3 py-2">
                  {canEditCharacteristics ? (
                    <select
                      value={row.finish ?? ''}
                      onChange={(event) => void handleUpdate(row.id, { finish: event.target.value ? event.target.value as typeof PAINT_FINISH_OPTIONS[number] : undefined })}
                      className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                    >
                      <option value="">— выберите —</option>
                      {PAINT_FINISH_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : row.finish ?? '—'}
                </td>
                <td className="px-3 py-2"><InlineEditCell value={row.remainder_kg} type="number" step="0.01" disabled={!canEdit} onSave={(value) => handleUpdate(row.id, { remainder_kg: Number(value || 0) })} /></td>
                <td className="px-3 py-2 text-right">
                  {canEdit && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => handleDelete(row.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  )}
                </td>
              </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Нет позиций
                  {canEdit && <Button type="button" variant="outline" size="sm" className="ml-3" onClick={handleAdd}>Добавить</Button>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Добавить позицию
          </Button>
        </div>
      )}
    </div>
  )
}
