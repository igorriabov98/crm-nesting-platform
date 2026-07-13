"use client"

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { SupplyItemCreateDialog } from './SupplyItemCreateDialog'
import { InlineEdit } from '@/components/features/shared/InlineEdit'
import { StickyTable } from '@/components/features/shared/StickyTable'
import { updateSupplyItem, deleteSupplyItem } from '@/lib/actions/supply'
import { useRole } from '@/lib/hooks/useRole'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

type SupplyItem = {
  id: string
  created_by: string | null
  engineer_confirmation: boolean
  nomenclature: string | null
  quantity: number | null
  unit: string | null
  supplier: string | null
  price_per_unit: number | null
  status: 'not_ordered' | 'ordered' | 'received'
  planned_delivery_date: string | null
  technologist_deadline: string | null
  engineer_deadline: string | null
  comment: string | null
  is_overdue: boolean
}

type SupplyMachineDetailData = {
  currentUser?: { id: string } | null
  machine: {
    id: string
    name: string
    total_weight: number
  }
  items: SupplyItem[]
  summary: {
    total: number
    received: number
    ordered: number
    not_ordered: number
    sum: number
  }
}

export function SupplyMachineDetail({ data }: { data: SupplyMachineDetailData }) {
  const router = useRouter()
  const { isEngineer, isTechnologist, isSupplyManager, isDirector, can } = useRole()
  const { machine, items, summary } = data
  const [filterMode, setFilterMode] = useState('all')

  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel(`supply-${machine.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'supply_items',
        filter: `machine_id=eq.${machine.id}`,
      }, () => {
        router.refresh()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [machine.id, supabase, router])

  const filteredItems = items.filter((item) => {
    if (filterMode === 'received' && item.status !== 'received') return false
    if (filterMode === 'ordered' && item.status !== 'ordered') return false
    if (filterMode === 'not_ordered' && ['ordered', 'received'].includes(item.status)) return false
    return true
  })

  const canManage = can('supply', 'manage')
  const canDelete = (userId: string | null) => canManage && (isDirector || (!!userId && userId === data.currentUser?.id))
  const disableEng = !canManage || (!isEngineer && !isDirector)
  const disableTech = !canManage || (!isTechnologist && !isDirector)
  const disableSup = !canManage || (!isSupplyManager && !isDirector)

  async function handleUpdate(id: string, field: string, value: string | number | boolean | null) {
    const res = await updateSupplyItem(id, { [field]: value }, machine.id)
    if (!res.success) alert(`Ошибка: ${res.error}`)
  }

  async function handleDelete(id: string) {
    if (confirm('Удалить эту позицию?')) {
      const res = await deleteSupplyItem(id, machine.id)
      if (!res.success) alert(`Ошибка: ${res.error}`)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <Link href="/supply" className="mb-2 inline-flex items-center text-sm text-[#6B7280] hover:text-[#1B3A6B]">
            <ArrowLeft className="mr-1 h-4 w-4" /> Вернуться к дашборду
          </Link>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-[#1B3A6B]">
            {machine.name} <span className="font-normal text-[#9CA3AF]">| Снабжение</span>
          </h1>
          <p className="mt-1 text-sm text-[#6B7280]">
            Вес: {machine.total_weight ? Number(machine.total_weight).toFixed(2) : 0} т
          </p>
        </div>
        <SupplyItemCreateDialog machineId={machine.id} />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryCard label="Всего позиций" value={summary.total} />
        <SummaryCard label="Получено" value={summary.received} tone="green" />
        <SummaryCard label="Заказано" value={summary.ordered} tone="yellow" />
        <SummaryCard label="Не заказано" value={summary.not_ordered} tone="red" />
      </div>

      <div className="flex flex-col overflow-hidden rounded-xl border border-[#E8ECF0] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E8ECF0] bg-[#F8F9FA] p-4">
          <div className="flex gap-0.5 rounded-lg bg-[#F8F9FA] p-0.5">
            {[
              { id: 'all', label: 'Все позиции' },
              { id: 'received', label: 'Получено' },
              { id: 'ordered', label: 'Заказано' },
              { id: 'not_ordered', label: 'Не заказано' },
            ].map((filter) => (
              <button
                key={filter.id}
                onClick={() => setFilterMode(filter.id)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  filterMode === filter.id ? 'bg-[#E8ECF0] text-[#1B3A6B]' : 'text-[#6B7280] hover:bg-[#E8ECF0] hover:text-[#374151]'
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="font-mono text-sm text-[#374151]">
            Общая смета:
            <span className="ml-2 font-bold text-[#1B3A6B]">
              {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' }).format(summary.sum)}
            </span>
          </div>
        </div>

        <div className="relative flex-1 overflow-hidden" style={{ minHeight: '400px' }}>
          <StickyTable stickyColumns={3}>
            <thead className="sticky top-0 z-20 border-b border-[#E8ECF0] bg-[#F8F9FA]/80 text-xs text-[#6B7280]">
              <tr>
                <th className="w-10 bg-[#F8F9FA]/80 px-3 py-3 text-center font-medium backdrop-blur">#</th>
                <th className="w-16 bg-[#F8F9FA]/80 px-3 py-3 text-center font-medium backdrop-blur" title="Инженерное подтверждение">
                  Подтв.
                </th>
                <th className="min-w-[200px] bg-[#F8F9FA]/80 px-3 py-3 text-left font-medium backdrop-blur">Номенклатура</th>
                <th className="w-20 px-3 py-3 text-right font-medium">Кол-во</th>
                <th className="w-16 px-3 py-3 text-center font-medium">Ед.</th>
                <th className="min-w-[150px] px-3 py-3 text-left font-medium">Поставщик</th>
                <th className="w-28 px-3 py-3 text-right font-medium">Цена/ед</th>
                <th className="w-28 px-3 py-3 text-right font-medium">Сумма</th>
                <th className="min-w-[140px] px-3 py-3 text-left font-medium">Статус</th>
                <th className="w-32 px-3 py-3 text-center font-medium">План. дата</th>
                <th className="w-32 px-3 py-3 text-center font-medium">Дедлайн (тех)</th>
                <th className="w-32 px-3 py-3 text-center font-medium">Дедлайн (инж)</th>
                <th className="min-w-[200px] px-3 py-3 text-left font-medium">Комментарий</th>
                <th className="sticky right-0 w-24 border-l border-[#E8ECF0] bg-[#F8F9FA]/80 px-3 py-3 text-center font-medium">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF0] text-sm">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={14} className="h-64 bg-white text-center text-[#9CA3AF]">
                    Позиций не найдено
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, index) => {
                  const noSupplier = !item.supplier && item.status !== 'received'
                  const rowBg = item.is_overdue
                    ? 'bg-red-950/20'
                    : noSupplier
                      ? 'bg-yellow-950/20'
                      : 'hover:bg-[#FAFBFC]'
                  const total = (item.quantity || 0) * (item.price_per_unit || 0)

                  return (
                    <tr key={item.id} className={cn('transition-colors', rowBg)}>
                      <td className="bg-white/90 px-3 py-2 text-center text-[#9CA3AF]">{index + 1}</td>
                      <td className="bg-white/90 px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          disabled={disableEng}
                          checked={item.engineer_confirmation || false}
                          onChange={(event) => handleUpdate(item.id, 'engineer_confirmation', event.target.checked)}
                          className="mx-auto h-4 w-4 cursor-pointer appearance-none rounded border border-[#D1D5DB] bg-[#F8F9FA] checked:border-blue-500 checked:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </td>
                      <td className="bg-white/90 px-3 py-2">
                        <InlineEdit
                          type="text"
                          value={item.nomenclature || ''}
                          onSave={(value) => handleUpdate(item.id, 'nomenclature', value)}
                          editable={!disableTech}
                          placeholder="Наименование"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <InlineEdit
                          type="number"
                          value={item.quantity?.toString() || '0'}
                          onSave={(value) => handleUpdate(item.id, 'quantity', parseFloat(value) || 0)}
                          editable={!disableTech}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <InlineEdit
                          type="text"
                          value={item.unit || 'шт'}
                          onSave={(value) => handleUpdate(item.id, 'unit', value)}
                          editable={!disableTech}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <InlineEdit
                          type="text"
                          value={item.supplier || ''}
                          onSave={(value) => handleUpdate(item.id, 'supplier', value)}
                          editable={!disableSup}
                          placeholder="Кто поставляет"
                        />
                        {noSupplier && <span className="block text-[10px] text-yellow-500">Укажите поставщика</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[#374151]">
                        <InlineEdit
                          type="number"
                          value={item.price_per_unit?.toString() || '0'}
                          onSave={(value) => handleUpdate(item.id, 'price_per_unit', parseFloat(value) || 0)}
                          editable={!disableSup}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium text-[#374151]">
                        {total > 0 ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' }).format(total) : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <InlineEdit
                          type="select"
                          value={item.status || 'not_ordered'}
                          onSave={(value) => handleUpdate(item.id, 'status', value)}
                          editable={!disableSup}
                          options={[
                            { value: 'not_ordered', label: 'Не заказано' },
                            { value: 'ordered', label: 'Заказано' },
                            { value: 'received', label: 'Получено' },
                          ]}
                        />
                      </td>
                      {[
                        { field: 'planned_delivery_date', value: item.planned_delivery_date, disabled: disableSup, overdueCheck: true },
                        { field: 'technologist_deadline', value: item.technologist_deadline, disabled: disableTech, overdueCheck: false },
                        { field: 'engineer_deadline', value: item.engineer_deadline, disabled: disableEng, overdueCheck: false },
                      ].map((column) => (
                        <td key={column.field} className="px-3 py-2 text-center">
                          <InlineEdit
                            type="date"
                            value={column.value || ''}
                            onSave={(value) => handleUpdate(item.id, column.field, value)}
                            editable={!column.disabled}
                          />
                          {column.overdueCheck && item.is_overdue && (
                            <span className="block animate-pulse text-[10px] font-medium text-[#DC2626]">Просрочка</span>
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <InlineEdit
                          type="text"
                          value={item.comment || ''}
                          onSave={(value) => handleUpdate(item.id, 'comment', value)}
                          editable={!disableSup}
                          placeholder="Комментарий..."
                        />
                      </td>
                      <td className="sticky right-0 border-l border-[#E8ECF0] bg-white/90 px-3 py-2 text-center">
                        {canDelete(item.created_by) ? (
                          <button onClick={() => handleDelete(item.id)} className="px-2 text-xs text-[#DC2626] hover:underline">
                            Удалить
                          </button>
                        ) : (
                          <span className="block text-xs text-[#9CA3AF]">Нет прав</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
            {filteredItems.length > 0 && (
              <tfoot className="sticky bottom-0 z-10 border-t border-[#E8ECF0] bg-[#F8F9FA]">
                <tr>
                  <td colSpan={7} className="px-4 py-3 text-right font-medium text-[#374151]">Итого по экрану:</td>
                  <td className="px-3 py-3 text-right font-mono font-bold text-[#1B3A6B]">
                    {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' }).format(
                      filteredItems.reduce((acc, item) => acc + (item.quantity || 0) * (item.price_per_unit || 0), 0)
                    )}
                  </td>
                  <td colSpan={6} />
                </tr>
              </tfoot>
            )}
          </StickyTable>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'green' | 'yellow' | 'red'
}) {
  const toneClass = tone === 'green'
    ? 'border-green-900/50 text-[#16A34A]'
    : tone === 'yellow'
      ? 'border-yellow-900/50 text-[#D97706]'
      : tone === 'red'
        ? 'border-red-900/50 text-[#DC2626]'
        : 'border-[#E8ECF0] text-[#6B7280]'

  return (
    <div className={cn('rounded-xl border bg-white p-4', toneClass)}>
      <p className="text-sm">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#1B3A6B]">{value}</p>
    </div>
  )
}
