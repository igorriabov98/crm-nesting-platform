"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { correctInvoicePayment, recordInvoicePayment } from '@/lib/actions/invoices'
import { todayDateOnly } from '@/lib/invoices/payment-schedule'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { InvoicePaymentEntry } from '@/lib/payments/types'

export function PaymentDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  remainingAmount,
  payment,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceId: string
  invoiceNumber: string
  remainingAmount: number
  payment?: InvoicePaymentEntry | null
}) {
  const router = useRouter()
  const today = todayDateOnly()
  const [amount, setAmount] = useState('')
  const [paidOn, setPaidOn] = useState(today)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const isCorrection = Boolean(payment)

  useEffect(() => {
    if (!open) return
    setAmount(payment ? String(payment.amount) : '')
    setPaidOn(payment?.paidOn || today)
    setNote(payment?.note || '')
    setReason('')
  }, [open, payment, today])

  const submit = async () => {
    setIsSaving(true)
    try {
      const parsedAmount = Number(amount)
      const result = payment
        ? await correctInvoicePayment({ paymentId: payment.id, amount: parsedAmount, paidOn, note, reason })
        : await recordInvoicePayment({ invoiceId, amount: parsedAmount, paidOn, note })
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить оплату')
      toast.success(payment ? 'Исправление оплаты сохранено в журнале' : 'Оплата добавлена')
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить оплату')
    } finally {
      setIsSaving(false)
    }
  }

  const maximum = payment ? remainingAmount + payment.amount : remainingAmount

  return (
    <Dialog open={open} onOpenChange={(value) => !isSaving && onOpenChange(value)}>
      <DialogContent className="bg-white text-slate-950 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isCorrection ? 'Исправить оплату' : 'Добавить оплату'}</DialogTitle>
          <DialogDescription>
            Инвойс {invoiceNumber}. {isCorrection ? 'Старая запись будет аннулирована, а замена останется в аудите.' : `Доступный остаток: €${remainingAmount.toLocaleString('ru-RU')}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <Label htmlFor="payment-amount">Сумма, EUR</Label>
            <Input id="payment-amount" type="number" min="0.01" max={maximum} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-2" autoFocus />
          </div>
          <div>
            <Label htmlFor="payment-date">Фактическая дата оплаты</Label>
            <Input id="payment-date" type="date" max={today} value={paidOn} onChange={(event) => setPaidOn(event.target.value)} className="mt-2" />
          </div>
          <div>
            <Label htmlFor="payment-note">Примечание</Label>
            <Textarea id="payment-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} className="mt-2" placeholder="Необязательно" />
          </div>
          {isCorrection && (
            <div>
              <Label htmlFor="payment-reason">Причина исправления</Label>
              <Textarea id="payment-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} className="mt-2" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Отмена</Button>
          <Button type="button" onClick={() => void submit()} disabled={isSaving || !paidOn || paidOn > today || Number(amount) <= 0 || Number(amount) > maximum || (isCorrection && !reason.trim())} className="bg-blue-950 hover:bg-blue-900">
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {isCorrection ? 'Сохранить исправление' : 'Добавить оплату'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
