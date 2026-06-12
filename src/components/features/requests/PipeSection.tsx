'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PIPE_SUBTYPE_LABELS } from '@/lib/constants/procurement'
import { addPipe, deletePipe, updatePipe, type WithMaterialName } from '@/lib/actions/technologist-requests'
import { InlineEditCell } from './InlineEditCell'
import { MaterialSearch, type MaterialSelectionSource } from './MaterialSearch'
import { canEditMaterialCharacteristics, isCustomVariantSource } from './materialVariantMode'
import type { MaterialWithSupplier } from '@/lib/actions/materials'
import type { PipeInput } from '@/lib/types/request-schemas'
import type { MaterialVariant, RequestPipe } from '@/lib/types'
import type { SteelType } from '@/lib/types/database'

export type PipeRow = WithMaterialName<RequestPipe>
type PipePatch = Partial<PipeInput> & { is_custom_material_variant?: boolean }

type Props = {
  requestId: string
  items: PipeRow[]
  isEditable: boolean
  steelTypes: SteelType[]
  onRowsChange?: (rows: PipeRow[]) => void
}

function toNumber(value: string | number | null) {
  if (value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function materialDisplayName(row: PipeRow) {
  return row.materials?.name ?? ''
}

function formatWeight(value: number | null | undefined) {
  return value === null || value === undefined || value < 0 ? '—' : `${value} кг`
}

function parsePipeDimensions(value: string | null | undefined) {
  if (!value) return null
  const dimensions = value
    .replace(/[хХ×*]/g, 'x')
    .split('x')
    .map((part) => Number(part.trim().replace(',', '.')))
    .filter((number) => Number.isFinite(number) && number > 0)
  return dimensions.length >= 2 ? dimensions : null
}

function parseRoundPipeDiameter(value: string | null | undefined) {
  if (!value) return null
  const diameter = Number(value.trim().replace(',', '.'))
  return Number.isFinite(diameter) && diameter > 0 ? diameter : null
}

export function calculatePipeWeight(row: PipeRow, steelTypes: SteelType[]) {
  if (row.pipe_type === 'wire') return row.remainder_kg ?? null
  const density = steelTypes.find((steelType) => steelType.id === row.steel_type_id)?.density_kg_mm3
  const wall = Number(row.wall_thickness_mm || 0)
  const lengthMm = Number(row.remainder_length_mm || 0)
  if (!density || wall <= 0 || lengthMm <= 0) return null

  let crossSection: number | null = null
  if (row.pipe_type === 'round') {
    const diameter = parseRoundPipeDiameter(row.size) ?? Number(row.diameter_mm || 0)
    if (diameter <= 0 || wall * 2 >= diameter) return null
    crossSection = Math.PI * ((diameter / 2) ** 2 - ((diameter - 2 * wall) / 2) ** 2)
  } else {
    const dimensions = parsePipeDimensions(row.size)
    if (!dimensions) return null
    const a = dimensions[0]
    const b = row.pipe_type === 'square' ? dimensions[0] : dimensions[1]
    if (wall * 2 >= Math.min(a, b)) return null
    crossSection = (a * b) - ((a - 2 * wall) * (b - 2 * wall))
  }

  if (crossSection <= 0) return null
  return Math.round(crossSection * lengthMm * Number(density) * 100) / 100
}

export function PipeSection({ requestId, items, isEditable, steelTypes, onRowsChange }: Props) {
  const router = useRouter()
  const [rows, setRows] = useState(items)
  const [materialNames, setMaterialNames] = useState<Record<string, string>>({})

  const applyRows = (nextRows: PipeRow[]) => {
    setRows(nextRows)
    onRowsChange?.(nextRows)
  }

  const handleAdd = async () => {
    const result = await addPipe(requestId, {
      pipe_type: 'square',
      size: null,
      wall_thickness_mm: null,
      diameter_mm: null,
      remainder_length_mm: 0,
      remainder_qty: 0,
      remainder_kg: 0,
    })
    if (!result.success || !result.data) {
      toast.error(result.error || 'Ошибка при добавлении')
      return
    }
    applyRows([...rows, result.data as PipeRow])
    toast.success('Позиция добавлена')
  }

  const handleUpdate = async (id: string, patch: PipePatch) => {
    const previous = rows
    applyRows(rows.map((row) => row.id === id ? ({ ...row, ...patch } as PipeRow) : row))
    const result = await updatePipe(id, patch)
    if (!result.success) {
      applyRows(previous)
      toast.error(result.error || 'Ошибка при сохранении')
      return
    }
    if (result.data) {
      applyRows(rows.map((row) => row.id === id ? ({ ...row, ...(result.data as PipeRow) }) : row))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить позицию?')) return
    const previous = rows
    applyRows(rows.filter((row) => row.id !== id))
    const result = await deletePipe(id)
    if (!result.success) {
      applyRows(previous)
      toast.error(result.error || 'Ошибка при удалении')
      return
    }
    router.refresh()
    toast.success('Позиция удалена')
  }

  const handlePipeTypeChange = (row: PipeRow, pipeType: PipeInput['pipe_type']) => {
    const patch: PipePatch = { pipe_type: pipeType }
    if (pipeType === 'wire') {
      patch.size = null
      patch.wall_thickness_mm = null
      patch.steel_type_id = null
      patch.remainder_length_mm = 0
      patch.remainder_qty = 0
    } else {
      patch.remainder_kg = 0
      patch.diameter_mm = null
    }
    void handleUpdate(row.id, patch)
  }

  const selectMaterial = (row: PipeRow, material: MaterialWithSupplier, variant: MaterialVariant | undefined, source: MaterialSelectionSource) => {
    const isCustomVariant = isCustomVariantSource(source)
    if (!isCustomVariant && !variant?.pipe_type) {
      toast.error('Выберите конкретный вариант трубы с подтипом')
      return
    }

    setMaterialNames((current) => ({ ...current, [row.id]: material.name }))
    const updates: PipePatch = {
      material_id: material.id,
      material_variant_id: variant?.id ?? null,
      pipe_type: variant?.pipe_type ?? row.pipe_type ?? 'square',
      is_custom_material_variant: isCustomVariant,
    }
    if (variant?.pipe_type === 'wire') {
      updates.size = null
      updates.wall_thickness_mm = null
      updates.steel_type_id = null
      updates.remainder_length_mm = 0
      updates.remainder_qty = 0
      if (variant?.diameter_mm) updates.diameter_mm = variant.diameter_mm
    } else {
      updates.remainder_kg = 0
      updates.diameter_mm = null
      if (variant?.steel_type_id) updates.steel_type_id = variant.steel_type_id
      if (variant?.piece_description ?? variant?.sheet_size) updates.size = variant?.piece_description ?? variant?.sheet_size
      if (variant?.wall_thickness_mm) updates.wall_thickness_mm = variant.wall_thickness_mm
    }
    void handleUpdate(row.id, updates)
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-[1410px] w-full text-sm">
          <thead className="bg-slate-50 text-sm font-medium text-gray-500">
            <tr>
              <th className="min-w-[200px] px-3 py-2 text-left">Материал</th>
              <th className="min-w-[150px] px-3 py-2 text-left">Подтип</th>
              <th className="min-w-[120px] px-3 py-2 text-left">Тип стали</th>
              <th className="min-w-[140px] px-3 py-2 text-left">Размер</th>
              <th className="min-w-[140px] px-3 py-2 text-left">Толщина стенки, мм</th>
              <th className="min-w-[150px] px-3 py-2 text-left">Диаметр проволоки, мм</th>
              <th className="min-w-[140px] px-3 py-2 text-left">Необходимо длина, мм</th>
              <th className="min-w-[110px] px-3 py-2 text-left">Необходимо, кг</th>
              <th className="min-w-[100px] px-3 py-2 text-left">Вес, кг</th>
              <th className="w-[60px] px-3 py-2 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const hasMaterial = Boolean(row.material_id)
              const canEditCharacteristics = canEditMaterialCharacteristics(row, isEditable)
              const isWire = hasMaterial && row.pipe_type === 'wire'
              const isRegularPipe = hasMaterial && !isWire
              const showsDiameter = hasMaterial && row.pipe_type === 'wire'
              const displayWeight = calculatePipeWeight(row, steelTypes) ?? row.calculated_weight_kg
              return (
                <tr key={row.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">
                    <MaterialSearch
                      category="pipe"
                      value={materialNames[row.id] ?? materialDisplayName(row)}
                      initialValue={materialDisplayName(row)}
                      selectedMaterialId={row.material_id}
                      disabled={!isEditable}
                      compact
                      onSelect={(material, variant, source) => selectMaterial(row, material, variant, source)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {hasMaterial ? (
                      canEditCharacteristics ? (
                        <select
                          value={row.pipe_type}
                          onChange={(event) => handlePipeTypeChange(row, event.target.value as PipeInput['pipe_type'])}
                          className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                        >
                          {Object.entries(PIPE_SUBTYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      ) : PIPE_SUBTYPE_LABELS[row.pipe_type]
                    ) : <span className="text-gray-400">Выберите материал</span>}
                  </td>
                  <td className="px-3 py-2">
                    {isWire ? (
                      <span className="text-gray-400">—</span>
                    ) : (
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
                    )}
                  </td>
                  <td className="px-3 py-2">{isRegularPipe ? <InlineEditCell value={row.size} disabled={!canEditCharacteristics} onSave={(value) => handleUpdate(row.id, { size: value === null ? null : String(value) })} /> : <span className="text-gray-400">—</span>}</td>
                  <td className="px-3 py-2">{isRegularPipe ? <InlineEditCell value={row.wall_thickness_mm} type="number" step="0.01" disabled={!canEditCharacteristics} onSave={(value) => handleUpdate(row.id, { wall_thickness_mm: toNumber(value) })} /> : <span className="text-gray-400">—</span>}</td>
                  <td className="px-3 py-2">{showsDiameter ? <InlineEditCell value={row.diameter_mm} type="number" step="0.01" disabled={!canEditCharacteristics} onSave={(value) => handleUpdate(row.id, { diameter_mm: toNumber(value) })} /> : <span className="text-gray-400">—</span>}</td>
                  <td className="px-3 py-2">{isRegularPipe ? <InlineEditCell value={row.remainder_length_mm} type="number" step="0.01" disabled={!isEditable} onSave={(value) => handleUpdate(row.id, { remainder_length_mm: Number(value || 0) })} /> : <span className="text-gray-400">—</span>}</td>
                  <td className="px-3 py-2">{isWire ? <InlineEditCell value={row.remainder_kg} type="number" step="0.01" disabled={!isEditable} onSave={(value) => handleUpdate(row.id, { remainder_kg: Number(value || 0) })} /> : <span className="text-gray-400">—</span>}</td>
                  <td className="px-3 py-2 text-slate-700">{formatWeight(displayWeight)}</td>
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
                <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
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

export default PipeSection
