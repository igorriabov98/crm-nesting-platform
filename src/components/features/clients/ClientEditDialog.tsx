"use client"

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Resolver } from 'react-hook-form'
import { toast } from 'sonner'
import { updateClient } from '@/lib/actions/clients'
import { recalculateSelectedInvoiceTerms } from '@/lib/actions/invoices'
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
  canManageInvoices?: boolean
}

function paymentChanged(client: Client, values: ClientInput) {
  return client.payment_terms_type !== values.payment_terms_type
    || Number(client.payment_due_days || 0) !== Number(values.payment_due_days || 0)
    || Number(client.prepayment_percent || 0) !== Number(values.prepayment_percent || 0)
    || Number(client.final_payment_due_days || 0) !== Number(values.final_payment_due_days || 0)
    || Number(client.estimated_delivery_days ?? 7) !== Number(values.estimated_delivery_days ?? 7)
    || JSON.stringify(client.scheduled_payment_weekdays || []) !== JSON.stringify(values.scheduled_payment_weekdays || [])
    || JSON.stringify(client.scheduled_payment_month_days || []) !== JSON.stringify(values.scheduled_payment_month_days || [])
    || client.scheduled_payment_amount_mode !== values.scheduled_payment_amount_mode
    || Number(client.scheduled_payment_minimum_amount || 0) !== Number(values.scheduled_payment_minimum_amount || 0)
}

export function ClientEditDialog({ client, open, onOpenChange, canManageInvoices = false }: ClientEditDialogProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [isApplyOpen, setIsApplyOpen] = useState(false)
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([])

  const eligibleInvoices = useMemo(
    () => (client.machines || []).flatMap((machine) => {
      const invoices = Array.isArray(machine.invoice) ? machine.invoice : machine.invoice ? [machine.invoice] : []
      return invoices
        .filter((invoice) => invoice.status !== 'cancelled' && Number(invoice.paid_amount || 0) < Number(invoice.amount || 0))
        .map((invoice) => ({ invoice, machine }))
    }),
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
      responsible_user_id: client.responsible_user_id,
      estimated_delivery_days: client.estimated_delivery_days ?? 7,
      scheduled_payment_weekdays: client.scheduled_payment_weekdays || [],
      scheduled_payment_month_days: client.scheduled_payment_month_days || [],
      scheduled_payment_amount_mode: client.scheduled_payment_amount_mode || 'full_balance',
      scheduled_payment_minimum_amount: client.scheduled_payment_minimum_amount,
    },
  })

  async function onSubmit(values: ClientInput) {
    setIsSubmitting(true)
    try {
      const shouldAskInvoices = canManageInvoices && paymentChanged(client, values) && eligibleInvoices.length > 0
      const result = await updateClient(client.id, values)
      if (!result.success) throw new Error(result.error || 'Не удалось обновить клиента')

      toast.success('Клиент обновлен')
      onOpenChange(false)
      if (shouldAskInvoices) {
        setSelectedInvoiceIds([])
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
      const result = await recalculateSelectedInvoiceTerms(client.id, selectedInvoiceIds)
      if (!result.success) throw new Error(result.error || 'Не удалось пересчитать условия оплаты')

      toast.success(`Условия оплаты пересчитаны для инвойсов: ${result.updatedCount}`)
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
            <DialogTitle>Применить новые условия к неоплаченным инвойсам</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-[#6B7280]">
              Будущие инвойсы уже получат новые условия. Ниже можно явно выбрать существующие неоплаченные инвойсы для пересчёта графика; по умолчанию ничего не выбрано.
            </p>
            <div className="rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-3 text-sm text-[#1B3A6B]">
              {paymentTermsLabel({
                type: form.getValues('payment_terms_type'),
                days: form.getValues('payment_due_days'),
                prepaymentPercent: form.getValues('prepayment_percent'),
                finalDays: form.getValues('final_payment_due_days'),
                scheduledWeekdays: form.getValues('scheduled_payment_weekdays'),
                scheduledMonthDays: form.getValues('scheduled_payment_month_days'),
                scheduledAmountMode: form.getValues('scheduled_payment_amount_mode'),
                scheduledMinimumAmount: form.getValues('scheduled_payment_minimum_amount'),
              })}
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-[#E8ECF0] p-3">
              {eligibleInvoices.map(({ machine, invoice }) => {
                const checked = selectedInvoiceIds.includes(invoice.id)
                return (
                  <label key={invoice.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-[#F8F9FA]">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => {
                        setSelectedInvoiceIds((current) => value
                          ? [...current, invoice.id]
                          : current.filter((id) => id !== invoice.id))
                      }}
                    />
                    <span className="font-medium text-[#1B3A6B]">{invoice.invoice_number || machine.specification_number || machine.name}</span>
                    <span className="text-xs text-[#6B7280]">{machine.name} · остаток €{Math.max(0, Number(invoice.amount || 0) - Number(invoice.paid_amount || 0)).toLocaleString('ru-RU')}</span>
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
            <LoadingButton type="button" loading={isApplying} disabled={selectedInvoiceIds.length === 0} onClick={applyTerms}>
              Пересчитать выбранные
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
