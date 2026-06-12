"use client"

import React, { useState } from 'react'
import { Plus, Edit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useRole } from '@/lib/hooks/useRole'
import { MachineEditDialog } from '../MachineEditDialog'
import type { MachineDetails, MachineExpense } from '@/lib/types'

interface ExpensesTabProps {
  machine: MachineDetails
}

export function ExpensesTab({ machine }: ExpensesTabProps) {
  const { role, isDirector } = useRole()
  const canEdit = isDirector || role === 'sales_manager'
  const [isEditOpen, setIsEditOpen] = useState(false)

  const expenses = machine.machine_expenses || []

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-[#1B3A6B]">Дополнительные расходы</h2>
        {canEdit && (
          <Button onClick={() => setIsEditOpen(true)} className="bg-[#1B3A6B] hover:bg-[#152D54] text-white">
            <Plus className="w-4 h-4 mr-2" />
            Добавить / Редактировать
          </Button>
        )}
      </div>

      <div className="rounded-md border border-[#E8ECF0] bg-white overflow-hidden max-w-4xl">
        <Table>
          <TableHeader className="bg-[#F8F9FA]">
            <TableRow className="border-[#E8ECF0]">
              <TableHead className="w-12 text-center text-[#6B7280]">#</TableHead>
              <TableHead className="text-[#6B7280]">Категория</TableHead>
              <TableHead className="text-[#6B7280] text-right">Сумма</TableHead>
              <TableHead className="text-[#6B7280]">Комментарий</TableHead>
              {canEdit && <TableHead className="w-12"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canEdit ? 5 : 4} className="text-center h-24 text-[#9CA3AF]">
                  Нет дополнительных расходов
                </TableCell>
              </TableRow>
            ) : (
              expenses.map((expense: MachineExpense, idx: number) => (
                <TableRow key={expense.id || idx} className="border-[#E8ECF0] hover:bg-[#F8F9FA]">
                  <TableCell className="text-center text-[#9CA3AF]">{idx + 1}</TableCell>
                  <TableCell className="font-medium text-[#374151]">{expense.category}</TableCell>
                  <TableCell className="text-right font-medium text-[#1B3A6B]">
                    €{Number(expense.amount).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-[#6B7280]">
                    {expense.comment || <span className="text-[#D1D5DB]">—</span>}
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => setIsEditOpen(true)} className="text-[#6B7280] hover:text-[#1B3A6B] hover:bg-transparent">
                        <Edit className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="bg-[#F8F9FA] p-4 rounded-lg flex items-center justify-between border border-[#E8ECF0] max-w-4xl">
        <div className="text-sm text-[#374151]">
          <span className="text-[#6B7280]">Всего записей:</span> <span className="font-medium">{expenses.length}</span>
        </div>
        <div className="text-lg font-medium text-[#D97706]">
          <span className="text-[#6B7280] text-sm pr-2">Итого доп. расходов:</span> 
          €{Number(machine.total_expenses || 0).toLocaleString()}
        </div>
      </div>

      {isEditOpen && (
        <MachineEditDialog
          machine={machine}
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
        />
      )}
    </div>
  )
}
