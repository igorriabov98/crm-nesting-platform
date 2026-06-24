"use client"

import React, { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertTriangle, FileText, Info } from 'lucide-react'
import { useRole } from '@/lib/hooks/useRole'
import { recordInvoicePayment, updateInvoiceStatus } from '@/lib/actions/invoices'
import { format, differenceInDays, isPast } from 'date-fns'
import { ru } from 'date-fns/locale'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { INVOICE_VISIBLE_ROLES } from '@/lib/constants/roles'
import type { InvoiceStatus, MachineDetails, UserRole } from '@/lib/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'

interface InvoiceTabProps {
  machine: MachineDetails
}

export function InvoiceTab({ machine }: InvoiceTabProps) {
  const { role } = useRole()
  const invoice = Array.isArray(machine.invoice) ? machine.invoice[0] || null : machine.invoice
  const [paidAmount, setPaidAmount] = useState('')
  const [balanceDueDate, setBalanceDueDate] = useState<string | null>(null)
  const [isSavingPayment, setIsSavingPayment] = useState(false)

  // Ensure user has access
  if (!role || !INVOICE_VISIBLE_ROLES.includes(role as UserRole)) {
    return null
  }

  const canEdit = ['financial_director', 'planning_director', 'sales_manager'].includes(role)
  const deliveryDate = machine.delivery_to_client_date ? new Date(machine.delivery_to_client_date) : null

  const handleStatusChange = async (val: 'paid' | 'not_paid') => {
    if (!invoice) return
    const res = await updateInvoiceStatus(invoice.id, val, machine.id)
    if (res.success) {
      toast.success('Статус инвойса обновлён')
    } else {
      toast.error(res.error || 'Ошибка обновления статуса')
    }
  }

  const handleRecordPayment = async () => {
    if (!invoice) return
    setIsSavingPayment(true)
    try {
      const res = await recordInvoicePayment(invoice.id, {
        paid_amount: Number(paidAmount || 0),
        balance_due_date: balanceDueDate,
      }, machine.id)
      if (!res.success) throw new Error(res.error || 'Не удалось сохранить оплату')
      toast.success(res.status === 'paid' ? 'Инвойс оплачен полностью' : 'Частичная оплата сохранена')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Неизвестная ошибка')
    } finally {
      setIsSavingPayment(false)
    }
  }

  if (!invoice) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-4">
          <Info className="w-5 h-5 text-[#2563EB] mr-4 mt-0.5" />
          <div>
            <h4 className="text-[#1B3A6B] font-medium mb-1">Инвойс ещё не создан</h4>
            <p className="text-sm text-[#6B7280]">
              {machine.delivery_to_client_date
                ? 'Инвойс будет создан автоматически после обновления даты доставки клиенту.'
                : 'Инвойс будет создан после указания даты доставки клиенту.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Calculate overdue status
  const paymentDueDate = invoice.due_date || invoice.payment_date
  const dueDate = paymentDueDate ? new Date(paymentDueDate) : null
  const isOverdue = invoice.status !== 'paid' && dueDate && isPast(dueDate)
  const overdueDays = isOverdue && dueDate ? differenceInDays(new Date(), dueDate) : 0
  const invoiceAmount = Number(invoice.amount || machine.total_cost || 0)
  const alreadyPaid = Number(invoice.paid_amount || 0)
  const remainingAmount = Math.max(invoiceAmount - alreadyPaid, 0)
  const nextPaidAmount = Number(paidAmount || 0)
  const isPartialPayment = nextPaidAmount > 0 && nextPaidAmount < invoiceAmount

  const getStatusBadge = (status: InvoiceStatus) => {
    switch (status) {
      case 'paid': return <Badge className="bg-green-600">Оплачен</Badge>
      case 'not_paid': return <Badge className="bg-yellow-600 border-yellow-700 border text-yellow-100">Ожидает оплаты</Badge>
      case 'overdue': return <Badge className="bg-red-600">Просрочен</Badge>
      default: return <Badge className="bg-[#E8ECF0]">Неизвестно</Badge>
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-950">
          <FileText className="h-5 w-5 text-blue-800" aria-hidden="true" />
          Инвойс
          {isOverdue && (
            <Badge className="bg-red-900 text-red-100 border border-red-800">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Просрочено на {overdueDays} дн.
            </Badge>
          )}
        </h3>
      </div>
      
      <div className="p-6 space-y-6">
        <div className="space-y-3 border-b border-[#E8ECF0] pb-4">
          <div className="flex justify-between items-center">
            <span className="text-[#6B7280] text-sm">Стоимость товаров</span>
            <span className="font-medium text-[#374151]">
              €{Number(machine.total_items_cost || 0).toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[#6B7280] text-sm">Доп. расходы</span>
            <span className="font-medium text-[#374151]">
              €{Number(machine.total_expenses || 0).toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-dashed border-[#E8ECF0]">
            <span className="text-[#1B3A6B] font-medium">ИТОГО Контракт</span>
            <span className="text-2xl font-bold text-[#16A34A]">
              €{Number(machine.total_cost || 0).toLocaleString()}
            </span>
          </div>
        </div>

        <div className="flex justify-between items-center border-b border-[#E8ECF0] pb-4">
          <span className="text-[#6B7280] text-sm">Дата создания</span>
          <span className="font-medium text-[#374151]">
            {format(new Date(invoice.created_at), 'dd.MM.yyyy', { locale: ru })}
          </span>
        </div>

        <div className="flex justify-between items-center border-b border-[#E8ECF0] pb-4">
          <span className="text-[#6B7280] text-sm">Доставка клиенту</span>
          <span className="font-medium text-[#374151]">
            {deliveryDate ? format(deliveryDate, 'dd.MM.yyyy', { locale: ru }) : '—'}
          </span>
        </div>

        <div className="flex justify-between items-center border-b border-[#E8ECF0] pb-4">
          <span className="text-[#6B7280] text-sm">Оплата до</span>
          <span className={cn("font-medium", isOverdue ? "text-[#DC2626]" : "text-[#374151]")}>
            {paymentDueDate ? format(new Date(paymentDueDate), 'dd.MM.yyyy', { locale: ru }) : '—'}
          </span>
        </div>

        <div className="space-y-3 border-b border-[#E8ECF0] pb-4">
          <div className="flex justify-between text-sm">
            <span className="text-[#6B7280]">Оплачено</span>
            <span className="font-medium text-[#374151]">
              €{alreadyPaid.toLocaleString()} / €{invoiceAmount.toLocaleString()}
            </span>
          </div>
          {canEdit && (
            <div className="grid gap-3">
              <Input
                type="number"
                min={0}
                max={invoiceAmount}
                step="0.01"
                placeholder="Сумма оплаты"
                value={paidAmount}
                onChange={(event) => setPaidAmount(event.target.value)}
              />
              {isPartialPayment && (
                <div>
                  <DatePicker
                    value={balanceDueDate ? new Date(balanceDueDate) : undefined}
                    onChange={(date) => setBalanceDueDate(date ? date.toISOString().split('T')[0] : null)}
                    placeholder="Дата оплаты остатка"
                    displayFormat="dd.MM.yyyy"
                  />
                  <p className="mt-1 text-xs text-[#DC2626]">При частичной оплате дата остатка обязательна.</p>
                </div>
              )}
              <Button
                type="button"
                disabled={isSavingPayment || !paidAmount || nextPaidAmount < 0 || nextPaidAmount === alreadyPaid || (isPartialPayment && !balanceDueDate)}
                onClick={handleRecordPayment}
              >
                Сохранить оплату
              </Button>
              {remainingAmount > 0 && <p className="text-xs text-[#6B7280]">Остаток: €{remainingAmount.toLocaleString()}</p>}
            </div>
          )}
        </div>

        <div className="flex justify-between items-center pt-2">
          <span className="text-[#6B7280] text-sm mt-1">Текущий статус</span>
          <div className="min-w-[180px]">
            {canEdit ? (
              <Select
                value={invoice.status}
                onValueChange={(val) => {
                  if (val === 'paid' || val === 'not_paid') void handleStatusChange(val)
                }}
              >
                <SelectTrigger className="bg-[#F4F6F9] border-[#E8ECF0] text-[#1B3A6B] w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
                  <SelectItem value="not_paid">Ожидает оплаты</SelectItem>
                  <SelectItem value="paid">Оплачено</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="text-right">
                {getStatusBadge(invoice.status)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
