import type { CompanyAccessScope } from '@/lib/permissions/resources'
import type { InvoicePaymentSchedule } from '@/lib/invoices/payment-schedule'

export type PaymentDisplayStatus = 'not_paid' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled'

export type ResponsibleManagerOption = {
  id: string
  name: string
}

export type InvoicePaymentEntry = {
  id: string
  invoiceId: string
  amount: number
  paidOn: string | null
  note: string | null
  source: 'crm' | 'legacy'
  createdAt: string
  createdByName: string | null
  isVoided: boolean
  voidedAt: string | null
  voidedByName: string | null
  voidReason: string | null
  replacementPaymentId: string | null
}

export type ClientPaymentsInvoice = {
  id: string
  machineId: string
  machineName: string
  invoiceNumber: string
  revision: number
  amount: number
  paidAmount: number
  remainingAmount: number
  invoiceDate: string
  status: PaymentDisplayStatus
  isCancelled: boolean
  cancelledAt: string | null
  cancellationReason: string | null
  lastPaidOn: string | null
  schedule: InvoicePaymentSchedule[]
  payments: InvoicePaymentEntry[]
}

export type InvoiceRegistryRow = ClientPaymentsInvoice & {
  clientId: string
  clientName: string
  responsibleName: string | null
  canManagePayments: boolean
}

export type InvoiceRegistryData = {
  invoices: InvoiceRegistryRow[]
  summary: ClientPaymentsSummary
}

export type ClientPaymentsSummary = {
  issuedAmount: number
  paidAmount: number
  debtAmount: number
  overdueDebtAmount: number
  invoiceCount: number
  overdueInvoiceCount: number
  nearestPaymentDate: string | null
  nearestPaymentIsForecast: boolean
}

export type PaymentCompanyRow = ClientPaymentsSummary & {
  id: string
  name: string
  responsibleUserId: string | null
  responsibleName: string | null
}

export type PaymentCompaniesData = {
  companies: PaymentCompanyRow[]
  summary: ClientPaymentsSummary
  managers: ResponsibleManagerOption[]
  viewScope: CompanyAccessScope
  manageScope: CompanyAccessScope
}

export type ClientPaymentDetails = {
  client: {
    id: string
    name: string
    responsibleUserId: string | null
    responsibleName: string | null
    paymentTermsType: string
    paymentDueDays: number
    prepaymentPercent: number | null
    finalPaymentDueDays: number | null
    estimatedDeliveryDays: number
  }
  invoices: ClientPaymentsInvoice[]
  summary: ClientPaymentsSummary
  canManagePayments: boolean
}
