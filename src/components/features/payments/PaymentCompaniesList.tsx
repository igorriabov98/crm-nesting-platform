"use client"

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Building2, CalendarClock, Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ROUTES } from '@/lib/constants/routes'
import type { PaymentCompaniesData } from '@/lib/payments/types'

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' })
const date = (value: string | null) => value ? value.split('-').reverse().join('.') : '—'

export function PaymentCompaniesList({ data }: { data: PaymentCompaniesData }) {
  const [search, setSearch] = useState('')
  const [debtFilter, setDebtFilter] = useState<'all' | 'debt' | 'overdue'>('all')
  const [managerId, setManagerId] = useState('all')
  const companies = useMemo(() => data.companies.filter((company) => {
    if (search && !company.name.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))) return false
    if (debtFilter === 'debt' && company.debtAmount <= 0) return false
    if (debtFilter === 'overdue' && company.overdueDebtAmount <= 0) return false
    if (managerId === 'unassigned' && company.responsibleUserId) return false
    if (managerId !== 'all' && managerId !== 'unassigned' && company.responsibleUserId !== managerId) return false
    return true
  }), [data.companies, debtFilter, managerId, search])

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Выставлено" value={money.format(data.summary.issuedAmount)} />
        <SummaryCard label="Оплачено" value={money.format(data.summary.paidAmount)} />
        <SummaryCard label="Общий долг" value={money.format(data.summary.debtAmount)} />
        <SummaryCard label="Просроченный долг" value={money.format(data.summary.overdueDebtAmount)} danger />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="payment-company-filters">
        <h2 id="payment-company-filters" className="sr-only">Фильтры компаний</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="payment-company-search">Компания</Label>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input id="payment-company-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по названию" className="pl-9" />
            </div>
          </div>
          <div>
            <Label htmlFor="payment-debt-filter">Задолженность</Label>
            <Select value={debtFilter} onValueChange={(value) => setDebtFilter(value as typeof debtFilter)}>
              <SelectTrigger id="payment-debt-filter" className="mt-2 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все компании</SelectItem>
                <SelectItem value="debt">Есть долг</SelectItem>
                <SelectItem value="overdue">Есть просрочка</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {data.viewScope === 'all' && (
            <div>
              <Label htmlFor="payment-manager-filter">Ответственный</Label>
              <Select value={managerId} onValueChange={(value) => setManagerId(value || 'all')}>
                <SelectTrigger id="payment-manager-filter" className="mt-2 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все ответственные</SelectItem>
                  <SelectItem value="unassigned">Не назначен</SelectItem>
                  {data.managers.map((manager) => <SelectItem key={manager.id} value={manager.id}>{manager.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        {companies.map((company) => (
          <Link key={company.id} href={`${ROUTES.SALES_PAYMENTS}/${company.id}`} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 truncate font-semibold text-blue-950"><Building2 className="h-5 w-5 shrink-0 text-blue-700" />{company.name}</h3>
                <p className="mt-1 text-sm text-slate-500">Ответственный: {company.responsibleName || 'не назначен'}</p>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-blue-700" aria-hidden="true" />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-slate-500">Выставлено</dt><dd className="mt-1 font-medium text-slate-950">{money.format(company.issuedAmount)}</dd></div>
              <div><dt className="text-slate-500">Общий долг</dt><dd className="mt-1 font-semibold text-slate-950">{money.format(company.debtAmount)}</dd></div>
              <div><dt className="text-slate-500">Просрочено</dt><dd className={company.overdueDebtAmount > 0 ? 'mt-1 font-semibold text-red-700' : 'mt-1 font-medium text-slate-950'}>{money.format(company.overdueDebtAmount)}</dd></div>
              <div><dt className="text-slate-500">Ближайшая оплата</dt><dd className="mt-1 font-medium text-slate-950">{date(company.nearestPaymentDate)}{company.nearestPaymentIsForecast && company.nearestPaymentDate ? ' · прогноз' : ''}</dd></div>
            </dl>
          </Link>
        ))}
      </div>
      {companies.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-14 text-center text-slate-500">По выбранным фильтрам компаний нет.</div>}

      <div className="flex flex-wrap gap-4 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
        <span className="inline-flex items-center gap-1.5"><CalendarClock className="h-4 w-4" />Ближайшая ожидаемая оплата: {date(data.summary.nearestPaymentDate)}{data.summary.nearestPaymentIsForecast && data.summary.nearestPaymentDate ? ' · прогноз' : ''}</span>
        {data.summary.overdueInvoiceCount > 0 && <span className="inline-flex items-center gap-1.5 text-red-700"><AlertTriangle className="h-4 w-4" />Просроченных инвойсов: {data.summary.overdueInvoiceCount}</span>}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <Card className={danger ? 'border border-red-200 bg-red-50/50' : 'border border-slate-200 bg-white'}><CardHeader><CardTitle className={danger ? 'text-red-800' : 'text-slate-600'}>{label}</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold text-blue-950">{value}</p></CardContent></Card>
}
