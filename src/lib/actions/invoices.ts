"use server"

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { trustedDb } from '@/lib/supabase/trusted-db'
import { ROUTES } from '@/lib/constants/routes'
import { DIRECTOR_ACCESS_ROLES } from '@/lib/permissions/resources'
import { requirePermission } from '@/lib/permissions/server'
import { requireCompanyRecordAccess } from '@/lib/permissions/company-scope'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import {
  createInvoiceDocumentSnapshot,
  getTrustedDocumentData,
  invoiceDocumentMissingFields,
} from '@/lib/actions/document-generation'
import {
  buildInvoicePaymentSchedule,
  nextPaymentSchedulePart,
  todayDateOnly,
} from '@/lib/invoices/payment-schedule'
import type { Database } from '@/lib/types/database'
import type { UserRole } from '@/lib/types'

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Некорректная дата')
const issueInvoiceSchema = z.object({
  machineId: z.string().uuid('Некорректный ID машины'),
  invoiceDate: dateOnlySchema,
})
const paymentSchema = z.object({
  invoiceId: z.string().uuid('Некорректный ID инвойса'),
  amount: z.coerce.number().positive('Сумма оплаты должна быть больше нуля').multipleOf(0.01, 'Укажите сумму с точностью до центов'),
  paidOn: dateOnlySchema,
  note: z.string().trim().max(1000).optional().nullable(),
})
const correctionSchema = paymentSchema.omit({ invoiceId: true }).extend({
  paymentId: z.string().uuid('Некорректный ID оплаты'),
  reason: z.string().trim().min(1, 'Укажите причину исправления').max(1000),
})
const cancellationSchema = z.object({
  invoiceId: z.string().uuid('Некорректный ID инвойса'),
  reason: z.string().trim().min(1, 'Укажите причину аннулирования').max(1000),
})
const recalculateTermsSchema = z.object({
  clientId: z.string().uuid('Некорректный ID компании'),
  invoiceIds: z.array(z.string().uuid('Некорректный ID инвойса')).max(500).default([]),
})

export type InvoiceIssueInput = z.input<typeof issueInvoiceSchema>
export type InvoicePaymentInput = z.input<typeof paymentSchema>
export type InvoicePaymentCorrectionInput = z.input<typeof correctionSchema>

type MachineInvoiceSource = {
  id: string
  name: string
  is_archived: boolean | null
  client_id: string | null
  specification_number: string | null
  actual_shipping_date: string | null
  desired_shipping_date: string | null
  delivery_to_client_date: string | null
  client: {
    id: string
    payment_terms_type: Database['public']['Enums']['payment_terms_type']
    payment_due_days: number
    prepayment_percent: number | null
    final_payment_due_days: number | null
    estimated_delivery_days: number
    scheduled_payment_weekdays: number[]
    scheduled_payment_month_days: number[]
    scheduled_payment_amount_mode: Database['public']['Enums']['scheduled_payment_amount_mode']
    scheduled_payment_minimum_amount: number | null
  } | null
}

type InvoiceHistoryRow = {
  id: string
  status: Database['public']['Enums']['invoice_status']
  invoice_revision: number
}

type RecalculationMachineRow = {
  id: string
  client_id: string | null
  actual_shipping_date: string | null
  desired_shipping_date: string | null
  delivery_to_client_date: string | null
}

type RecalculationInvoiceRow = {
  id: string
  amount: number | null
  paid_amount: number | null
  invoice_date: string
  status: Database['public']['Enums']['invoice_status']
  payment_terms_type_snapshot: Database['public']['Enums']['payment_terms_type'] | null
  payment_due_days_snapshot: number | null
  prepayment_percent_snapshot: number | null
  final_payment_due_days_snapshot: number | null
  estimated_delivery_days_snapshot: number | null
  scheduled_payment_weekdays_snapshot: number[]
  scheduled_payment_month_days_snapshot: number[]
  scheduled_payment_amount_mode_snapshot: Database['public']['Enums']['scheduled_payment_amount_mode']
  scheduled_payment_minimum_amount_snapshot: number | null
  machine: RecalculationMachineRow | RecalculationMachineRow[] | null
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function assertDateNotFuture(value: string, label: string) {
  if (value > todayDateOnly()) throw new Error(`${label} не может быть в будущем`)
}

function revalidateInvoiceViews(machineId?: string, clientId?: string | null) {
  if (machineId) revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
  if (clientId) revalidatePath(`${ROUTES.SALES_PAYMENTS}/${clientId}`)
  revalidatePath(ROUTES.SALES_PAYMENTS)
  revalidatePath(ROUTES.INVOICES)
  revalidatePath(ROUTES.CLIENTS)
  revalidatePath(ROUTES.FINANCE_CALENDAR)
  revalidatePath(ROUTES.REPORTS_COMPLEX)
}

async function loadInvoiceWithClient(invoiceId: string) {
  const admin = trustedDb(createAdminClient())
  const { data, error } = await admin
    .from('invoices')
    .select('id, machine_id, status, machine:machines(id, client_id)')
    .eq('id', invoiceId)
    .single()
  if (error || !data) throw new Error('Инвойс не найден')
  const row = data as {
    id: string
    machine_id: string
    status: Database['public']['Enums']['invoice_status']
    machine: { id: string; client_id: string | null } | Array<{ id: string; client_id: string | null }> | null
  }
  const machine = relationOne(row.machine)
  return {
    id: row.id,
    machineId: row.machine_id,
    status: row.status,
    clientId: machine?.client_id || null,
  }
}

export async function issueMachineInvoice(input: InvoiceIssueInput) {
  try {
    const parsed = issueInvoiceSchema.parse(input)
    assertDateNotFuture(parsed.invoiceDate, 'Дата инвойса')
    const permission = await requirePermission('invoices', 'manage')
    const admin = trustedDb(createAdminClient())

    const { data: machineData, error: machineError } = await admin
      .from('machines')
      .select(`
        id, name, is_archived, client_id, specification_number,
        actual_shipping_date, desired_shipping_date, delivery_to_client_date,
        client:clients(
          id, payment_terms_type, payment_due_days, prepayment_percent,
          final_payment_due_days, estimated_delivery_days,
          scheduled_payment_weekdays, scheduled_payment_month_days,
          scheduled_payment_amount_mode, scheduled_payment_minimum_amount
        )
      `)
      .eq('id', parsed.machineId)
      .single()

    if (machineError || !machineData) throw new Error('Машина не найдена')
    const rawMachine = machineData as unknown as Omit<MachineInvoiceSource, 'client'> & { client: MachineInvoiceSource['client'] | MachineInvoiceSource['client'][] }
    const machine: MachineInvoiceSource = { ...rawMachine, client: relationOne(rawMachine.client) }
    if (machine.is_archived) throw new Error('Машина архивирована. Действия с ней остановлены.')
    if (!machine.client_id || !machine.client) throw new Error('У машины не указана компания клиента')
    await requireCompanyRecordAccess('invoices', 'manage', machine.client_id)

    const { data: invoiceHistory, error: invoiceHistoryError } = await admin
      .from('invoices')
      .select('id, status, invoice_revision')
      .eq('machine_id', parsed.machineId)
      .order('invoice_revision', { ascending: false })
    if (invoiceHistoryError) throw invoiceHistoryError
    const history = (invoiceHistory || []) as InvoiceHistoryRow[]
    if (history.some((invoice) => invoice.status !== 'cancelled')) {
      throw new Error('По этой машине уже есть активный инвойс')
    }

    const documentData = await getTrustedDocumentData(parsed.machineId)
    const missingFields = invoiceDocumentMissingFields(documentData)
    if (missingFields.length > 0) {
      throw new Error(`Инвойс не выставлен. Заполните данные:\n• ${missingFields.join('\n• ')}`)
    }

    const revision = history.length === 0
      ? 0
      : Math.max(...history.map((invoice) => Number(invoice.invoice_revision || 0))) + 1
    const baseNumber = documentData.machine.specification_number.trim()
    const invoiceNumber = revision === 0 ? baseNumber : `${baseNumber}-R${revision}`
    const amount = Number(documentData.totals.grand_total.toFixed(2))
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Сумма инвойса должна быть больше нуля')

    const schedule = buildInvoicePaymentSchedule({
      amount,
      paidAmount: 0,
      invoiceDate: parsed.invoiceDate,
      paymentTermsType: machine.client.payment_terms_type,
      paymentDueDays: machine.client.payment_due_days,
      prepaymentPercent: machine.client.prepayment_percent,
      finalPaymentDueDays: machine.client.final_payment_due_days,
      estimatedDeliveryDays: machine.client.estimated_delivery_days,
      scheduledPaymentWeekdays: machine.client.scheduled_payment_weekdays,
      scheduledPaymentMonthDays: machine.client.scheduled_payment_month_days,
      scheduledPaymentAmountMode: machine.client.scheduled_payment_amount_mode,
      scheduledPaymentMinimumAmount: machine.client.scheduled_payment_minimum_amount,
      deliveryToClientDate: machine.delivery_to_client_date,
      actualShippingDate: machine.actual_shipping_date,
      desiredShippingDate: machine.desired_shipping_date,
    })
    const nextPayment = nextPaymentSchedulePart(schedule)
    const exactDueDate = nextPayment && !nextPayment.isForecast ? nextPayment.dueDate : null
    const snapshot = createInvoiceDocumentSnapshot(documentData, { number: invoiceNumber, date: parsed.invoiceDate })

    const { data: invoice, error: insertError } = await admin
      .from('invoices')
      .insert({
        machine_id: parsed.machineId,
        invoice_number: invoiceNumber,
        invoice_revision: revision,
        amount,
        invoice_date: parsed.invoiceDate,
        payment_date: exactDueDate,
        due_date: exactDueDate,
        original_planned_date: exactDueDate,
        status: 'not_paid',
        paid_amount: 0,
        updated_by: permission.userId,
        payment_terms_type_snapshot: machine.client.payment_terms_type,
        payment_due_days_snapshot: machine.client.payment_due_days,
        prepayment_percent_snapshot: machine.client.payment_terms_type === 'prepayment_full'
          ? machine.client.prepayment_percent ?? 50
          : null,
        final_payment_due_days_snapshot: machine.client.payment_terms_type === 'prepayment_full'
          ? machine.client.final_payment_due_days ?? machine.client.payment_due_days
          : null,
        estimated_delivery_days_snapshot: machine.client.estimated_delivery_days,
        scheduled_payment_weekdays_snapshot: machine.client.scheduled_payment_weekdays,
        scheduled_payment_month_days_snapshot: machine.client.scheduled_payment_month_days,
        scheduled_payment_amount_mode_snapshot: machine.client.scheduled_payment_amount_mode,
        scheduled_payment_minimum_amount_snapshot: machine.client.payment_terms_type === 'scheduled_after_delivery'
          && machine.client.scheduled_payment_amount_mode === 'fixed_amount'
          ? machine.client.scheduled_payment_minimum_amount
          : null,
        document_snapshot: snapshot as unknown as Database['public']['Tables']['invoices']['Insert']['document_snapshot'],
      })
      .select('id, invoice_number')
      .single()

    if (insertError?.code === '23505') throw new Error('По этой машине уже есть активный инвойс')
    if (insertError || !invoice) throw insertError || new Error('Не удалось выставить инвойс')
    const createdInvoice = invoice as { id: string; invoice_number: string }

    revalidateInvoiceViews(parsed.machineId, machine.client_id)
    return { success: true, invoiceId: createdInvoice.id, invoiceNumber: createdInvoice.invoice_number, error: null }
  } catch (error) {
    return { success: false, invoiceId: null, invoiceNumber: null, error: getErrorMessage(error) }
  }
}

/** @deprecated Use issueMachineInvoice with an explicit date. */
export async function createMachineInvoice(machineId: string, invoiceDate = todayDateOnly()) {
  return issueMachineInvoice({ machineId, invoiceDate })
}

export async function cancelMachineInvoice(input: z.input<typeof cancellationSchema>) {
  try {
    const parsed = cancellationSchema.parse(input)
    const invoice = await loadInvoiceWithClient(parsed.invoiceId)
    const context = await requireCompanyRecordAccess('invoices', 'manage', invoice.clientId)
    const canCancel = context.permissionDetails.isAdminPosition
      || (DIRECTOR_ACCESS_ROLES as readonly UserRole[]).includes(context.role)
    if (!canCancel) throw new Error('Аннулировать инвойс может только директор или Администратор CRM')

    const { error } = await trustedDb(createAdminClient()).rpc('fn_cancel_invoice', {
      p_invoice_id: parsed.invoiceId,
      p_reason: parsed.reason,
      p_actor: context.userId,
    })
    if (error) throw error
    revalidateInvoiceViews(invoice.machineId, invoice.clientId)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function recordInvoicePayment(input: InvoicePaymentInput) {
  try {
    const parsed = paymentSchema.parse(input)
    assertDateNotFuture(parsed.paidOn, 'Дата оплаты')
    const invoice = await loadInvoiceWithClient(parsed.invoiceId)
    const context = await requireCompanyRecordAccess('client_payments', 'manage', invoice.clientId)
    const { data, error } = await trustedDb(createAdminClient()).rpc('fn_record_invoice_payment', {
      p_invoice_id: parsed.invoiceId,
      p_amount: parsed.amount,
      p_paid_on: parsed.paidOn,
      p_note: parsed.note || null,
      p_actor: context.userId,
    })
    if (error) throw error
    revalidateInvoiceViews(invoice.machineId, invoice.clientId)
    return { success: true, paymentId: data, error: null }
  } catch (error) {
    return { success: false, paymentId: null, error: getErrorMessage(error) }
  }
}

export async function correctInvoicePayment(input: InvoicePaymentCorrectionInput) {
  try {
    const parsed = correctionSchema.parse(input)
    assertDateNotFuture(parsed.paidOn, 'Дата оплаты')
    const admin = trustedDb(createAdminClient())
    const { data: payment, error: paymentError } = await admin
      .from('invoice_payments')
      .select('invoice_id')
      .eq('id', parsed.paymentId)
      .is('voided_at', null)
      .single()
    if (paymentError || !payment) throw new Error('Активная оплата не найдена')
    const paymentRow = payment as { invoice_id: string }
    const invoice = await loadInvoiceWithClient(paymentRow.invoice_id)
    const context = await requireCompanyRecordAccess('client_payments', 'manage', invoice.clientId)
    const { data, error } = await admin.rpc('fn_correct_invoice_payment', {
      p_payment_id: parsed.paymentId,
      p_amount: parsed.amount,
      p_paid_on: parsed.paidOn,
      p_note: parsed.note || null,
      p_reason: parsed.reason,
      p_actor: context.userId,
    })
    if (error) throw error
    revalidateInvoiceViews(invoice.machineId, invoice.clientId)
    return { success: true, replacementPaymentId: data, error: null }
  } catch (error) {
    return { success: false, replacementPaymentId: null, error: getErrorMessage(error) }
  }
}

export async function recalculateSelectedInvoiceTerms(clientId: string, invoiceIds: string[]) {
  try {
    const parsed = recalculateTermsSchema.parse({ clientId, invoiceIds: Array.from(new Set(invoiceIds)) })
    if (parsed.invoiceIds.length === 0) return { success: true, updatedCount: 0, error: null }
    const context = await requireCompanyRecordAccess('invoices', 'manage', parsed.clientId)
    const admin = trustedDb(createAdminClient())
    const { data: clientData, error: clientError } = await admin
      .from('clients')
      .select('id, payment_terms_type, payment_due_days, prepayment_percent, final_payment_due_days, estimated_delivery_days, scheduled_payment_weekdays, scheduled_payment_month_days, scheduled_payment_amount_mode, scheduled_payment_minimum_amount')
      .eq('id', parsed.clientId)
      .single()
    if (clientError || !clientData) throw new Error('Компания не найдена')
    const client = clientData as {
      payment_terms_type: Database['public']['Enums']['payment_terms_type']
      payment_due_days: number
      prepayment_percent: number | null
      final_payment_due_days: number | null
      estimated_delivery_days: number
      scheduled_payment_weekdays: number[]
      scheduled_payment_month_days: number[]
      scheduled_payment_amount_mode: Database['public']['Enums']['scheduled_payment_amount_mode']
      scheduled_payment_minimum_amount: number | null
    }
    const { data: invoiceData, error: invoiceError } = await admin
      .from('invoices')
      .select(`
        id, amount, paid_amount, invoice_date, status,
        payment_terms_type_snapshot, payment_due_days_snapshot,
        prepayment_percent_snapshot, final_payment_due_days_snapshot,
        estimated_delivery_days_snapshot, scheduled_payment_weekdays_snapshot,
        scheduled_payment_month_days_snapshot, scheduled_payment_amount_mode_snapshot,
        scheduled_payment_minimum_amount_snapshot,
        machine:machines!inner(id, client_id, actual_shipping_date, desired_shipping_date, delivery_to_client_date)
      `)
      .in('id', parsed.invoiceIds)
      .eq('machines.client_id', parsed.clientId)
    if (invoiceError) throw invoiceError

    let updatedCount = 0
    for (const invoice of (invoiceData || []) as RecalculationInvoiceRow[]) {
      if (invoice.status === 'cancelled' || Number(invoice.paid_amount || 0) >= Number(invoice.amount || 0)) continue
      const machine = relationOne(invoice.machine)
      if (!machine) continue
      const oldTerms = {
        paymentTermsType: invoice.payment_terms_type_snapshot,
        paymentDueDays: invoice.payment_due_days_snapshot,
        prepaymentPercent: invoice.prepayment_percent_snapshot,
        finalPaymentDueDays: invoice.final_payment_due_days_snapshot,
        estimatedDeliveryDays: invoice.estimated_delivery_days_snapshot,
        scheduledPaymentWeekdays: invoice.scheduled_payment_weekdays_snapshot,
        scheduledPaymentMonthDays: invoice.scheduled_payment_month_days_snapshot,
        scheduledPaymentAmountMode: invoice.scheduled_payment_amount_mode_snapshot,
        scheduledPaymentMinimumAmount: invoice.scheduled_payment_minimum_amount_snapshot,
      }
      const newTerms = {
        paymentTermsType: client.payment_terms_type,
        paymentDueDays: client.payment_due_days,
        prepaymentPercent: client.payment_terms_type === 'prepayment_full' ? client.prepayment_percent ?? 50 : null,
        finalPaymentDueDays: client.payment_terms_type === 'prepayment_full' ? client.final_payment_due_days ?? client.payment_due_days : null,
        estimatedDeliveryDays: client.estimated_delivery_days,
        scheduledPaymentWeekdays: client.scheduled_payment_weekdays,
        scheduledPaymentMonthDays: client.scheduled_payment_month_days,
        scheduledPaymentAmountMode: client.scheduled_payment_amount_mode,
        scheduledPaymentMinimumAmount: client.payment_terms_type === 'scheduled_after_delivery'
          && client.scheduled_payment_amount_mode === 'fixed_amount'
          ? client.scheduled_payment_minimum_amount
          : null,
      }
      const schedule = buildInvoicePaymentSchedule({
        amount: Number(invoice.amount || 0),
        paidAmount: Number(invoice.paid_amount || 0),
        invoiceDate: invoice.invoice_date,
        ...newTerms,
        deliveryToClientDate: machine.delivery_to_client_date,
        actualShippingDate: machine.actual_shipping_date,
        desiredShippingDate: machine.desired_shipping_date,
      })
      const nextPart = nextPaymentSchedulePart(schedule)
      const exactDueDate = nextPart && !nextPart.isForecast ? nextPart.dueDate : null
      const { error: updateError } = await admin
        .from('invoices')
        .update({
          payment_terms_type_snapshot: newTerms.paymentTermsType,
          payment_due_days_snapshot: newTerms.paymentDueDays,
          prepayment_percent_snapshot: newTerms.prepaymentPercent,
          final_payment_due_days_snapshot: newTerms.finalPaymentDueDays,
          estimated_delivery_days_snapshot: newTerms.estimatedDeliveryDays,
          scheduled_payment_weekdays_snapshot: newTerms.scheduledPaymentWeekdays,
          scheduled_payment_month_days_snapshot: newTerms.scheduledPaymentMonthDays,
          scheduled_payment_amount_mode_snapshot: newTerms.scheduledPaymentAmountMode,
          scheduled_payment_minimum_amount_snapshot: newTerms.scheduledPaymentMinimumAmount,
          payment_date: exactDueDate,
          due_date: exactDueDate,
          original_planned_date: exactDueDate,
          updated_at: new Date().toISOString(),
          updated_by: context.userId,
        })
        .eq('id', invoice.id)
        .neq('status', 'cancelled')
      if (updateError) throw updateError
      const { error: auditError } = await admin.from('invoice_terms_audit').insert({
        invoice_id: invoice.id,
        client_id: parsed.clientId,
        old_terms: oldTerms,
        new_terms: newTerms,
        changed_by: context.userId,
      })
      if (auditError) throw auditError
      updatedCount += 1
    }
    revalidateInvoiceViews(undefined, parsed.clientId)
    return { success: true, updatedCount, error: null }
  } catch (error) {
    return { success: false, updatedCount: 0, error: getErrorMessage(error) }
  }
}

/** @deprecated Payment status is calculated from the ledger. */
export async function updateInvoiceStatus() {
  return { success: false, error: 'Статус инвойса рассчитывается автоматически по оплатам' }
}

/** @deprecated Issued invoices are cancelled instead of deleted. */
export async function deleteMachineInvoice() {
  return { success: false, error: 'Выставленный инвойс нельзя удалить. Используйте аннулирование.' }
}
