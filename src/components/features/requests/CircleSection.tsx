'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { InlineEditCell } from './InlineEditCell'
import { MaterialSearch, type MaterialSelectionSource } from './MaterialSearch'
import { canEditMaterialCharacteristics, isCustomVariantSource } from './materialVariantMode'
import { addCircle, deleteCircle, updateCircle, type WithMaterialName } from '@/lib/actions/technologist-requests'
import type { MaterialWithSupplier } from '@/lib/actions/materials'
import type { CircleInput } from '@/lib/types/request-schemas'
import type { MaterialVariant, RequestCircle } from '@/lib/types'
import type { SteelType } from '@/lib/types/database'

type CircleRow = WithMaterialName<RequestCircle>
type CirclePatch = Partial<CircleInput> & { is_custom_material_variant?: boolean }

type Props = {
  requestId: string
  items: CircleRow[]
  isEditable: boolean
  steelTypes: SteelType[]
}

function toNumber(value: string | number | null) {
  if (value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function materialDisplayName(row: CircleRow) {
  return row.materials?.name ?? ''
}

function formatWeight(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${value} кг`
}

export function CircleSection({ requestId, items, isEditable, steelTypes }: Props) {
  const [rows, setRows] = useState(items)
  const [materialNames, setMaterialNames] = useState<Record<string, string>>({})

  const handleAdd = async () => {
    const result = await addCircle(requestId, {
      diameter_mm: null,
      steel_grade: null,
      is_calibrated: false,
      remainder_mm: 0,
    })
    if (!result.success || !result.data) {
      toast.error(result.error || 'Ошибка при добавлении')
      return
    }
    setRows((current) => [...current, result.data as CircleRow])
    toast.success('Позиция добавлена')
  }

  const handleUpdate = async (id: string, patch: CirclePatch) => {
    const previous = rows
    setRows((current) => current.map((row) => row.id === id ? ({ ...row, ...patch } as CircleRow) : row))
    const result = await updateCircle(id, patch)
    if (!result.success) {
      setRows(previous)
      toast.error(result.error || 'Ошибка при сохранении')
      return
    }
    if (result.data) {
      setRows((current) => current.map((row) => row.id === id ? ({ ...row, ...(result.data as CircleRow) }) : row))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить позицию?')) return
    const previous = rows
    setRows((current) => current.filter((row) => row.id !== id))
    const result = await deleteCircle(id)
    if (!result.success) {
      setRows(previous)
      toast.error(result.error || 'Ошибка при удалении')
      return
    }
    toast.success('Позиция удалена')
  }

  const selectMaterial = (row: CircleRow, material: MaterialWithSupplier, variant: MaterialVariant | undefined, source: MaterialSelectionSource) => {
    const isCustomVariant = isCustomVariantSource(source)
    setMaterialNames((current) => ({ ...current, [row.id]: material.name }))
    const updates: CirclePatch = {
      material_id: material.id,
      material_variant_id: variant?.id ?? null,
      is_custom_material_variant: isCustomVariant,
    }
    if (variant?.diameter_mm) updates.diameter_mm = variant.diameter_mm
    if (variant?.steel_type_id) updates.steel_type_id = variant.steel_type_id
    if (variant?.material_grade ?? material.comment) updates.steel_grade = variant?.material_grade ?? material.comment
    if (variant?.is_calibrated !== null && variant?.is_calibrated !== undefined) updates.is_calibrated = variant.is_calibrated
    void handleUpdate(row.id, updates)
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-[1000px] w-full text-sm">
          <thead className="bg-slate-50 text-sm font-medium text-gray-500">
            <tr>
              <th className="min-w-[200px] px-3 py-2 text-left">Материал</th>
              <th className="min-w-[120px] px-3 py-2 text-left">Диаметр, мм</th>
              <th className="min-w-[120px] px-3 py-2 text-left">Тип стали</th>
              <th className="min-w-[100px] px-3 py-2 text-left">Калибровка</th>
              <th className="min-w-[120px] px-3 py-2 text-left">Необходимо, мм</th>
              <th className="min-w-[100px] px-3 py-2 text-left">Вес, кг</th>
              <th className="w-[60px] px-3 py-2 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const canEditCharacteristics = canEditMaterialCharacteristics(row, isEditable)
              return (
              <tr key={row.id} className="border-b last:border-b-0">
                <td className="px-3 py-2">
                  <MaterialSearch
                    category="circle"
                    value={materialNames[row.id] ?? materialDisplayName(row)}
                    initialValue={materialDisplayName(row)}
                    selectedMaterialId={row.material_id}
                    disabled={!isEditable}
                    compact
                    onSelect={(material, variant, source) => selectMaterial(row, material, variant, source)}
                  />
                </td>
                <td className="px-3 py-2"><InlineEditCell value={row.diameter_mm} type="number" step="0.01" disabled={!canEditCharacteristics} onSave={(value) => handleUpdate(row.id, { diameter_mm: toNumber(value) })} /></td>
                <td className="px-3 py-2">
                  <select
                    value={row.steel_type_id ?? ''}
                    disabled={!canEditCharacteristics}
                    onChange={(event) => void handleUpdate(row.id, { steel_type_id: event.target.value || null })}
                    className="h-9 w-full min-w-[112px] rounded-md border border-slate-200 bg-white px-2 text-sm disabled:cursor-not-allowed disabled:text-slate-500"
                  >
                    <option value="">— не выбрано —</option>
                    {steelTypes.map((steelType) => (
                      <option key={steelType.id} value={steelType.id}>{steelType.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={row.is_calibrated}
                    disabled={!canEditCharacteristics}
                    onChange={(event) => void handleUpdate(row.id, { is_calibrated: event.target.checked })}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </td>
                <td className="px-3 py-2"><InlineEditCell value={row.remainder_mm} type="number" step="0.01" disabled={!isEditable} onSave={(value) => handleUpdate(row.id, { remainder_mm: Number(value || 0) })} /></td>
                <td className="px-3 py-2 text-slate-700">{formatWeight(row.calculated_weight_kg)}</td>
                <td className="px-3 py-2 text-right">
                  {isEditable && (
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
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Нет позиций
                  {isEditable && <Button type="button" variant="outline" size="sm" className="ml-3" onClick={handleAdd}>Добавить</Button>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {isEditable && (
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

export default CircleSection
