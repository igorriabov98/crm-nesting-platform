'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import { DELIVERY_DAYS } from '@/lib/constants/procurement'
import {
  validateSupplierRoleConfiguration,
  type SupplierPrimaryRole,
} from '@/lib/suppliers/directory'
import type { MaterialCategory, Supplier } from '@/lib/types'

type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  single: () => Promise<DbResult>
  insert: (values: unknown) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
  delete: () => LooseQuery
}
type LooseDb = { from: (table: string) => LooseQuery }

export type SupplierWithRelations = Supplier & {
  deliveryDays: number[]
  categories: MaterialCategory[]
}

export type SupplierInput = {
  name: string
  contact_person?: string | null
  phone?: string | null
  email?: string | null
  notes?: string | null
  is_active?: boolean
  primary_role: SupplierPrimaryRole | null
  supplies_metal: boolean | null
  supplies_consumables: boolean | null
  delivery_lead_days?: number
  deliveryDays: number[]
  categories: MaterialCategory[]
}

async function requireDirector() {
  const context = await requirePermission('suppliers', 'manage')
  return { db: context.supabase as unknown as LooseDb }
}

async function getDb() {
  const supabase = await createServerSupabaseClient()
  return supabase as unknown as LooseDb
}

async function hydrateSuppliers(db: LooseDb, suppliers: Supplier[]) {
  const ids = suppliers.map((supplier) => supplier.id)
  if (ids.length === 0) return []

  const [daysRes, catsRes] = await Promise.all([
    db.from('supplier_delivery_days').select('supplier_id, day_of_week').in('supplier_id', ids),
    db.from('supplier_material_categories').select('supplier_id, category').in('supplier_id', ids),
  ])
  if (daysRes.error) throw new Error(daysRes.error.message || 'Не удалось загрузить дни отгрузки')
  if (catsRes.error) throw new Error(catsRes.error.message || 'Не удалось загрузить категории')

  const days = (daysRes.data || []) as { supplier_id: string; day_of_week: number }[]
  const categories = (catsRes.data || []) as { supplier_id: string; category: MaterialCategory }[]

  return suppliers.map((supplier) => ({
    ...supplier,
    deliveryDays: days.filter((day) => day.supplier_id === supplier.id).map((day) => day.day_of_week).sort((a, b) => a - b),
    categories: categories.filter((cat) => cat.supplier_id === supplier.id).map((cat) => cat.category),
  }))
}

async function replaceRelations(supplierId: string, deliveryDays: number[], categories: MaterialCategory[]) {
  const db = createAdminClient() as unknown as LooseDb
  const uniqueDeliveryDays = Array.from(new Set(deliveryDays)).sort((a, b) => a - b)
  const uniqueCategories = Array.from(new Set(categories))

  const { error: daysDeleteError } = await db.from('supplier_delivery_days').delete().eq('supplier_id', supplierId)
  if (daysDeleteError) throw new Error(daysDeleteError.message || 'Не удалось обновить дни отгрузки')
  const { error: catsDeleteError } = await db.from('supplier_material_categories').delete().eq('supplier_id', supplierId)
  if (catsDeleteError) throw new Error(catsDeleteError.message || 'Не удалось обновить категории')

  if (uniqueDeliveryDays.length > 0) {
    const { error } = await db.from('supplier_delivery_days').insert(
      uniqueDeliveryDays.map((day) => ({ supplier_id: supplierId, day_of_week: day }))
    )
    if (error) throw new Error(error.message || 'Не удалось сохранить дни отгрузки')
  }

  if (uniqueCategories.length > 0) {
    const { error } = await db.from('supplier_material_categories').insert(
      uniqueCategories.map((category) => ({ supplier_id: supplierId, category }))
    )
    if (error) throw new Error(error.message || 'Не удалось сохранить категории')
  }
}

function revalidateSupplierDirectory() {
  revalidatePath('/admin/database')
  revalidatePath('/admin/database/[section]', 'page')
  revalidatePath('/admin/database/[section]/[id]', 'page')
  revalidatePath('/admin/suppliers')
}

export async function getSuppliers(filters: { category?: MaterialCategory; active_only?: boolean } = {}) {
  try {
    const db = await getDb()
    let query = db.from('suppliers').select('*').order('name')
    if (filters.active_only) query = query.eq('is_active', true)
    const { data, error } = await query
    if (error) throw new Error(error.message || 'Не удалось загрузить поставщиков')
    let suppliers = await hydrateSuppliers(db, (data || []) as Supplier[])
    if (filters.category) suppliers = suppliers.filter((supplier) => supplier.categories.includes(filters.category!))
    return { data: suppliers, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить поставщиков' }
  }
}

export async function getSupplier(id: string) {
  try {
    const db = await getDb()
    const { data, error } = await db.from('suppliers').select('*').eq('id', id).single()
    if (error || !data) throw new Error('Поставщик не найден')
    const [supplier] = await hydrateSuppliers(db, [data as Supplier])
    return { data: supplier, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить поставщика' }
  }
}

export async function createSupplier(input: SupplierInput) {
  try {
    const { db } = await requireDirector()
    if (!input.name.trim()) throw new Error('Укажите название компании')
    const roleConfiguration = validateSupplierRoleConfiguration(input)
    if (!roleConfiguration.success) throw new Error(roleConfiguration.error)
    const deliveryDays = Array.isArray(input.deliveryDays) ? input.deliveryDays : []
    if (input.primary_role === 'supplier' && deliveryDays.length === 0) {
      throw new Error('Выберите хотя бы один день отгрузки для поставщика')
    }
    if (
      input.primary_role === 'supplier'
      && deliveryDays.some((day) => !(DELIVERY_DAYS as readonly number[]).includes(day))
    ) {
      throw new Error('Выбран некорректный день отгрузки')
    }
    const isMaterialSupplier = input.primary_role === 'supplier'

    const { data, error } = await db.from('suppliers').insert({
      name: input.name.trim(),
      contact_person: input.contact_person || null,
      phone: input.phone || null,
      email: input.email || null,
      notes: input.notes || null,
      delivery_lead_days: isMaterialSupplier ? Number(input.delivery_lead_days || 0) : 0,
      is_active: input.is_active ?? true,
      can_outsource: roleConfiguration.data.can_outsource,
      can_transport: roleConfiguration.data.can_transport,
    }).select('*').single()
    if (error || !data) throw new Error(error?.message || 'Не удалось создать поставщика')

    const supplier = data as Supplier
    await replaceRelations(
      supplier.id,
      isMaterialSupplier ? deliveryDays : [],
      roleConfiguration.data.categories,
    )
    revalidateSupplierDirectory()
    return { success: true, data: supplier }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось создать поставщика' }
  }
}

export async function updateSupplier(id: string, input: SupplierInput) {
  try {
    const { db } = await requireDirector()
    if (!input.name.trim()) throw new Error('Укажите название компании')
    const roleConfiguration = validateSupplierRoleConfiguration(input)
    if (!roleConfiguration.success) throw new Error(roleConfiguration.error)
    const deliveryDays = Array.isArray(input.deliveryDays) ? input.deliveryDays : []
    if (input.primary_role === 'supplier' && deliveryDays.length === 0) {
      throw new Error('Выберите хотя бы один день отгрузки для поставщика')
    }
    if (
      input.primary_role === 'supplier'
      && deliveryDays.some((day) => !(DELIVERY_DAYS as readonly number[]).includes(day))
    ) {
      throw new Error('Выбран некорректный день отгрузки')
    }
    const isMaterialSupplier = input.primary_role === 'supplier'

    const { error } = await db.from('suppliers').update({
      name: input.name.trim(),
      contact_person: input.contact_person || null,
      phone: input.phone || null,
      email: input.email || null,
      notes: input.notes || null,
      delivery_lead_days: isMaterialSupplier ? Number(input.delivery_lead_days || 0) : 0,
      is_active: input.is_active ?? true,
      can_outsource: roleConfiguration.data.can_outsource,
      can_transport: roleConfiguration.data.can_transport,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) throw new Error(error.message || 'Не удалось обновить поставщика')

    await replaceRelations(
      id,
      isMaterialSupplier ? deliveryDays : [],
      roleConfiguration.data.categories,
    )
    revalidateSupplierDirectory()
    revalidatePath(`/admin/suppliers/${id}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить поставщика' }
  }
}

export async function deleteSupplier(id: string) {
  try {
    const { db } = await requireDirector()
    const { error } = await db.from('suppliers').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(error.message || 'Не удалось деактивировать поставщика')
    revalidateSupplierDirectory()
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось деактивировать поставщика' }
  }
}

export async function getSuppliersByCategory(category: MaterialCategory) {
  return getSuppliers({ category, active_only: true })
}
