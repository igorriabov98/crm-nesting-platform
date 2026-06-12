"use client"

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  createContract,
  deleteContract,
  updateContract,
  type ContractInput,
} from '@/lib/actions/contracts'
import type { Contract, MachineDetails } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingButton } from '@/components/ui/loading-button'
import { Textarea } from '@/components/ui/textarea'

type ClientContractsSectionProps = {
  clientId: string
  contracts: Contract[]
  machines: MachineDetails[]
  error?: string | null
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

function emptyDraft(clientId: string): ContractInput {
  return {
    client_id: clientId,
    number: '',
    date: todayDateOnly(),
    notes: '',
  }
}

function displayDate(value: string) {
  return format(new Date(value), 'dd.MM.yyyy')
}

export function ClientContractsSection({ clientId, contracts, machines, error }: ClientContractsSectionProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [editingContract, setEditingContract] = useState<Contract | null>(null)
  const [draft, setDraft] = useState<ContractInput>(() => emptyDraft(clientId))

  const sortedContracts = useMemo(
    () => [...contracts].sort((a, b) => b.date.localeCompare(a.date)),
    [contracts],
  )

  const usageByContract = useMemo(() => {
    const counts = new Map<string, number>()
    machines.forEach((machine) => {
      if (!machine.contract_id) return
      counts.set(machine.contract_id, (counts.get(machine.contract_id) || 0) + 1)
    })
    return counts
  }, [machines])

  function openCreate() {
    setEditingContract(null)
    setDraft(emptyDraft(clientId))
    setIsOpen(true)
  }

  function openEdit(contract: Contract) {
    setEditingContract(contract)
    setDraft({
      client_id: clientId,
      number: contract.number,
      date: contract.date,
      notes: contract.notes || '',
    })
    setIsOpen(true)
  }

  async function saveContract() {
    setIsSubmitting(true)
    try {
      const payload: ContractInput = { ...draft, client_id: clientId }
      const result = editingContract
        ? await updateContract(editingContract.id, payload)
        : await createContract(payload)

      if (!result.success) throw new Error(result.error || 'Не удалось сохранить контракт')

      toast.success(editingContract ? 'Контракт обновлен' : 'Контракт добавлен')
      setIsOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Неизвестная ошибка')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function removeContract(contract: Contract) {
    const usageCount = usageByContract.get(contract.id) || 0
    if (usageCount > 0) {
      toast.error('Контракт уже связан с заказами')
      return
    }

    if (!confirm(`Удалить контракт №${contract.number}?`)) return

    const result = await deleteContract(contract.id)
    if (!result.success) {
      toast.error(result.error || 'Не удалось удалить контракт')
      return
    }

    toast.success('Контракт удален')
    router.refresh()
  }

  if (error === 'Недостаточно прав') return null

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-[#1B3A6B]">Контракты</h2>
        {!error && (
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Добавить контракт
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
        {error ? (
          <div className="px-4 py-6 text-sm text-[#DC2626]">{error}</div>
        ) : sortedContracts.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[#9CA3AF]">Контракты по клиенту пока не добавлены.</div>
        ) : (
          <div className="divide-y divide-[#E8ECF0]">
            {sortedContracts.map((contract) => {
              const usageCount = usageByContract.get(contract.id) || 0
              return (
                <div key={contract.id} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4 text-[#1B3A6B]" />
                      <div className="font-semibold text-[#1B3A6B]">№{contract.number}</div>
                      <div className="text-sm text-[#6B7280]">от {displayDate(contract.date)}</div>
                    </div>
                    <div className="mt-1 text-sm text-[#6B7280]">
                      {usageCount > 0 ? `Используется в заказах: ${usageCount}` : 'Пока не привязан к заказам'}
                    </div>
                    {contract.notes && <div className="mt-1 text-xs text-[#6B7280]">{contract.notes}</div>}
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => openEdit(contract)} aria-label="Редактировать контракт">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => removeContract(contract)} aria-label="Удалить контракт">
                      <Trash2 className="h-4 w-4 text-[#DC2626]" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingContract ? 'Редактировать контракт' : 'Новый контракт'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>Номер контракта *</Label>
                <Input value={draft.number} onChange={(event) => setDraft((current) => ({ ...current, number: event.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label>Дата контракта *</Label>
                <DatePicker
                  value={draft.date ? new Date(draft.date) : undefined}
                  onChange={(nextDate) => setDraft((current) => ({ ...current, date: dateOnly(nextDate) }))}
                  placeholder="Выберите дату"
                  allowClear={false}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Заметка</Label>
              <Textarea value={draft.notes || ''} rows={3} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => setIsOpen(false)}>
              Отмена
            </Button>
            <LoadingButton type="button" loading={isSubmitting} disabled={!draft.number.trim() || !draft.date} onClick={saveContract}>
              Сохранить
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
