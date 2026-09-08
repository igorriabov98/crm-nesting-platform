'use client'

import { useState, useTransition } from 'react'
import { Ban, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cancelReturnedSupplyPosition } from '@/lib/actions/supply-position-returns'
import type { SupplyPositionTable } from '@/lib/supply-orders/position-revisions'
import { notifySidebarWorkQueuesChanged } from '@/lib/sidebar-work-queue-events'

export function CancelReturnedSupplyPositionDialog({
  table,
  itemId,
  compact = false,
}: {
  table: SupplyPositionTable
  itemId: string
  compact?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      const result = await cancelReturnedSupplyPosition({ table, itemId, reason })
      if (!result.success) {
        toast.error(result.error || 'Не удалось отменить позицию')
        return
      }
      toast.success(result.data?.idempotent ? 'Позиция уже была отменена' : 'Позиция отменена')
      setOpen(false)
      setReason('')
      notifySidebarWorkQueuesChanged()
      router.refresh()
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={compact ? 'sm' : 'default'}
        className={compact
          ? 'min-h-11 border-red-200 px-3 text-xs text-red-700 hover:bg-red-50 hover:text-red-800'
          : 'min-h-11 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800'}
        onClick={() => setOpen(true)}
      >
        <Ban className="size-4" aria-hidden="true" />
        Отменить
      </Button>

      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (!pending) {
          setOpen(nextOpen)
          if (!nextOpen) setReason('')
        }
      }}>
        <DialogContent className="border-slate-200 bg-white p-0 sm:max-w-lg">
          <form onSubmit={submit}>
            <DialogHeader className="border-b border-slate-200 px-5 py-5 sm:px-6">
              <DialogTitle className="text-xl text-red-950">Окончательно отменить позицию?</DialogTitle>
              <DialogDescription>
                Потребность будет закрыта без восстановления исходного заказа. Отмена сохранится в истории и разделе «Закрытые».
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 px-5 py-5 sm:px-6">
              <Label htmlFor={`returned-position-cancel-reason-${itemId}`}>Причина отмены</Label>
              <Textarea
                id={`returned-position-cancel-reason-${itemId}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={3}
                maxLength={2000}
                required
                autoFocus
                rows={5}
                className="min-h-32 resize-y focus-visible:ring-2 focus-visible:ring-red-600"
                placeholder="Почему потребность больше не нужно исправлять и заказывать"
              />
              <p className="text-xs text-slate-500">От 3 до 2000 символов.</p>
            </div>
            <DialogFooter className="border-t border-slate-200 px-5 py-4 sm:px-6">
              <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setOpen(false)}>
                Назад
              </Button>
              <Button type="submit" variant="destructive" className="min-h-11" disabled={pending || reason.trim().length < 3}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Ban className="size-4" aria-hidden="true" />}
                {pending ? 'Отменяем…' : 'Отменить позицию'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

