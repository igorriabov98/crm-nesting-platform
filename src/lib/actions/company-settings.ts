"use server"

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import type { PermissionOperation } from '@/lib/permissions/resources'
import { companySettingsSchema, type UpdateCompanySettingsData } from '@/lib/types/schemas'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import type { Database } from '@/lib/types/database'

const COMPANY_SETTINGS_ID = '00000000-0000-0000-0000-000000000001'

type CompanySettings = Database['public']['Tables']['company_settings']['Row']
type CompanySettingsUpdate = Database['public']['Tables']['company_settings']['Update']
type DbError = { message?: string; details?: string; hint?: string }
type LooseDbResult = { data: unknown; error: DbError | null }
type LooseQuery = PromiseLike<LooseDbResult> & {
  select: (columns?: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  upsert: (values: unknown, options?: unknown) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  single: () => Promise<LooseDbResult>
  maybeSingle: () => Promise<LooseDbResult>
}
type LooseDb = {
  from: (table: string) => LooseQuery
}

function dbFrom(supabase: unknown): LooseDb {
  return supabase as LooseDb
}

async function requireCompanySettingsAccess(operation: PermissionOperation = 'view') {
  return requirePermission('company_settings', operation)
}

async function loadCompanySettingsFromAdmin(): Promise<CompanySettings> {
  const adminSupabase = createAdminClient()
  const db = dbFrom(adminSupabase)
  const { data, error } = await db
    .from('company_settings')
    .select('*')
    .eq('id', COMPANY_SETTINGS_ID)
    .maybeSingle()

  if (error) throw error
  if (data) return data as CompanySettings

  const { data: created, error: createError } = await db
    .from('company_settings')
    .insert({ id: COMPANY_SETTINGS_ID })
    .select('*')
    .single()

  if (createError) throw createError
  return created as CompanySettings
}

function normalizeText(value: string | null | undefined) {
  return value?.trim() || ''
}

function fileExtension(file: File) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.png')) return '.png'
  if (name.endsWith('.jpg')) return '.jpg'
  if (name.endsWith('.jpeg')) return '.jpeg'
  if (file.type === 'image/png') return '.png'
  if (file.type === 'image/jpeg') return '.jpg'
  return ''
}

function assertPngOrJpg(file: File) {
  if (!file || file.size === 0) throw new Error('Выберите файл')

  const extension = fileExtension(file)
  const allowedType = file.type === 'image/png' || file.type === 'image/jpeg' || file.type === ''
  if (!extension || !allowedType) {
    throw new Error('Загрузите изображение в формате PNG или JPG')
  }

  return extension
}

export async function getCompanySettings(): Promise<CompanySettings> {
  await requireCompanySettingsAccess()
  return loadCompanySettingsFromAdmin()
}

export async function updateCompanySettings(data: UpdateCompanySettingsData): Promise<{ success: boolean; error: string | null }> {
  try {
    await requireCompanySettingsAccess('manage')
    const adminSupabase = createAdminClient()
    const db = dbFrom(adminSupabase)
    const parsed = companySettingsSchema.parse(data)
    const payload: CompanySettingsUpdate = {
      name_en: normalizeText(parsed.name_en),
      name_ua: normalizeText(parsed.name_ua),
      address_en: normalizeText(parsed.address_en),
      director_name_en: normalizeText(parsed.director_name_en),
      director_name_ua: normalizeText(parsed.director_name_ua),
      enterprise_code: normalizeText(parsed.enterprise_code),
      iban: normalizeText(parsed.iban),
      swift: normalizeText(parsed.swift),
      bank_name: normalizeText(parsed.bank_name),
      bank_address: normalizeText(parsed.bank_address),
      delivery_basis_en: normalizeText(parsed.delivery_basis_en) || 'Delivery Basis: DAP',
      delivery_basis_ua: normalizeText(parsed.delivery_basis_ua) || 'Базис постачання: DAP',
      intermediary_bank_name: normalizeText(parsed.intermediary_bank_name),
      intermediary_bank_swift: normalizeText(parsed.intermediary_bank_swift),
      updated_at: new Date().toISOString(),
    }

    const { error } = await db
      .from('company_settings')
      .upsert({ id: COMPANY_SETTINGS_ID, ...payload }, { onConflict: 'id' })

    if (error) throw error

    revalidatePath(ROUTES.ADMIN_COMPANY_SETTINGS)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function uploadCompanyImage(
  formData: FormData,
  type: 'signature' | 'stamp'
): Promise<{ success: boolean; path?: string; error: string | null }> {
  let uploadedPath: string | null = null
  let adminSupabase: ReturnType<typeof createAdminClient> | null = null

  try {
    await requireCompanySettingsAccess('manage')
    adminSupabase = createAdminClient()
    const db = dbFrom(adminSupabase)
    if (type !== 'signature' && type !== 'stamp') throw new Error('Некорректный тип изображения')

    const file = formData.get('file')
    if (!(file instanceof File)) throw new Error('Выберите файл')

    const extension = assertPngOrJpg(file)
    uploadedPath = `company/${type}/${Date.now()}-${randomUUID()}${extension}`

    const { error: uploadError } = await adminSupabase.storage
      .from('product-files')
      .upload(uploadedPath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || undefined,
      })

    if (uploadError) throw uploadError

    const payload: CompanySettingsUpdate = type === 'signature'
      ? { signature_image_path: uploadedPath, updated_at: new Date().toISOString() }
      : { stamp_image_path: uploadedPath, updated_at: new Date().toISOString() }

    const { error: updateError } = await db
      .from('company_settings')
      .upsert({ id: COMPANY_SETTINGS_ID, ...payload }, { onConflict: 'id' })

    if (updateError) throw updateError

    revalidatePath(ROUTES.ADMIN_COMPANY_SETTINGS)
    return { success: true, path: uploadedPath, error: null }
  } catch (error) {
    if (uploadedPath) {
      await (adminSupabase ?? createAdminClient()).storage
        .from('product-files')
        .remove([uploadedPath])
        .catch(() => undefined)
    }
    return { success: false, error: getErrorMessage(error) }
  }
}
