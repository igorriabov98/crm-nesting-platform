"use server"

import 'server-only'

import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { trustedDb } from '@/lib/supabase/trusted-db'
import { requireCompanyRecordAccess, requireCompanyScope, type CompanyScopedResource } from '@/lib/permissions/company-scope'
import { hasPermission } from '@/lib/permissions/resources'
import {
  buildInvoicePaymentSchedule,
  invoiceDisplayStatus,
  nextPaymentSchedulePart,
} from '@/lib/invoices/payment-schedule'
import type {
  ClientPaymentDetails,
  ClientPaymentsInvoice,
  ClientPaymentsSummary,
  InvoicePaymentEntry,
  InvoiceRegistryData,
  InvoiceRegistryRow,
  PaymentCompaniesData,
  PaymentCompanyRow,
} from '@/lib/payments/types'

type ClientRow = {
  id: string
  name: string
  responsible_user_id: string | null
  payment_terms_type: string
  payment_due_days: number
  prepayment_percent: number | null
  final_payment_due_days: number | null
  estimated_delivery_days: number
}

type MachineRow = {
  id: string
  name: string
  client_id: string | null
  actual_shipping_date: string | null
  desired_shipping_date: string | null
  delivery_to_client_date: string | null
}

type InvoiceRow = {
  id: string
  machine_id: string
  invoice_number: string
  invoice_revision: number
  amount: number | null
  paid_amount: number | null
  invoice_date: string
  status: string
  actual_paid_date: string | null
  payment_terms_type_snapshot: string | null
  payment_due_days_snapshot: number | null
  prepayment_percent_snapshot: number | null
  final_payment_due_days_snapshot: number | null
  estimated_delivery_days_snapshot: number | null
  cancelled_at: string | null
  cancellation_reason: string | null
}

type PaymentRow = {
  id: string
  invoice_id: string
  amount: number
  paid_on: string | null
  note: string | null
  source: 'crm' | 'legacy'
  created_by: string | null
  created_at: string
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
  replacement_payment_id: string | null
}

type UserRow = { id: string; full_name: string | null }

const emptySummary = (): ClientPaymentsSummary => ({
  issuedAmount: 0,
  paidAmount: 0,
  debtAmount: 0,
  overdueDebtAmount: 0,
  invoiceCount: 0,
  overdueInvoiceCount: 0,
  nearestPaymentDate: null,
  nearestPaymentIsForecast: false,
})

function addInvoiceToSummary(summary: ClientPaymentsSummary, invoice: ClientPaymentsInvoice) {
  if (invoice.isCancelled) return
  summary.invoiceCount += 1
  summary.issuedAmount += invoice.amount
  summary.paidAmount += invoice.paidAmount
  summary.debtAmount += invoice.remainingAmount
  if (invoice.status === 'overdue') {
    summary.overdueInvoiceCount += 1
    summary.overdueDebtAmount += invoice.schedule
      .filter((part) => part.isOverdue)
      .reduce((total, part) => total + part.remainingAmount, 0)
  }
  const nextPart = nextPaymentSchedulePart(invoice.schedule)
  if (nextPart?.dueDate && (!summary.nearestPaymentDate || nextPart.dueDate < summary.nearestPaymentDate)) {
    summary.nearestPaymentDate = nextPart.dueDate
    summary.nearestPaymentIsForecast = nextPart.isForecast
  }
}

function finishSummary(summary: ClientPaymentsSummary) {
  for (const key of ['issuedAmount', 'paidAmount', 'debtAmount', 'overdueDebtAmount'] as const) {
    summary[key] = Math.round((summary[key] + Number.EPSILON) * 100) / 100
  }
  return summary
}

function mapInvoices(
  invoices: InvoiceRow[],
  machinesById: Map<string, MachineRow>,
  paymentsByInvoice: Map<string, InvoicePaymentEntry[]>,
): ClientPaymentsInvoice[] {
  return invoices.map((invoice) => {
    const machine = machinesById.get(invoice.machine_id)
    const amount = Number(invoice.amount || 0)
    const paidAmount = Number(invoice.paid_amount || 0)
    const isCancelled = invoice.status === 'cancelled' || Boolean(invoice.cancelled_at)
    const schedule = buildInvoicePaymentSchedule({
      amount,
      paidAmount,
      invoiceDate: invoice.invoice_date,
      paymentTermsType: invoice.payment_terms_type_snapshot,
      paymentDueDays: invoice.payment_due_days_snapshot,
      prepaymentPercent: invoice.prepayment_percent_snapshot,
      finalPaymentDueDays: invoice.final_payment_due_days_snapshot,
      estimatedDeliveryDays: invoice.estimated_delivery_days_snapshot,
      deliveryToClientDate: machine?.delivery_to_client_date,
      actualShippingDate: machine?.actual_shipping_date,
      desiredShippingDate: machine?.desired_shipping_date,
    })
    return {
      id: invoice.id,
      machineId: invoice.machine_id,
      machineName: machine?.name || 'Машина не найдена',
      invoiceNumber: invoice.invoice_number,
      revision: Number(invoice.invoice_revision || 0),
      amount,
      paidAmount,
      remainingAmount: Math.max(0, amount - paidAmount),
      invoiceDate: invoice.invoice_date,
      status: invoiceDisplayStatus({ amount, paidAmount, cancelled: isCancelled, schedule }),
      isCancelled,
      cancelledAt: invoice.cancelled_at,
      cancellationReason: invoice.cancellation_reason,
      lastPaidOn: invoice.actual_paid_date,
      schedule,
      payments: paymentsByInvoice.get(invoice.id) || [],
    }
  }).sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.revision - a.revision)
}

function paymentEntries(rows: PaymentRow[], usersById: Map<string, string>): Map<string, InvoicePaymentEntry[]> {
  const result = new Map<string, InvoicePaymentEntry[]>()
  for (const row of rows) {
    const entry: InvoicePaymentEntry = {
      id: row.id,
      invoiceId: row.invoice_id,
      amount: Number(row.amount),
      paidOn: row.paid_on,
      note: row.note,
      source: row.source,
      createdAt: row.created_at,
      createdByName: row.created_by ? usersById.get(row.created_by) || null : null,
      isVoided: Boolean(row.voided_at),
      voidedAt: row.voided_at,
      voidedByName: row.voided_by ? usersById.get(row.voided_by) || null : null,
      voidReason: row.void_reason,
      replacementPaymentId: row.replacement_payment_id,
    }
    const list = result.get(row.invoice_id) || []
    list.push(entry)
    result.set(row.invoice_id, list)
  }
  return result
}

async function loadBase(resourceKey: CompanyScopedResource) {
  const context = await requireCompanyScope(resourceKey, 'view')
  const db = trustedDb(createAdminClient())
  let clientQuery = db
    .from('clients')
    .select('id, name, responsible_user_id, payment_terms_type, payment_due_days, prepayment_percent, final_payment_due_days, estimated_delivery_days')
    .order('name')
  if (context.companyScope === 'own') clientQuery = clientQuery.eq('responsible_user_id', context.userId)
  const { data: clientData, error: clientError } = await clientQuery
  if (clientError) throw new Error(clientError.message)
  const clients = (clientData || []) as ClientRow[]
  const clientIds = clients.map((client) => client.id)
  if (clientIds.length === 0) return { context, db, clients, machines: [] as MachineRow[], invoices: [] as InvoiceRow[] }

  const { data: machineData, error: machineError } = await db
    .from('machines')
    .select('id, name, client_id, actual_shipping_date, desired_shipping_date, delivery_to_client_date')
    .in('client_id', clientIds)
  if (machineError) throw new Error(machineError.message)
  const machines = (machineData || []) as MachineRow[]
  const machineIds = machines.map((machine) => machine.id)
  if (machineIds.length === 0) return { context, db, clients, machines, invoices: [] as InvoiceRow[] }

  const { data: invoiceData, error: invoiceError } = await db
    .from('invoices')
    .select('id, machine_id, invoice_number, invoice_revision, amount, paid_amount, invoice_date, status, actual_paid_date, payment_terms_type_snapshot, payment_due_days_snapshot, prepayment_percent_snapshot, final_payment_due_days_snapshot, estimated_delivery_days_snapshot, cancelled_at, cancellation_reason')
    .in('machine_id', machineIds)
  if (invoiceError) throw new Error(invoiceError.message)
  return { context, db, clients, machines, invoices: (invoiceData || []) as InvoiceRow[] }
}

export const getPaymentCompanies = cache(async (): Promise<PaymentCompaniesData> => {
  const { context, db, clients, machines, invoices } = await loadBase('client_payments')
  const userIds = Array.from(new Set(clients.map((client) => client.responsible_user_id).filter(Boolean))) as string[]
  const { data: userData } = userIds.length
    ? await db.from('users').select('id, full_name').in('id', userIds)
    : { data: [] }
  const users = (userData || []) as UserRow[]
  const usersById = new Map(users.map((user) => [user.id, user.full_name || 'Без имени']))
  const machinesByClient = new Map<string, MachineRow[]>()
  for (const machine of machines) {
    if (!machine.client_id) continue
    const list = machinesByClient.get(machine.client_id) || []
    list.push(machine)
    machinesByClient.set(machine.client_id, list)
  }
  const invoicesByMachine = new Map<string, InvoiceRow[]>()
  for (const invoice of invoices) {
    const list = invoicesByMachine.get(invoice.machine_id) || []
    list.push(invoice)
    invoicesByMachine.set(invoice.machine_id, list)
  }

  const companies: PaymentCompanyRow[] = clients.map((client) => {
    const clientMachines = machinesByClient.get(client.id) || []
    const machinesById = new Map(clientMachines.map((machine) => [machine.id, machine]))
    const clientInvoices = clientMachines.flatMap((machine) => invoicesByMachine.get(machine.id) || [])
    const mappedInvoices = mapInvoices(clientInvoices, machinesById, new Map())
    const summary = emptySummary()
    for (const invoice of mappedInvoices) addInvoiceToSummary(summary, invoice)
    return {
      id: client.id,
      name: client.name,
      responsibleUserId: client.responsible_user_id,
      responsibleName: client.responsible_user_id ? usersById.get(client.responsible_user_id) || null : null,
      ...finishSummary(summary),
    }
  })

  const summary = emptySummary()
  for (const company of companies) {
    summary.issuedAmount += company.issuedAmount
    summary.paidAmount += company.paidAmount
    summary.debtAmount += company.debtAmount
    summary.overdueDebtAmount += company.overdueDebtAmount
    summary.invoiceCount += company.invoiceCount
    summary.overdueInvoiceCount += company.overdueInvoiceCount
    if (company.nearestPaymentDate && (!summary.nearestPaymentDate || company.nearestPaymentDate < summary.nearestPaymentDate)) {
      summary.nearestPaymentDate = company.nearestPaymentDate
      summary.nearestPaymentIsForecast = company.nearestPaymentIsForecast
    }
  }
  return {
    companies,
    summary: finishSummary(summary),
    managers: users.map((user) => ({ id: user.id, name: user.full_name || 'Без имени' })).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    viewScope: context.companyScope,
    manageScope: context.permissionDetails.companyScopes.client_payments?.manage || 'own',
  }
})

export const getInvoiceRegistry = cache(async (): Promise<InvoiceRegistryData> => {
  const { context, db, clients, machines, invoices } = await loadBase('invoices')
  const invoiceIds = invoices.map((invoice) => invoice.id)
  const { data: paymentsData, error: paymentsError } = invoiceIds.length
    ? await db
        .from('invoice_payments')
        .select('id, invoice_id, amount, paid_on, note, source, created_by, created_at, voided_at, voided_by, void_reason, replacement_payment_id')
        .in('invoice_id', invoiceIds)
        .order('created_at', { ascending: false })
    : { data: [], error: null }
  if (paymentsError) throw new Error(paymentsError.message)
  const payments = (paymentsData || []) as PaymentRow[]
  const userIds = Array.from(new Set([
    ...clients.map((client) => client.responsible_user_id),
    ...payments.flatMap((payment) => [payment.created_by, payment.voided_by]),
  ].filter(Boolean))) as string[]
  const { data: usersData } = userIds.length ? await db.from('users').select('id, full_name').in('id', userIds) : { data: [] }
  const usersById = new Map(((usersData || []) as UserRow[]).map((user) => [user.id, user.full_name || 'Без имени']))
  const clientsById = new Map(clients.map((client) => [client.id, client]))
  const machinesById = new Map(machines.map((machine) => [machine.id, machine]))
  const mapped = mapInvoices(invoices, machinesById, paymentEntries(payments, usersById))
  const paymentManageScope = context.permissionDetails.companyScopes.client_payments?.manage || 'own'
  const canManageAnyPayment = hasPermission(context.permissions, 'client_payments', 'manage')
  const registryInvoices: InvoiceRegistryRow[] = mapped.flatMap((invoice) => {
    const machine = machinesById.get(invoice.machineId)
    const client = machine?.client_id ? clientsById.get(machine.client_id) : null
    if (!client) return []
    return [{
      ...invoice,
      clientId: client.id,
      clientName: client.name,
      responsibleName: client.responsible_user_id ? usersById.get(client.responsible_user_id) || null : null,
      canManagePayments: canManageAnyPayment
        && (paymentManageScope === 'all' || client.responsible_user_id === context.userId),
    }]
  })
  const summary = emptySummary()
  for (const invoice of registryInvoices) addInvoiceToSummary(summary, invoice)
  return { invoices: registryInvoices, summary: finishSummary(summary) }
})

export async function getClientPaymentDetails(
  clientId: string,
  resourceKey: CompanyScopedResource = 'client_payments',
): Promise<ClientPaymentDetails> {
  const context = await requireCompanyRecordAccess(resourceKey, 'view', clientId)
  const db = trustedDb(createAdminClient())
  const { data: clientData, error: clientError } = await db
    .from('clients')
    .select('id, name, responsible_user_id, payment_terms_type, payment_due_days, prepayment_percent, final_payment_due_days, estimated_delivery_days')
    .eq('id', clientId)
    .single()
  if (clientError || !clientData) throw new Error('Компания не найдена')
  const client = clientData as ClientRow
  const { data: machineData, error: machineError } = await db
    .from('machines')
    .select('id, name, client_id, actual_shipping_date, desired_shipping_date, delivery_to_client_date')
    .eq('client_id', clientId)
  if (machineError) throw new Error(machineError.message)
  const machines = (machineData || []) as MachineRow[]
  const machineIds = machines.map((machine) => machine.id)
  const { data: invoiceData, error: invoiceError } = machineIds.length
    ? await db
        .from('invoices')
        .select('id, machine_id, invoice_number, invoice_revision, amount, paid_amount, invoice_date, status, actual_paid_date, payment_terms_type_snapshot, payment_due_days_snapshot, prepayment_percent_snapshot, final_payment_due_days_snapshot, estimated_delivery_days_snapshot, cancelled_at, cancellation_reason')
        .in('machine_id', machineIds)
    : { data: [], error: null }
  if (invoiceError) throw new Error(invoiceError.message)
  const invoices = (invoiceData || []) as InvoiceRow[]
  const invoiceIds = invoices.map((invoice) => invoice.id)
  const { data: paymentsData, error: paymentsError } = invoiceIds.length
    ? await db
        .from('invoice_payments')
        .select('id, invoice_id, amount, paid_on, note, source, created_by, created_at, voided_at, voided_by, void_reason, replacement_payment_id')
        .in('invoice_id', invoiceIds)
        .order('created_at', { ascending: false })
    : { data: [], error: null }
  if (paymentsError) throw new Error(paymentsError.message)
  const payments = (paymentsData || []) as PaymentRow[]
  const userIds = Array.from(new Set([
    client.responsible_user_id,
    ...payments.flatMap((payment) => [payment.created_by, payment.voided_by]),
  ].filter(Boolean))) as string[]
  const { data: usersData } = userIds.length ? await db.from('users').select('id, full_name').in('id', userIds) : { data: [] }
  const usersById = new Map(((usersData || []) as UserRow[]).map((user) => [user.id, user.full_name || 'Без имени']))
  const mappedInvoices = mapInvoices(invoices, new Map(machines.map((machine) => [machine.id, machine])), paymentEntries(payments, usersById))
  const summary = emptySummary()
  for (const invoice of mappedInvoices) addInvoiceToSummary(summary, invoice)

  const manageScope = context.permissionDetails.companyScopes[resourceKey]?.manage || 'own'
  const canManagePayments = hasPermission(context.permissions, resourceKey, 'manage')
    && (manageScope === 'all' || client.responsible_user_id === context.userId)
  return {
    client: {
      id: client.id,
      name: client.name,
      responsibleUserId: client.responsible_user_id,
      responsibleName: client.responsible_user_id ? usersById.get(client.responsible_user_id) || null : null,
      paymentTermsType: client.payment_terms_type,
      paymentDueDays: client.payment_due_days,
      prepaymentPercent: client.prepayment_percent,
      finalPaymentDueDays: client.final_payment_due_days,
      estimatedDeliveryDays: client.estimated_delivery_days,
    },
    invoices: mappedInvoices,
    summary: finishSummary(summary),
    canManagePayments,
  }
}
