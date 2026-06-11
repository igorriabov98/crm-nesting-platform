'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PermissionOperation } from '@/lib/permissions/resources'
import type { Client, Contract } from '@/lib/types'
import type { Database } from '@/lib/types/database'

type ContractInsert = Database['public']['Tables']['contracts']['Insert']
type ContractUpdate = Database['public']['Tables']['contracts']['Update']
type DbError = { message?: string; details?: string; hint?: string }
type DbResult = { data: unknown; error: DbError | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  delete: () => LooseQuery
  single: () => Promise<DbResult>
}
type LooseDb = { from: (table: string) => LooseQuery }

export type ContractInput = {
  client_id: string
  number: string
  date: string
  notes?: string | null
}

export type ContractWithClient = Contract & {
  client?: Pick<Client, 'id' | 'name'> | null
}

const contractSchema = z.object({
  client_id: z.string().uuid('Выберите клиента'),
  number: z.string().trim().min(1, 'Введите номер контракта'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Выберите дату контракта'),
  notes: z.string().optional().nullable(),
})

const nextSpecificationSchema = z.object({
  client_id: z.string().uuid().optional().nullable(),
  contract_id: z.string().uuid().optional().nullable(),
})

function looseDb(supabase: unknown): LooseDb {
  return supabase as LooseDb
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

async function requireContractAccess(operation: PermissionOperation = 'view') {
  await requirePermission('contracts', operation)
  return { db: looseDb(createAdminClient()) }
}

function contractPayload(input: ContractInput): ContractInsert {
  const parsed = contractSchema.parse(input)
  return {
    client_id: parsed.client_id,
    number: parsed.number,
    date: parsed.date,
    notes: parsed.notes?.trim() || null,
  }
}

function revalidateContractSurfaces(clientIds: Array<string | null | undefined> = []) {
  revalidatePath(ROUTES.CONTRACTS)
  revalidatePath(ROUTES.SALES_PLAN)
  revalidatePath(ROUTES.SALES_PLAN_NEW)

  Array.from(new Set(clientIds.filter((clientId): clientId is string => Boolean(clientId)))).forEach((clientId) => {
    revalidatePath(`${ROUTES.CLIENTS}/${clientId}`)
  })
}

export async function getContracts() {
  try {
    const { db } = await requireContractAccess('view')
    const { data, error } = await db
      .from('contracts')
      .select('*, client:clients(id, name)')
      .order('date', { ascending: false })

    if (error) throw error
    return { data: (data || []) as ContractWithClient[], error: null }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getContractsByClient(clientId: string) {
  try {
    const { db } = await requireContractAccess('view')
    const parsedClientId = z.string().uuid('Выберите клиента').parse(clientId)
    const { data, error } = await db
      .from('contracts')
      .select('*')
      .eq('client_id', parsedClientId)
      .order('date', { ascending: false })

    if (error) throw error
    return { data: (data || []) as Contract[], error: null }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function createContract(input: ContractInput) {
  try {
    const { db } = await requireContractAccess('manage')
    const payload = contractPayload(input)
    const { data, error } = await db
      .from('contracts')
      .insert(payload)
      .select('*')
      .single()

    if (error || !data) throw error || new Error('Не удалось создать контракт')
    const contract = data as Contract
    revalidateContractSurfaces([contract.client_id])
    return { success: true, data: contract, error: null }
  } catch (error) {
    return { success: false, data: null, error: getErrorMessage(error) }
  }
}

export async function updateContract(id: string, input: ContractInput) {
  try {
    const { db } = await requireContractAccess('manage')
    const parsedId = z.string().uuid('Контракт не найден').parse(id)
    const { data: existing, error: existingError } = await db
      .from('contracts')
      .select('client_id')
      .eq('id', parsedId)
      .single()

    if (existingError) throw existingError

    const payload: ContractUpdate = {
      ...contractPayload(input),
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await db
      .from('contracts')
      .update(payload)
      .eq('id', parsedId)
      .select('*')
      .single()

    if (error || !data) throw error || new Error('Не удалось обновить контракт')
    const contract = data as Contract
    revalidateContractSurfaces([
      (existing as { client_id?: string } | null)?.client_id,
      contract.client_id,
    ])
    return { success: true, data: contract, error: null }
  } catch (error) {
    return { success: false, data: null, error: getErrorMessage(error) }
  }
}

export async function deleteContract(id: string) {
  try {
    const { db } = await requireContractAccess('manage')
    const parsedId = z.string().uuid('Контракт не найден').parse(id)
    const { data: contract, error: contractError } = await db
      .from('contracts')
      .select('client_id')
      .eq('id', parsedId)
      .single()

    if (contractError || !contract) throw contractError || new Error('Контракт не найден')

    const { data: machines, error: machinesError } = await db
      .from('machines')
      .select('id')
      .eq('contract_id', parsedId)
      .limit(1)

    if (machinesError) throw machinesError
    if (((machines || []) as Array<{ id: string }>).length > 0) {
      throw new Error('Нельзя удалить контракт: он связан с заказами')
    }

    const { error } = await db.from('contracts').delete().eq('id', parsedId)
    if (error) throw error

    revalidateContractSurfaces([(contract as { client_id: string }).client_id])
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function getNextSpecificationNumber(input: { client_id?: string | null; contract_id?: string | null } = {}) {
  try {
    const { db } = await requireContractAccess('view')
    const parsed = nextSpecificationSchema.parse(input)
    let query = db.from('machines').select('specification_number')

    if (parsed.contract_id) {
      query = query.eq('contract_id', parsed.contract_id)
    } else if (parsed.client_id) {
      query = query.eq('client_id', parsed.client_id)
    }

    const { data, error } = await query
    if (error) throw error

    const maxNumber = ((data || []) as Array<{ specification_number: string | null }>).reduce((max, row) => {
      const value = (row.specification_number || '').trim()
      if (!/^\d+$/.test(value)) return max
      return Math.max(max, Number.parseInt(value, 10))
    }, 0)

    return { data: String(maxNumber + 1), error: null }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}
