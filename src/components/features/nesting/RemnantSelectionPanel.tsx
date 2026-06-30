'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { RemnantGeom, SheetResult } from '@/lib/nesting/api'

type Props = {
  projectId: string
  sheet: SheetResult
  onHoverRemnant: (id: string | null) => void
  onSaved: (data: {
    remnantGeom: RemnantGeom | null
    remnantCandidates: RemnantGeom[]
    selectedRemnants: RemnantGeom[]
  }) => void
}

function formatArea(value: number) {
  return `${(value / 1_000_000).toFixed(3)} м²`
}

function formatSize(remnant: RemnantGeom) {
  return `${Math.round(remnant.width)}×${Math.round(remnant.height)} мм`
}

function selectedIdsForSheet(sheet: SheetResult) {
  return new Set(sheet.selectedRemnants?.map((remnant) => remnant.id) || [])
}

export function RemnantSelectionPanel({ projectId, sheet, onHoverRemnant, onSaved }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => selectedIdsForSheet(sheet))
  const [isPending, startTransition] = useTransition()
  const selectedIds = useMemo(() => Array.from(selected), [selected])
  const candidates = sheet.remnantCandidates || []
  const initialSelectedIds = useMemo(() => selectedIdsForSheet(sheet), [sheet])
  const dirty = candidates.length > 0 && (
    selectedIds.length !== initialSelectedIds.size ||
    selectedIds.some((id) => !initialSelectedIds.has(id))
  )

  useEffect(() => {
    setSelected(selectedIdsForSheet(sheet))
    onHoverRemnant(null)
  }, [sheet.id, sheet.selectedRemnants, onHoverRemnant])

  if (candidates.length === 0) {
    return null
  }

  function toggle(remnant: RemnantGeom, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (!checked) {
        next.delete(remnant.id)
        return next
      }

      for (const candidate of candidates) {
        if (candidate.id !== remnant.id && next.has(candidate.id) && remnantsOverlap(candidate, remnant)) {
          next.delete(candidate.id)
        }
      }
      next.add(remnant.id)
      return next
    })
  }

  function save() {
    startTransition(async () => {
      const res = await fetch(`/api/nesting/result/${projectId}/sheets/${sheet.id}/remnants`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedRemnantIds: selectedIds }),
      })
      const payload = await res.json().catch(() => ({ error: 'Не удалось сохранить выбор деловых остатков' }))

      if (!res.ok) {
        toast.error(payload.error || 'Не удалось сохранить выбор деловых остатков')
        return
      }

      onSaved(payload.data)
      toast.success('Выбор деловых остатков сохранён')
    })
  }

  return (
    <div className="rounded-lg border border-[#E8ECF0] bg-white p-4 text-sm">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold text-[#1B3A6B]">Деловые остатки</h3>
          <p className="text-[#6B7280]">Отметьте зоны, которые нужно оставить как будущий деловой остаток.</p>
        </div>
        <Button size="sm" onClick={save} disabled={!dirty || isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить выбор
        </Button>
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {candidates.map((remnant, index) => {
          const checked = selected.has(remnant.id)
          return (
            <label
              key={remnant.id}
              className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2 transition-colors ${
                checked ? 'border-green-300 bg-green-50/70' : 'border-[#E8ECF0] bg-[#F8F9FA] hover:border-slate-300'
              }`}
              onMouseEnter={() => onHoverRemnant(remnant.id)}
              onMouseLeave={() => onHoverRemnant(null)}
            >
              <Checkbox checked={checked} onCheckedChange={(value) => toggle(remnant, value === true)} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block font-medium text-[#374151]">Кандидат {index + 1}: {formatSize(remnant)}</span>
                <span className="block text-[#6B7280]">{formatArea(remnant.area)} · x {Math.round(remnant.x)}, y {Math.round(remnant.y)}</span>
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function remnantsOverlap(left: RemnantGeom, right: RemnantGeom) {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  )
}
