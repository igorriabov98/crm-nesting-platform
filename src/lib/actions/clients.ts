"use server"

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { CLIENTS_LIST_LIMIT } from '@/lib/constants/performance-limits'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import type { PermissionOperation } from '@/lib/permissions/resources'
import { clientContactSchema, clientSchema, type ClientContactInput, type ClientInput } from '@/lib/types/schemas'
import type { Client, ClientContact, CurrentUser, MachineDetails } from '@/lib/types'
import type { Database } from '@/lib/types/database'

type ClientInsert = Database['public']['Tables']['clients']['Insert']
type ClientUpdate = Database['public']['Tables']['clients']['Update']
type ClientContactInsert = Database['public']['Tables']['client_contacts']['Insert']
type ClientContactUpdate = Database['public']['Tables']['client_contacts']['Update']
type DbError = { message?: string; details?: string; hint?: string }
type LooseDbResult = { data: unknown; error: DbError | null }
type LooseQuery = PromiseLike<LooseDbResult> & {
  select: (columns?: string) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  delete: () => LooseQuery
  single: () => Promise<LooseDbResult>
}
type LooseDb = {
  from: (table: string) => LooseQuery
}

type NumericLike = number | string | null

type ClientPaymentTermsRow = {
  payment_terms_type: string
  payment_due_days: number | null
  prepayment_percent: number | null
  final_payment_due_days: number | null
}

type ClientListSummaryRow = {
  id: string
  name: string
  primary_contact_name: string | null
  phone: string | null
  email: string | null
  country_city: string | null
  payment_terms_type: string
  payment_due_days: NumericLike
  prepayment_percent: NumericLike
  final_payment_due_days: NumericLike
  active_machines_count: NumericLike
  current_invoice_amount: NumericLike
  overdue_invoice_amount: NumericLike
  last_activity: string | null
}

function looseDb(supabase: unknown): LooseDb {
  return supabase as LooseDb
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

async function requireClientPermission(operation: PermissionOperation) {
  const context = await requirePermission('clients', operation)
  return { supabase: context.supabase, user: context.user }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = 'message' in error ? error.message : null
    const details = 'details' in error ? error.details : null
    const hint = 'hint' in error ? error.hint : null

    return [message, details, hint]
      .filter((item): item is string => typeof item === 'string' && item.length > 0)
      .join(' ') || 'Неизвестная ошибка'
  }
  return 'Неизвестная ошибка'
}

function assertCanManageClients(user: CurrentUser) {
  void user
}

export async function getClientOptions() {
  try {
    const { supabase } = await requireClientPermission('view')

    const { data, error } = await looseDb(supabase).from('clients')
      .select('id, name, primary_contact_name, phone, email, country_city, address, delivery_address, payment_terms_type, payment_due_days, prepayment_percent, final_payment_due_days')
      .order('name', { ascending: true })

    if (error) throw error
    return { data: (data || []) as unknown as Client[], error: null }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getClients() {
  try {
    const { supabase } = await requireClientPermission('view')
    const { data: clients, error } = await looseDb(supabase).from('client_list_summary')
      .select('id, name, primary_contact_name, phone, email, country_city, payment_terms_type, payment_due_days, prepayment_percent, final_payment_due_days, active_machines_count, current_invoice_amount, overdue_invoice_amount, last_activity')
      .order('updated_at', { ascending: false })
      .limit(CLIENTS_LIST_LIMIT)

    if (error) throw error

    const rows = ((clients || []) as ClientListSummaryRow[]).map((client) => ({
      id: client.id,
      name: client.name,
      primary_contact_name: client.primary_contact_name,
      phone: client.phone,
      email: client.email,
      country_city: client.country_city,
      payment_terms_type: client.payment_terms_type,
      payment_due_days: Number(client.payment_due_days || 0),
      prepayment_percent: client.prepayment_percent === null ? null : Number(client.prepayment_percent),
      final_payment_due_days: client.final_payment_due_days === null ? null : Number(client.final_payment_due_days),
      active_machines_count: Number(client.active_machines_count || 0),
      current_invoice_amount: Number(client.current_invoice_amount || 0),
      overdue_invoice_amount: Number(client.overdue_invoice_amount || 0),
      last_activity: client.last_activity,
    }))

    return { data: rows, error: null }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getClient(id: string) {
  try {
    const { supabase } = await requireClientPermission('view')
    const { data, error } = await looseDb(supabase).from('clients')
      .select(`
        *,
        client_contacts(*),
        machines(
          *,
          machine_items(id, drawing_number, product_name, price, quantity, weight, coating, is_sample),
          invoice:invoices(*)
        )
      `)
      .eq('id', id)
      .single()

    if (error) throw error
    const client = data as unknown as Client & {
      client_contacts: ClientContact[]
      machines: MachineDetails[]
    }
    return { data: client, error: null }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function createClient(input: ClientInput) {
  try {
    const { supabase, user } = await requireClientPermission('manage')
    assertCanManageClients(user)

    const parsed = clientSchema.parse(input)
    const payload: ClientInsert = {
      ...parsed,
      primary_contact_name: parsed.primary_contact_name || null,
      phone: parsed.phone || null,
      email: parsed.email || null,
      country_city: parsed.country_city || null,
      address: parsed.address || null,
      delivery_address: parsed.delivery_address || null,
      director_name: parsed.director_name || null,
      second_director_name: parsed.second_director_name || null,
      second_director_name_en: parsed.second_director_name_en || null,
      second_director_name_ua: parsed.second_director_name_ua || null,
      vat_number: parsed.vat_number || null,
      notes: parsed.notes || null,
      prepayment_percent: parsed.payment_terms_type === 'prepayment_full' ? parsed.prepayment_percent ?? 50 : null,
      final_payment_due_days: parsed.payment_terms_type === 'prepayment_full' ? parsed.final_payment_due_days ?? parsed.payment_due_days : null,
    }

    const { data, error } = await looseDb(supabase).from('clients')
      .insert(payload)
      .select('*')
      .single()

    if (error) throw error

    revalidatePath(ROUTES.CLIENTS)
    revalidatePath(ROUTES.SALES_PLAN_NEW)
    return { success: true, client: data as unknown as Client, error: null }
  } catch (error) {
    return { success: false, client: null, error: getErrorMessage(error) }
  }
}

export async function updateClient(id: string, input: ClientInput) {
  try {
    const { supabase, user } = await requireClientPermission('manage')
    assertCanManageClients(user)

    const parsed = clientSchema.parse(input)
    const payload: ClientUpdate = {
      ...parsed,
      primary_contact_name: parsed.primary_contact_name || null,
      phone: parsed.phone || null,
      email: parsed.email || null,
      country_city: parsed.country_city || null,
      address: parsed.address || null,
      delivery_address: parsed.delivery_address || null,
      director_name: parsed.director_name || null,
      second_director_name: parsed.second_director_name || null,
      second_director_name_en: parsed.second_director_name_en || null,
      second_director_name_ua: parsed.second_director_name_ua || null,
      vat_number: parsed.vat_number || null,
      notes: parsed.notes || null,
      prepayment_percent: parsed.payment_terms_type === 'prepayment_full' ? parsed.prepayment_percent ?? 50 : null,
      final_payment_due_days: parsed.payment_terms_type === 'prepayment_full' ? parsed.final_payment_due_days ?? parsed.payment_due_days : null,
      updated_at: new Date().toISOString(),
    }

    const { error } = await looseDb(supabase).from('clients').update(payload).eq('id', id)
    if (error) throw error

    revalidatePath(ROUTES.CLIENTS)
    revalidatePath(`${ROUTES.CLIENTS}/${id}`)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function createClientContact(clientId: string, input: ClientContactInput) {
  try {
    const { supabase, user } = await requireClientPermission('manage')
    assertCanManageClients(user)

    const parsed = clientContactSchema.parse(input)
    const payload: ClientContactInsert = {
      client_id: clientId,
      full_name: parsed.full_name,
      phone: parsed.phone || null,
      email: parsed.email || null,
      role_description: parsed.role_description || null,
      notes: parsed.notes || null,
      is_primary: false,
    }

    const { data, error } = await looseDb(supabase).from('client_contacts')
      .insert(payload)
      .select('*')
      .single()
    if (error) throw error

    revalidatePath(`${ROUTES.CLIENTS}/${clientId}`)
    return { success: true, contact: data as unknown as ClientContact, error: null }
  } catch (error) {
    return { success: false, contact: null, error: getErrorMessage(error) }
  }
}

export async function updateClientContact(clientId: string, contactId: string, input: ClientContactInput) {
  try {
    const { supabase, user } = await requireClientPermission('manage')
    assertCanManageClients(user)

    const parsed = clientContactSchema.parse(input)
    const payload: ClientContactUpdate = {
      full_name: parsed.full_name,
      phone: parsed.phone || null,
      email: parsed.email || null,
      role_description: parsed.role_description || null,
      notes: parsed.notes || null,
    }

    const { data, error } = await looseDb(supabase).from('client_contacts')
      .update(payload)
      .eq('id', contactId)
      .eq('client_id', clientId)
      .select('*')
      .single()
    if (error) throw error

    revalidatePath(`${ROUTES.CLIENTS}/${clientId}`)
    return { success: true, contact: data as unknown as ClientContact, error: null }
  } catch (error) {
    return { success: false, contact: null, error: getErrorMessage(error) }
  }
}

export async function deleteClientContact(clientId: string, contactId: string) {
  try {
    const { supabase, user } = await requireClientPermission('manage')
    assertCanManageClients(user)

    const { error } = await looseDb(supabase).from('client_contacts')
      .delete()
      .eq('id', contactId)
      .eq('client_id', clientId)
    if (error) throw error

    revalidatePath(`${ROUTES.CLIENTS}/${clientId}`)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function applyClientPaymentTermsToMachines(clientId: string, machineIds: string[]) {
  try {
    const { supabase, user } = await requireClientPermission('manage')
    assertCanManageClients(user)

    const ids = Array.from(new Set(machineIds.filter(Boolean)))
    if (!ids.length) return { success: true, updated_count: 0, error: null }

    const { data: client, error: clientError } = await looseDb(supabase).from('clients')
      .select('payment_terms_type, payment_due_days, prepayment_percent, final_payment_due_days')
      .eq('id', clientId)
      .single()
    if (clientError || !client) throw clientError || new Error('Клиент не найден')
    const paymentTerms = client as ClientPaymentTermsRow

    const { data, error } = await looseDb(supabase).from('machines')
      .update({
        payment_terms_type: paymentTerms.payment_terms_type,
        payment_due_days: paymentTerms.payment_due_days,
        prepayment_percent: paymentTerms.payment_terms_type === 'prepayment_full' ? paymentTerms.prepayment_percent ?? 50 : null,
        final_payment_due_days: paymentTerms.payment_terms_type === 'prepayment_full' ? paymentTerms.final_payment_due_days ?? paymentTerms.payment_due_days : null,
        updated_at: new Date().toISOString(),
      })
      .eq('client_id', clientId)
      .in('id', ids)
      .select('id')
    if (error) throw error

    revalidatePath(ROUTES.CLIENTS)
    revalidatePath(`${ROUTES.CLIENTS}/${clientId}`)
    revalidatePath(ROUTES.SALES_PLAN)
    return { success: true, updated_count: ((data || []) as Array<{ id: string }>).length, error: null }
  } catch (error) {
    return { success: false, updated_count: 0, error: getErrorMessage(error) }
  }
}
