"use client"

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { differenceInDays, format } from 'date-fns'
import { AlertCircle, ClipboardList, Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'
import type { RequestStatus } from '@/lib/types'

const supplyFilterLabels: Record<string, string> = {
  '': 'Все машины',
  with_overdue: 'С просрочками',
  not_full: 'Не полностью получено',
  full: '100% получено',
}

type SupplyDashboardMachine = {
  id: string
  name: string
  total_weight: number
  factory_id: string | null
  total_items: number
  received_items: number
  ordered_items: number
  not_ordered_items: number
  overdue_items: number
  nearest_deadline: string | null
  total_cost: number
}

type SupplyDashboardData = {
  machines: SupplyDashboardMachine[]
  noFactoryMachines: Array<Pick<SupplyDashboardMachine, 'id' | 'name' | 'total_weight' | 'total_items'>>
  summary: {
    total_items: number
    total_received: number
    total_ordered: number
    total_not_ordered: number
    total_overdue: number
    total_cost: number
  }
}

type SupplyRequestCard = {
  id: string
  machine_id: string
  machine_name: string
  created_at: string
  status: RequestStatus
  positions: number
  reserved_positions: number
  to_order_positions: number
}

export function SupplyDashboard({
  data,
  ordersSummary,
  requestCards = [],
  resultLimit,
}: {
  data: SupplyDashboardData
  ordersSummary?: { total: number; pending: number; ordered: number; delivered: number } | null
  requestCards?: SupplyRequestCard[]
  resultLimit?: number
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')

  const filteredMachines = useMemo(() => {
    return data.machines.filter((machine) => {
      if (search && !machine.name.toLowerCase().includes(search.toLowerCase())) return false
      if (filter === 'with_overdue' && machine.overdue_items === 0) return false
      if (filter === 'not_full' && (machine.total_items === 0 || machine.received_items === machine.total_items)) return false
      if (filter === 'full' && (machine.total_items === 0 || machine.received_items !== machine.total_items)) return false
      return true
    })
  }, [data.machines, search, filter])

  const summary = data.summary
  const noFactoryMachines = data.noFactoryMachines || []
  const stockCheckRequestCards = requestCards.filter((request) => request.positions > 0 && (request.status === 'pending_stock_check' || request.status === 'stock_checked'))
  const activeRequestCards = requestCards.filter((request) => request.status === 'submitted_to_supply' && request.positions > 0 && request.to_order_positions > 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <SummaryCard label="Всего позиций" value={summary.total_items} />
        <SummaryCard label="Получено" value={summary.total_received} tone="green" />
        <SummaryCard label="Заказано" value={summary.total_ordered} tone="yellow" />
        <SummaryCard label="Просрочено" value={summary.total_overdue} tone="red" />
        <SummaryCard
          label="Общая стоимость"
          value={new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' }).format(summary.total_cost)}
          compact
        />
      </div>

      <Link
        href={ROUTES.SUPPLY_ORDERS}
        className="flex flex-col gap-2 rounded-xl border border-[#E8ECF0] bg-white p-4 shadow-sm transition-colors hover:border-[#1B3A6B]/30 hover:bg-[#F8F9FA] sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1B3A6B]/10 text-[#1B3A6B]">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold text-[#1B3A6B]">Что нужно заказать →</div>
            <div className="text-sm text-[#6B7280]">
              К заказу: {ordersSummary?.pending ?? 0} позиций · всего в списке: {ordersSummary?.total ?? 0}
            </div>
          </div>
        </div>
      </Link>

      {stockCheckRequestCards.length > 0 && <SupplyRequestCardSection title="На проверке склада" cards={stockCheckRequestCards} />}
      {activeRequestCards.length > 0 && <SupplyRequestCardSection title="Заявки, переданные в снабжение" cards={activeRequestCards} />}

      {noFactoryMachines.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[#DC2626]/30 bg-white">
          <div className="border-b border-[#E8ECF0] px-4 py-3">
            <h2 className="text-sm font-semibold text-[#DC2626]">Машины без назначенного завода</h2>
          </div>
          <div className="divide-y divide-[#E8ECF0]">
            {noFactoryMachines.map((machine) => (
              <Link
                key={machine.id}
                href={`${ROUTES.SALES_PLAN}/${machine.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-[#F8F9FA]"
              >
                <span className="font-medium text-[#1B3A6B]">{machine.name}</span>
                <span className="text-xs text-[#6B7280]">
                  {Number(machine.total_weight || 0).toFixed(2)} т · {machine.total_items} поз.
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
          <Input
            placeholder="Поиск по названию машины..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="border-[#E8ECF0] bg-white pl-9 text-[#1B3A6B]"
          />
        </div>
        <Select value={filter} onValueChange={(value) => setFilter(value ?? '')}>
          <SelectTrigger className="w-[200px] border-[#E8ECF0] bg-white text-[#374151]">
            <SelectValue>{supplyFilterLabels[filter]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Все машины</SelectItem>
            <SelectItem value="with_overdue">С просрочками</SelectItem>
            <SelectItem value="not_full">Не полностью получено</SelectItem>
            <SelectItem value="full">100% получено</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {resultLimit && data.machines.length >= resultLimit && (
        <div className="rounded-md border border-[#E8ECF0] bg-white px-3 py-2 text-sm text-[#6B7280]">
          Показаны последние {resultLimit} машин снабжения по текущей сортировке.
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA] font-medium text-[#6B7280]">
              <tr>
                <th className="min-w-[200px] px-4 py-3">Машина</th>
                <th className="w-24 px-4 py-3">Тоннаж</th>
                <th className="w-24 px-4 py-3">Позиций</th>
                <th className="min-w-[200px] px-4 py-3">Получено</th>
                <th className="w-24 px-4 py-3">Просрочено</th>
                <th className="w-32 px-4 py-3">Ближ. дедлайн</th>
                <th className="w-32 px-4 py-3 text-right">Стоимость</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF0]">
              {filteredMachines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#9CA3AF]">
                    Позиций снабжения пока нет или ничего не найдено по фильтрам.
                  </td>
                </tr>
              ) : (
                filteredMachines.map((machine) => {
                  const percent = machine.total_items === 0 ? 0 : Math.round((machine.received_items / machine.total_items) * 100)
                  const deadlineDanger = machine.nearest_deadline
                    ? differenceInDays(new Date(machine.nearest_deadline), new Date()) <= 3
                    : false
                  const progressColor = percent === 100
                    ? 'bg-green-500'
                    : percent > 50
                      ? 'bg-yellow-500'
                      : percent > 0
                        ? 'bg-orange-500'
                        : 'bg-red-500'

                  return (
                    <tr key={machine.id} className="transition-colors hover:bg-[#F8F9FA]">
                      <td className="px-4 py-3">
                        <Link href={`/supply/${machine.id}`} className="font-medium text-[#2563EB] hover:underline">
                          {machine.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[#374151]">{Number(machine.total_weight || 0).toFixed(2)} т</td>
                      <td className="px-4 py-3 text-[#374151]">{machine.total_items}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="w-10 text-right text-[#6B7280]">{machine.received_items}/{machine.total_items}</span>
                          <div className="h-2 max-w-[120px] flex-1 overflow-hidden rounded-full bg-[#F8F9FA]">
                            <div className={cn('h-full transition-all', progressColor)} style={{ width: `${percent}%` }} />
                          </div>
                          <span className="w-10 text-[#6B7280]">{percent}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {machine.overdue_items > 0 ? (
                          <div className="inline-flex items-center gap-1.5 rounded bg-red-400/10 px-2 py-0.5 font-medium text-[#DC2626]">
                            <AlertCircle className="h-3.5 w-3.5" />
                            {machine.overdue_items}
                          </div>
                        ) : (
                          <span className="text-[#9CA3AF]">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {machine.nearest_deadline ? (
                          <span className={cn(deadlineDanger ? 'font-medium text-[#DC2626]' : 'text-[#374151]')}>
                            {format(new Date(machine.nearest_deadline), 'dd.MM.yyyy')}
                          </span>
                        ) : (
                          <span className="text-[#9CA3AF]">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[#374151]">
                        {machine.total_cost > 0
                          ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' }).format(machine.total_cost)
                          : '-'}
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

function SupplyRequestCardSection({ title, cards }: { title: string; cards: SupplyRequestCard[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
      <div className="border-b border-[#E8ECF0] px-4 py-3">
        <h2 className="text-sm font-semibold text-[#1B3A6B]">{title}</h2>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((request) => (
          <Link
            key={request.id}
            href={`${ROUTES.SUPPLY_REQUEST}/${request.id}`}
            className="rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-4 transition-colors hover:border-[#1B3A6B]/30 hover:bg-white"
          >
            <div className="font-semibold text-[#1B3A6B]">{request.machine_name}</div>
            <div className="mt-2 text-sm text-[#6B7280]">
              Позиций: {request.positions} · с бронью: {request.reserved_positions} · к заказу: {request.to_order_positions}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  tone,
  compact,
}: {
  label: string
  value: number | string
  tone?: 'green' | 'yellow' | 'red'
  compact?: boolean
}) {
  const toneClass = tone === 'green'
    ? 'border-green-900/50 text-[#16A34A]'
    : tone === 'yellow'
      ? 'border-yellow-900/50 text-[#D97706]'
      : tone === 'red'
        ? 'border-red-900/50 text-[#DC2626]'
        : 'border-[#E8ECF0] text-[#6B7280]'

  return (
    <div className={cn('rounded-xl border bg-white p-5', toneClass)}>
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn('font-bold text-[#1B3A6B]', compact ? 'text-2xl' : 'text-3xl')}>{value}</span>
      </div>
    </div>
  )
}
