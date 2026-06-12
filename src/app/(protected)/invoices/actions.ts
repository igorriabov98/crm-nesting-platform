"use server"

import { getCurrentUserContext } from '@/lib/auth/current-user'
import { INVOICES_LIST_LIMIT } from '@/lib/constants/performance-limits'
import { requirePermission } from '@/lib/permissions/server'
import { differenceInDays } from 'date-fns'

type InvoiceStatus = 'paid' | 'not_paid'
type InvoiceDisplayStatus = InvoiceStatus | 'overdue'

type InvoiceRow = {
  id: string
  machine_id: string
  amount: number | null
  payment_date: string | null
  due_date: string | null
  paid_amount: number | null
  balance_due_date: string | null
  status: InvoiceStatus
  created_at: string | null
  machine: {
    id: string
    name: string | null
    factory_id: string | null
    delivery_to_client_date: string | null
  } | null
  updated_by_user?: { full_name?: string | null } | null
}

export async function getInvoices(factoryFilter?: string | null) {
  await requirePermission('invoices', 'view')
  const { supabase, role, factoryId: userFactoryId } = await getCurrentUserContext()

  let query = supabase
    .from('invoices')
    .select(`
      id,
      machine_id,
      amount,
      payment_date,
      due_date,
      paid_amount,
      balance_due_date,
      status,
      created_at,
      machine:machines!inner(id, name, factory_id, delivery_to_client_date),
      updated_by_user:users!invoices_updated_by_fkey(full_name)
    `)

  if (role === 'production_manager') {
    query = userFactoryId
      ? query.eq('machines.factory_id', userFactoryId)
      : query.is('machines.factory_id', null)
  } else if (factoryFilter === 'no_factory') {
    query = query.is('machines.factory_id', null)
  } else if (factoryFilter && factoryFilter !== 'all') {
    query = query.eq('machines.factory_id', factoryFilter)
  }

  const { data: invoices, error } = await query
    .order('created_at', { ascending: false })
    .limit(INVOICES_LIST_LIMIT)

  if (error) throw new Error(error.message)

  const filtered = ((invoices || []) as unknown as InvoiceRow[]).filter(i => i.machine != null)
  
  let total_invoices = 0
  let total_amount = 0
  let paid_amount = 0
  let unpaid_amount = 0
  let overdue_amount = 0
  let overdue_count = 0

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const processed = filtered.map(inv => {
    let days_until_payment = 0
    let is_overdue = false

    const effectiveDueDate = inv.due_date || inv.payment_date
    if (effectiveDueDate) {
      const pd = new Date(effectiveDueDate)
      days_until_payment = differenceInDays(pd, today)
      is_overdue = days_until_payment < 0 && inv.status !== 'paid'
    }

    // Auto-correct status property for view if it's overdue
    const displayStatus: InvoiceDisplayStatus = is_overdue ? 'overdue' : inv.status

    total_invoices++
    total_amount += inv.amount || 0

    if (inv.status === 'paid') {
      paid_amount += inv.amount || 0
    } else {
      unpaid_amount += Number(inv.amount || 0) - Number(inv.paid_amount || 0)
      if (is_overdue) {
        overdue_amount += Number(inv.amount || 0) - Number(inv.paid_amount || 0)
        overdue_count++
      }
    }

    return {
      ...inv,
      days_until_payment,
      is_overdue,
      displayStatus
    }
  })

  return {
    invoices: processed,
    summary: {
      total_invoices,
      total_amount,
      paid_amount,
      unpaid_amount,
      overdue_amount,
      overdue_count
    }
  }
}
