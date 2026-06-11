'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BigNumberInput } from './BigNumberInput'
import { BigSaveButton } from './BigSaveButton'
import { savePaintingCheck } from '@/lib/actions/stock-check'
import { cn } from '@/lib/utils'
import type { RequestPaint } from '@/lib/types'

type Props = {
  requestId: string
  machineName: string
  paint: RequestPaint[]
}

function neededKg(item: RequestPaint) {
  return Number(item.weight_kg || 0) * (1 + Number(item.waste_percent ?? 20) / 100)
}

export function PaintingCheckForm({ requestId, machineName, paint }: Props) {
  const storageKey = `stock-check:painting:${requestId}`
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(
    paint.map((item) => [item.id, item.stock_remainder_kg?.toString() ?? ''])
  ))
  const [saving, setSaving] = useState(false)
  const [complete, setComplete] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(storageKey)
    if (!saved) return
    try {
      setDraft(JSON.parse(saved) as Record<string, string>)
    } catch {
      localStorage.removeItem(storageKey)
    }
  }, [storageKey])

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(draft))
  }, [draft, storageKey])

  const progress = useMemo(() => ({
    done: paint.filter((item) => draft[item.id] !== '').length,
    total: paint.length,
  }), [draft, paint])

  const save = async () => {
    setSaving(true)
    try {
      const result = await savePaintingCheck(
        requestId,
        paint
          .filter((item) => draft[item.id] !== '')
          .map((item) => ({ id: item.id, stock_remainder_kg: Number(draft[item.id]) }))
      )
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить')
      localStorage.removeItem(storageKey)
      setComplete(!!result.data?.complete || progress.done === progress.total)
      toast.success('Сохранено ✓')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Проверка остатков — Малярка</h1>
        <p className="mt-1 text-lg font-medium text-slate-700">Машина: {machineName}</p>
      </div>

      {complete && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-lg font-semibold text-emerald-700">Все остатки проверены!</div>}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-xl font-bold text-slate-900">Краска</h2>
        <div className="space-y-3">
          {paint.map((item) => {
            const filled = draft[item.id] !== ''
            return (
              <div key={item.id} className={cn('grid gap-3 rounded-lg border border-slate-100 p-3 md:grid-cols-[140px_1fr_150px_180px]', filled && 'bg-emerald-50')}>
                <div>
                  <div className="font-semibold text-slate-900">{item.paint_type}</div>
                  <div className="text-sm text-slate-500">Тип</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-900">{item.ral_code}</div>
                  <div className="text-sm text-slate-500">{item.finish || 'Покрытие не указано'}</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-slate-900">{neededKg(item).toFixed(2)}</div>
                  <div className="text-sm text-slate-500">Нужно, кг</div>
                </div>
                <BigNumberInput value={draft[item.id] ?? ''} onChange={(value) => setDraft((current) => ({ ...current, [item.id]: value }))} step="0.01" />
              </div>
            )
          })}
          {paint.length === 0 && <div className="text-slate-500">Краски в заявке нет.</div>}
        </div>
      </section>

      <div className="sticky bottom-0 space-y-3 border-t border-slate-200 bg-[#F4F6F9] py-4">
        <div className="text-center text-lg font-semibold text-slate-800">Заполнено {progress.done} из {progress.total} позиций</div>
        <BigSaveButton loading={saving} onClick={save} />
      </div>
    </div>
  )
}
