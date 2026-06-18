"use client"

import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Resolver } from 'react-hook-form'
import { toast } from 'sonner'
import { clientSchema, type ClientInput } from '@/lib/types/schemas'
import type { Client } from '@/lib/types'
import { createClient } from '@/lib/actions/clients'
import { Form } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { LoadingButton } from '@/components/ui/loading-button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ClientFormFields } from './ClientFormFields'

interface ClientCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (client: Client) => void
}

export function ClientCreateDialog({ open, onOpenChange, onCreated }: ClientCreateDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const form = useForm<ClientInput>({
    resolver: zodResolver(clientSchema) as Resolver<ClientInput>,
    defaultValues: {
      name: '',
      primary_contact_name: '',
      phone: '',
      email: '',
      country_city: '',
      address: '',
      delivery_basis_location_en: '',
      delivery_basis_location_ua: '',
      director_name: '',
      notes: '',
      payment_terms_type: 'invoice_days',
      payment_due_days: 14,
      prepayment_percent: 50,
      final_payment_due_days: 0,
    },
  })

  async function onSubmit(values: ClientInput) {
    setIsSubmitting(true)
    let createdClient: Client | null = null
    try {
      const res = await createClient(values)
      if (!res.success || !res.client) throw new Error(res.error || 'Не удалось создать клиента')
      createdClient = res.client
      toast.success('Клиент создан')
      form.reset()
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Неизвестная ошибка')
    } finally {
      setIsSubmitting(false)
    }

    if (createdClient) onCreated?.(createdClient)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Новый клиент</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <ClientFormFields form={form} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Отмена
              </Button>
              <LoadingButton type="submit" loading={isSubmitting}>
                Создать клиента
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
