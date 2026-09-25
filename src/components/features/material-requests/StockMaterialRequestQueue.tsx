'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createStockMaterialRequest } from '@/lib/actions/stock-material-requests'
import { ROUTES } from '@/lib/constants/routes'

export type StockQueueItem = {
  id: string
  title: string | null
  factory_id: string | null
  needed_by: string | null
  status: string
  request_number: number
  display_revision_number: number
}

const statusLabels: Record<string, string> = {
  draft: 'Черновик', pending_financial_approval: 'На согласовании',
  submitted_to_supply: 'Передана в снабжение', completed: 'Получена', cancelled: 'Отменена',
}

export function StockMaterialRequestQueue({ items, factories, canCreate }: {
  items: StockQueueItem[]
  factories: Array<{ id: string; name: string }>
  canCreate: boolean
}) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [factoryId, setFactoryId] = useState(factories.length === 1 ? factories[0].id : '')
  const [neededBy, setNeededBy] = useState('')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try {
      const result = await createStockMaterialRequest({ title, factoryId, neededBy: neededBy || null })
      if (!result.success || !result.requestId) throw new Error(result.error || 'Не удалось создать заявку')
      router.push(`${ROUTES.MATERIAL_REQUESTS}/stock/${result.requestId}`)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Не удалось создать заявку') }
    finally { setBusy(false) }
  }
  return <div className="space-y-6">
    {canCreate && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold text-[#1B3A6B]">Новая заявка на склад</h2>
      <p className="mt-1 text-sm text-slate-600">Материал поступит в свободный остаток выбранного завода.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_180px_auto] md:items-end">
        <label className="space-y-1 text-sm font-medium">Название
          <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="Например, пополнение листового металла" />
        </label>
        <div className="space-y-1 text-sm font-medium"><label htmlFor="stock-request-factory">Завод</label>
          <Select value={factoryId} onValueChange={(value) => setFactoryId(value || '')}>
            <SelectTrigger id="stock-request-factory"><SelectValue>{factories.find((factory) => factory.id === factoryId)?.name || 'Выберите завод'}</SelectValue></SelectTrigger>
            <SelectContent>{factories.map((factory) => <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <label className="space-y-1 text-sm font-medium">Нужен к дате
          <Input type="date" value={neededBy} onChange={(event) => setNeededBy(event.target.value)} />
        </label>
        <Button disabled={busy || !title.trim() || !factoryId} onClick={create}>Создать заявку</Button>
      </div>
    </section>}
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold text-[#1B3A6B]">Заявки на склад</h2>
      {items.length === 0 ? <p className="mt-4 text-sm text-slate-600">Заявок пока нет.</p> :
        <div className="mt-4 divide-y divide-slate-100">{items.map((item) =>
          <Link key={item.id} href={`${ROUTES.MATERIAL_REQUESTS}/stock/${item.id}`}
            className="flex flex-col gap-1 py-3 hover:text-blue-700 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-medium">СЗ-{String(item.request_number).padStart(6, '0')} · {item.title}</span>
            <span className="text-sm text-slate-600">{statusLabels[item.status] || item.status} · {factories.find((factory) => factory.id === item.factory_id)?.name || 'Завод'}</span>
          </Link>)}
        </div>}
    </section>
  </div>
}
