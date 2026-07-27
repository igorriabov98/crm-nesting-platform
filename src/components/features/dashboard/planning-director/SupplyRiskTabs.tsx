'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type {
  PlanningSupplyRisk,
  PlanningSupplyRiskCategory,
  PlanningSupplyRisks,
} from '@/lib/dashboard/planning-director/types'

const CATEGORY_LABELS: Record<PlanningSupplyRiskCategory, string> = {
  materials: 'Материалы и комплектующие',
  detailing: 'Деталировка',
  consumables: 'Расходники',
  transfers: 'Перемещения',
  outsourcing: 'Аутсорсинг / возврат',
  transport: 'Транспорт',
  other: 'Прочее',
}
function formatQuantity(item: PlanningSupplyRisk) {
  if (item.remainingQuantity === null) return null
  const value = item.remainingQuantity.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
  return `${value}${item.unit ? ` ${item.unit}` : ''}`
}

export function SupplyRiskTabs({ risks }: { risks: PlanningSupplyRisks }) {
  const [tab, setTab] = useState<'overdue' | 'undated'>('overdue')
  const [category, setCategory] = useState<PlanningSupplyRiskCategory | 'all'>('all')
  const source = tab === 'overdue' ? risks.overdue : risks.undated
  const categories = useMemo(
    () => Array.from(new Set(source.map((item) => item.category))),
    [source],
  )
  const items = category === 'all' ? source : source.filter((item) => item.category === category)

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Состояние рисков">
          {([
            ['overdue', 'Просрочено', risks.overdueCount],
            ['undated', 'Без даты', risks.undatedCount],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => {
                setTab(value)
                setCategory('all')
              }}
              className={`min-h-10 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                tab === value ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label} <span className="ml-1 tabular-nums">{count}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span>Категория</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as PlanningSupplyRiskCategory | 'all')}
            className="h-10 max-w-[240px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <option value="all">Все категории</option>
            {categories.map((value) => (
              <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>
            ))}
          </select>
        </label>
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">
          {tab === 'overdue' ? 'Просроченных обязательств нет.' : 'Обязательств без даты нет.'}
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              prefetch
              className="grid min-h-16 gap-2 px-4 py-3 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 sm:grid-cols-[minmax(0,1fr)_180px_140px]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">{item.title}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {CATEGORY_LABELS[item.category]}
                  </span>
                </div>
                {item.context && <div className="mt-1 truncate text-xs text-slate-500">{item.context}</div>}
              </div>
              <div className="text-sm text-slate-600 sm:text-right">
                {formatQuantity(item) || 'Ожидается выполнение'}
              </div>
              <div className={`text-sm font-semibold sm:text-right ${tab === 'overdue' ? 'text-red-700' : 'text-amber-700'}`}>
                {tab === 'overdue' ? `${item.overdueDays} дн. просрочки` : 'Дата не указана'}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
