"use server"

import { getInvoiceRegistry } from '@/lib/actions/client-payments'

export async function getInvoices() {
  return getInvoiceRegistry()
}
