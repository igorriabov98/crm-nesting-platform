'use client'
/* eslint-disable @typescript-eslint/no-explicit-any -- compact view model is returned by a migration-backed action. */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { confirmFutureDetailing, correctFutureDetailingPlan } from '@/lib/actions/future-inventory'
import { ROUTES } from '@/lib/constants/routes'

export function FutureDetailingPage({ data }: { data: any }) {
  const router = useRouter(); const [pending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Record<string, { quantity: string; reason: string }>>({})
  const [planReasons, setPlanReasons] = useState<Record<string, string>>({})
  const statusLabel: Record<string, string> = { planned: 'Запланировано', awaiting_confirmation: 'Ожидает подтверждения', confirmed: 'Подтверждено', cancelled: 'Отменено' }
  function confirm(batch: any) {
    const items = batch.items.map((item: any) => ({ itemId: item.id, actualQuantity: Number(drafts[item.id]?.quantity ?? item.planned_quantity), reason: drafts[item.id]?.reason || '' }))
    startTransition(async () => { const result = await confirmFutureDetailing(batch.id, items); if (!result.success) { toast.error(result.error); return } toast.success('Фактическая деталировка принята на склад'); router.refresh() })
  }
  function correctPlan(batch: any) {
    const items = batch.items.filter((item: any) => item.status === 'planned').map((item: any) => ({ itemId: item.id, quantity: Number(drafts[item.id]?.quantity ?? item.planned_quantity) }))
    startTransition(async () => { const result = await correctFutureDetailingPlan(batch.id, items, planReasons[batch.id] || ''); if (!result.success) { toast.error(result.error); return } toast.success('План будущей деталировки скорректирован'); router.refresh() })
  }
  return <main className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold">Будущая деталировка</h1><p className="text-muted-foreground">До подтверждения детали не входят в обычный остаток.</p></div><div><Label>Завод</Label><Select value={data.selectedFactory} onValueChange={(value) => router.push(`${ROUTES.INVENTORY_FUTURE_DETAILING}?factory=${value}`)}><SelectTrigger className="w-56"><SelectValue>{data.factories.find((factory: any) => factory.id === data.selectedFactory)?.name || 'Выберите завод'}</SelectValue></SelectTrigger><SelectContent>{data.factories.map((factory: any) => <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>)}</SelectContent></Select></div></div>
    <div className="space-y-3">{data.batches.map((batch: any) => <Card key={batch.id}><CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-lg">{batch.machines?.name || 'Машина'}</CardTitle><div className="flex items-center gap-2">{batch.isOwner && <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href={`/technologist/requests/${batch.request_id}/correction`}>Отходность и время</Link>}<Badge variant="outline">{statusLabel[batch.status] || batch.status}</Badge></div></div><p className="text-sm text-muted-foreground">Автор: {batch.users?.full_name || '—'}{batch.confirmation_due_date ? ` · подтвердить до ${batch.confirmation_due_date}` : ''}</p></CardHeader><CardContent className="space-y-3">{batch.items.map((item: any) => { const changed = Number(drafts[item.id]?.quantity ?? item.planned_quantity) !== item.planned_quantity; return <div key={item.id} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_120px_minmax(180px,1fr)] md:items-end"><div><p className="font-medium">{item.detailing_parts?.name}</p><p className="text-sm text-muted-foreground">{item.detailing_parts?.drawing_number} · план {item.planned_quantity} шт.</p></div>{batch.status === 'awaiting_confirmation' && batch.isOwner ? <><div><Label>Факт, шт.</Label><Input type="number" min="0" value={drafts[item.id]?.quantity ?? String(item.planned_quantity)} onChange={(e) => setDrafts({ ...drafts, [item.id]: { quantity: e.target.value, reason: drafts[item.id]?.reason || '' } })} /></div><div><Label>Причина {changed ? '*' : '(необязательно)'}</Label><Input value={drafts[item.id]?.reason || ''} onChange={(e) => setDrafts({ ...drafts, [item.id]: { quantity: drafts[item.id]?.quantity ?? String(item.planned_quantity), reason: e.target.value } })} /></div></> : batch.status === 'planned' && batch.isOwner && item.status === 'planned' ? <><div><Label>План, шт.</Label><Input type="number" min="1" value={drafts[item.id]?.quantity ?? String(item.planned_quantity)} onChange={(e) => setDrafts({ ...drafts, [item.id]: { quantity: e.target.value, reason: '' } })} /></div><p className="text-sm text-muted-foreground">До первого факта</p></> : <p className="md:col-span-2">Факт: {item.actual_quantity ?? '—'} шт.</p>}</div>})}{batch.status === 'awaiting_confirmation' && batch.isOwner && <div className="flex justify-end"><Button disabled={pending} onClick={() => confirm(batch)}>{pending ? 'Подтверждаем…' : 'Подтвердить выпуск'}</Button></div>}{batch.status === 'planned' && batch.isOwner && <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-end"><div className="sm:w-80"><Label>Причина корректировки *</Label><Input value={planReasons[batch.id] || ''} onChange={(e) => setPlanReasons({ ...planReasons, [batch.id]: e.target.value })} /></div><Button disabled={pending} onClick={() => correctPlan(batch)}>Сохранить корректировку</Button></div>}</CardContent></Card>)}{data.batches.length === 0 && <Card><CardContent className="py-10 text-center text-muted-foreground">На выбранном заводе позиций нет.</CardContent></Card>}</div>
  </main>
}
