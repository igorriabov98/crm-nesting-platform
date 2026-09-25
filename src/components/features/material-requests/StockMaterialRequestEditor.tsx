'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TechnologistRequestPage } from '@/components/features/requests/TechnologistRequestPage'
import { updateStockMaterialRequest } from '@/lib/actions/stock-material-requests'
import { ROUTES } from '@/lib/constants/routes'
import type { TechnologistRequestPayload } from '@/lib/technologist-requests/request-payload'
import type { SteelType } from '@/lib/types/database'

export function StockMaterialRequestEditor({ data, number, revision, approvalState, factoryName, canManage, steelTypes, backHref = ROUTES.MATERIAL_REQUESTS }: {
  data: TechnologistRequestPayload
  number: number
  revision: number
  approvalState: string | null
  factoryName: string
  canManage: boolean
  steelTypes: SteelType[]
  backHref?: string
}) {
  const router = useRouter()
  const [title, setTitle] = useState(data.request.title || '')
  const [neededBy, setNeededBy] = useState(data.request.needed_by || '')
  const [savedMeta, setSavedMeta] = useState({ title: data.request.title || '', neededBy: data.request.needed_by || '' })
  const [busy, setBusy] = useState(false)
  const editable = canManage && data.request.status === 'draft'
  const pendingMeta = title.trim() !== savedMeta.title.trim() || neededBy !== savedMeta.neededBy
  const save = async () => {
    setBusy(true)
    try {
      const result = await updateStockMaterialRequest(data.request.id, {
        title, factoryId: data.request.factory_id!, neededBy: neededBy || null,
      })
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить заявку')
      setSavedMeta({ title: title.trim(), neededBy })
      toast.success('Данные заявки сохранены')
      router.refresh()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Не удалось сохранить заявку') }
    finally { setBusy(false) }
  }
  return <div className="space-y-6">
    <section className="rounded-xl border bg-white p-5">
      <div className="text-sm font-semibold text-[#1B3A6B]">СЗ-{String(number).padStart(6, '0')} · {factoryName}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px_auto] sm:items-end">
        <label className="space-y-1 text-sm font-medium">Название
          <Input value={title} onChange={(event) => setTitle(event.target.value)} disabled={!editable} maxLength={160} />
        </label>
        <label className="space-y-1 text-sm font-medium">Нужен к дате
          <Input type="date" value={neededBy} onChange={(event) => setNeededBy(event.target.value)} disabled={!editable} />
        </label>
        {editable && <Button variant="outline" disabled={busy || !title.trim()} onClick={save}>Сохранить</Button>}
      </div>
    </section>
    <TechnologistRequestPage
      machine={{ id: data.request.id, name: data.request.title || 'Заявка на склад' }}
      data={data} suppliers={{ sheetMetal: [] }} canManage={canManage}
      steelTypes={steelTypes} stockMode
      canSubmit={!pendingMeta}
      requestNumber={number} revisionNumber={revision || null} approvalState={approvalState}
      backHref={backHref} backLabel="Назад к заявкам"
    />
  </div>
}
