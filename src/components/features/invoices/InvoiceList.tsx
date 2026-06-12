"use client"

import React, { useState, useMemo } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Search, AlertTriangle, ArrowUpDown, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { updateInvoiceStatus } from '@/lib/actions/invoices'
import { toast } from 'sonner'

type InvoiceStatus = 'paid' | 'not_paid'

type InvoiceItem = {
  id: string
  machine_id: string
  status: InvoiceStatus
  displayStatus: 'paid' | 'not_paid' | 'overdue'
  amount: number | null
  payment_date: string | null
  due_date: string | null
  paid_amount: number | null
  balance_due_date: string | null
  created_at: string | null
  days_until_payment: number | null
  is_overdue: boolean
  machine?: { name?: string | null } | null
  created_by_user?: { full_name?: string | null } | null
}

type InvoiceListData = {
  invoices: InvoiceItem[]
  summary: {
    total_amount: number
    total_invoices: number
    paid_amount: number
    unpaid_amount: number
    overdue_amount: number
    overdue_count: number
  }
}

const invoiceStatusFilterLabels: Record<string, string> = {
  all: 'Все инвойсы',
  paid: 'Оплачено',
  not_paid: 'В ожидании',
  overdue: 'Просрочено',
}

export function InvoiceList({ data, resultLimit }: { data: InvoiceListData; resultLimit?: number }) {
  const { invoices, summary: s } = data

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // all, paid, not_paid, overdue
  const [sortConfig, setSortConfig] = useState<{ key: string, dir: 'asc' | 'desc' }>({ key: 'default', dir: 'asc' })
  const [savingInvoiceId, setSavingInvoiceId] = useState<string | null>(null)

  // can edit invoices? handled by backend, but we can visually disable
  // actually in this project sales_manager, financial_director etc can edit
  // let's just use try catch, but hook should inform us. 
  // Разрешаем действие в UI, а сервер вернёт ошибку при недостатке прав.

  const handleStatusChange = async (invoiceId: string, newStatus: string) => {
    // Overdue is not selectable manually
    if (newStatus !== 'paid' && newStatus !== 'not_paid') return

    setSavingInvoiceId(invoiceId)
    try {
      const res = await updateInvoiceStatus(invoiceId, newStatus as InvoiceStatus)
      if (res.success) {
        toast.success('Статус обновлён')
        // To properly refresh data without reloading, in Next.js Server Components,
        // it's best to call router.refresh() or let revalidatePath handle it.
        // Since Server Action calls revalidatePath('/invoices'), Next.js should auto-refresh.
      } else {
        toast.error(res.error)
      }
    } finally {
      setSavingInvoiceId(null)
    }
  }

  const filteredInvoices = useMemo(() => {
    const arr = invoices.filter((inv) => {
      if (search && !inv.machine?.name?.toLowerCase().includes(search.toLowerCase())) return false
      
      if (statusFilter === 'paid' && inv.displayStatus !== 'paid') return false
      if (statusFilter === 'not_paid' && inv.displayStatus !== 'not_paid') return false
      if (statusFilter === 'overdue' && inv.displayStatus !== 'overdue') return false

      return true
    })

    // Sorting
    arr.sort((a, b) => {
      let aVal: number | string
      let bVal: number | string
      
      if (sortConfig.key === 'amount') {
        aVal = Number(a.amount || 0) - Number(a.paid_amount || 0)
        bVal = Number(b.amount || 0) - Number(b.paid_amount || 0)
      } else if (sortConfig.key === 'payment_date') {
        aVal = (a.due_date || a.payment_date) ? new Date(a.due_date || a.payment_date || '').getTime() : 0
        bVal = (b.due_date || b.payment_date) ? new Date(b.due_date || b.payment_date || '').getTime() : 0
      } else if (sortConfig.key === 'status') {
        aVal = a.displayStatus
        bVal = b.displayStatus
      } else {
        // default sorting: overdue first, then by date nearest
        if (a.is_overdue && !b.is_overdue) return -1
        if (!a.is_overdue && b.is_overdue) return 1
        return (a.days_until_payment || 0) - (b.days_until_payment || 0)
      }

      if (aVal < bVal) return sortConfig.dir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortConfig.dir === 'asc' ? 1 : -1
      return 0
    })

    return arr
  }, [invoices, search, statusFilter, sortConfig])

  const toggleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc'
    }))
  }

  return (
    <div className="space-y-6">
      {/* 4 Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E8ECF0] rounded-xl p-5">
          <p className="text-[#6B7280] text-sm font-medium">Всего</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-[#1B3A6B]">
              {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' }).format(s.total_amount)}
            </span>
          </div>
          <p className="text-[#9CA3AF] text-xs mt-1">{s.total_invoices} шт.</p>
        </div>
        <div className="bg-white border border-green-900/50 rounded-xl p-5 relative overflow-hidden">
          <p className="text-[#16A34A] text-sm font-medium">Оплачено</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-[#1B3A6B]">
              {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' }).format(s.paid_amount)}
            </span>
          </div>
        </div>
        <div className="bg-white border border-yellow-900/50 rounded-xl p-5 relative overflow-hidden">
          <p className="text-[#D97706] text-sm font-medium">Не оплачено</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-[#1B3A6B]">
              {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' }).format(s.unpaid_amount)}
            </span>
          </div>
        </div>
        <div className="bg-white border border-red-900/50 rounded-xl p-5 relative overflow-hidden">
          <p className="text-[#DC2626] text-sm font-medium">Просрочено</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-[#1B3A6B]">
              {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' }).format(s.overdue_amount)}
            </span>
          </div>
          <p className="text-[#DC2626]/70 text-xs mt-1">{s.overdue_count} шт.</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
          <Input 
            placeholder="Поиск по названию машины..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white border-[#E8ECF0] text-[#1B3A6B]"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? 'all')}>
          <SelectTrigger className="w-[200px] bg-white border-[#E8ECF0] text-[#374151]">
            <SelectValue>{invoiceStatusFilterLabels[statusFilter]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все инвойсы</SelectItem>
            <SelectItem value="paid">Оплачено</SelectItem>
            <SelectItem value="not_paid">В ожидании</SelectItem>
            <SelectItem value="overdue">Просрочено</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {resultLimit && invoices.length >= resultLimit && (
        <div className="rounded-md border border-[#E8ECF0] bg-white px-3 py-2 text-sm text-[#6B7280]">
          Показаны последние {resultLimit} инвойсов по текущей сортировке.
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-[#E8ECF0] rounded-xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#F8F9FA] border-b border-[#E8ECF0] text-[#6B7280] font-medium">
              <tr>
                <th className="px-4 py-3 min-w-[200px]">Машина</th>
                <th 
                  className="px-4 py-3 cursor-pointer hover:bg-[#F4F6F9] transition-colors"
                  onClick={() => toggleSort('amount')}
                >
                  <div className="flex items-center gap-1">Сумма <ArrowUpDown className="w-3 h-3"/></div>
                </th>
                <th className="px-4 py-3">Дата инвойса</th>
                <th 
                  className="px-4 py-3 cursor-pointer hover:bg-[#F4F6F9] transition-colors"
                  onClick={() => toggleSort('payment_date')}
                >
                  <div className="flex items-center gap-1">Оплата до <ArrowUpDown className="w-3 h-3"/></div>
                </th>
                <th className="px-4 py-3">Осталось / Просрочка</th>
                <th 
                  className="px-4 py-3 cursor-pointer hover:bg-[#F4F6F9] transition-colors"
                  onClick={() => toggleSort('status')}
                >
                  <div className="flex items-center gap-1">Статус <ArrowUpDown className="w-3 h-3"/></div>
                </th>
                <th className="px-4 py-3 text-right">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF0]">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-[#9CA3AF]">
                    Инвойсов не найдено.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => {
                  let bgClass = "hover:bg-[#F8F9FA]"
                  if (inv.displayStatus === 'overdue') bgClass = "bg-red-950/20 hover:bg-red-950/30"
                  else if (inv.displayStatus === 'not_paid' && (inv.days_until_payment || 0) <= 3) bgClass = "bg-yellow-950/20 hover:bg-yellow-950/30"

                  return (
                    <tr key={inv.id} className={cn("transition-colors", bgClass)}>
                      <td className="px-4 py-3">
                        <Link 
                          href={`/sales-plan/${inv.machine_id}`} 
                          className="font-medium text-[#2563EB] hover:text-[#2563EB] hover:underline block"
                        >
                          {inv.machine?.name || 'Неизвестная машина'}
                        </Link>
                        <span className="text-xs text-[#9CA3AF]">
                          Создал: {inv.created_by_user?.full_name || 'Неизвестен'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[#374151] font-medium">
                        {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' }).format(Number(inv.amount || 0) - Number(inv.paid_amount || 0))}
                      </td>
                      <td className="px-4 py-3 text-[#6B7280]">
                        {inv.created_at ? format(new Date(inv.created_at), 'dd.MM.yyyy') : '—'}
                      </td>
                      <td className="px-4 py-3 text-[#374151]">
                        {(inv.due_date || inv.payment_date) ? format(new Date(inv.due_date || inv.payment_date || ''), 'dd.MM.yyyy') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {inv.displayStatus === 'paid' ? (
                          <span className="text-[#9CA3AF]">—</span>
                        ) : inv.displayStatus === 'overdue' ? (
                          <span className="text-[#DC2626] font-bold block">
                            просрочен на {Math.abs(inv.days_until_payment || 0)} дн.
                          </span>
                        ) : (
                          <span className={cn((inv.days_until_payment || 0) <= 3 ? "text-orange-400 font-medium" : "text-[#6B7280]")}>
                            через {inv.days_until_payment || 0} дн.
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {inv.displayStatus === 'paid' && <Badge className="bg-green-600">Оплачено</Badge>}
                        {inv.displayStatus === 'not_paid' && <Badge className="bg-yellow-600 border border-yellow-700">Не оплачено</Badge>}
                        {inv.displayStatus === 'overdue' && (
                          <Badge className="bg-red-600 flex items-center gap-1 w-fit">
                            <AlertTriangle className="w-3 h-3"/> Просрочено
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Select 
                          value={inv.status} 
                          onValueChange={(val) => val && handleStatusChange(inv.id, val)}
                          disabled={savingInvoiceId === inv.id}
                        >
                          <SelectTrigger className="w-[140px] ml-auto h-8 bg-white border-[#E8ECF0] text-[#374151]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#374151]">
                            <SelectItem value="not_paid">Ожидает</SelectItem>
                            <SelectItem value="paid">Оплачено</SelectItem>
                          </SelectContent>
                        </Select>
                        {savingInvoiceId === inv.id && (
                          <Loader2 className="ml-auto mt-1 h-3.5 w-3.5 animate-spin text-[#2563EB]" />
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
