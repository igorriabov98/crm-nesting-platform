"use client"

import React, { useState } from 'react'
import { Edit, Plus, ReceiptText, WalletCards } from 'lucide-react'
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
import { TRANSPORT_EXPENSE_CATEGORY, isTransportExpenseCategory } from '@/lib/utils/transport-expense'

interface ExpensesTabProps {
  machine: MachineDetails
}

export function ExpensesTab({ machine }: ExpensesTabProps) {
  const { role, isDirector } = useRole()
  const canEdit = isDirector || role === 'sales_manager'
  const [isEditOpen, setIsEditOpen] = useState(false)

  const allExpenses = machine.machine_expenses || []
  const transportExpenses = allExpenses.filter(
    (expense) => isTransportExpenseCategory(expense.category) && Number(expense.amount) > 0,
  )
  const transportExpense = transportExpenses[0]
  const regularExpenses = allExpenses.filter((expense) => !isTransportExpenseCategory(expense.category))
  const transportTotal = transportExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
  const expenses = transportExpense
    ? [
        {
          ...transportExpense,
          category: TRANSPORT_EXPENSE_CATEGORY,
          amount: transportTotal,
          comment: transportExpense.comment || null,
        },
        ...regularExpenses,
      ]
    : regularExpenses

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-100 bg-amber-50 text-amber-700">
            <WalletCards className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-950">Дополнительные расходы</h2>
            <p className="mt-1 text-sm text-slate-500">Учитываются в общей стоимости машины.</p>
          </div>
        </div>
        {canEdit && (
          <Button onClick={() => setIsEditOpen(true)} className="min-h-11 bg-blue-950 text-white hover:bg-blue-900">
            <Plus className="mr-2 h-4 w-4" />
            Добавить / Редактировать
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Записей</span>
          <span className="mt-1 block text-2xl font-bold tabular-nums text-slate-950">{expenses.length}</span>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">Итого расходов</span>
          <span className="mt-1 block text-2xl font-bold tabular-nums text-amber-800">€{Number(machine.total_expenses || 0).toLocaleString()}</span>
        </div>
      </div>

      {expenses.length === 0 ? (
        <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center shadow-sm">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500">
            <ReceiptText className="h-5 w-5" aria-hidden="true" />
          </div>
          <h3 className="mt-3 font-semibold text-slate-950">Дополнительных расходов нет</h3>
          <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">Добавьте транспорт, упаковку или другие расходы, когда они появятся.</p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow className="border-slate-200 hover:bg-transparent">
                  <TableHead className="w-14 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">#</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-slate-500">Категория</TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Сумма</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-slate-500">Комментарий</TableHead>
                  {canEdit && <TableHead className="w-14" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((expense: MachineExpense, idx: number) => (
                  <TableRow key={expense.id || idx} className="border-slate-200 hover:bg-slate-50">
                    <TableCell className="text-center tabular-nums text-slate-400">{idx + 1}</TableCell>
                    <TableCell className="font-medium text-slate-900">
                      {isTransportExpenseCategory(expense.category) ? TRANSPORT_EXPENSE_CATEGORY : expense.category}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-amber-700">€{Number(expense.amount).toLocaleString()}</TableCell>
                    <TableCell className="max-w-lg text-slate-600">{expense.comment || '—'}</TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => setIsEditOpen(true)} aria-label="Редактировать расходы" className="text-slate-500 hover:bg-blue-50 hover:text-blue-900">
                          <Edit className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 md:hidden">
            {expenses.map((expense: MachineExpense, idx: number) => (
              <article key={expense.id || idx} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Расход {idx + 1}</span>
                    <h3 className="mt-1 break-words font-semibold text-slate-950">{isTransportExpenseCategory(expense.category) ? TRANSPORT_EXPENSE_CATEGORY : expense.category}</h3>
                  </div>
                  <span className="shrink-0 text-lg font-bold tabular-nums text-amber-700">€{Number(expense.amount).toLocaleString()}</span>
                </div>
                {expense.comment && <p className="mt-3 border-t border-slate-100 pt-3 text-sm leading-6 text-slate-600">{expense.comment}</p>}
              </article>
            ))}
          </div>
        </>
      )}

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
