"use client"

import React, { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { InlineEdit } from '@/components/features/shared/InlineEdit'
import { useRole } from '@/lib/hooks/useRole'
import { differenceInDays, isPast, format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Trash2, Plus, Loader2 } from 'lucide-react'
import {
  createSupplyItem,
  updateSupplyItem,
  deleteSupplyItem
} from '@/lib/actions/supply'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { MachineDetails, SupplyItem } from '@/lib/types'

interface SupplyTabProps {
  machine: MachineDetails
}

export function SupplyTab({ machine }: SupplyTabProps) {
  const { isDirector, isEngineer, isTechnologist, isSupplyManager } = useRole()
  const [isCreating, setIsCreating] = useState(false)

  const items = machine.supply_items || []
  const receivedCount = items.filter((i) => i.status === 'received').length
  const totalCount = items.length
  const percent = totalCount > 0 ? Math.round((receivedCount / totalCount) * 100) : 0

  const canCreate = isDirector || isTechnologist || isSupplyManager

  const handleUpdate = async (itemId: string, field: string, value: string | number | boolean | null) => {
    return updateSupplyItem(itemId, { [field]: value }, machine.id)
  }

  const handleDelete = async (itemId: string) => {
    return deleteSupplyItem(itemId, machine.id)
  }

  const handleAdd = async () => {
    setIsCreating(true)
    await createSupplyItem(machine.id, { nomenclature: 'Новая позиция' })
    setIsCreating(false)
  }

  const statusOptions = [
    { value: 'not_ordered', label: 'Не заказано' },
    { value: 'ordered', label: 'Заказано' },
    { value: 'received', label: 'Получено' },
  ]

  const getStatusBadge = (status: string) => {
    if (status === 'received') return <Badge className="bg-green-600">Получено</Badge>
    if (status === 'ordered') return <Badge className="bg-yellow-600">Заказано</Badge>
    return <Badge className="bg-red-600">Не заказано</Badge>
  }

  // Helper to color deadline texts if past
  const renderDeadline = (dateString: string | null) => {
    if (!dateString) return <span className="text-[#9CA3AF]">—</span>
    const date = new Date(dateString)
    const overdue = isPast(date) && differenceInDays(new Date(), date) > 0
    return (
      <span className={cn(overdue && "text-[#DC2626] font-medium")}>
        {format(date, 'dd.MM.yyyy', { locale: ru })}
      </span>
    )
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Сводка */}
      <div className="flex items-center justify-between p-4 bg-white border border-[#E8ECF0] rounded-md">
        <div className="w-1/2">
          <p className="text-sm text-[#374151] mb-2">
            Получено <span className="font-bold text-[#1B3A6B]">{receivedCount}</span> из <span className="font-bold text-[#1B3A6B]">{totalCount}</span> позиций
          </p>
          <Progress value={percent} className="h-2 bg-[#F8F9FA]" indicatorClassName="bg-[#1B3A6B]" />
        </div>
        {canCreate && (
          <Button onClick={handleAdd} disabled={isCreating} className="bg-[#1B3A6B] hover:bg-[#152D54] text-white">
            {isCreating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Добавить позицию
          </Button>
        )}
      </div>

      {/* Таблица позиций */}
      <div className="overflow-x-auto rounded-md border border-[#E8ECF0]">
        <table className="w-full text-sm text-left">
          <thead className="bg-[#F8F9FA] text-[#6B7280] text-xs uppercase">
            <tr>
              <th className="px-3 py-3 w-8">#</th>
              <th className="px-3 py-3 min-w-[200px]">Номенклатура</th>
              <th className="px-3 py-3 w-20">Кол-во</th>
              <th className="px-3 py-3 w-16">Ед.</th>
              <th className="px-3 py-3 min-w-[150px]">Поставщик</th>
              <th className="px-3 py-3 min-w-[100px]">Цена</th>
              <th className="px-3 py-3 min-w-[120px]">Статус</th>
              <th className="px-3 py-3 w-24 text-center">План. дата</th>
              <th className="px-3 py-3 w-24 text-center">Дедлайн (Т)</th>
              <th className="px-3 py-3 w-24 text-center">Дедлайн (И)</th>
              <th className="px-3 py-3 min-w-[150px]">Комментарий</th>
              <th className="px-3 py-3 text-center">Подтверждено</th>
              <th className="px-3 py-3">Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: SupplyItem, idx: number) => {
              // Права редактирования для полей
              const canEditTech = isDirector || isTechnologist
              const canEditSupply = isDirector || isSupplyManager
              const canEditEng = isDirector || isEngineer

              return (
                <tr key={item.id} className="border-b border-[#E8ECF0] bg-white hover:bg-[#F8F9FA]">
                  <td className="px-3 py-3 text-[#9CA3AF]">{idx + 1}</td>
                  
                  {/* Номенклатура */}
                  <td className="px-3 py-3">
                    <InlineEdit
                      type="text"
                      value={item.nomenclature}
                      editable={canEditTech}
                      onSave={(val) => handleUpdate(item.id, 'nomenclature', val)}
                    />
                  </td>
                  
                  {/* Количество */}
                  <td className="px-3 py-3">
                    <InlineEdit
                      type="number"
                      value={item.quantity}
                      editable={canEditTech}
                      onSave={(val) => handleUpdate(item.id, 'quantity', val)}
                      className="w-16"
                    />
                  </td>

                  {/* Ед. изм. */}
                  <td className="px-3 py-3">
                    <InlineEdit
                      type="text"
                      value={item.unit}
                      editable={canEditTech}
                      onSave={(val) => handleUpdate(item.id, 'unit', val)}
                      className="w-12"
                    />
                  </td>

                  {/* Поставщик */}
                  <td className="px-3 py-3">
                    <InlineEdit
                      type="text"
                      value={item.supplier}
                      editable={canEditSupply}
                      onSave={(val) => handleUpdate(item.id, 'supplier', val)}
                    />
                  </td>

                  {/* Цена */}
                  <td className="px-3 py-3">
                    <InlineEdit
                      type="number"
                      value={item.price_per_unit}
                      editable={canEditSupply}
                      onSave={(val) => handleUpdate(item.id, 'price_per_unit', val)}
                      className="w-20"
                    />
                  </td>

                  {/* Статус */}
                  <td className="px-3 py-3">
                    {!canEditSupply ? getStatusBadge(item.status) : (
                      <InlineEdit
                        type="select"
                        value={item.status}
                        options={statusOptions}
                        editable={true}
                        onSave={(val) => handleUpdate(item.id, 'status', val)}
                      />
                    )}
                  </td>

                  {/* Плановая дата поставки (редактируется Supply) */}
                  <td className="px-3 py-3 text-center">
                    <InlineEdit
                      type="date"
                      value={item.planned_delivery_date}
                      editable={canEditSupply}
                      onSave={(val) => handleUpdate(item.id, 'planned_delivery_date', val)}
                      className="w-[125px]"
                    />
                  </td>

                  {/* Дедлайн технолога (Read-only) */}
                  <td className="px-3 py-3 text-center">
                    {renderDeadline(item.technologist_deadline)}
                  </td>

                  {/* Дедлайн инженера (Read-only) */}
                  <td className="px-3 py-3 text-center">
                    {renderDeadline(item.engineer_deadline)}
                  </td>

                  {/* Комментарий */}
                  <td className="px-3 py-3">
                    <InlineEdit
                      type="text"
                      value={item.comment}
                      editable={canEditSupply}
                      onSave={(val) => handleUpdate(item.id, 'comment', val)}
                    />
                  </td>

                  {/* Инженер подтверждение */}
                  <td className="px-3 py-3 text-center">
                    <Checkbox
                      checked={item.engineer_confirmation}
                      disabled={!canEditEng}
                      onCheckedChange={(c) => handleUpdate(item.id, 'engineer_confirmation', c === true)}
                    />
                  </td>

                  {/* Действия (Удаление) — бэкенд проверяет владельца/директора */}
                  <td className="px-3 py-3 text-center">
                    <AlertDialog>
                      <AlertDialogTrigger
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#6B7280] hover:text-[#DC2626] hover:bg-[#F8F9FA] transition-colors"
                        aria-label="Удалить позицию"
                      >
                        <Trash2 className="w-4 h-4" />
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-white border-[#E8ECF0] text-[#1B3A6B]">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Удалить позицию?</AlertDialogTitle>
                          <AlertDialogDescription className="text-[#6B7280]">
                            Это действие необратимо. Позиция снабжения будет удалена из системы.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B] hover:bg-[#E8ECF0]">Отмена</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700 text-white"
                            onClick={() => handleDelete(item.id)}
                          >
                            Удалить
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </td>

                </tr>
              )
            })}
            
            {items.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-8 text-center text-[#6B7280] border-b border-[#E8ECF0]">
                  Позиции снабжения пока не добавлены
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
