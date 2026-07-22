'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileWarning,
  Search,
  Weight,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ROUTES } from '@/lib/constants/routes'
import type {
  MaterialRequestQueueItem,
  MaterialRequestQueueState,
} from '@/lib/types/material-request-queue'

type QueueFilter = 'all' | MaterialRequestQueueState

type Props = {
  items: MaterialRequestQueueItem[]
  canViewAll: boolean
}

const filterLabels: Record<QueueFilter, string> = {
  all: 'Все состояния',
  none: 'Нет заявки',
  in_progress: 'В работе',
  submitted: 'Передана в снабжение',
}

function machineRequestsHref(machineId: string) {
  return `${ROUTES.SALES_PLAN}/${machineId}/request`
}

function formatWeight(value: number) {
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} т`
}

function formatDeadline(value: string | null) {
  return value ? format(new Date(`${value}T00:00:00`), 'd MMMM yyyy', { locale: ru }) : 'В ближайшее время'
}

function readyRequestsLabel(submitted: number, total: number) {
  if (total === 0) return 'Заявок ещё нет'
  const lastTwoDigits = submitted % 100
  const lastDigit = submitted % 10
  const readyWord = lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? 'готово'
    : lastDigit === 1
      ? 'готова'
      : lastDigit >= 2 && lastDigit <= 4
        ? 'готовы'
        : 'готово'
  return `${submitted} ${readyWord} из ${total}`
}

function RequestStateBadge({ state }: { state: MaterialRequestQueueState }) {
  if (state === 'submitted') {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
        Передана в снабжение
      </Badge>
    )
  }
  if (state === 'in_progress') {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
        <Clock3 className="mr-1.5 h-3.5 w-3.5" />
        В работе
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
      <FileWarning className="mr-1.5 h-3.5 w-3.5" />
      Нет заявки
    </Badge>
  )
}

export function MaterialRequestQueue({ items, canViewAll }: Props) {
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<QueueFilter>('all')

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('ru')
    return items.filter((item) => {
      const matchesSearch = !normalizedSearch
        || item.machineName.toLocaleLowerCase('ru').includes(normalizedSearch)
      const matchesState = stateFilter === 'all' || item.state === stateFilter
      return matchesSearch && matchesState
    })
  }, [items, search, stateFilter])

  const metrics = useMemo(() => ({
    total: items.length,
    awaiting: items.filter((item) => item.state === 'none').length,
    inProgress: items.filter((item) => item.state === 'in_progress').length,
    submitted: items.filter((item) => item.state === 'submitted').length,
  }), [items])

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl bg-gradient-to-r from-[#17356A] to-[#2448A6] p-6 text-white shadow-sm md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-blue-100">
              <ClipboardList className="h-4 w-4" />
              Работа технолога
            </div>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Заявки на материалы</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-100 md:text-base">
              {canViewAll
                ? 'Общая очередь машин: дедлайны технологов, готовность и история переданных заявок.'
                : 'Ваши назначенные машины: дедлайны, готовность и история переданных заявок.'}
            </p>
          </div>
          <div className="rounded-xl border border-white/20 bg-white/10 px-5 py-4 backdrop-blur-sm">
            <div className="text-sm text-blue-100">Машин в списке</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{metrics.total}</div>
          </div>
        </div>
      </section>

      <section aria-label="Сводка по заявкам" className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Нет заявки</div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-slate-900">{metrics.awaiting}</div>
            </div>
            <div className="rounded-xl bg-slate-100 p-3 text-slate-600"><FileWarning className="h-5 w-5" /></div>
          </div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">В работе</div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-slate-900">{metrics.inProgress}</div>
            </div>
            <div className="rounded-xl bg-amber-50 p-3 text-amber-700"><Clock3 className="h-5 w-5" /></div>
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Переданы</div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-slate-900">{metrics.submitted}</div>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="grid flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_260px]">
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <label htmlFor="material-request-search" className="sr-only">Поиск по названию машины</label>
              <Input
                id="material-request-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Найти машину..."
                className="h-11 border-slate-200 pl-10"
              />
            </div>
            <Select value={stateFilter} onValueChange={(value) => setStateFilter(value as QueueFilter)}>
              <SelectTrigger className="h-11 w-full border-slate-200 bg-white" aria-label="Фильтр по состоянию заявки">
                <SelectValue>{filterLabels[stateFilter]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(filterLabels) as Array<[QueueFilter, string]>).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div aria-live="polite" className="text-sm text-slate-500">
            Показано {filteredItems.length} из {items.length}
          </div>
        </div>
      </section>

      {filteredItems.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <ClipboardList className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-4 text-lg font-semibold text-slate-800">Машины не найдены</h2>
          <p className="mt-1 text-sm text-slate-500">
            {items.length === 0
              ? 'Назначенные задачи на подготовку заявок пока отсутствуют.'
              : 'Измените поисковый запрос или выбранное состояние.'}
          </p>
        </section>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:block">
            <table className="w-full text-left">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-4">Машина</th>
                  <th scope="col" className="px-5 py-4">Тоннаж</th>
                  <th scope="col" className="px-5 py-4">Дедлайн</th>
                  <th scope="col" className="px-5 py-4">Готовность</th>
                  <th scope="col" className="px-5 py-4">Заявки</th>
                  <th scope="col" className="w-14 px-5 py-4"><span className="sr-only">Открыть</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.map((item) => (
                  <tr key={item.machineId} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <Link
                        href={machineRequestsHref(item.machineId)}
                        className="font-semibold text-[#1B3A6B] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      >
                        {item.machineName}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">
                        {item.taskStatus === 'completed' ? 'Задача выполнена' : 'Задача активна'}
                      </div>
                    </td>
                    <td className="px-5 py-4 font-medium tabular-nums text-slate-700">
                      <span className="inline-flex items-center gap-2"><Weight className="h-4 w-4 text-slate-400" />{formatWeight(item.totalWeight)}</span>
                    </td>
                    <td className="px-5 py-4 text-sm font-medium text-slate-700">{formatDeadline(item.deadline)}</td>
                    <td className="px-5 py-4"><RequestStateBadge state={item.state} /></td>
                    <td className="px-5 py-4 text-sm font-medium tabular-nums text-slate-700">
                      {readyRequestsLabel(item.submittedRequestCount, item.totalRequestCount)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={machineRequestsHref(item.machineId)}
                        aria-label={`Открыть заявки машины ${item.machineName}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-blue-50 hover:text-[#1B3A6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 lg:hidden">
            {filteredItems.map((item) => (
              <article key={item.machineId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <Link
                      href={machineRequestsHref(item.machineId)}
                      className="text-lg font-bold text-[#1B3A6B] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      {item.machineName}
                    </Link>
                    <div className="mt-1 text-xs text-slate-500">
                      {item.taskStatus === 'completed' ? 'Задача выполнена' : 'Задача активна'}
                    </div>
                  </div>
                  <RequestStateBadge state={item.state} />
                </div>
                <dl className="mt-5 grid grid-cols-1 gap-4 border-y border-slate-100 py-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">Тоннаж</dt>
                    <dd className="mt-1 font-semibold tabular-nums text-slate-800">{formatWeight(item.totalWeight)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Дедлайн</dt>
                    <dd className="mt-1 font-semibold text-slate-800">{formatDeadline(item.deadline)}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-slate-500">Заявки</dt>
                    <dd className="mt-1 font-semibold tabular-nums text-slate-800">
                      {readyRequestsLabel(item.submittedRequestCount, item.totalRequestCount)}
                    </dd>
                  </div>
                </dl>
                <Link
                  href={machineRequestsHref(item.machineId)}
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#254B87] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                >
                  Открыть заявки <ArrowRight className="h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
