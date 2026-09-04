'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import { ROUTES } from '@/lib/constants/routes'
import type { Database } from '@/lib/types/database'

type ActionResult<T = undefined> = { success: boolean; data?: T; error: string | null }
type FactoryOption = { id: string; name: string }
type SectionOption = { id: string; name: string; stage: string }
type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  update: (values: unknown) => LooseQuery
  insert: (values: unknown) => LooseQuery
  upsert: (values: unknown, options?: { onConflict?: string }) => LooseQuery
  delete: () => LooseQuery
  single: () => Promise<DbResult>
  maybeSingle: () => Promise<DbResult>
}
type LooseDb = { from: (table: string) => LooseQuery }
type RawSection = Pick<
  Database['public']['Tables']['production_fact_sections']['Row'],
  'id' | 'name' | 'parent_id' | 'production_stage_type'
>

export type ProductionReportSettingsData = {
  factories: FactoryOption[]
  selectedFactoryId: string | null
  sections: SectionOption[]
  calendar: Database['public']['Tables']['factory_work_calendar_exceptions']['Row'][]
  capacities: Array<Database['public']['Tables']['production_section_capacity_periods']['Row'] & { sectionName: string }>
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return 'Неизвестная ошибка'
}

function dateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Укажите корректную дату')
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Укажите корректную дату')
  }
  return value
}

function requiredReason(value: string) {
  const reason = String(value || '').replace(/\s+/g, ' ').trim()
  if (!reason) throw new Error('Причина обязательна')
  return reason
}

async function context(operation: 'view' | 'manage', requestedFactoryId?: string | null) {
  const auth = await requirePermission('production_reports', operation)
  const scope = auth.permissionDetails.factoryScopes.production_reports?.[operation] || 'own'
  const admin = createAdminClient()
  const factoryResult = scope === 'all'
    ? await admin.from('factories').select('id, name').order('name')
    : auth.factoryId
      ? await admin.from('factories').select('id, name').eq('id', auth.factoryId)
      : { data: [], error: null }
  if (factoryResult.error) throw factoryResult.error
  const factories = (factoryResult.data || []) as FactoryOption[]
  const factoryId = factories.some((factory) => factory.id === requestedFactoryId)
    ? requestedFactoryId!
    : factories[0]?.id || null
  return { auth, admin, factories, factoryId }
}

function revalidateReports() {
  revalidatePath(ROUTES.REPORTS_PRODUCTION)
  revalidatePath(ROUTES.REPORTS_PRODUCTION_SETTINGS)
  revalidatePath(ROUTES.DASHBOARD)
}

export async function getProductionReportSettingsData(factoryId?: string | null): Promise<ProductionReportSettingsData> {
  const { admin, factories, factoryId: selectedFactoryId } = await context('manage', factoryId)
  if (!selectedFactoryId) return { factories, selectedFactoryId: null, sections: [], calendar: [], capacities: [] }
  const db = admin as unknown as LooseDb
  const [sectionsResult, calendarResult, capacityResult] = await Promise.all([
    db.from('production_fact_sections')
      .select('id, name, parent_id, production_stage_type')
      .eq('factory_id', selectedFactoryId)
      .eq('is_active', true)
      .is('archived_at', null)
      .order('sort_order'),
    db.from('factory_work_calendar_exceptions')
      .select('*')
      .eq('factory_id', selectedFactoryId)
      .order('work_date'),
    db.from('production_section_capacity_periods')
      .select('*')
      .eq('factory_id', selectedFactoryId)
      .order('valid_from', { ascending: false }),
  ])
  const firstError = [sectionsResult, calendarResult, capacityResult].find((result) => result.error)?.error
  if (firstError) throw firstError
  const rawSections = (sectionsResult.data || []) as RawSection[]
  const sectionById = new Map(rawSections.map((section) => [section.id, section]))
  const parentIds = new Set(rawSections.map((section) => section.parent_id).filter(Boolean))
  const sections = rawSections.filter((section) => !parentIds.has(section.id)).map((section) => ({
    id: section.id,
    name: section.name,
    stage: section.production_stage_type || (section.parent_id ? sectionById.get(section.parent_id)?.production_stage_type : null) || '',
  })).filter((section) => ['assembly', 'cleaning', 'painting', 'packaging'].includes(section.stage))
  const names = new Map(sections.map((section) => [section.id, section.name]))
  return {
    factories,
    selectedFactoryId,
    sections,
    calendar: (calendarResult.data || []) as ProductionReportSettingsData['calendar'],
    capacities: ((capacityResult.data || []) as Database['public']['Tables']['production_section_capacity_periods']['Row'][])
      .map((row) => ({ ...row, sectionName: names.get(row.section_id) || 'Архивный участок' })),
  }
}

export async function saveFactoryCalendarException(input: {
  id?: string | null
  factory_id: string
  exception_date: string
  is_working: boolean
  reason: string
}): Promise<ActionResult<{ id: string }>> {
  try {
    const { auth, admin, factoryId } = await context('manage', input.factory_id)
    if (!factoryId || factoryId !== input.factory_id) throw new Error('Недостаточно прав для выбранного завода')
    const payload = {
      factory_id: factoryId,
      work_date: dateOnly(input.exception_date),
      is_working: Boolean(input.is_working),
      reason: requiredReason(input.reason),
      updated_by: auth.userId,
    }
    const db = admin as unknown as LooseDb
    const query = input.id
      ? db.from('factory_work_calendar_exceptions').update(payload).eq('id', input.id).eq('factory_id', factoryId)
      : db.from('factory_work_calendar_exceptions').upsert(
          { ...payload, created_by: auth.userId },
          { onConflict: 'factory_id,work_date' },
        )
    const { data, error } = await query.select('id').single()
    if (error) throw error
    revalidateReports()
    return { success: true, data: { id: (data as { id: string }).id }, error: null }
  } catch (error) {
    return { success: false, error: errorMessage(error) }
  }
}

export async function deleteFactoryCalendarException(id: string): Promise<ActionResult> {
  try {
    await requirePermission('production_reports', 'manage')
    const admin = createAdminClient()
    const db = admin as unknown as LooseDb
    const { data: rowRaw, error: readError } = await db.from('factory_work_calendar_exceptions')
      .select('factory_id').eq('id', id).maybeSingle()
    const row = rowRaw as { factory_id: string } | null
    if (readError || !row) throw new Error(readError?.message || 'Исключение не найдено')
    const { factoryId } = await context('manage', row.factory_id)
    if (factoryId !== row.factory_id) throw new Error('Недостаточно прав для выбранного завода')
    const { error } = await db.from('factory_work_calendar_exceptions').delete().eq('id', id)
    if (error) throw error
    revalidateReports()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: errorMessage(error) }
  }
}

export async function saveProductionSectionCapacity(input: {
  id?: string | null
  factory_id: string
  section_id: string
  valid_from: string
  valid_to?: string | null
  tons_per_workday: number
}): Promise<ActionResult<{ id: string }>> {
  try {
    const { auth, admin, factoryId } = await context('manage', input.factory_id)
    if (!factoryId || factoryId !== input.factory_id) throw new Error('Недостаточно прав для выбранного завода')
    const validFrom = dateOnly(input.valid_from)
    const validTo = input.valid_to ? dateOnly(input.valid_to) : null
    if (validTo && validTo < validFrom) throw new Error('Дата окончания раньше даты начала')
    const tons = Number(input.tons_per_workday)
    if (!Number.isFinite(tons) || tons <= 0) throw new Error('Мощность должна быть больше нуля')
    const db = admin as unknown as LooseDb
    const { data: sectionRaw, error: sectionError } = await db.from('production_fact_sections')
      .select('id, factory_id, parent_id, production_stage_type')
      .eq('id', input.section_id).maybeSingle()
    const section = sectionRaw as Pick<Database['public']['Tables']['production_fact_sections']['Row'], 'id' | 'factory_id' | 'parent_id' | 'production_stage_type'> | null
    if (sectionError || !section) throw new Error(sectionError?.message || 'Участок не найден')
    if (section.factory_id !== factoryId) throw new Error('Участок относится к другому заводу')
    const payload = {
      factory_id: factoryId,
      section_id: section.id,
      valid_from: validFrom,
      valid_to: validTo,
      tons_per_workday: tons,
      updated_by: auth.userId,
    }
    const query = input.id
      ? db.from('production_section_capacity_periods').update(payload).eq('id', input.id).eq('factory_id', factoryId)
      : db.from('production_section_capacity_periods').insert({ ...payload, created_by: auth.userId })
    const { data, error } = await query.select('id').single()
    if (error) throw error
    revalidateReports()
    return { success: true, data: { id: (data as { id: string }).id }, error: null }
  } catch (error) {
    return { success: false, error: errorMessage(error) }
  }
}

export async function deleteProductionSectionCapacity(id: string): Promise<ActionResult> {
  try {
    await requirePermission('production_reports', 'manage')
    const admin = createAdminClient()
    const db = admin as unknown as LooseDb
    const { data: rowRaw, error: readError } = await db.from('production_section_capacity_periods')
      .select('factory_id').eq('id', id).maybeSingle()
    const row = rowRaw as { factory_id: string } | null
    if (readError || !row) throw new Error(readError?.message || 'Период мощности не найден')
    const { factoryId } = await context('manage', row.factory_id)
    if (factoryId !== row.factory_id) throw new Error('Недостаточно прав для выбранного завода')
    const { error } = await db.from('production_section_capacity_periods').delete().eq('id', id)
    if (error) throw error
    revalidateReports()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: errorMessage(error) }
  }
}
