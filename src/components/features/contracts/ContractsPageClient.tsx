'use client'

import { useState, useTransition } from 'react'
import { format } from 'date-fns'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  createContract,
  deleteContract,
  updateContract,
  type ContractInput,
  type ContractWithClient,
} from '@/lib/actions/contracts'
import type { Client } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type ContractsPageClientProps = {
  contracts: ContractWithClient[]
  clients: Pick<Client, 'id' | 'name'>[]
}

type ContractFormState = ContractInput & { id?: string }

const emptyForm: ContractFormState = {
  client_id: '',
  number: '',
  date: todayDateOnly(),
  notes: '',
}

function todayDateOnly() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateOnly(date: Date | undefined) {
  if (!date) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function displayDate(value: string) {
  return format(new Date(value), 'dd.MM.yyyy')
}

export function ContractsPageClient({ contracts: initialContracts, clients }: ContractsPageClientProps) {
  const [contracts, setContracts] = useState(initialContracts)
  const [form, setForm] = useState<ContractFormState>(emptyForm)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const openCreate = () => {
    setForm({ ...emptyForm, date: todayDateOnly() })
    setIsDialogOpen(true)
  }

  const openEdit = (contract: ContractWithClient) => {
    setForm({
      id: contract.id,
      client_id: contract.client_id,
      number: contract.number,
      date: contract.date,
      notes: contract.notes || '',
    })
    setIsDialogOpen(true)
  }

  const save = () => {
    startTransition(async () => {
      const result = form.id
        ? await updateContract(form.id, form)
        : await createContract(form)

      if (!result.success || !result.data) {
        toast.error(result.error || 'Не удалось сохранить контракт')
        return
      }

      const client = clients.find((item) => item.id === result.data!.client_id) || null
      const nextContract: ContractWithClient = { ...result.data, client }
      setContracts((current) => {
        const withoutCurrent = current.filter((item) => item.id !== nextContract.id)
        return [nextContract, ...withoutCurrent].sort((a, b) => b.date.localeCompare(a.date))
      })
      setIsDialogOpen(false)
      toast.success('Контракт сохранен')
    })
  }

  const remove = (contract: ContractWithClient) => {
    if (!confirm(`Удалить контракт №${contract.number}?`)) return
    startTransition(async () => {
      const result = await deleteContract(contract.id)
      if (!result.success) {
        toast.error(result.error || 'Не удалось удалить контракт')
        return
      }

      setContracts((current) => current.filter((item) => item.id !== contract.id))
      toast.success('Контракт удален')
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1B3A6B]">Контракты</h1>
          <p className="text-sm text-[#6B7280]">Контракты клиентов для заказов и документов.</p>
        </div>
        <Button type="button" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Добавить контракт
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA] text-[#6B7280]">
              <tr>
                <th className="min-w-[160px] px-4 py-3">Номер</th>
                <th className="min-w-[140px] px-4 py-3">Дата</th>
                <th className="min-w-[220px] px-4 py-3">Клиент</th>
                <th className="min-w-[220px] px-4 py-3">Заметки</th>
                <th className="w-40 px-4 py-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF0]">
              {contracts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[#9CA3AF]">
                    Контракты пока не добавлены.
                  </td>
                </tr>
              ) : contracts.map((contract) => (
                <tr key={contract.id} className="hover:bg-[#F8F9FA]">
                  <td className="px-4 py-3 font-medium text-[#1B3A6B]">№{contract.number}</td>
                  <td className="px-4 py-3 text-[#374151]">{displayDate(contract.date)}</td>
                  <td className="px-4 py-3 text-[#374151]">{contract.client?.name || '—'}</td>
                  <td className="px-4 py-3 text-[#6B7280]">{contract.notes || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => openEdit(contract)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Редактировать
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => remove(contract)}>
                        <Trash2 className="h-3.5 w-3.5" />
                        Удалить
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Редактировать контракт' : 'Добавить контракт'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Label className="grid gap-2 text-sm font-medium text-[#374151]">
              Клиент
              <Select value={form.client_id} onValueChange={(value) => setForm((current) => ({ ...current, client_id: value || '' }))}>
                <SelectTrigger className="bg-[#F8F9FA] border-[#E8ECF0]">
                  <SelectValue placeholder="Выберите клиента" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Label className="grid gap-2 text-sm font-medium text-[#374151]">
                Номер
                <Input value={form.number} onChange={(event) => setForm((current) => ({ ...current, number: event.target.value }))} />
              </Label>
              <Label className="grid gap-2 text-sm font-medium text-[#374151]">
                Дата
                <DatePicker
                  value={form.date ? new Date(form.date) : undefined}
                  onChange={(date) => setForm((current) => ({ ...current, date: dateOnly(date) }))}
                  placeholder="Выберите дату"
                />
              </Label>
            </div>
            <Label className="grid gap-2 text-sm font-medium text-[#374151]">
              Заметки
              <Textarea value={form.notes || ''} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
            </Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isPending} onClick={() => setIsDialogOpen(false)}>
              Отмена
            </Button>
            <Button type="button" disabled={isPending || !form.client_id || !form.number.trim() || !form.date} onClick={save}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
