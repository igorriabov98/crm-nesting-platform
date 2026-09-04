"use client"

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ChevronDown, Download, FileText, Loader2, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/lib/constants/routes'
import type { ClientPaymentDetails, ClientPaymentsInvoice, InvoicePaymentEntry, PaymentDisplayStatus } from '@/lib/payments/types'
import { PaymentDialog } from './PaymentDialog'
import { PAYMENT_TERMS_TYPE_LABELS, paymentTermsLabel } from '@/lib/payments/terms'

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' })
const date = (value: string | null) => value ? value.slice(0, 10).split('-').reverse().join('.') : 'дата не указана'

const statusLabels: Record<PaymentDisplayStatus, string> = {
  not_paid: 'Не оплачен',
  partially_paid: 'Частично оплачен',
  paid: 'Оплачен',
  overdue: 'Просрочен',
  cancelled: 'Аннулирован',
}

function statusBadge(status: PaymentDisplayStatus) {
  return <Badge className={cn(
    status === 'paid' && 'bg-emerald-700 text-white',
    status === 'partially_paid' && 'bg-blue-100 text-blue-900',
    status === 'overdue' && 'bg-red-700 text-white',
    status === 'not_paid' && 'bg-amber-100 text-amber-950',
    status === 'cancelled' && 'bg-slate-200 text-slate-700',
  )}>{statusLabels[status]}</Badge>
}

export function ClientPaymentsDetail({ data }: { data: ClientPaymentDetails }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(data.invoices[0] ? [data.invoices[0].id] : []))
  const [paymentTarget, setPaymentTarget] = useState<ClientPaymentsInvoice | null>(null)
  const [correctionTarget, setCorrectionTarget] = useState<{ invoice: ClientPaymentsInvoice; payment: InvoicePaymentEntry } | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const toggle = (invoiceId: string) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(invoiceId)) next.delete(invoiceId)
    else next.add(invoiceId)
    return next
  })

  const downloadPdf = async (invoice: ClientPaymentsInvoice) => {
    setDownloadingId(invoice.id)
    try {
      const response = await fetch('/api/documents/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId: invoice.machineId, invoiceId: invoice.id, type: 'invoice' }),
      })
      const errorBody = response.ok ? null : await response.json().catch(() => null)
      if (!response.ok) throw new Error(errorBody?.error || 'Не удалось скачать PDF')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `Invoice_${invoice.invoiceNumber.replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось скачать PDF')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Выставлено" value={money.format(data.summary.issuedAmount)} />
        <SummaryCard label="Оплачено" value={money.format(data.summary.paidAmount)} />
        <SummaryCard label="Общий долг" value={money.format(data.summary.debtAmount)} />
        <SummaryCard label="Просроченный долг" value={money.format(data.summary.overdueDebtAmount)} danger />
        <SummaryCard
          label="Ближайшее обязательство"
          value={data.summary.nearestPaymentDate ? `${date(data.summary.nearestPaymentDate)} · ${money.format(data.summary.nearestPaymentAmount)}${data.summary.nearestPaymentIsForecast ? ' · прогноз' : ''}` : '—'}
        />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="client-payment-terms">
        <h2 id="client-payment-terms" className="font-semibold text-blue-950">Условия компании</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-slate-500">Ответственный</dt><dd className="mt-1 font-medium text-slate-900">{data.client.responsibleName || 'не назначен'}</dd></div>
          <div><dt className="text-slate-500">Тип оплаты</dt><dd className="mt-1 font-medium text-slate-900">{PAYMENT_TERMS_TYPE_LABELS[data.client.paymentTermsType as keyof typeof PAYMENT_TERMS_TYPE_LABELS] || 'Условия не указаны'}</dd></div>
          <div className="sm:col-span-2"><dt className="text-slate-500">Условия</dt><dd className="mt-1 font-medium text-slate-900">{paymentTermsLabel({
            type: data.client.paymentTermsType,
            days: data.client.paymentDueDays,
            prepaymentPercent: data.client.prepaymentPercent,
            finalDays: data.client.finalPaymentDueDays,
            scheduledWeekdays: data.client.scheduledPaymentWeekdays,
            scheduledMonthDays: data.client.scheduledPaymentMonthDays,
            scheduledAmountMode: data.client.scheduledPaymentAmountMode,
            scheduledMinimumAmount: data.client.scheduledPaymentMinimumAmount,
          })}</dd></div>
          <div><dt className="text-slate-500">Норматив доставки</dt><dd className="mt-1 font-medium text-slate-900">{data.client.estimatedDeliveryDays} календ. дн.</dd></div>
        </dl>
      </section>

      <section className="space-y-3" aria-labelledby="client-invoices-title">
        <h2 id="client-invoices-title" className="text-lg font-semibold text-blue-950">Инвойсы компании</h2>
        {data.invoices.map((invoice) => {
          const isOpen = expanded.has(invoice.id)
          return (
            <article key={invoice.id} className={cn('overflow-hidden rounded-2xl border bg-white shadow-sm', invoice.isCancelled ? 'border-slate-200 opacity-80' : 'border-slate-200')}>
              <button type="button" onClick={() => toggle(invoice.id)} aria-expanded={isOpen} className="flex min-h-16 w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-700 sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-blue-950">{invoice.invoiceNumber}</span>{statusBadge(invoice.status)}</div>
                  <p className="mt-1 truncate text-sm text-slate-500">{invoice.machineName} · выставлен {date(invoice.invoiceDate)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3"><span className="hidden text-right sm:block"><span className="block font-semibold text-slate-950">{money.format(invoice.remainingAmount)}</span><span className="text-xs text-slate-500">остаток</span></span><ChevronDown className={cn('h-5 w-5 text-slate-500 transition', isOpen && 'rotate-180')} /></div>
              </button>

              {isOpen && (
                <div className="border-t border-slate-200 px-4 py-5 sm:px-5">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Value label="Сумма" value={money.format(invoice.amount)} />
                    <Value label="Оплачено" value={money.format(invoice.paidAmount)} />
                    <Value label="Остаток" value={money.format(invoice.remainingAmount)} />
                  </div>
                  <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/50 p-3 text-sm text-slate-700">
                    <span className="font-medium text-blue-950">Условия инвойса: </span>
                    {invoice.paymentTermsDescription}
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {invoice.schedule.map((part) => (
                      <div key={part.key} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-start justify-between gap-3"><p className="font-medium text-slate-900">{part.label}</p>{part.isOverdue && <AlertTriangle className="h-4 w-4 text-red-700" aria-label="Просрочено" />}</div>
                        <p className="mt-1 text-sm text-slate-600">{money.format(part.remainingAmount)} до {part.dueDate ? date(part.dueDate) : '—'}</p>
                        {part.isForecast && <p className="mt-1 text-xs text-blue-700">Прогноз; официальная просрочка не рассчитывается</p>}
                        {!part.dueDate && <p className="mt-1 text-xs text-slate-500">Недостаточно данных для прогноза</p>}
                      </div>
                    ))}
                  </div>

                  {invoice.isCancelled && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">Аннулирован {date(invoice.cancelledAt)}. Причина: {invoice.cancellationReason || 'не указана'}.</div>}

                  <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    <Button type="button" variant="outline" onClick={() => void downloadPdf(invoice)} disabled={downloadingId === invoice.id}>
                      {downloadingId === invoice.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                      PDF
                    </Button>
                    <Button render={<Link href={`${ROUTES.SALES_PLAN}/${invoice.machineId}`} />} variant="outline"><FileText className="mr-2 h-4 w-4" />Карточка машины</Button>
                    {data.canManagePayments && !invoice.isCancelled && invoice.remainingAmount > 0 && <Button type="button" onClick={() => setPaymentTarget(invoice)} className="bg-blue-950 hover:bg-blue-900"><Plus className="mr-2 h-4 w-4" />Добавить оплату</Button>}
                  </div>

                  <div className="mt-6">
                    <h3 className="font-medium text-slate-950">История платежей</h3>
                    <div className="mt-3 space-y-2">
                      {invoice.payments.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">Платежей пока нет.</p> : invoice.payments.map((payment) => (
                        <div key={payment.id} className={cn('flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between', payment.isVoided ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-slate-200')}>
                          <div>
                            <p className={cn('font-medium', payment.isVoided && 'line-through')}>{money.format(payment.amount)} · {date(payment.paidOn)}</p>
                            <p className="mt-1 text-xs">{payment.source === 'legacy' ? 'Перенесено из старого учёта' : `Добавил: ${payment.createdByName || 'не указано'}`}{payment.note ? ` · ${payment.note}` : ''}</p>
                            {payment.isVoided && <p className="mt-1 text-xs text-red-700">Аннулировано: {payment.voidReason || 'причина не указана'}</p>}
                          </div>
                          {data.canManagePayments && !payment.isVoided && !invoice.isCancelled && <Button type="button" size="sm" variant="outline" onClick={() => setCorrectionTarget({ invoice, payment })}><Pencil className="mr-2 h-3.5 w-3.5" />Исправить</Button>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </article>
          )
        })}
        {data.invoices.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-14 text-center text-slate-500">У компании пока нет выставленных инвойсов.</div>}
      </section>

      {paymentTarget && <PaymentDialog open invoiceId={paymentTarget.id} invoiceNumber={paymentTarget.invoiceNumber} remainingAmount={paymentTarget.remainingAmount} onOpenChange={(open) => !open && setPaymentTarget(null)} />}
      {correctionTarget && <PaymentDialog open invoiceId={correctionTarget.invoice.id} invoiceNumber={correctionTarget.invoice.invoiceNumber} remainingAmount={correctionTarget.invoice.remainingAmount} payment={correctionTarget.payment} onOpenChange={(open) => !open && setCorrectionTarget(null)} />}
    </div>
  )
}

function SummaryCard({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <Card className={danger ? 'border border-red-200 bg-red-50/50' : 'border border-slate-200 bg-white'}><CardHeader><CardTitle className={danger ? 'text-red-800' : 'text-slate-600'}>{label}</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold text-blue-950">{value}</p></CardContent></Card>
}

function Value({ label, value }: { label: string; value: string }) {
  return <div><p className="text-sm text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-950">{value}</p></div>
}
