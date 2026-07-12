'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Boxes, CalendarDays, Search } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ROUTES } from '@/lib/constants/routes'
import type { BusinessScrapQueueItem, BusinessScrapQueueState } from '@/lib/actions/business-scrap-corrections'
import { formatProductionMonth } from '@/lib/utils/production-months'

type Props = {
  items: BusinessScrapQueueItem[]
  canViewAll: boolean
}

const stateLabels: Record<'all' | BusinessScrapQueueState, string> = {
  all: 'Все состояния',
  no_request: 'Нет заявки',
  draft: 'Заявка заполняется',
  initial_reservation: 'Первичная бронь',
  submitted: 'Передана снабжению',
  correction_pending: 'Ждёт согласования',
}

function stateBadge(state: BusinessScrapQueueState) {
  const tone = state === 'correction_pending'
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : state === 'submitted'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : state === 'initial_reservation'
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : 'border-slate-200 bg-slate-50 text-slate-700'
  return <Badge variant="outline" className={tone}>{stateLabels[state]}</Badge>
}

export function BusinessScrapQueue({ items, canViewAll }: Props) {
  const [search, setSearch] = useState('')
  const [month, setMonth] = useState('all')
  const [state, setState] = useState<'all' | BusinessScrapQueueState>('all')
  const monthOptions = useMemo(() => Array.from(new Set(items.map((item) => item.productionMonth).filter(Boolean) as string[])).sort(), [items])
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ru')
    return items.filter((item) => {
      const matchesSearch = !needle || item.machineName.toLocaleLowerCase('ru').includes(needle)
      const matchesMonth = month === 'all' || item.productionMonth === month
      const matchesState = state === 'all' || item.state === state
      return matchesSearch && matchesMonth && matchesState
    })
  }, [items, month, search, state])

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl bg-gradient-to-r from-[#17356A] to-[#2448A6] p-6 text-white shadow-sm md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-blue-100">
              <Boxes className="h-4 w-4" />
              Технолог
            </div>
            <h1 className="text-3xl font-bold">Бронь делового остатка</h1>
            <p className="mt-3 max-w-3xl text-blue-100">
              {canViewAll
                ? 'Все назначенные машины: первичная бронь, переданные заявки и согласуемые корректировки.'
                : 'Ваши назначенные машины: первичная бронь, переданные заявки и согласуемые корректировки.'}
            </p>
          </div>
          <div className="rounded-xl border border-white/20 bg-white/10 px-5 py-3">
            <div className="text-sm text-blue-100">Машин</div>
            <div className="text-3xl font-bold tabular-nums">{items.length}</div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_240px_240px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти машину..." className="h-11 pl-10" />
        </div>
        <Select value={month} onValueChange={(value) => value && setMonth(value)}>
          <SelectTrigger className="h-11 w-full"><SelectValue>{month === 'all' ? 'Все месяцы' : formatProductionMonth(month)}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все месяцы</SelectItem>
            {monthOptions.map((value) => <SelectItem key={value} value={value}>{formatProductionMonth(value)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={state} onValueChange={(value) => value && setState(value as 'all' | BusinessScrapQueueState)}>
          <SelectTrigger className="h-11 w-full"><SelectValue>{stateLabels[state]}</SelectValue></SelectTrigger>
          <SelectContent>
            {(Object.entries(stateLabels) as Array<['all' | BusinessScrapQueueState, string]>).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center text-slate-600">
          Машины по выбранным условиям не найдены.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((item) => (
            <article key={item.machineId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-semibold text-slate-950">{item.machineName}</h2>
                  <p className="mt-1 text-sm text-slate-500">{item.factoryName || 'Завод не указан'}</p>
                </div>
                {stateBadge(item.state)}
              </div>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-500">Месяц производства</div>
                  <div className="mt-1 font-medium">{item.productionMonth ? formatProductionMonth(item.productionMonth) : 'Не указан'}</div>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-1 text-xs text-slate-500"><CalendarDays className="h-3.5 w-3.5" /> Дедлайн</div>
                  <div className="mt-1 font-medium">{new Date(item.deadline + 'T00:00:00').toLocaleDateString('ru-RU')}</div>
                </div>
              </div>
              <Link
                href={ROUTES.BUSINESS_SCRAP_RESERVATIONS + '/' + item.machineId}
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#254B87]"
              >
                Открыть машину <ArrowRight className="h-4 w-4" />
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
