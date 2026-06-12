"use client"

import { useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/lib/constants/routes'
import { paymentTermsLabel } from './ClientFormFields'
import { ClientContactsSection } from './ClientContactsSection'
import { ClientContractsSection } from './ClientContractsSection'
import { ClientEditDialog } from './ClientEditDialog'
import type { Client, ClientContact, Contract, MachineDetails } from '@/lib/types'

type ClientDetailData = Client & { client_contacts?: ClientContact[]; contracts?: Contract[]; machines: MachineDetails[] }

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' })

function normalizeInvoice(invoice: MachineDetails['invoice']) {
  if (Array.isArray(invoice)) return invoice[0] || null
  return invoice || null
}

function paymentTermTitle(type: Client['payment_terms_type']) {
  if (type === 'delivery_days') return 'От даты доставки'
  if (type === 'prepayment_full') return 'Предоплата + полная оплата'
  return 'От даты инвойса'
}

export function ClientDetail({ client, contractsError }: { client: ClientDetailData; contractsError?: string | null }) {
  const [isEditOpen, setIsEditOpen] = useState(false)
  const machines = client.machines || []
  const contacts = client.client_contacts || []
  const contracts = client.contracts || []
  const invoices = machines
    .map((machine) => ({ machine, invoice: normalizeInvoice(machine.invoice) }))
    .filter((item) => item.invoice)
  const currentInvoices = invoices.filter(({ invoice }) => invoice && invoice.status !== 'paid')
  const overdueInvoices = currentInvoices.filter(({ invoice }) => {
    const dueDate = invoice?.due_date || invoice?.payment_date
    return dueDate && new Date(dueDate) < new Date()
  })

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#E8ECF0] bg-white p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[#1B3A6B]">{client.name}</h1>
            <p className="mt-2 text-sm text-[#6B7280]">
              {paymentTermsLabel(client.payment_terms_type, client.payment_due_days, client.prepayment_percent, client.final_payment_due_days)}
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 text-sm text-[#6B7280] md:items-end">
            <Button type="button" onClick={() => setIsEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              Редактировать клиента
            </Button>
            <div className="text-left md:text-right">
              <div>{client.country_city || 'Страна / город не указаны'}</div>
              <div>{client.address || 'Юридический адрес не указан'}</div>
              <div>{client.delivery_address || 'Адрес доставки не указан'}</div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div>
            <div className="text-xs uppercase text-[#9CA3AF]">Контактное лицо</div>
            <div className="mt-1 font-medium text-[#374151]">{client.primary_contact_name || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-[#9CA3AF]">Телефон</div>
            <div className="mt-1 font-medium text-[#374151]">{client.phone || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-[#9CA3AF]">Email</div>
            <div className="mt-1 font-medium text-[#374151]">{client.email || '—'}</div>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-4">
          <div className="text-xs font-semibold uppercase text-[#9CA3AF]">Как оплачивает клиент</div>
          <div className="mt-2 text-lg font-semibold text-[#1B3A6B]">
            {paymentTermTitle(client.payment_terms_type)}
          </div>
          <div className="mt-1 text-sm text-[#374151]">
            {paymentTermsLabel(client.payment_terms_type, client.payment_due_days, client.prepayment_percent, client.final_payment_due_days)}
          </div>
          {client.payment_terms_type === 'prepayment_full' && (
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <span className="text-[#6B7280]">Предоплата: </span>
                <span className="font-medium text-[#1B3A6B]">{client.prepayment_percent ?? 50}%</span>
              </div>
              <div>
                <span className="text-[#6B7280]">Остаток: </span>
                <span className="font-medium text-[#1B3A6B]">через {client.final_payment_due_days ?? client.payment_due_days} дн. от доставки</span>
              </div>
            </div>
          )}
        </div>

        {client.notes && (
          <div className="mt-6 rounded-lg bg-[#F8F9FA] p-4 text-sm text-[#374151]">
            {client.notes}
          </div>
        )}
      </div>

      <ClientContractsSection clientId={client.id} contracts={contracts} machines={machines} error={contractsError} />

      <ClientContactsSection clientId={client.id} contacts={contacts} />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-[#E8ECF0] bg-white p-5">
          <div className="text-sm text-[#6B7280]">Машин / изделий</div>
          <div className="mt-2 text-3xl font-bold text-[#1B3A6B]">{machines.length}</div>
        </div>
        <div className="rounded-xl border border-[#E8ECF0] bg-white p-5">
          <div className="text-sm text-[#6B7280]">Актуальные инвойсы</div>
          <div className="mt-2 text-3xl font-bold text-[#1B3A6B]">
            {money.format(currentInvoices.reduce((sum, item) => sum + Number(item.invoice?.amount || 0) - Number(item.invoice?.paid_amount || 0), 0))}
          </div>
        </div>
        <div className="rounded-xl border border-red-200 bg-white p-5">
          <div className="text-sm text-[#DC2626]">Просроченные инвойсы</div>
          <div className="mt-2 text-3xl font-bold text-[#DC2626]">
            {money.format(overdueInvoices.reduce((sum, item) => sum + Number(item.invoice?.amount || 0) - Number(item.invoice?.paid_amount || 0), 0))}
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-[#1B3A6B]">Машины и изделия</h2>
        <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA] text-[#6B7280]">
              <tr>
                <th className="px-4 py-3">Машина</th>
                <th className="px-4 py-3">Изделия</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Инвойс</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF0]">
              {machines.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-[#9CA3AF]">Машин по клиенту пока нет.</td></tr>
              ) : machines.map((machine) => {
                const invoice = normalizeInvoice(machine.invoice)
                return (
                  <tr key={machine.id}>
                    <td className="px-4 py-3">
                      <Link href={`${ROUTES.SALES_PLAN}/${machine.id}`} className="font-medium text-[#2563EB] hover:underline">
                        {machine.name}
                      </Link>
                      <div className="text-xs text-[#9CA3AF]">{format(new Date(machine.created_at), 'dd.MM.yyyy')}</div>
                    </td>
                    <td className="px-4 py-3 text-[#374151]">
                      {(machine.machine_items || []).map((item) => item.product_name).filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3"><Badge variant="outline">{machine.status}</Badge></td>
                    <td className="px-4 py-3 text-[#374151]">
                      {invoice ? `${money.format(Number(invoice.amount || 0) - Number(invoice.paid_amount || 0))} · ${invoice.status}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <ClientEditDialog client={client} open={isEditOpen} onOpenChange={setIsEditOpen} />
    </div>
  )
}
