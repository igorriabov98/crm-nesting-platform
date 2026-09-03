"use client"

import { useEffect, useMemo, useState } from 'react'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ClientInput } from '@/lib/types/schemas'
import type { UseFormReturn } from 'react-hook-form'
import { getClientManagerOptions } from '@/lib/actions/clients'

type ManagerAccess = {
  canAssign: boolean
  currentUserId: string | null
  currentUserName: string | null
  managers: Array<{ id: string; name: string; isActive: boolean }>
}

export function paymentTermsLabel(type: string, days: number, prepayment?: number | null, finalDays?: number | null) {
  if (type === 'delivery_days') return `Через ${days} дн. от доставки клиенту`
  if (type === 'prepayment_full') return `Предоплата ${prepayment ?? 50}%, остаток через ${finalDays ?? days} дн. от доставки`
  return `Через ${days} дн. от даты инвойса`
}

export function ClientFormFields({ form }: { form: UseFormReturn<ClientInput> }) {
  const termsType = form.watch('payment_terms_type')
  const responsibleUserId = form.watch('responsible_user_id')
  const [managerAccess, setManagerAccess] = useState<ManagerAccess | null>(null)

  useEffect(() => {
    let active = true
    void getClientManagerOptions().then((result) => {
      if (!active || !result.success) return
      setManagerAccess({
        canAssign: result.canAssign,
        currentUserId: result.currentUserId,
        currentUserName: result.currentUserName,
        managers: result.managers,
      })
      if (!result.canAssign && !form.getValues('responsible_user_id') && result.currentUserId) {
        form.setValue('responsible_user_id', result.currentUserId)
      }
    })
    return () => { active = false }
  }, [form])

  const responsibleName = useMemo(() => {
    if (!managerAccess) return 'Загрузка…'
    return managerAccess.managers.find((manager) => manager.id === responsibleUserId)?.name
      || managerAccess.currentUserName
      || 'Не назначен'
  }, [managerAccess, responsibleUserId])

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

      <div className="grid gap-4 rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-4 md:grid-cols-2">
        <FormField control={form.control} name="responsible_user_id" render={({ field }) => (
          <FormItem>
            <FormLabel>Ответственный менеджер</FormLabel>
            {managerAccess?.canAssign ? (
              <Select value={field.value || 'unassigned'} onValueChange={(value) => field.onChange(value === 'unassigned' ? null : value)}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="unassigned">Не назначен</SelectItem>
                  {managerAccess.managers.map((manager) => (
                    <SelectItem key={manager.id} value={manager.id} disabled={!manager.isActive}>
                      {manager.name}{manager.isActive ? '' : ' (неактивен)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={responsibleName} disabled aria-label="Ответственный менеджер" />
            )}
            <p className="text-xs text-[#6B7280]">
              {managerAccess?.canAssign ? 'Назначение могут менять директора и Администратор CRM.' : 'При создании компании вы назначаетесь ответственным автоматически.'}
            </p>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="estimated_delivery_days" render={({ field }) => (
          <FormItem>
            <FormLabel>Норматив доставки, календарных дней</FormLabel>
            <FormControl><Input type="number" min={0} max={365} {...field} value={field.value ?? 7} /></FormControl>
            <p className="text-xs text-[#6B7280]">Используется только для прогноза срока оплаты до фактической доставки.</p>
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
