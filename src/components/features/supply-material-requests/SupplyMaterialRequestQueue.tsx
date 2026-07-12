'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  CircleAlert,
  Factory,
  PackageCheck,
  Search,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ROUTES } from '@/lib/constants/routes'
import type {
  SupplyMaterialRequestQueueItem,
  SupplyMaterialRequestState,
} from '@/lib/types/supply-material-request-queue'

type StateFilter = 'all' | SupplyMaterialRequestState

type Props = {
  items: SupplyMaterialRequestQueueItem[]
  factories: Array<{ id: string; name: string }>
}

const stateFilterLabels: Record<StateFilter, string> = {
  needs_action: 'Требуют работы',
  all: 'Все',
  covered: 'Полностью покрыты',
  received: 'Получены',
}

function requestHref(requestId: string) {
  return `${ROUTES.SUPPLY_REQUEST}/${requestId}`
}

function formatDate(value: string | null, includeTime = false) {
  if (!value) return 'Не указан'
  const parsed = new Date(value.includes('T') ? value : `${value}T00:00:00`)
  return format(parsed, includeTime ? 'd MMMM yyyy, HH:mm' : 'd MMMM yyyy', { locale: ru })
}

function StateBadge({ state }: { state: SupplyMaterialRequestState }) {
  if (state === 'received') {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        <PackageCheck className="mr-1.5 h-3.5 w-3.5" />
        Получено
      </Badge>
    )
  }
  if (state === 'covered') {
    return (
      <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
        Полностью покрыта
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
      <CircleAlert className="mr-1.5 h-3.5 w-3.5" />
      Требует работы
    </Badge>
  )
}

export function SupplyMaterialRequestQueue({ items, factories }: Props) {
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('needs_action')
  const [factoryFilter, setFactoryFilter] = useState('all')

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('ru')
    return items.filter((item) => {
      const matchesSearch = !normalizedSearch
        || item.machineName.toLocaleLowerCase('ru').includes(normalizedSearch)
      const matchesState = stateFilter === 'all' || item.state === stateFilter
      const matchesFactory = factoryFilter === 'all' || item.factoryId === factoryFilter
      return matchesSearch && matchesState && matchesFactory
    })
  }, [factoryFilter, items, search, stateFilter])

  const metrics = useMemo(() => ({
    total: items.length,
    needsAction: items.filter((item) => item.state === 'needs_action').length,
    covered: items.filter((item) => item.state === 'covered').length,
    received: items.filter((item) => item.state === 'received').length,
  }), [items])

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl bg-gradient-to-r from-[#17356A] to-[#2448A6] p-6 text-white shadow-sm md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-blue-100">
              <Boxes className="h-4 w-4" />
              Снабжение
            </div>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Бронь склада</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-100 md:text-base">
              Машины, переданные технологом: забронируйте доступный материал на обычном складе и начните обработку заявки.
            </p>
          </div>
          <div className="rounded-xl border border-white/20 bg-white/10 px-5 py-4 backdrop-blur-sm">
            <div className="text-sm text-blue-100">Передано машин</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{metrics.total}</div>
          </div>
        </div>
      </section>

      <section aria-label="Сводка очереди" className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">Требуют работы</div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-slate-900">{metrics.needsAction}</div>
            </div>
            <div className="rounded-xl bg-amber-50 p-3 text-amber-700"><CircleAlert className="h-5 w-5" /></div>
          </div>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">Покрыты</div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-slate-900">{metrics.covered}</div>
            </div>
            <div className="rounded-xl bg-blue-50 p-3 text-blue-700"><CheckCircle2 className="h-5 w-5" /></div>
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Получены</div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-slate-900">{metrics.received}</div>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><PackageCheck className="h-5 w-5" /></div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_240px_240px_auto] lg:items-center">
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <label htmlFor="supply-material-request-search" className="sr-only">Поиск по названию машины</label>
            <Input
              id="supply-material-request-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Найти машину..."
              className="h-11 border-slate-200 pl-10"
            />
          </div>
          <Select value={stateFilter} onValueChange={(value) => setStateFilter((value || 'needs_action') as StateFilter)}>
            <SelectTrigger className="h-11 w-full border-slate-200 bg-white" aria-label="Фильтр по состоянию">
              <SelectValue>{stateFilterLabels[stateFilter]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(stateFilterLabels) as Array<[StateFilter, string]>).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={factoryFilter} onValueChange={(value) => setFactoryFilter(value || 'all')}>
            <SelectTrigger className="h-11 w-full border-slate-200 bg-white" aria-label="Фильтр по заводу">
              <SelectValue>
                {factoryFilter === 'all'
                  ? 'Все заводы'
                  : factories.find((factory) => factory.id === factoryFilter)?.name || 'Завод'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все заводы</SelectItem>
              {factories.map((factory) => <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div aria-live="polite" className="text-sm text-slate-500 lg:text-right">
            Показано {filteredItems.length} из {items.length}
          </div>
        </div>
      </section>

      {filteredItems.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <Boxes className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-4 text-lg font-semibold text-slate-800">Машины не найдены</h2>
          <p className="mt-1 text-sm text-slate-500">
            {items.length === 0
              ? 'Технологи пока не передали заявки в снабжение.'
              : 'Измените поиск, состояние или завод.'}
          </p>
        </section>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:block">
            <table className="w-full text-left">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-4">Машина</th>
                  <th scope="col" className="px-5 py-4">Завод</th>
                  <th scope="col" className="px-5 py-4">Передана</th>
                  <th scope="col" className="px-5 py-4">Дедлайн материала</th>
                  <th scope="col" className="px-5 py-4">Позиции</th>
                  <th scope="col" className="px-5 py-4">Состояние</th>
                  <th scope="col" className="w-14 px-5 py-4"><span className="sr-only">Открыть</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.map((item) => (
                  <tr key={item.machineId} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <Link href={requestHref(item.requestId)} className="font-semibold text-[#1B3A6B] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                        {item.machineName}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-sm font-medium text-slate-700">
                      <span className="inline-flex items-center gap-2"><Factory className="h-4 w-4 text-slate-400" />{item.factoryName}</span>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">{formatDate(item.submittedAt, true)}</td>
                    <td className="px-5 py-4 text-sm font-medium text-slate-700">{formatDate(item.materialDeadline)}</td>
                    <td className="px-5 py-4 text-sm tabular-nums text-slate-700">
                      <div className="font-semibold">{item.positions} всего</div>
                      <div className="mt-1 text-xs text-slate-500">{item.reservedPositions} забр. · {item.remainingPositions} осталось</div>
                    </td>
                    <td className="px-5 py-4"><StateBadge state={item.state} /></td>
                    <td className="px-5 py-4 text-right">
                      <Link href={requestHref(item.requestId)} aria-label={`Открыть заявку машины ${item.machineName}`} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-blue-50 hover:text-[#1B3A6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 xl:hidden">
            {filteredItems.map((item) => (
              <article key={item.machineId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <Link href={requestHref(item.requestId)} className="text-lg font-bold text-[#1B3A6B] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                      {item.machineName}
                    </Link>
                    <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-500"><Factory className="h-4 w-4" />{item.factoryName}</div>
                  </div>
                  <StateBadge state={item.state} />
                </div>
                <dl className="mt-5 grid grid-cols-1 gap-4 border-y border-slate-100 py-4 text-sm sm:grid-cols-2">
                  <div><dt className="text-slate-500">Передана</dt><dd className="mt-1 font-semibold text-slate-800">{formatDate(item.submittedAt, true)}</dd></div>
                  <div><dt className="text-slate-500">Дедлайн материала</dt><dd className="mt-1 font-semibold text-slate-800">{formatDate(item.materialDeadline)}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-slate-500">Позиции</dt><dd className="mt-1 font-semibold tabular-nums text-slate-800">{item.positions} всего · {item.reservedPositions} забронировано · {item.remainingPositions} осталось</dd></div>
                </dl>
                <Link href={requestHref(item.requestId)} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#254B87] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
                  Открыть заявку <ArrowRight className="h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
