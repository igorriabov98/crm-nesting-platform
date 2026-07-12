'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  decideBusinessScrapCorrection,
  getBusinessScrapCorrectionApproval,
  type BusinessScrapCorrectionApproval,
} from '@/lib/actions/business-scrap-corrections'
import { cn } from '@/lib/utils'

type Props = {
  taskId: string
  disabled?: boolean
  className?: string
}

function quantity(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}

export function BusinessScrapCorrectionApprovalButton({ taskId, disabled, className }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [comment, setComment] = useState('')
  const [approval, setApproval] = useState<BusinessScrapCorrectionApproval | null>(null)

  const openDialog = async () => {
    setOpen(true)
    setLoading(true)
    setApproval(null)
    setComment('')
    try {
      const result = await getBusinessScrapCorrectionApproval(taskId)
      if (!result.data || result.error) throw new Error(result.error || 'Не удалось загрузить запрос')
      setApproval(result.data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось загрузить запрос')
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!approval) return
    if (decision === 'rejected' && comment.trim().length < 3) {
      toast.error('Укажите причину отклонения')
      return
    }
    setSubmitting(true)
    try {
      const result = await decideBusinessScrapCorrection({
        requestId: approval.request.id,
        decision,
        comment,
      })
      if (!result.success) throw new Error(result.error || 'Не удалось обработать запрос')
      if (result.outcome === 'conflicted') {
        toast.error('Бронь уже изменилась. Технологу нужно создать новый запрос.')
      } else {
        toast.success(decision === 'approved' ? 'Корректировка одобрена' : 'Корректировка отклонена')
      }
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось обработать запрос')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button size="sm" type="button" onClick={openDialog} disabled={disabled || loading} className={className}>
        Рассмотреть
      </Button>
      <Dialog open={open} onOpenChange={(next) => !submitting && setOpen(next)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Корректировка делового остатка</DialogTitle>
            <DialogDescription>Старая бронь продолжает действовать до вашего решения.</DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">Загружаю изменения...</div>
          ) : approval ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">Машина</div>
                  <div className="mt-1 font-semibold text-slate-950">{approval.request.machine.name}</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">Технолог</div>
                  <div className="mt-1 font-semibold text-slate-950">{approval.request.requestedBy?.fullName || 'Сотрудник'}</div>
                </div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <div className="font-semibold">Причина</div>
                <div className="mt-1 whitespace-pre-wrap">{approval.request.reason}</div>
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 hover:bg-slate-50">
                      <TableHead>Позиция</TableHead>
                      <TableHead className="w-28 text-right">Было</TableHead>
                      <TableHead className="w-28 text-right">Станет</TableHead>
                      <TableHead className="w-28 text-right">Разница</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {approval.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium text-slate-950">{item.materialName}</div>
                          <div className="text-xs text-slate-500">{item.categoryLabel}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{quantity(item.oldQuantity)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{quantity(item.proposedQuantity)}</TableCell>
                        <TableCell className={cn('text-right font-semibold tabular-nums', item.difference < 0 ? 'text-red-700' : 'text-emerald-700')}>
                          {item.difference > 0 ? '+' : ''}{quantity(item.difference)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`business-scrap-decision-${taskId}`}>Комментарий к решению</Label>
                <Textarea
                  id={`business-scrap-decision-${taskId}`}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="При отклонении причина обязательна."
                  rows={3}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Закрыть</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => decide('rejected')}
              disabled={!approval || submitting || comment.trim().length < 3}
              className="border-red-200 text-red-700 hover:bg-red-50"
            >
              Отклонить
            </Button>
            <Button type="button" onClick={() => decide('approved')} disabled={!approval || submitting}>
              Одобрить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
