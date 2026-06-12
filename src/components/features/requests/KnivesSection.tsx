'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { InlineEditCell } from './InlineEditCell'
import { MaterialSearch, type MaterialSelectionSource } from './MaterialSearch'
import { canEditMaterialCharacteristics, isCustomVariantSource } from './materialVariantMode'
import { addKnife, deleteKnife, updateKnife, type WithMaterialName } from '@/lib/actions/technologist-requests'
import type { MaterialWithSupplier } from '@/lib/actions/materials'
import type { MaterialVariant, RequestKnives } from '@/lib/types'
import type { SteelType } from '@/lib/types/database'
import type { KnifeInput } from '@/lib/types/request-schemas'

type KnifeRow = WithMaterialName<RequestKnives>
type KnifePatch = Partial<KnifeInput> & { is_custom_material_variant?: boolean }

type Props = {
  requestId: string
  items: KnifeRow[]
  canEdit: boolean
  canEditStock?: boolean
  steelTypes: SteelType[]
}

function toNumber(value: string | number | null) {
  if (value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function parseDimensions(value: string | null | undefined) {
  const [length, width, height] = String(value || '').trim().toLowerCase().replace(/[\u0445\u00d7*]/g, 'x').split('x').map((part) => Number(part.trim().replace(',', '.')))
  return {
    length_mm: Number.isFinite(length) && length > 0 ? length : undefined,
    width_mm: Number.isFinite(width) && width > 0 ? width : undefined,
    height_mm: Number.isFinite(height) && height > 0 ? height : undefined,
  }
}

function variantLength(variant: MaterialVariant | undefined) {
  if (!variant) return null
  return variant.standard_length_mm ?? (variant as MaterialVariant & { length_mm?: number | null }).length_mm ?? null
}

function materialDisplayName(row: KnifeRow) {
  return row.materials?.name || row.knife_type || ''
}

function formatWeight(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${value} кг`
}

function neededLengthMm(row: KnifeRow) {
  const meters = Number(row.remainder_meters || 0)
  return Number.isFinite(meters) ? Math.round(meters * 1000 * 100) / 100 : 0
}

function mmToMeters(value: string | number | null) {
  const millimeters = Number(value || 0)
  return Number.isFinite(millimeters) ? millimeters / 1000 : 0
}

function calculateKnifeWeight(row: KnifeRow, steelTypes: SteelType[]) {
  const density = steelTypes.find((steelType) => steelType.id === row.steel_type_id)?.density_kg_mm3
  const totalLengthMm = neededLengthMm(row)
  const width = Number(row.width_mm || 0)
  const height = Number(row.height_mm || 0)
  if (!density || totalLengthMm <= 0 || width <= 0 || height <= 0) return null
  return Math.round(totalLengthMm * width * height * Number(density) * 100) / 100
}

export function KnivesSection({ requestId, items, canEdit, steelTypes }: Props) {
  const router = useRouter()
  const [rows, setRows] = useState(items)
  const [materialNames, setMaterialNames] = useState<Record<string, string>>({})

  useEffect(() => {
    setRows(items)
  }, [items])

  const handleAdd = async () => {
    const result = await addKnife(requestId, {
      knife_type: null,
      steel_grade: null,
      length_mm: null,
      width_mm: null,
      height_mm: null,
      remainder_meters: 0,
    })
    if (!result.success || !result.data) {
      toast.error(result.error || 'Ошибка при добавлении')
      return
    }
    setRows((current) => [...current, result.data as KnifeRow])
    toast.success('Позиция добавлена')
  }

  const handleUpdate = async (id: string, patch: KnifePatch) => {
    const previous = rows
    setRows((current) => current.map((row) => row.id === id ? ({ ...row, ...patch } as KnifeRow) : row))
    const result = await updateKnife(id, patch)
    if (!result.success) {
      setRows(previous)
      toast.error(result.error || 'Ошибка при сохранении')
      return
    }
    if (result.data) {
      setRows((current) => current.map((row) => row.id === id ? ({ ...row, ...(result.data as KnifeRow) }) : row))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить позицию?')) return
    const previous = rows
    setRows((current) => current.filter((row) => row.id !== id))
    const result = await deleteKnife(id)
    if (!result.success) {
      setRows(previous)
      toast.error(result.error || 'Ошибка при удалении')
      return
    }
    router.refresh()
    toast.success('Позиция удалена')
  }

  const selectMaterial = (row: KnifeRow, material: MaterialWithSupplier, variant: MaterialVariant | undefined, source: MaterialSelectionSource) => {
    const isCustomVariant = isCustomVariantSource(source)
    setMaterialNames((current) => ({ ...current, [row.id]: material.name }))
    const updates: KnifePatch = {
      material_id: material.id,
      material_variant_id: variant?.id ?? null,
      knife_type: material.name,
      is_custom_material_variant: isCustomVariant,
    }
    if (variant?.steel_type_id) updates.steel_type_id = variant.steel_type_id
    if (variant?.material_grade ?? variant?.knife_material) updates.steel_grade = variant?.material_grade ?? variant?.knife_material
    if (variant?.knife_dimensions) Object.assign(updates, parseDimensions(variant.knife_dimensions))
    const length = variantLength(variant)
    if (length !== null) updates.length_mm = length
    if (variant?.width_mm !== null && variant?.width_mm !== undefined) updates.width_mm = variant.width_mm
    if (variant?.height_mm !== null && variant?.height_mm !== undefined) updates.height_mm = variant.height_mm
    void handleUpdate(row.id, updates)
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-[1120px] w-full text-sm">
          <thead className="bg-slate-50 text-sm font-medium text-gray-500">
            <tr>
              <th className="min-w-[200px] px-3 py-2 text-left">Материал</th>
              <th className="min-w-[120px] px-3 py-2 text-left">Тип стали</th>
              <th className="min-w-[100px] px-3 py-2 text-left">Длина, мм</th>
              <th className="min-w-[100px] px-3 py-2 text-left">Ширина, мм</th>
              <th className="min-w-[100px] px-3 py-2 text-left">Высота, мм</th>
              <th className="min-w-[100px] px-3 py-2 text-left">Необходимо, мм</th>
              <th className="min-w-[100px] px-3 py-2 text-left">Вес, кг</th>
              <th className="w-[60px] px-3 py-2 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const canEditCharacteristics = canEditMaterialCharacteristics(row, canEdit)
              const displayWeight = calculateKnifeWeight(row, steelTypes) ?? row.calculated_weight_kg
              return (
              <tr key={row.id} className="border-b last:border-b-0">
                <td className="px-3 py-2">
                  <MaterialSearch category="knives" value={materialNames[row.id] ?? materialDisplayName(row)} initialValue={materialDisplayName(row)} selectedMaterialId={row.material_id} disabled={!canEdit} compact onSelect={(material, variant, source) => selectMaterial(row, material, variant, source)} />
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
                <td className="px-3 py-2"><InlineEditCell value={row.length_mm} type="number" step="0.01" disabled={!canEditCharacteristics} onSave={(value) => handleUpdate(row.id, { length_mm: toNumber(value) })} /></td>
                <td className="px-3 py-2"><InlineEditCell value={row.width_mm} type="number" step="0.01" disabled={!canEditCharacteristics} onSave={(value) => handleUpdate(row.id, { width_mm: toNumber(value) })} /></td>
                <td className="px-3 py-2"><InlineEditCell value={row.height_mm} type="number" step="0.01" disabled={!canEditCharacteristics} onSave={(value) => handleUpdate(row.id, { height_mm: toNumber(value) })} /></td>
                <td className="px-3 py-2"><InlineEditCell value={neededLengthMm(row)} type="number" step="1" disabled={!canEdit} onSave={(value) => handleUpdate(row.id, { remainder_meters: mmToMeters(value) })} /></td>
                <td className="px-3 py-2 text-slate-700">{formatWeight(displayWeight)}</td>
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
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
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
