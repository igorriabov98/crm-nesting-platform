"use client"

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Download, FileText, Loader2, Pencil, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PaymentDialog } from '@/components/features/payments/PaymentDialog'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'
import type { InvoicePaymentEntry, InvoiceRegistryData, InvoiceRegistryRow, PaymentDisplayStatus } from '@/lib/payments/types'

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' })
const date = (value: string | null) => value ? value.slice(0, 10).split('-').reverse().join('.') : '—'
const statusLabels: Record<PaymentDisplayStatus, string> = {
  not_paid: 'Не оплачен',
  partially_paid: 'Частично оплачен',
  paid: 'Оплачен',
  overdue: 'Просрочен',
  cancelled: 'Аннулирован',
}
const statusFilterLabels: Record<'all' | PaymentDisplayStatus, string> = {
  all: 'Все статусы',
  not_paid: 'Не оплачены',
  partially_paid: 'Частично оплачены',
  paid: 'Оплачены',
  overdue: 'Просрочены',
  cancelled: 'Аннулированы',
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

export function InvoiceList({ data, resultLimit }: { data: InvoiceRegistryData; resultLimit?: number }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | PaymentDisplayStatus>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [paymentTarget, setPaymentTarget] = useState<InvoiceRegistryRow | null>(null)
  const [correctionTarget, setCorrectionTarget] = useState<{ invoice: InvoiceRegistryRow; payment: InvoicePaymentEntry } | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const invoices = useMemo(() => data.invoices.filter((invoice) => {
    const needle = search.toLocaleLowerCase('ru')
    if (needle && !`${invoice.invoiceNumber} ${invoice.machineName} ${invoice.clientName}`.toLocaleLowerCase('ru').includes(needle)) return false
    return status === 'all' || invoice.status === status
  }), [data.invoices, search, status])

  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const downloadPdf = async (invoice: InvoiceRegistryRow) => {
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
        <SummaryCard label="Остаток" value={money.format(data.summary.debtAmount)} />
        <SummaryCard label="Просрочено" value={money.format(data.summary.overdueDebtAmount)} danger />
        <SummaryCard
          label="Ближайшее обязательство"
          value={data.summary.nearestPaymentDate ? `${date(data.summary.nearestPaymentDate)} · ${money.format(data.summary.nearestPaymentAmount)}${data.summary.nearestPaymentIsForecast ? ' · прогноз' : ''}` : '—'}
        />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="invoice-filters-title">
        <h2 id="invoice-filters-title" className="sr-only">Фильтры инвойсов</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="invoice-search">Поиск</Label>
            <div className="relative mt-2"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input id="invoice-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Инвойс, машина или компания" className="pl-9" /></div>
          </div>
          <div>
            <Label htmlFor="invoice-status">Статус</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
              <SelectTrigger id="invoice-status" className="mt-2 w-full"><SelectValue>{statusFilterLabels[status]}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                <SelectItem value="not_paid">Не оплачены</SelectItem>
                <SelectItem value="partially_paid">Частично оплачены</SelectItem>
                <SelectItem value="paid">Оплачены</SelectItem>
                <SelectItem value="overdue">Просрочены</SelectItem>
                <SelectItem value="cancelled">Аннулированы</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {resultLimit && data.invoices.length >= resultLimit && <p className="text-sm text-slate-500">Показаны последние {resultLimit} инвойсов.</p>}
      <div className="space-y-3">
        {invoices.map((invoice) => {
          const isOpen = expanded.has(invoice.id)
          const nextPart = invoice.schedule.find((part) => part.remainingAmount > 0)
          return (
            <article key={invoice.id} className={cn('overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm', invoice.isCancelled && 'opacity-80')}>
              <button type="button" onClick={() => toggle(invoice.id)} aria-expanded={isOpen} className="grid min-h-20 w-full gap-3 px-4 py-4 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-700 sm:grid-cols-[1.2fr_1fr_0.8fr_auto] sm:items-center sm:px-5">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-blue-950">{invoice.invoiceNumber}</span>{statusBadge(invoice.status)}</div><p className="mt-1 truncate text-sm text-slate-500">{invoice.clientName} · {invoice.machineName}</p></div>
                <div><p className="text-sm text-slate-500">Остаток</p><p className="font-semibold text-slate-950">{money.format(invoice.remainingAmount)}</p></div>
                <div><p className="text-sm text-slate-500">Ожидается</p><p className="text-sm font-medium text-slate-900">{nextPart?.dueDate ? date(nextPart.dueDate) : '—'}{nextPart?.isForecast ? ' · прогноз' : ''}</p></div>
                <ChevronDown className={cn('hidden h-5 w-5 text-slate-500 transition sm:block', isOpen && 'rotate-180')} />
              </button>

              {isOpen && (
                <div className="border-t border-slate-200 px-4 py-5 sm:px-5">
                  <div className="grid gap-4 sm:grid-cols-4">
                    <Value label="Дата инвойса" value={date(invoice.invoiceDate)} />
                    <Value label="Сумма" value={money.format(invoice.amount)} />
                    <Value label="Оплачено" value={money.format(invoice.paidAmount)} />
                    <Value label="Ответственный" value={invoice.responsibleName || 'не назначен'} />
                  </div>
                  <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/50 p-3 text-sm text-slate-700">
                    <span className="font-medium text-blue-950">Условия инвойса: </span>
                    {invoice.paymentTermsDescription}
                  </div>
                  <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    <Button type="button" variant="outline" onClick={() => void downloadPdf(invoice)} disabled={downloadingId === invoice.id}>{downloadingId === invoice.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}PDF</Button>
                    <Button render={<Link href={`${ROUTES.SALES_PLAN}/${invoice.machineId}`} />} variant="outline"><FileText className="mr-2 h-4 w-4" />Карточка машины</Button>
                    {invoice.canManagePayments && !invoice.isCancelled && invoice.remainingAmount > 0 && <Button type="button" onClick={() => setPaymentTarget(invoice)} className="bg-blue-950 hover:bg-blue-900"><Plus className="mr-2 h-4 w-4" />Добавить оплату</Button>}
                  </div>

                  <div className="mt-6">
                    <h3 className="font-medium text-slate-950">Журнал платежей</h3>
                    <div className="mt-3 space-y-2">
                      {invoice.payments.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">Платежей пока нет.</p> : invoice.payments.map((payment) => (
                        <div key={payment.id} className={cn('flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between', payment.isVoided ? 'bg-slate-50 text-slate-500' : 'bg-white')}>
                          <div><p className={cn('font-medium', payment.isVoided && 'line-through')}>{money.format(payment.amount)} · {payment.paidOn ? date(payment.paidOn) : 'дата не указана'}</p><p className="mt-1 text-xs">{payment.source === 'legacy' ? 'Перенесено из старого учёта' : `Добавил: ${payment.createdByName || 'не указано'}`}{payment.note ? ` · ${payment.note}` : ''}</p>{payment.isVoided && <p className="mt-1 text-xs text-red-700">Аннулировано: {payment.voidReason || 'причина не указана'}</p>}</div>
                          {invoice.canManagePayments && !invoice.isCancelled && !payment.isVoided && <Button type="button" variant="outline" size="sm" onClick={() => setCorrectionTarget({ invoice, payment })}><Pencil className="mr-2 h-3.5 w-3.5" />Исправить</Button>}
                        </div>
                      ))}
                    </div>
                  </div>
                  {invoice.isCancelled && <p className="mt-4 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">Аннулирован: {invoice.cancellationReason || 'причина не указана'}.</p>}
                </div>
              )}
            </article>
          )
        })}
      </div>
      {invoices.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-14 text-center text-slate-500">Инвойсы не найдены.</div>}

      {paymentTarget && <PaymentDialog open invoiceId={paymentTarget.id} invoiceNumber={paymentTarget.invoiceNumber} remainingAmount={paymentTarget.remainingAmount} onOpenChange={(open) => !open && setPaymentTarget(null)} />}
      {correctionTarget && <PaymentDialog open invoiceId={correctionTarget.invoice.id} invoiceNumber={correctionTarget.invoice.invoiceNumber} remainingAmount={correctionTarget.invoice.remainingAmount} payment={correctionTarget.payment} onOpenChange={(open) => !open && setCorrectionTarget(null)} />}
    </div>
  )
}

function SummaryCard({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <Card className={danger ? 'border border-red-200 bg-red-50/50' : 'border border-slate-200 bg-white'}><CardHeader><CardTitle className={danger ? 'text-red-800' : 'text-slate-600'}>{label}</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold text-blue-950">{value}</p></CardContent></Card>
}

function Value({ label, value }: { label: string; value: string }) {
  return <div><p className="text-sm text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-950">{value}</p></div>
}
