'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { addMesh, deleteMesh, updateMesh, type WithMaterialName } from '@/lib/actions/technologist-requests'
import { InlineEditCell } from './InlineEditCell'
import { MaterialSearch, type MaterialSelectionSource } from './MaterialSearch'
import { canEditMaterialCharacteristics, isCustomVariantSource } from './materialVariantMode'
import type { MaterialWithSupplier } from '@/lib/actions/materials'
import type { MeshInput } from '@/lib/types/request-schemas'
import type { MaterialVariant, RequestMesh } from '@/lib/types'

type MeshRow = WithMaterialName<RequestMesh>
type MeshPatch = Partial<MeshInput> & { is_custom_material_variant?: boolean }

type Props = {
  requestId: string
  items: MeshRow[]
  isEditable: boolean
  onRowsChange?: (rows: MeshRow[]) => void
}

function toNumber(value: string | number | null) {
  if (value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function materialDisplayName(row: MeshRow) {
  return row.materials?.name ?? ''
}

export function MeshSection({ requestId, items, isEditable, onRowsChange }: Props) {
  const [rows, setRows] = useState(items)
  const [materialNames, setMaterialNames] = useState<Record<string, string>>({})

  useEffect(() => {
    setRows(items)
    onRowsChange?.(items)
  }, [items, onRowsChange])

  const applyRows = (nextRows: MeshRow[]) => {
    setRows(nextRows)
    onRowsChange?.(nextRows)
  }

  const handleAdd = async () => {
    const result = await addMesh(requestId, {
      description: null,
      length_mm: null,
      width_mm: null,
      remainder_qty: 0,
    })
    if (!result.success || !result.data) {
      toast.error(result.error || 'Ошибка при добавлении')
      return
    }
    applyRows([...rows, result.data as MeshRow])
    toast.success('Позиция добавлена')
  }

  const handleUpdate = async (id: string, patch: MeshPatch) => {
    const previous = rows
    const nextRows = rows.map((row) => row.id === id ? ({ ...row, ...patch } as MeshRow) : row)
    applyRows(nextRows)
    const result = await updateMesh(id, patch)
    if (!result.success) {
      applyRows(previous)
      toast.error(result.error || 'Ошибка при сохранении')
      return
    }
    if (result.data) {
      applyRows(nextRows.map((row) => row.id === id ? ({ ...row, ...(result.data as MeshRow) }) : row))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить позицию?')) return
    const previous = rows
    applyRows(rows.filter((row) => row.id !== id))
    const result = await deleteMesh(id)
    if (!result.success) {
      applyRows(previous)
      toast.error(result.error || 'Ошибка при удалении')
      return
    }
    toast.success('Позиция удалена')
  }

  const selectMaterial = (row: MeshRow, material: MaterialWithSupplier, variant: MaterialVariant | undefined, source: MaterialSelectionSource) => {
    const isCustomVariant = isCustomVariantSource(source)
    setMaterialNames((current) => ({ ...current, [row.id]: material.name }))
    const updates: MeshPatch = {
      material_id: material.id,
      material_variant_id: variant?.id ?? null,
      is_custom_material_variant: isCustomVariant,
    }
    if (variant?.mesh_description) updates.description = variant.mesh_description
    if (variant?.mesh_length_mm) updates.length_mm = variant.mesh_length_mm
    if (variant?.mesh_width_mm) updates.width_mm = variant.mesh_width_mm
    void handleUpdate(row.id, updates)
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-[920px] w-full text-sm">
          <thead className="bg-slate-50 text-sm font-medium text-gray-500">
            <tr>
              <th className="min-w-[200px] px-3 py-2 text-left">Материал</th>
              <th className="min-w-[200px] px-3 py-2 text-left">Характеристика решетки</th>
              <th className="min-w-[120px] px-3 py-2 text-left">Длина, мм</th>
              <th className="min-w-[120px] px-3 py-2 text-left">Ширина, мм</th>
              <th className="min-w-[100px] px-3 py-2 text-left">Необходимо, шт</th>
              <th className="w-[60px] px-3 py-2 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const canEditCharacteristics = canEditMaterialCharacteristics(row, isEditable)
              return (
              <tr key={row.id} className="border-b last:border-b-0">
                <td className="px-3 py-2">
                  <MaterialSearch category="mesh" value={materialNames[row.id] ?? materialDisplayName(row)} initialValue={materialDisplayName(row)} selectedMaterialId={row.material_id} disabled={!isEditable} compact onSelect={(material, variant, source) => selectMaterial(row, material, variant, source)} />
                </td>
                <td className="px-3 py-2"><InlineEditCell value={row.description} disabled={!canEditCharacteristics} onSave={(value) => handleUpdate(row.id, { description: value === null ? null : String(value) })} /></td>
                <td className="px-3 py-2"><InlineEditCell value={row.length_mm} type="number" step="0.01" disabled={!canEditCharacteristics} onSave={(value) => handleUpdate(row.id, { length_mm: toNumber(value) })} /></td>
                <td className="px-3 py-2"><InlineEditCell value={row.width_mm} type="number" step="0.01" disabled={!canEditCharacteristics} onSave={(value) => handleUpdate(row.id, { width_mm: toNumber(value) })} /></td>
                <td className="px-3 py-2"><InlineEditCell value={row.remainder_qty} type="number" step="1" disabled={!isEditable} onSave={(value) => handleUpdate(row.id, { remainder_qty: Number(value || 0) })} /></td>
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
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
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

export default MeshSection
