"use client"

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AlertTriangle, CalendarDays, Download, FileText, Info, Loader2, Plus, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cancelMachineInvoice, issueMachineInvoice } from '@/lib/actions/invoices'
import {
  buildInvoicePaymentSchedule,
  invoiceDisplayStatus,
  todayDateOnly,
} from '@/lib/invoices/payment-schedule'
import { useRole } from '@/lib/hooks/useRole'
import type { Invoice, MachineDetails } from '@/lib/types'

interface InvoiceTabProps {
  machine: MachineDetails
  canManage: boolean
}

const currency = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' })

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return format(new Date(`${value.slice(0, 10)}T00:00:00`), 'dd.MM.yyyy', { locale: ru })
}

function invoiceStatusBadge(status: ReturnType<typeof invoiceDisplayStatus>) {
  if (status === 'paid') return <Badge className="bg-emerald-700 text-white">Оплачен</Badge>
  if (status === 'partially_paid') return <Badge className="bg-blue-100 text-blue-900">Частично оплачен</Badge>
  if (status === 'overdue') return <Badge className="bg-red-700 text-white">Просрочен</Badge>
  if (status === 'cancelled') return <Badge variant="outline">Аннулирован</Badge>
  return <Badge className="bg-amber-100 text-amber-950">Не оплачен</Badge>
}

export function InvoiceTab({ machine, canManage }: InvoiceTabProps) {
  const router = useRouter()
  const { isDirector, isAdminPosition } = useRole()
  const today = todayDateOnly()
  const invoices = useMemo(() => {
    const value = Array.isArray(machine.invoice) ? machine.invoice : machine.invoice ? [machine.invoice] : []
    return [...value].sort((a, b) => Number(b.invoice_revision || 0) - Number(a.invoice_revision || 0))
  }, [machine.invoice])
  const invoice = invoices.find((item) => item.status !== 'cancelled') || null
  const latestCancelled = invoices.find((item) => item.status === 'cancelled') || null
  const [showIssueForm, setShowIssueForm] = useState(false)
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [isIssuing, setIsIssuing] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [isCancelling, setIsCancelling] = useState(false)

  const downloadInvoice = async (item: Invoice) => {
    setIsDownloading(true)
    try {
      const response = await fetch('/api/documents/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId: machine.id, invoiceId: item.id, type: 'invoice' }),
      })
      const body = response.ok ? null : await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || 'Не удалось сформировать документ инвойса')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const safeNumber = (item.invoice_number || machine.name).replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
      link.href = url
      link.download = `Invoice_${safeNumber}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сформировать документ инвойса')
    } finally {
      setIsDownloading(false)
    }
  }

  const issueInvoice = async () => {
    setIsIssuing(true)
    try {
      const result = await issueMachineInvoice({ machineId: machine.id, invoiceDate })
      if (!result.success) throw new Error(result.error || 'Не удалось выставить инвойс')
      toast.success(`Инвойс ${result.invoiceNumber} выставлен. Документ доступен в карточке.`)
      setShowIssueForm(false)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось выставить инвойс', { duration: 9000 })
    } finally {
      setIsIssuing(false)
    }
  }

  const cancelInvoice = async () => {
    if (!invoice) return
    setIsCancelling(true)
    try {
      const result = await cancelMachineInvoice({ invoiceId: invoice.id, reason: cancelReason })
      if (!result.success) throw new Error(result.error || 'Не удалось аннулировать инвойс')
      toast.success('Инвойс аннулирован. Для машины можно выставить новую ревизию.')
      setCancelOpen(false)
      setCancelReason('')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось аннулировать инвойс')
    } finally {
      setIsCancelling(false)
    }
  }

  if (!invoice) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-blue-950">Активный инвойс ещё не выставлен</h3>
            <p className="mt-1 text-sm text-slate-600">
              {latestCancelled
                ? `Предыдущий инвойс ${latestCancelled.invoice_number} аннулирован. Новый получит номер следующей ревизии.`
                : 'Сначала выберите дату, затем подтвердите выставление. Сумма и документ будут зафиксированы.'}
            </p>

            {canManage && !machine.is_archived && !showIssueForm && (
              <Button type="button" onClick={() => setShowIssueForm(true)} className="mt-4 min-h-10 bg-blue-950 hover:bg-blue-900">
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Создать инвойс
              </Button>
            )}
            {machine.is_archived && <p className="mt-3 text-sm text-amber-800">Для архивной машины выставление недоступно.</p>}

            {showIssueForm && (
              <div className="mt-5 max-w-md rounded-xl border border-blue-100 bg-blue-50/60 p-4">
                <Label htmlFor="invoice-date">Дата выставления</Label>
                <Input
                  id="invoice-date"
                  type="date"
                  max={today}
                  value={invoiceDate}
                  onChange={(event) => setInvoiceDate(event.target.value)}
                  className="mt-2 bg-white"
                />
                <p className="mt-2 text-xs text-slate-600">Можно выбрать сегодняшнюю или прошедшую дату. Будущая дата запрещена.</p>
                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row">
                  <Button type="button" variant="outline" onClick={() => setShowIssueForm(false)} disabled={isIssuing}>Отмена</Button>
                  <Button type="button" onClick={() => void issueInvoice()} disabled={isIssuing || !invoiceDate || invoiceDate > today} className="bg-blue-950 hover:bg-blue-900">
                    {isIssuing && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    Выставить инвойс
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  const amount = Number(invoice.amount || 0)
  const paidAmount = Number(invoice.paid_amount || 0)
  const schedule = buildInvoicePaymentSchedule({
    amount,
    paidAmount,
    invoiceDate: invoice.invoice_date,
    paymentTermsType: invoice.payment_terms_type_snapshot,
    paymentDueDays: invoice.payment_due_days_snapshot,
    prepaymentPercent: invoice.prepayment_percent_snapshot,
    finalPaymentDueDays: invoice.final_payment_due_days_snapshot,
    estimatedDeliveryDays: invoice.estimated_delivery_days_snapshot,
    deliveryToClientDate: machine.delivery_to_client_date,
    actualShippingDate: machine.actual_shipping_date,
    desiredShippingDate: machine.desired_shipping_date,
  })
  const status = invoiceDisplayStatus({ amount, paidAmount, schedule })

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="machine-invoice-title">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h3 id="machine-invoice-title" className="flex items-center gap-2 text-lg font-semibold text-slate-950">
              <FileText className="h-5 w-5 text-blue-800" aria-hidden="true" />
              Инвойс {invoice.invoice_number}
            </h3>
            <div className="mt-2">{invoiceStatusBadge(status)}</div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => void downloadInvoice(invoice)} disabled={isDownloading} className="min-h-10 bg-white">
              {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              PDF инвойса
            </Button>
            {canManage && (isDirector || isAdminPosition) && (
              <Button type="button" variant="outline" onClick={() => setCancelOpen(true)} className="min-h-10 border-red-200 bg-white text-red-700 hover:bg-red-50">
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                Аннулировать
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
          <div><p className="text-sm text-slate-500">Сумма</p><p className="mt-1 text-xl font-semibold text-slate-950">{currency.format(amount)}</p></div>
          <div><p className="text-sm text-slate-500">Дата выставления</p><p className="mt-1 font-medium text-slate-900">{formatDate(invoice.invoice_date)}</p></div>
          <div><p className="text-sm text-slate-500">Оплачено</p><p className="mt-1 font-medium text-slate-900">{currency.format(paidAmount)}</p></div>
          <div><p className="text-sm text-slate-500">Остаток</p><p className="mt-1 font-medium text-slate-900">{currency.format(Math.max(0, amount - paidAmount))}</p></div>
        </div>

        <div className="border-t border-slate-200 px-5 py-5 sm:px-6">
          <h4 className="flex items-center gap-2 font-medium text-slate-950"><CalendarDays className="h-4 w-4 text-blue-800" />Ожидаемые оплаты</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {schedule.map((part) => (
              <div key={part.part} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-medium text-slate-900">{part.label}</p><p className="mt-1 text-sm text-slate-600">{currency.format(part.remainingAmount)} осталось</p></div>
                  {part.isOverdue && <AlertTriangle className="h-4 w-4 shrink-0 text-red-700" aria-label="Просрочено" />}
                </div>
                <p className="mt-2 text-sm text-slate-700">
                  {part.dueDate ? formatDate(part.dueDate) : 'Недостаточно данных для прогноза'}
                  {part.isForecast && part.dueDate ? ' · прогноз' : ''}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">Оплаты и их даты ведутся в разделе Sales → Оплаты.</p>
        </div>
      </section>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="bg-white text-slate-950">
          <AlertDialogHeader>
            <AlertDialogTitle>Аннулировать инвойс {invoice.invoice_number}?</AlertDialogTitle>
            <AlertDialogDescription>Действие сохранится в истории. Оно доступно только директору или Администратору CRM и только при отсутствии активных оплат.</AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label htmlFor="invoice-cancel-reason">Причина аннулирования</Label>
            <Textarea id="invoice-cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} className="mt-2" maxLength={1000} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelling}>Отмена</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={() => void cancelInvoice()} disabled={isCancelling || !cancelReason.trim()} className="bg-red-700 text-white hover:bg-red-800">
              {isCancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Аннулировать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
