'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { approveMachineDiscountRequest, getMachineDiscountApproval, rejectMachineDiscountRequest, type MachineDiscountApprovalPayload } from '@/lib/actions/machine-discounts'

function money(value: number) {
  return `€${Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function MachineDiscountApprovalButton({ requestId, className }: { requestId: string; className?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [details, setDetails] = useState<MachineDiscountApprovalPayload | null>(null)
  const [comment, setComment] = useState('')

  const show = async () => {
    setOpen(true)
    setLoading(true)
    try {
      const result = await getMachineDiscountApproval(requestId)
      if (!result.data) throw new Error(result.error || 'Не удалось загрузить заявку')
      setDetails(result.data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось загрузить заявку')
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  const decide = async (decision: 'approved' | 'rejected') => {
    setLoading(true)
    try {
      const result = decision === 'approved'
        ? await approveMachineDiscountRequest(requestId)
        : await rejectMachineDiscountRequest({ requestId, comment })
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить решение')
      toast.success(decision === 'approved' ? 'Скидка одобрена' : 'Скидка отклонена')
      setOpen(false)
      setDetails(null)
      setComment('')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить решение')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  const request = details?.request
  return (
    <>
      <Button type="button" size="sm" onClick={show} className={className}>Подробнее</Button>
      <Dialog open={open} onOpenChange={(value) => { if (!loading) setOpen(value) }}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Согласование скидки</DialogTitle>
            <DialogDescription>Проверьте причину и финансовый результат перед решением.</DialogDescription>
          </DialogHeader>
          {loading && !request ? (
            <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-slate-600" role="status"><Loader2 className="h-4 w-4 animate-spin" />Загружаю заявку…</div>
          ) : request ? (
            <div className="space-y-4">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <Info label="Заказ" value={request.machine.name} />
                <Info label="Клиент" value={request.client.name} />
                <Info label="Инициатор" value={request.submitted_by_user?.full_name || 'Сотрудник'} />
                <Info label="Скидка" value={`${request.discount_percent}%`} />
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <div className="font-medium">Причина менеджера</div><div className="mt-1 whitespace-pre-wrap">{request.reason}</div>
              </div>
              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Info label="Товары до скидки" value={money(request.items_total_before_discount)} />
                <Info label="Сумма скидки" value={`−${money(request.discount_amount)}`} />
                <Info label="Товары со скидкой" value={money(request.discounted_items_total)} />
                <Info label="Транспорт и расходы" value={money(request.expenses_total)} />
                <Info label="Общая сумма до" value={money(request.total_before_discount)} />
                <Info label="Общая сумма после" value={money(request.total_after_discount)} strong />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`discount-rejection-${request.id}`}>Комментарий к решению</Label>
                <Textarea id={`discount-rejection-${request.id}`} value={comment} onChange={(event) => setComment(event.target.value)}
                  placeholder="Для отклонения комментарий обязателен" rows={3} disabled={request.status !== 'pending' || loading} />
              </div>
              {request.status !== 'pending' && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">Заявка уже обработана: {request.status}.</div>}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading} className="min-h-11">Закрыть</Button>
            <Button type="button" variant="outline" onClick={() => decide('rejected')} disabled={loading || request?.status !== 'pending' || comment.trim().length < 3} className="min-h-11 border-red-200 text-red-700 hover:bg-red-50">Отклонить</Button>
            <Button type="button" onClick={() => decide('approved')} disabled={loading || request?.status !== 'pending'} className="min-h-11">{loading && <Loader2 className="h-4 w-4 animate-spin" />}Одобрить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Info({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="rounded-lg border border-slate-200 bg-white px-3 py-2"><div className="text-xs font-medium text-slate-500">{label}</div><div className={strong ? 'mt-1 font-bold tabular-nums text-emerald-700' : 'mt-1 font-semibold tabular-nums text-slate-950'}>{value}</div></div>
}
