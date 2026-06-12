"use server"

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import type { CurrentUser } from '@/lib/types'

async function requireAuth() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Не авторизован')

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) throw new Error('Профиль не найден')
  return { supabase, user: profile as unknown as CurrentUser }
}

export async function updateInvoiceStatus(invoiceId: string, status: 'paid' | 'not_paid', machineId?: string) {
  try {
    await requirePermission('invoices', 'manage')
    const { supabase, user } = await requireAuth()

    // В ТЗ: overdue устанавливается автоматически. Ручной выбор только paid/not_paid.
    if (status !== 'paid' && status !== 'not_paid') {
      throw new Error('Некорректный статус. Допустимы только paid и not_paid')
    }

    const { error } = await (supabase.from('invoices') as any)
      .update({ 
        status,
        updated_by: user.id
      })
      .eq('id', invoiceId)

    if (error) throw error

    if (machineId) {
      revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    }
    revalidatePath('/invoices')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function recordInvoicePayment(
  invoiceId: string,
  input: { paid_amount: number; balance_due_date?: string | null; payment_note?: string | null },
  machineId?: string,
) {
  try {
    await requirePermission('invoices', 'manage')
    const { supabase, user } = await requireAuth()

    const { data: invoiceData, error: invoiceError } = await (supabase.from('invoices') as any)
      .select('amount')
      .eq('id', invoiceId)
      .single()

    if (invoiceError || !invoiceData) throw new Error('Инвойс не найден')

    const amount = Number((invoiceData as { amount?: number | null }).amount || 0)
    const paidAmount = Number(input.paid_amount || 0)
    if (!Number.isFinite(paidAmount) || paidAmount < 0) throw new Error('Некорректная сумма оплаты')
    if (paidAmount > amount) throw new Error('Оплата не может быть больше суммы инвойса')
    if (paidAmount > 0 && paidAmount < amount && !input.balance_due_date) {
      throw new Error('Если оплата не полная, укажите дату оплаты остатка')
    }

    const status = amount > 0 && paidAmount >= amount ? 'paid' : 'not_paid'
    const { error } = await (supabase.from('invoices') as any)
      .update({
        paid_amount: paidAmount,
        balance_due_date: status === 'paid' ? null : input.balance_due_date || null,
        payment_note: input.payment_note || null,
        status,
        updated_by: user.id,
      })
      .eq('id', invoiceId)

    if (error) throw error

    if (machineId) revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    revalidatePath('/invoices')
    revalidatePath(ROUTES.CLIENTS)
    return { success: true, status }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
