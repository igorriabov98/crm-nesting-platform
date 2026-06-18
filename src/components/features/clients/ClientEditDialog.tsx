"use client"

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Resolver } from 'react-hook-form'
import { toast } from 'sonner'
import { applyClientPaymentTermsToMachines, updateClient } from '@/lib/actions/clients'
import { clientSchema, type ClientInput } from '@/lib/types/schemas'
import type { Client, MachineDetails } from '@/lib/types'
import { Form } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LoadingButton } from '@/components/ui/loading-button'
import { ClientFormFields, paymentTermsLabel } from './ClientFormFields'

type ClientEditDialogProps = {
  client: Client & { machines?: MachineDetails[] }
  open: boolean
  onOpenChange: (open: boolean) => void
}

function paymentChanged(client: Client, values: ClientInput) {
  return client.payment_terms_type !== values.payment_terms_type
    || Number(client.payment_due_days || 0) !== Number(values.payment_due_days || 0)
    || Number(client.prepayment_percent || 0) !== Number(values.prepayment_percent || 0)
    || Number(client.final_payment_due_days || 0) !== Number(values.final_payment_due_days || 0)
}

export function ClientEditDialog({ client, open, onOpenChange }: ClientEditDialogProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [isApplyOpen, setIsApplyOpen] = useState(false)
  const [selectedMachineIds, setSelectedMachineIds] = useState<string[]>([])

  const activeMachines = useMemo(
    () => (client.machines || []).filter((machine) => !machine.is_archived),
    [client.machines],
  )

  const form = useForm<ClientInput>({
    resolver: zodResolver(clientSchema) as Resolver<ClientInput>,
    defaultValues: {
      name: client.name || '',
      primary_contact_name: client.primary_contact_name || '',
      phone: client.phone || '',
      email: client.email || '',
      country_city: client.country_city || '',
      address: client.address || '',
      delivery_basis_location_en: client.delivery_basis_location_en || '',
      delivery_basis_location_ua: client.delivery_basis_location_ua || '',
      director_name: client.director_name || '',
      notes: client.notes || '',
      payment_terms_type: client.payment_terms_type || 'invoice_days',
      payment_due_days: client.payment_due_days || 14,
      prepayment_percent: client.prepayment_percent ?? 50,
      final_payment_due_days: client.final_payment_due_days ?? 0,
    },
  })

  async function onSubmit(values: ClientInput) {
    setIsSubmitting(true)
    try {
      const shouldAskMachines = paymentChanged(client, values) && activeMachines.length > 0
      const result = await updateClient(client.id, values)
      if (!result.success) throw new Error(result.error || 'Не удалось обновить клиента')

      toast.success('Клиент обновлен')
      onOpenChange(false)
      if (shouldAskMachines) {
        setSelectedMachineIds([])
        setIsApplyOpen(true)
      } else {
        router.refresh()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Неизвестная ошибка')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function applyTerms() {
    setIsApplying(true)
    try {
      const result = await applyClientPaymentTermsToMachines(client.id, selectedMachineIds)
      if (!result.success) throw new Error(result.error || 'Не удалось применить условия оплаты')

      toast.success(`Условия оплаты применены к машинам: ${result.updated_count}`)
      setIsApplyOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Неизвестная ошибка')
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Редактировать клиента</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <ClientFormFields form={form} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                  Отмена
                </Button>
                <LoadingButton type="submit" loading={isSubmitting}>
                  Сохранить
                </LoadingButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isApplyOpen} onOpenChange={setIsApplyOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Применить новые условия оплаты к машинам</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-[#6B7280]">
              Выберите машины, где нужно заменить условия оплаты на текущие условия клиента. Инвойсы и даты оплат не будут пересчитаны.
            </p>
            <div className="rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-3 text-sm text-[#1B3A6B]">
              {paymentTermsLabel(form.getValues('payment_terms_type'), form.getValues('payment_due_days'), form.getValues('prepayment_percent'), form.getValues('final_payment_due_days'))}
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-[#E8ECF0] p-3">
              {activeMachines.map((machine) => {
                const checked = selectedMachineIds.includes(machine.id)
                return (
                  <label key={machine.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-[#F8F9FA]">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => {
                        setSelectedMachineIds((current) => value
                          ? [...current, machine.id]
                          : current.filter((id) => id !== machine.id))
                      }}
                    />
                    <span className="font-medium text-[#1B3A6B]">{machine.name}</span>
                    <span className="text-xs text-[#6B7280]">{machine.status}</span>
                  </label>
                )
              })}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isApplying} onClick={() => {
              setIsApplyOpen(false)
              router.refresh()
            }}>
              Не применять
            </Button>
            <LoadingButton type="button" loading={isApplying} disabled={selectedMachineIds.length === 0} onClick={applyTerms}>
              Применить к выбранным
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
