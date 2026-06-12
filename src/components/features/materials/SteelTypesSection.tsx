'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createSteelType, deleteSteelType, updateSteelTypeDensity } from '@/lib/actions/steel-types'
import type { SteelType } from '@/lib/types/database'

type Props = {
  initialSteelTypes: SteelType[]
}

function densityToInput(value: number) {
  return Number((value * 1_000_000).toFixed(4)).toString()
}

function densityLabel(value: number) {
  return Number((value * 1_000_000).toFixed(4)).toLocaleString('ru-RU', {
    maximumFractionDigits: 4,
  })
}

export function SteelTypesSection({ initialSteelTypes }: Props) {
  const [rows, setRows] = useState(initialSteelTypes)
  const [newName, setNewName] = useState('')
  const [newDensity, setNewDensity] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [densityDraft, setDensityDraft] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const sortRows = (items: SteelType[]) => [...items].sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  const startEdit = (row: SteelType) => {
    if (savingId || deletingId) return
    setEditingId(row.id)
    setDensityDraft(densityToInput(row.density_kg_mm3))
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDensityDraft('')
  }

  const saveDensity = (row: SteelType) => {
    const value = Number(densityDraft)
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Введите корректную плотность')
      return
    }

    setSavingId(row.id)
    startTransition(async () => {
      try {
        await updateSteelTypeDensity(row.id, value)
        setRows((current) => current.map((item) => item.id === row.id ? {
          ...item,
          density_kg_mm3: value / 1_000_000,
        } : item))
        cancelEdit()
        toast.success('Плотность сохранена')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Не удалось сохранить плотность')
      } finally {
        setSavingId(null)
      }
    })
  }

  const handleCreate = () => {
    const name = newName.trim()
    const density = Number(newDensity)
    if (!name) {
      toast.error('Введите марку стали')
      return
    }
    if (!Number.isFinite(density) || density <= 0) {
      toast.error('Введите корректную плотность')
      return
    }

    startTransition(async () => {
      try {
        const created = await createSteelType(name, density)
        setRows((current) => sortRows([created, ...current.filter((row) => row.id !== created.id)]))
        setNewName('')
        setNewDensity('')
        toast.success('Марка стали добавлена')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Не удалось добавить марку стали')
      }
    })
  }

  const handleDelete = (row: SteelType) => {
    setDeletingId(row.id)
    startTransition(async () => {
      try {
        await deleteSteelType(row.id)
        setRows((current) => current.filter((item) => item.id !== row.id))
        toast.success('Марка стали удалена')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Не удалось удалить марку стали')
      } finally {
        setDeletingId(null)
      }
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-[#1B3A6B]">Марки стали</h2>
        <p className="mt-1 text-sm text-[#6B7280]">Плотность хранится для расчёта веса материалов.</p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-[#E8ECF0] bg-white p-4 md:flex-row md:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium text-[#374151]">Марка</label>
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Например: S275"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium text-[#374151]">Плотность, г/см³</label>
          <Input
            type="number"
            min="0"
            step="0.0001"
            value={newDensity}
            onChange={(event) => setNewDensity(event.target.value)}
            placeholder="Например: 7.85"
          />
        </div>
        <Button type="button" onClick={handleCreate} disabled={isPending}>
          <Plus className="mr-2 h-4 w-4" />
          {isPending ? 'Добавление...' : 'Добавить'}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA] text-[#6B7280]">
              <tr>
                <th className="min-w-[220px] px-4 py-3">Марка</th>
                <th className="min-w-[180px] px-4 py-3">Плотность (г/см³)</th>
                <th className="w-36 px-4 py-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF0]">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-medium text-[#1B3A6B]">{row.name}</td>
                  <td className="px-4 py-3">
                    {editingId === row.id ? (
                      <Input
                        autoFocus
                        type="number"
                        min="0"
                        step="0.0001"
                        value={densityDraft}
                        disabled={savingId === row.id}
                        onChange={(event) => setDensityDraft(event.target.value)}
                        onBlur={() => saveDensity(row)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') saveDensity(row)
                          if (event.key === 'Escape') cancelEdit()
                        }}
                        className="h-9 max-w-[180px]"
                      />
                    ) : (
                      <button
                        type="button"
                        className="block min-h-9 min-w-[120px] rounded-md px-2 py-2 text-left hover:bg-slate-50"
                        onClick={() => startEdit(row)}
                      >
                        {savingId === row.id ? 'Сохранение...' : densityLabel(row.density_kg_mm3)}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={deletingId === row.id || savingId === row.id}
                      onClick={() => handleDelete(row)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      {deletingId === row.id ? 'Удаление...' : 'Удалить'}
                    </Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-[#9CA3AF]">
                    Марки стали не найдены
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
