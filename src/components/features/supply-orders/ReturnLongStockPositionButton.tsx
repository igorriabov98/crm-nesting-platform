'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { returnLongStockPositionToTechnologist } from '@/lib/actions/supply-orders'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  requestItemTable: string
  requestItemId: string
  planNumber: number
  versionNumber: number
}

export function ReturnLongStockPositionButton({
  requestItemTable,
  requestItemId,
  planNumber,
  versionNumber,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    startTransition(async () => {
      const result = await returnLongStockPositionToTechnologist({
        requestItemTable,
        requestItemId,
        reason,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось вернуть позицию технологу')
        return
      }
      toast.success('Позиция возвращена автору плана на пересчёт')
      setOpen(false)
      setReason('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!pending) setOpen(nextOpen)
    }}>
      <DialogTrigger render={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-9 border-amber-300 text-amber-900 hover:bg-amber-50"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Вернуть технологу
        </Button>
      } />
      <DialogContent className="border-slate-200 bg-white p-0 sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader className="border-b border-slate-200 px-5 py-5 sm:px-6">
            <DialogTitle className="text-xl text-slate-950">Вернуть позицию на пересчёт</DialogTitle>
            <DialogDescription>
              Карта №{planNumber}, версия {versionNumber}. Позиция станет недоступна для резки до утверждения новой версии.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-5 py-5 sm:px-6">
            <Label htmlFor={`long-stock-return-reason-${requestItemId}`}>Причина возврата</Label>
            <Textarea
              id={`long-stock-return-reason-${requestItemId}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={3}
              maxLength={2000}
              required
              rows={5}
              className="min-h-32 resize-y"
              placeholder="Например: 8500 мм только под заказ, срок поставки шесть недель"
            />
            <p className="text-xs leading-5 text-slate-500">
              Запрос попадёт автору утверждённой карты в общий список запросов и закроется автоматически после нового утверждения.
            </p>
          </div>
          <DialogFooter className="mx-0 mb-0 rounded-none px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={pending || reason.trim().length < 3} className="bg-amber-700 text-white hover:bg-amber-800">
              {pending ? 'Возвращаем…' : 'Вернуть на пересчёт'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
