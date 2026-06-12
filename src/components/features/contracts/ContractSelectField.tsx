'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { format } from 'date-fns'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createContract, getContractsByClient } from '@/lib/actions/contracts'
import type { Contract } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type ContractSelectFieldProps = {
  clientId?: string | null
  value?: string | null
  onChange: (value: string | null) => void
  onCreated?: (contract: Contract) => void
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

function contractLabel(contract: Contract) {
  return `№${contract.number} от ${format(new Date(contract.date), 'dd.MM.yyyy')}`
}

export function ContractSelectField({ clientId, value, onChange, onCreated }: ContractSelectFieldProps) {
  const [contractState, setContractState] = useState<{ clientId: string | null; contracts: Contract[] }>({
    clientId: null,
    contracts: [],
  })
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [number, setNumber] = useState('')
  const [date, setDate] = useState(todayDateOnly())
  useEffect(() => {
    let cancelled = false
    if (!clientId) return

    getContractsByClient(clientId).then((result) => {
      if (cancelled) return
      if (result.error) {
        toast.error(result.error)
        setContractState({ clientId, contracts: [] })
      } else {
        setContractState({ clientId, contracts: result.data || [] })
      }
    })

    return () => {
      cancelled = true
    }
  }, [clientId])

  const contracts = useMemo(
    () => contractState.clientId === clientId ? contractState.contracts : [],
    [clientId, contractState.clientId, contractState.contracts],
  )
  const selectedValue = useMemo(
    () => contracts.some((contract) => contract.id === value) ? value || 'none' : 'none',
    [contracts, value],
  )

  const submit = () => {
    if (!clientId) return
    startTransition(async () => {
      const result = await createContract({
        client_id: clientId,
        number,
        date,
      })
      if (!result.success || !result.data) {
        toast.error(result.error || 'Не удалось создать контракт')
        return
      }

      setContractState((current) => ({
        clientId: clientId,
        contracts: [result.data!, ...current.contracts.filter((contract) => contract.id !== result.data!.id)],
      }))
      onChange(result.data.id)
      onCreated?.(result.data)
      setNumber('')
      setDate(todayDateOnly())
      setIsDialogOpen(false)
      toast.success('Контракт создан')
    })
  }

  return (
    <div className="flex gap-2">
      <Select
        value={selectedValue}
        onValueChange={(nextValue) => onChange(nextValue === 'none' ? null : nextValue)}
        disabled={!clientId}
      >
        <SelectTrigger className="bg-[#F8F9FA] border-[#E8ECF0]">
          <SelectValue placeholder={clientId ? 'Выберите контракт' : 'Сначала выберите клиента'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Без контракта</SelectItem>
          {contracts.map((contract) => (
            <SelectItem key={contract.id} value={contract.id}>
              {contractLabel(contract)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={!clientId}
        onClick={() => setIsDialogOpen(true)}
        title={clientId ? 'Добавить контракт' : 'Сначала выберите клиента'}
      >
        <Plus className="h-4 w-4" />
      </Button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Новый контракт</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Label className="grid gap-2 text-sm font-medium text-[#374151]">
              Номер контракта
              <Input value={number} onChange={(event) => setNumber(event.target.value)} />
            </Label>
            <Label className="grid gap-2 text-sm font-medium text-[#374151]">
              Дата контракта
              <DatePicker
                value={date ? new Date(date) : undefined}
                onChange={(nextDate) => setDate(dateOnly(nextDate))}
                placeholder="Выберите дату"
              />
            </Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isPending} onClick={() => setIsDialogOpen(false)}>
              Отмена
            </Button>
            <Button type="button" disabled={isPending || !number.trim() || !date} onClick={submit}>
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
