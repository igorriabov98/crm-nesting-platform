"use client"

import Link from 'next/link'
import { format } from 'date-fns'
import { Building2 } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import { paymentTermsLabel } from '@/lib/payments/terms'

export type ClientListRow = {
  id: string
  name: string
  primary_contact_name: string | null
  phone: string | null
  email: string | null
  country_city: string | null
  payment_terms_type: string
  payment_due_days: number
  prepayment_percent: number | null
  final_payment_due_days: number | null
  scheduled_payment_weekdays: number[]
  scheduled_payment_month_days: number[]
  scheduled_payment_amount_mode: string
  scheduled_payment_minimum_amount: number | null
  active_machines_count: number
  current_invoice_amount: number | null
  overdue_invoice_amount: number | null
  can_view_invoices: boolean
  last_activity: string | null
}

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' })

export function ClientList({ clients, resultLimit }: { clients: ClientListRow[]; resultLimit?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
      {resultLimit && clients.length >= resultLimit && (
        <div className="border-b border-[#E8ECF0] px-4 py-2 text-sm text-[#6B7280]">
          Показаны последние {resultLimit} клиентов по активности.
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-sm">
          <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA] text-[#6B7280]">
            <tr>
              <th className="px-4 py-3">Клиент</th>
              <th className="px-4 py-3">Контакт</th>
              <th className="px-4 py-3">Активные машины</th>
              <th className="px-4 py-3">Актуальные инвойсы</th>
              <th className="px-4 py-3">Просрочено</th>
              <th className="px-4 py-3">Последняя активность</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E8ECF0]">
            {clients.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-[#9CA3AF]">
                  Клиентов пока нет.
                </td>
              </tr>
            ) : clients.map((client) => (
              <tr key={client.id} className="hover:bg-[#F8F9FA]">
                <td className="px-4 py-3">
                  <Link href={`${ROUTES.CLIENTS}/${client.id}`} className="flex items-center gap-2 font-semibold text-[#2563EB] hover:underline">
                    <Building2 className="h-4 w-4" />
                    {client.name}
                  </Link>
                  <div className="mt-1 text-xs text-[#9CA3AF]">
                    {client.country_city || 'Локация не указана'} · {paymentTermsLabel({
                      type: client.payment_terms_type,
                      days: client.payment_due_days,
                      prepaymentPercent: client.prepayment_percent,
                      finalDays: client.final_payment_due_days,
                      scheduledWeekdays: client.scheduled_payment_weekdays,
                      scheduledMonthDays: client.scheduled_payment_month_days,
                      scheduledAmountMode: client.scheduled_payment_amount_mode,
                      scheduledMinimumAmount: client.scheduled_payment_minimum_amount,
                    })}
                  </div>
                </td>
                <td className="px-4 py-3 text-[#374151]">
                  <div>{client.primary_contact_name || '—'}</div>
                  <div className="text-xs text-[#9CA3AF]">{client.phone || client.email || 'Контакты не указаны'}</div>
                </td>
                <td className="px-4 py-3 font-medium text-[#1B3A6B]">{client.active_machines_count}</td>
                <td className="px-4 py-3 font-medium text-[#374151]">{client.can_view_invoices ? money.format(client.current_invoice_amount || 0) : 'Скрыто доступом'}</td>
                <td className="px-4 py-3 font-semibold text-[#DC2626]">{client.can_view_invoices ? money.format(client.overdue_invoice_amount || 0) : '—'}</td>
                <td className="px-4 py-3 text-[#6B7280]">
                  {client.last_activity ? format(new Date(client.last_activity), 'dd.MM.yyyy') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
