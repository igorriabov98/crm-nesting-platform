'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { InlineEditCell } from './InlineEditCell'
import { MaterialSearch, type MaterialSelectionSource } from './MaterialSearch'
import { canEditMaterialCharacteristics, isCustomVariantSource } from './materialVariantMode'
import { addComponent, deleteComponent, updateComponent, type WithMaterialName } from '@/lib/actions/technologist-requests'
import type { MaterialWithSupplier } from '@/lib/actions/materials'
import type { MaterialVariant, RequestComponents } from '@/lib/types'
import type { ComponentInput } from '@/lib/types/request-schemas'

type ComponentRow = WithMaterialName<RequestComponents>
type ComponentPatch = Partial<ComponentInput> & { is_custom_material_variant?: boolean }

type Props = {
  requestId: string
  items: ComponentRow[]
  canEdit: boolean
  canEditStock?: boolean
  onRowsChange?: (rows: ComponentRow[]) => void
}

function toNumber(value: string | number | null) {
  if (value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function materialDisplayName(row: ComponentRow) {
  return row.materials?.name || row.component_name || ''
}

export function ComponentsSection({ requestId, items, canEdit, onRowsChange }: Props) {
  const [rows, setRows] = useState(items)
  const [materialNames, setMaterialNames] = useState<Record<string, string>>({})

  useEffect(() => {
    setRows(items)
    onRowsChange?.(items)
  }, [items, onRowsChange])

  const applyRows = (nextRows: ComponentRow[]) => {
    setRows(nextRows)
    onRowsChange?.(nextRows)
  }

  const handleAdd = async () => {
    const result = await addComponent(requestId, {
      component_name: null,
      diameter_mm: null,
      quantity_needed: 0,
      stock_remainder: 0,
      unit: 'шт',
    })

    if (!result.success || !result.data) {
      toast.error(result.error || 'Ошибка при добавлении')
      return
    }

    applyRows([...rows, result.data as ComponentRow])
    toast.success('Позиция добавлена')
  }

  const handleUpdate = async (id: string, patch: ComponentPatch) => {
    const previous = rows
    const nextRows = rows.map((row) => row.id === id ? ({ ...row, ...patch } as ComponentRow) : row)
    applyRows(nextRows)

    const result = await updateComponent(id, patch)
    if (!result.success) {
      applyRows(previous)
      toast.error(result.error || 'Ошибка при сохранении')
      return
    }
    if (result.data) {
      applyRows(nextRows.map((row) => row.id === id ? ({ ...row, ...(result.data as ComponentRow) }) : row))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить позицию?')) return

    const previous = rows
    applyRows(rows.filter((row) => row.id !== id))

    const result = await deleteComponent(id)
    if (!result.success) {
      applyRows(previous)
      toast.error(result.error || 'Ошибка при удалении')
      return
    }

    toast.success('Позиция удалена')
  }

  const selectMaterial = (row: ComponentRow, material: MaterialWithSupplier, variant: MaterialVariant | undefined, source: MaterialSelectionSource) => {
    const isCustomVariant = isCustomVariantSource(source)
    setMaterialNames((current) => ({ ...current, [row.id]: material.name }))

    const updates: ComponentPatch = {
      material_id: material.id,
      material_variant_id: variant?.id ?? null,
      component_name: material.name,
      is_custom_material_variant: isCustomVariant,
    }

    if (variant?.diameter_mm) updates.diameter_mm = variant.diameter_mm
    void handleUpdate(row.id, updates)
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[660px] text-sm">
          <thead className="bg-slate-50 text-sm font-medium text-gray-500">
            <tr>
              <th className="min-w-[200px] px-3 py-2 text-left">Материал</th>
              <th className="min-w-[120px] px-3 py-2 text-left">Диаметр, мм</th>
              <th className="min-w-[100px] px-3 py-2 text-left">Необходимо, шт</th>
              <th className="w-[60px] px-3 py-2 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const canEditCharacteristics = canEditMaterialCharacteristics(row, canEdit)
              return (
              <tr key={row.id} className="border-b last:border-b-0">
                <td className="px-3 py-2">
                  <MaterialSearch
                    category="components"
                    value={materialNames[row.id] ?? materialDisplayName(row)}
                    initialValue={materialDisplayName(row)}
                    selectedMaterialId={row.material_id}
                    disabled={!canEdit}
                    compact
                    onSelect={(material, variant, source) => selectMaterial(row, material, variant, source)}
                  />
                </td>
                <td className="px-3 py-2">
                  <InlineEditCell value={row.diameter_mm} type="number" step="0.01" disabled={!canEditCharacteristics} onSave={(value) => handleUpdate(row.id, { diameter_mm: toNumber(value) })} />
                </td>
                <td className="px-3 py-2">
                  <InlineEditCell value={row.quantity_needed} type="number" step="1" disabled={!canEdit} onSave={(value) => handleUpdate(row.id, { quantity_needed: toNumber(value) })} />
                </td>
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
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  Нет позиций
                  {canEdit && (
                    <Button type="button" variant="outline" size="sm" className="ml-3" onClick={handleAdd}>
                      Добавить
                    </Button>
                  )}
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
