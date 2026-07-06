"use server"

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import type { CurrentUser } from '@/lib/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>
type DbMutationResult = { error: { message?: string } | null }
type DbUpdateChain = {
  eq: (column: string, value: unknown) => Promise<DbMutationResult>
}
type InvoiceMutationTable = {
  insert: (values: Record<string, unknown>) => Promise<DbMutationResult>
  update: (values: Record<string, unknown>) => DbUpdateChain
}

function invoiceMutations(supabase: SupabaseServerClient) {
  return supabase.from('invoices') as unknown as InvoiceMutationTable
}

function todayDateOnly() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  const nextYear = date.getFullYear()
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0')
  const nextDay = String(date.getDate()).padStart(2, '0')
  return `${nextYear}-${nextMonth}-${nextDay}`
}

function invoiceDueDate(machine: {
  payment_terms_type?: string | null
  payment_due_days?: number | null
  final_payment_due_days?: number | null
  delivery_to_client_date?: string | null
}, invoiceDate: string) {
  const fallbackDays = Number(machine.payment_due_days || 0)
  const deliveryDate = machine.delivery_to_client_date || null

  if (machine.payment_terms_type === 'delivery_days' && deliveryDate) {
    return addDays(deliveryDate, fallbackDays)
  }

  if (machine.payment_terms_type === 'prepayment_full' && deliveryDate) {
    return addDays(deliveryDate, Number(machine.final_payment_due_days || fallbackDays))
  }

  return addDays(invoiceDate, fallbackDays)
}

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

    const { error } = await invoiceMutations(supabase)
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
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err) }
  }
}

export async function createMachineInvoice(machineId: string) {
  try {
    await requirePermission('invoices', 'manage')
    const { supabase, user } = await requireAuth()

    const { data: machineData, error: machineError } = await supabase
      .from('machines')
      .select('id, is_archived, payment_terms_type, payment_due_days, final_payment_due_days, delivery_to_client_date')
      .eq('id', machineId)
      .single()

    if (machineError || !machineData) throw new Error('Машина не найдена')
    const machine = machineData as {
      id: string
      is_archived: boolean | null
      payment_terms_type: string | null
      payment_due_days: number | null
      final_payment_due_days: number | null
      delivery_to_client_date: string | null
    }
    if (machine.is_archived) throw new Error('Машина архивирована. Действия с ней остановлены.')

    const { data: existingInvoice, error: existingError } = await supabase
      .from('invoices')
      .select('id')
      .eq('machine_id', machineId)
      .maybeSingle()

    if (existingError) throw existingError
    if (existingInvoice) throw new Error('Инвойс уже создан')

    const [{ data: itemsData, error: itemsError }, { data: expensesData, error: expensesError }] = await Promise.all([
      supabase.from('machine_items').select('price, quantity').eq('machine_id', machineId),
      supabase.from('machine_expenses').select('amount').eq('machine_id', machineId),
    ])

    if (itemsError) throw itemsError
    if (expensesError) throw expensesError

    const totalItems = ((itemsData || []) as Array<{ price: number | null; quantity: number | null }>)
      .reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0)
    const totalExpenses = ((expensesData || []) as Array<{ amount: number | null }>)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const amount = totalItems + totalExpenses
    const invoiceDate = todayDateOnly()
    const dueDate = invoiceDueDate(machine, invoiceDate)

    const { error: insertError } = await invoiceMutations(supabase).insert({
      machine_id: machineId,
      amount,
      invoice_date: invoiceDate,
      payment_date: dueDate,
      due_date: dueDate,
      original_planned_date: dueDate,
      status: 'not_paid',
      paid_amount: 0,
      updated_by: user.id,
    })

    if (insertError) throw insertError

    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    revalidatePath(ROUTES.INVOICES)
    revalidatePath(ROUTES.FINANCE_CALENDAR)
    return { success: true, error: null }
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err) }
  }
}

export async function deleteMachineInvoice(machineId: string, invoiceId: string) {
  try {
    await requirePermission('invoices', 'manage')
    const { supabase } = await requireAuth()

    const { data: existingInvoice, error: existingError } = await supabase
      .from('invoices')
      .select('id, machine_id')
      .eq('id', invoiceId)
      .eq('machine_id', machineId)
      .maybeSingle()

    if (existingError) throw existingError
    if (!existingInvoice) throw new Error('Инвойс не найден')

    const { error } = await supabase
      .from('invoices')
      .delete()
      .eq('id', invoiceId)
      .eq('machine_id', machineId)

    if (error) throw error

    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    revalidatePath(ROUTES.INVOICES)
    revalidatePath(ROUTES.FINANCE_CALENDAR)
    return { success: true, error: null }
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err) }
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

    const { data: invoiceData, error: invoiceError } = await supabase
      .from('invoices')
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
    const { error } = await invoiceMutations(supabase)
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
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err) }
  }
}
