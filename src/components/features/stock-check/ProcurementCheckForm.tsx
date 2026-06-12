'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BigNumberInput } from './BigNumberInput'
import { BigSaveButton } from './BigSaveButton'
import { saveProcurementCheck } from '@/lib/actions/stock-check'
import { cn } from '@/lib/utils'
import type { RequestComponents, RequestKnives } from '@/lib/types'
import type { AvailabilityInput } from '@/lib/types/request-schemas'

type Props = {
  requestId: string
  machineName: string
  knives: RequestKnives[]
  components: RequestComponents[]
}

type Draft = {
  knives: Record<string, string>
  components: Record<string, { availability: AvailabilityInput; stock: string }>
}

const AVAILABILITY_LABELS: Record<AvailabilityInput, string> = {
  unknown: 'Не проверено',
  available: 'Есть',
  unavailable: 'Нету',
  partial: 'Частично',
}

function componentRowClass(availability: AvailabilityInput) {
  if (availability === 'available') return 'bg-emerald-50'
  if (availability === 'unavailable') return 'bg-red-50'
  if (availability === 'partial') return 'bg-amber-50'
  return 'bg-white'
}

export function ProcurementCheckForm({ requestId, machineName, knives, components }: Props) {
  const storageKey = `stock-check:procurement:${requestId}`
  const [draft, setDraft] = useState<Draft>(() => ({
    knives: Object.fromEntries(knives.map((item) => [item.id, item.stock_remainder_mm?.toString() ?? ''])),
    components: Object.fromEntries(components.map((item) => [item.id, {
      availability: (item.availability || 'unknown') as AvailabilityInput,
      stock: item.stock_remainder?.toString() ?? '',
    }])),
  }))
  const [saving, setSaving] = useState(false)
  const [complete, setComplete] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(storageKey)
    if (!saved) return
    try {
      setDraft(JSON.parse(saved) as Draft)
    } catch {
      localStorage.removeItem(storageKey)
    }
  }, [storageKey])

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(draft))
  }, [draft, storageKey])

  const progress = useMemo(() => {
    const checkedKnives = knives.filter((item) => draft.knives[item.id] !== '').length
    const checkedComponents = components.filter((item) => {
      const row = draft.components[item.id]
      return row && row.availability !== 'unknown' && row.stock !== ''
    }).length
    return { done: checkedKnives + checkedComponents, total: knives.length + components.length }
  }, [components, draft, knives])

  const setKnifeValue = (id: string, value: string) => {
    setDraft((current) => ({ ...current, knives: { ...current.knives, [id]: value } }))
  }

  const setComponentAvailability = (item: RequestComponents, availability: AvailabilityInput) => {
    setDraft((current) => {
      const stock = availability === 'available'
        ? String(item.quantity_needed)
        : availability === 'unavailable'
          ? '0'
          : current.components[item.id]?.stock || ''

      return {
        ...current,
        components: {
          ...current.components,
          [item.id]: { availability, stock },
        },
      }
    })
  }

  const setComponentStock = (id: string, value: string) => {
    setDraft((current) => ({
      ...current,
      components: {
        ...current.components,
        [id]: { availability: current.components[id]?.availability || 'unknown', stock: value },
      },
    }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const result = await saveProcurementCheck(
        requestId,
        knives
          .filter((item) => draft.knives[item.id] !== '')
          .map((item) => ({ id: item.id, stock_remainder_mm: Number(draft.knives[item.id]) })),
        components
          .filter((item) => draft.components[item.id]?.stock !== '' && draft.components[item.id]?.availability !== 'unknown')
          .map((item) => ({
            id: item.id,
            stock_remainder: Number(draft.components[item.id].stock),
            availability: draft.components[item.id].availability,
          }))
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
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Проверка остатков — Заготовка</h1>
        <p className="mt-1 text-lg font-medium text-slate-700">Машина: {machineName}</p>
      </div>

      {complete && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-lg font-semibold text-emerald-700">Все остатки проверены!</div>}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-xl font-bold text-slate-900">Ножи</h2>
        <div className="space-y-3">
          {knives.map((item) => {
            const filled = draft.knives[item.id] !== ''
            return (
              <div key={item.id} className={cn('grid gap-3 rounded-lg border border-slate-100 p-3 sm:grid-cols-[1fr_130px_180px]', filled && 'bg-emerald-50')}>
                <div>
                  <div className="font-semibold text-slate-900">{item.knife_type}</div>
                  <div className="text-sm text-slate-500">Тип ножа</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-slate-900">{Number(item.order_mm || 0).toFixed(0)}</div>
                  <div className="text-sm text-slate-500">Нужно, мм</div>
                </div>
                <BigNumberInput value={draft.knives[item.id] ?? ''} onChange={(value) => setKnifeValue(item.id, value)} step="1" />
              </div>
            )
          })}
          {knives.length === 0 && <div className="text-slate-500">Ножей в заявке нет.</div>}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-xl font-bold text-slate-900">Комплектация</h2>
        <div className="space-y-3">
          {components.map((item) => {
            const row = draft.components[item.id] || { availability: 'unknown' as AvailabilityInput, stock: '' }
            const stockDisabled = row.availability === 'available' || row.availability === 'unavailable'
            return (
              <div key={item.id} className={cn('grid gap-3 rounded-lg border border-slate-100 p-3 md:grid-cols-[1fr_90px_70px_150px_160px]', componentRowClass(row.availability))}>
                <div>
                  <div className="font-semibold text-slate-900">{item.component_name}</div>
                  <div className="text-sm text-slate-500">{item.specification || 'Характеристика не указана'}</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-slate-900">{Number(item.quantity_needed || 0).toFixed(0)}</div>
                  <div className="text-sm text-slate-500">Нужно</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-slate-900">{item.unit}</div>
                  <div className="text-sm text-slate-500">Ед.</div>
                </div>
                <select
                  value={row.availability}
                  onChange={(event) => setComponentAvailability(item, event.target.value as AvailabilityInput)}
                  className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 text-lg font-medium"
                >
                  {Object.entries(AVAILABILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <BigNumberInput value={row.stock} onChange={(value) => setComponentStock(item.id, value)} disabled={stockDisabled} step="1" />
              </div>
            )
          })}
          {components.length === 0 && <div className="text-slate-500">Комплектации в заявке нет.</div>}
        </div>
      </section>

      <div className="sticky bottom-0 space-y-3 border-t border-slate-200 bg-[#F4F6F9] py-4">
        <div className="text-center text-lg font-semibold text-slate-800">Заполнено {progress.done} из {progress.total} позиций</div>
        <BigSaveButton loading={saving} onClick={save} />
      </div>
    </div>
  )
}
