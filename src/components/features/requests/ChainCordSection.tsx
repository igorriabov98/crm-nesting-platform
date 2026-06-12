'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CHAIN_CORD_SUBTYPE_LABELS } from '@/lib/constants/procurement'
import { addChainCord, deleteChainCord, updateChainCord, type WithMaterialName } from '@/lib/actions/technologist-requests'
import { InlineEditCell } from './InlineEditCell'
import { MaterialSearch, type MaterialSelectionSource } from './MaterialSearch'
import { canEditMaterialCharacteristics, isCustomVariantSource } from './materialVariantMode'
import type { MaterialWithSupplier } from '@/lib/actions/materials'
import type { ChainCordInput } from '@/lib/types/request-schemas'
import type { ChainCordSubtype, MaterialVariant, RequestChainCord } from '@/lib/types'

type ChainCordRow = WithMaterialName<RequestChainCord>
type ChainCordPatch = Partial<ChainCordInput> & { is_custom_material_variant?: boolean }

type Props = {
  requestId: string
  items: ChainCordRow[]
  isEditable: boolean
  onRowsChange?: (rows: ChainCordRow[]) => void
}

function materialDisplayName(row: ChainCordRow) {
  return row.materials?.name ?? ''
}

function neededLengthMm(row: ChainCordRow) {
  const meters = Number(row.remainder_meters || 0)
  return Number.isFinite(meters) ? Math.round(meters * 1000 * 100) / 100 : 0
}

function mmToMeters(value: string | number | null) {
  const millimeters = Number(value || 0)
  return Number.isFinite(millimeters) ? millimeters / 1000 : 0
}

export function ChainCordSection({ requestId, items, isEditable, onRowsChange }: Props) {
  const [rows, setRows] = useState(items)
  const [materialNames, setMaterialNames] = useState<Record<string, string>>({})

  useEffect(() => {
    setRows(items)
    onRowsChange?.(items)
  }, [items, onRowsChange])

  const applyRows = (nextRows: ChainCordRow[]) => {
    setRows(nextRows)
    onRowsChange?.(nextRows)
  }

  const handleAdd = async () => {
    const result = await addChainCord(requestId, {
      item_type: 'chain',
      parameters: null,
      remainder_meters: 0,
    })
    if (!result.success || !result.data) {
      toast.error(result.error || 'Ошибка при добавлении')
      return
    }
    applyRows([...rows, result.data as ChainCordRow])
    toast.success('Позиция добавлена')
  }

  const handleUpdate = async (id: string, patch: ChainCordPatch) => {
    const previous = rows
    const nextRows = rows.map((row) => row.id === id ? ({ ...row, ...patch } as ChainCordRow) : row)
    applyRows(nextRows)
    const result = await updateChainCord(id, patch)
    if (!result.success) {
      applyRows(previous)
      toast.error(result.error || 'Ошибка при сохранении')
      return
    }
    if (result.data) {
      applyRows(nextRows.map((row) => row.id === id ? ({ ...row, ...(result.data as ChainCordRow) }) : row))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить позицию?')) return
    const previous = rows
    applyRows(rows.filter((row) => row.id !== id))
    const result = await deleteChainCord(id)
    if (!result.success) {
      applyRows(previous)
      toast.error(result.error || 'Ошибка при удалении')
      return
    }
    toast.success('Позиция удалена')
  }

  const selectMaterial = (row: ChainCordRow, material: MaterialWithSupplier, variant: MaterialVariant | undefined, source: MaterialSelectionSource) => {
    const isCustomVariant = isCustomVariantSource(source)
    setMaterialNames((current) => ({ ...current, [row.id]: material.name }))
    const updates: ChainCordPatch = {
      material_id: material.id,
      material_variant_id: variant?.id ?? null,
      is_custom_material_variant: isCustomVariant,
    }
    if (variant?.chain_cord_type) updates.item_type = variant.chain_cord_type
    if (variant?.chain_cord_parameters) updates.parameters = variant.chain_cord_parameters
    void handleUpdate(row.id, updates)
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-[760px] w-full text-sm">
          <thead className="bg-slate-50 text-sm font-medium text-gray-500">
            <tr>
              <th className="min-w-[200px] px-3 py-2 text-left">Материал</th>
              <th className="min-w-[120px] px-3 py-2 text-left">Тип</th>
              <th className="min-w-[200px] px-3 py-2 text-left">Параметры</th>
              <th className="min-w-[120px] px-3 py-2 text-left">Необходимо, мм</th>
              <th className="w-[60px] px-3 py-2 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const canEditCharacteristics = canEditMaterialCharacteristics(row, isEditable)
              return (
              <tr key={row.id} className="border-b last:border-b-0">
                <td className="px-3 py-2">
                  <MaterialSearch category="chain_cord" value={materialNames[row.id] ?? materialDisplayName(row)} initialValue={materialDisplayName(row)} selectedMaterialId={row.material_id} disabled={!isEditable} compact onSelect={(material, variant, source) => selectMaterial(row, material, variant, source)} />
                </td>
                <td className="px-3 py-2">
                  {canEditCharacteristics ? (
                    <select
                      value={row.item_type}
                      onChange={(event) => void handleUpdate(row.id, { item_type: event.target.value as ChainCordSubtype })}
                      className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                    >
                      {Object.entries(CHAIN_CORD_SUBTYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  ) : CHAIN_CORD_SUBTYPE_LABELS[row.item_type]}
                </td>
                <td className="px-3 py-2"><InlineEditCell value={row.parameters} disabled={!canEditCharacteristics} onSave={(value) => handleUpdate(row.id, { parameters: value === null ? null : String(value) })} /></td>
                <td className="px-3 py-2"><InlineEditCell value={neededLengthMm(row)} type="number" step="1" disabled={!isEditable} onSave={(value) => handleUpdate(row.id, { remainder_meters: mmToMeters(value) })} /></td>
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
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
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

export default ChainCordSection
