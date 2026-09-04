"use client"

import { useEffect, useMemo, useState } from 'react'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ClientInput } from '@/lib/types/schemas'
import type { UseFormReturn } from 'react-hook-form'
import { getClientManagerOptions } from '@/lib/actions/clients'
import {
  PAYMENT_TERMS_TYPE_LABELS,
  SCHEDULED_PAYMENT_AMOUNT_MODE_LABELS,
  SCHEDULED_WEEKDAYS,
} from '@/lib/payments/terms'

export { PAYMENT_TERMS_TYPE_LABELS, paymentTermsLabel } from '@/lib/payments/terms'

type ManagerAccess = {
  canAssign: boolean
  currentUserId: string | null
  currentUserName: string | null
  managers: Array<{ id: string; name: string; isActive: boolean }>
}

export function ClientFormFields({ form }: { form: UseFormReturn<ClientInput> }) {
  const termsType = form.watch('payment_terms_type')
  const scheduledAmountMode = form.watch('scheduled_payment_amount_mode')
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
    if (responsibleUserId) {
      return managerAccess.managers.find((manager) => manager.id === responsibleUserId)?.name
        || (responsibleUserId === managerAccess.currentUserId ? managerAccess.currentUserName : null)
        || 'Ответственный не найден'
    }
    if (!managerAccess.canAssign && managerAccess.currentUserName) return managerAccess.currentUserName
    return 'Не назначен'
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
                <FormControl><SelectTrigger><SelectValue>{responsibleName}</SelectValue></SelectTrigger></FormControl>
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
                if (value === 'scheduled_after_delivery' && !form.getValues('scheduled_payment_amount_mode')) {
                  form.setValue('scheduled_payment_amount_mode', 'full_balance')
                }
              }}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue>{PAYMENT_TERMS_TYPE_LABELS[field.value]}</SelectValue>
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="invoice_days">От даты инвойса</SelectItem>
                <SelectItem value="delivery_days">От даты доставки</SelectItem>
                <SelectItem value="prepayment_full">Предоплата + полная оплата</SelectItem>
                <SelectItem value="scheduled_after_delivery">По расписанию после доставки</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />
        {termsType !== 'scheduled_after_delivery' && (
          <FormField control={form.control} name="payment_due_days" render={({ field }) => (
            <FormItem>
              <FormLabel>{termsType === 'delivery_days' ? 'Дней от доставки' : 'Дней от инвойса'}</FormLabel>
              <FormControl><Input type="number" min={0} {...field} value={field.value ?? 14} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        )}
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

      {termsType === 'scheduled_after_delivery' && (
        <fieldset className="space-y-5 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
          <legend className="px-1 text-sm font-semibold text-[#1B3A6B]">Расписание после доставки</legend>
          <p className="text-xs leading-5 text-[#6B7280]">
            Первая дата всегда позже даты получения клиентом. Если доставка совпала с выбранным днём, используется следующая дата.
          </p>

          <FormField control={form.control} name="scheduled_payment_weekdays" render={({ field }) => (
            <FormItem>
              <FormLabel>Дни недели</FormLabel>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {SCHEDULED_WEEKDAYS.map((day) => {
                  const checked = (field.value || []).includes(day.value)
                  return (
                    <div key={day.value} className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-2 text-sm text-slate-700 transition-colors hover:border-blue-300 focus-within:ring-2 focus-within:ring-blue-600 ${checked ? 'border-blue-700 bg-blue-50' : 'border-slate-200 bg-white'}`}>
                      <Checkbox
                        id={`scheduled-weekday-${day.value}`}
                        checked={checked}
                        onCheckedChange={(selected) => field.onChange(selected
                          ? [...(field.value || []), day.value].sort((left, right) => left - right)
                          : (field.value || []).filter((value) => value !== day.value))}
                        aria-label={day.label}
                      />
                      <label htmlFor={`scheduled-weekday-${day.value}`} className="cursor-pointer">{day.shortLabel}</label>
                    </div>
                  )
                })}
              </div>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="scheduled_payment_month_days" render={({ field }) => (
            <FormItem>
              <FormLabel>Числа месяца</FormLabel>
              <div className="grid grid-cols-7 gap-2 sm:grid-cols-11">
                {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => {
                  const checked = (field.value || []).includes(day)
                  return (
                    <div key={day} className={`relative flex min-h-11 items-center justify-center rounded-lg border text-sm text-slate-700 transition-colors hover:border-blue-300 focus-within:ring-2 focus-within:ring-blue-600 ${checked ? 'border-blue-700 bg-blue-50' : 'border-slate-200 bg-white'}`}>
                      <Checkbox
                        id={`scheduled-month-day-${day}`}
                        checked={checked}
                        onCheckedChange={(selected) => field.onChange(selected
                          ? [...(field.value || []), day].sort((left, right) => left - right)
                          : (field.value || []).filter((value) => value !== day))}
                        aria-label={`${day}-е число месяца`}
                        className="sr-only"
                      />
                      <label htmlFor={`scheduled-month-day-${day}`} className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-lg">{day}</label>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-[#6B7280]">Для 29–31 числа в коротком месяце используется последний день месяца. Совпавшие даты считаются один раз.</p>
              <FormMessage />
            </FormItem>
          )} />

          <div className="grid gap-4 md:grid-cols-2">
            <FormField control={form.control} name="scheduled_payment_amount_mode" render={({ field }) => (
              <FormItem>
                <FormLabel>Сумма на дату</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue>{SCHEDULED_PAYMENT_AMOUNT_MODE_LABELS[field.value]}</SelectValue></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="full_balance">Весь остаток</SelectItem>
                    <SelectItem value="fixed_amount">Минимальная сумма</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-[#6B7280]">Ранние и повышенные оплаты засчитываются в следующие даты.</p>
                <FormMessage />
              </FormItem>
            )} />
            {scheduledAmountMode === 'fixed_amount' && (
              <FormField control={form.control} name="scheduled_payment_minimum_amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Минимальная сумма, EUR *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0.01}
                      step="0.01"
                      inputMode="decimal"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(event) => field.onChange(event.target.value === '' ? null : event.target.value)}
                    />
                  </FormControl>
                  <p className="text-xs text-[#6B7280]">Просрочкой считается только недостающая часть обязательной суммы.</p>
                  <FormMessage />
                </FormItem>
              )} />
            )}
          </div>
        </fieldset>
      )}

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
