'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { InlineEditCell } from './InlineEditCell'
import { MaterialSearch, type MaterialSelectionSource } from './MaterialSearch'
import { canEditMaterialCharacteristics, isCustomVariantSource } from './materialVariantMode'
import { addSheetMetal, deleteSheetMetal, updateSheetMetal, type WithMaterialName } from '@/lib/actions/technologist-requests'
import type { MaterialWithSupplier } from '@/lib/actions/materials'
import type { MaterialVariant, RequestSheetMetal, Supplier } from '@/lib/types'
import type { SteelType } from '@/lib/types/database'
import type { SheetMetalInput } from '@/lib/types/request-schemas'

type SheetMetalRow = WithMaterialName<RequestSheetMetal>
type SheetMetalPatch = Partial<SheetMetalInput> & { is_custom_material_variant?: boolean }

type Props = {
  requestId: string
  items: SheetMetalRow[]
  suppliers?: Supplier[]
  canEdit: boolean
  steelTypes: SteelType[]
}

function toNumber(value: string | number | null) {
  if (value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function materialDisplayName(row: SheetMetalRow) {
  return row.materials?.name || row.material_name || ''
}

function formatWeight(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${value} кг`
}

function normalizeSteelName(value: string | null | undefined) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase()
}

function resolveSteelTypeId(steelTypes: SteelType[], variant: MaterialVariant | undefined) {
  if (variant?.steel_type_id) return variant.steel_type_id
  const grade = normalizeSteelName(variant?.material_grade)
  if (!grade) return null
  return steelTypes.find((steelType) => normalizeSteelName(steelType.name) === grade)?.id ?? null
}

export function SheetMetalSection({ requestId, items, canEdit, steelTypes }: Props) {
  const router = useRouter()
  const [rows, setRows] = useState(items)
  const [materialNames, setMaterialNames] = useState<Record<string, string>>({})

  useEffect(() => {
    setRows(items)
  }, [items])

  const handleAdd = async () => {
    const result = await addSheetMetal(requestId, {
      material_name: null,
      material_grade: null,
      sheet_size: null,
      thickness_mm: null,
      remainder_qty: 0,
    })
    if (!result.success || !result.data) {
      toast.error(result.error || 'Ошибка')
      return
    }
    setRows((current) => [...current, result.data as SheetMetalRow])
    toast.success('Позиция добавлена')
  }

  const handleUpdate = async (id: string, patch: SheetMetalPatch) => {
    const previous = rows
    setRows((current) => current.map((row) => row.id === id ? ({ ...row, ...patch } as SheetMetalRow) : row))
    const result = await updateSheetMetal(id, patch)
    if (!result.success) {
      setRows(previous)
      toast.error(result.error || 'Ошибка при сохранении')
      return
    }
    if (result.data) {
      setRows((current) => current.map((row) => row.id === id ? ({ ...row, ...(result.data as SheetMetalRow) }) : row))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить позицию?')) return
    const previous = rows
    setRows((current) => current.filter((row) => row.id !== id))
    const result = await deleteSheetMetal(id)
    if (!result.success) {
      setRows(previous)
      toast.error(result.error || 'Ошибка при удалении')
      return
    }
    router.refresh()
    toast.success('Позиция удалена')
  }

  const selectMaterial = (row: SheetMetalRow, material: MaterialWithSupplier, variant: MaterialVariant | undefined, source: MaterialSelectionSource) => {
    const isCustomVariant = isCustomVariantSource(source)
    setMaterialNames((current) => ({ ...current, [row.id]: material.name }))
    const updates: SheetMetalPatch = {
      material_id: material.id,
      material_variant_id: variant?.id ?? null,
      material_name: material.name,
      is_custom_material_variant: isCustomVariant,
    }
    const steelTypeId = resolveSteelTypeId(steelTypes, variant)
    if (steelTypeId) updates.steel_type_id = steelTypeId
    if (variant?.material_grade) updates.material_grade = variant.material_grade
    if (variant?.thickness_mm) updates.thickness_mm = variant.thickness_mm
    if (variant?.sheet_size) updates.sheet_size = variant.sheet_size
    void handleUpdate(row.id, updates)
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-[960px] w-full text-sm">
          <thead className="bg-slate-50 text-sm font-medium text-gray-500">
            <tr>
              <th className="min-w-[200px] px-3 py-2 text-left">Материал</th>
              <th className="min-w-[120px] px-3 py-2 text-left">Тип стали</th>
              <th className="min-w-[150px] px-3 py-2 text-left">Размер листа</th>
              <th className="min-w-[120px] px-3 py-2 text-left">Толщина, мм</th>
              <th className="min-w-[100px] px-3 py-2 text-left">Необходимо, шт</th>
              <th className="min-w-[100px] px-3 py-2 text-left">Вес, кг</th>
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
                    category="sheet_metal"
                    value={materialNames[row.id] ?? materialDisplayName(row)}
                    initialValue={materialDisplayName(row)}
                    selectedMaterialId={row.material_id}
                    disabled={!canEdit}
                    compact
                    onSelect={(material, variant, source) => selectMaterial(row, material, variant, source)}
                  />
                </td>
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
                <td className="px-3 py-2"><InlineEditCell value={row.sheet_size} disabled={!canEditCharacteristics} onSave={(value) => handleUpdate(row.id, { sheet_size: value === null ? null : String(value) })} /></td>
                <td className="px-3 py-2"><InlineEditCell value={row.thickness_mm} type="number" step="0.01" disabled={!canEditCharacteristics} onSave={(value) => handleUpdate(row.id, { thickness_mm: toNumber(value) })} /></td>
                <td className="px-3 py-2"><InlineEditCell value={row.remainder_qty} type="number" step="1" disabled={!canEdit} onSave={(value) => handleUpdate(row.id, { remainder_qty: Number(value || 0) })} /></td>
                <td className="px-3 py-2 text-slate-700">{formatWeight(row.calculated_weight_kg)}</td>
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
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
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
