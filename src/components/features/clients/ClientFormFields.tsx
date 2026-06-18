"use client"

import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ClientInput } from '@/lib/types/schemas'
import type { UseFormReturn } from 'react-hook-form'

export function paymentTermsLabel(type: string, days: number, prepayment?: number | null, finalDays?: number | null) {
  if (type === 'delivery_days') return `Через ${days} дн. от доставки клиенту`
  if (type === 'prepayment_full') return `Предоплата ${prepayment ?? 50}%, остаток через ${finalDays ?? days} дн. от доставки`
  return `Через ${days} дн. от даты инвойса`
}

export function ClientFormFields({ form }: { form: UseFormReturn<ClientInput> }) {
  const termsType = form.watch('payment_terms_type')

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Компания *</FormLabel>
            <FormControl><Input {...field} value={field.value || ''} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="primary_contact_name" render={({ field }) => (
          <FormItem>
            <FormLabel>Контактное лицо</FormLabel>
            <FormControl><Input {...field} value={field.value || ''} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="phone" render={({ field }) => (
          <FormItem>
            <FormLabel>Телефон</FormLabel>
            <FormControl><Input {...field} value={field.value || ''} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="email" render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl><Input type="email" {...field} value={field.value || ''} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="country_city" render={({ field }) => (
          <FormItem>
            <FormLabel>Страна / город</FormLabel>
            <FormControl><Input {...field} value={field.value || ''} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="address" render={({ field }) => (
          <FormItem>
            <FormLabel>Юридический / общий адрес</FormLabel>
            <FormControl><Input {...field} value={field.value || ''} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
      </div>

      <div className="space-y-3 rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-4">
        <div>
          <h3 className="text-sm font-semibold text-[#1B3A6B]">Данные для документов</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField control={form.control} name="director_name" render={({ field }) => (
            <FormItem>
              <FormLabel>Директор EN</FormLabel>
              <FormControl><Input {...field} value={field.value || ''} placeholder="Имя как в документах на английском, напр. R. Choufany" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="delivery_basis_location_en" render={({ field }) => (
            <FormItem>
              <FormLabel>Место доставки EN для инвойса</FormLabel>
              <FormControl><Input {...field} value={field.value || ''} placeholder="Charleville-Mésières, France" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="delivery_basis_location_ua" render={({ field }) => (
            <FormItem>
              <FormLabel>Місце доставки UA для інвойсу</FormLabel>
              <FormControl><Input {...field} value={field.value || ''} placeholder="Шарлевіль-Мезьєр,Франція" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <FormField control={form.control} name="payment_terms_type" render={({ field }) => (
          <FormItem>
            <FormLabel>Оплата по умолчанию</FormLabel>
            <Select
              value={field.value}
              onValueChange={(value) => {
                field.onChange(value)
                if (value === 'prepayment_full' && !form.getValues('prepayment_percent')) {
                  form.setValue('prepayment_percent', 50)
                }
              }}
            >
              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="invoice_days">От даты инвойса</SelectItem>
                <SelectItem value="delivery_days">От даты доставки</SelectItem>
                <SelectItem value="prepayment_full">Предоплата + полная оплата</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="payment_due_days" render={({ field }) => (
          <FormItem>
            <FormLabel>{termsType === 'delivery_days' ? 'Дней от доставки' : 'Дней от инвойса'}</FormLabel>
            <FormControl><Input type="number" min={0} {...field} value={field.value ?? 14} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        {termsType === 'prepayment_full' && (
          <>
            <FormField control={form.control} name="prepayment_percent" render={({ field }) => (
              <FormItem>
                <FormLabel>Предоплата, %</FormLabel>
                <FormControl><Input type="number" min={0} max={100} {...field} value={field.value ?? 50} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="final_payment_due_days" render={({ field }) => (
              <FormItem>
                <FormLabel>Остаток через дней от доставки</FormLabel>
                <FormControl><Input type="number" min={0} {...field} value={field.value ?? form.getValues('payment_due_days') ?? 14} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </>
        )}
      </div>

      <FormField control={form.control} name="notes" render={({ field }) => (
        <FormItem>
          <FormLabel>Комментарий / заметки</FormLabel>
          <FormControl><Textarea {...field} value={field.value || ''} rows={3} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />
    </div>
  )
}
