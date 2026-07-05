'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserContext } from '@/lib/auth/current-user'
import { ROUTES } from '@/lib/constants/routes'
import { dispatchPendingTelegramDeliveries } from '@/lib/services/task-notifications'
import { updateMachineDate } from '@/lib/actions/production'
import {
  PRODUCTION_FACT_STANDARD_STAGES,
  getProductionFactStageDefinition,
  isProductionFactStageKey,
  type ProductionFactStageKey,
} from '@/lib/constants/production-fact'
import type {
  Factory,
  MachineWithTotals,
  ProductionFactSection,
  ProductionFactShift,
  ProductionMachineFact,
  ProductionTonnageFact,
  UserRole,
} from '@/lib/types'
import type { Database } from '@/lib/types/database'

type AdminClient = SupabaseClient<Database>
type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: DbError | null }>
}

type UserNameRow = Pick<Database['public']['Tables']['users']['Row'], 'id' | 'full_name' | 'email'>
type MachineOptionRow = Pick<
  MachineWithTotals,
  'id' | 'name' | 'factory_id' | 'production_month' | 'production_queue_number' | 'total_weight' | 'status' | 'actual_shipping_date'
>
type DbError = { message?: string; details?: string; hint?: string; code?: string }
type LooseDbResult = { data: unknown; error: DbError | null }
type LooseQuery = PromiseLike<LooseDbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  neq: (column: string, value: unknown) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  delete: () => LooseQuery
  single: () => Promise<LooseDbResult>
  maybeSingle: () => Promise<LooseDbResult>
}
type LooseDb = {
  from: (table: string) => LooseQuery
}

export type ProductionFactFactoryOption = Pick<Factory, 'id' | 'name'>

export type ProductionFactMachineOption = {
  id: string
  name: string
  production_month: string | null
  production_queue_number: number | null
  total_weight: number
  status: string | null
  actual_shipping_date: string | null
}

export type ProductionFactMachineFactRow = ProductionMachineFact & {
  machine: ProductionFactMachineOption | null
  section: ProductionFactSection | null
  parentSection: ProductionFactSection | null
  createdByName: string | null
  updatedByName: string | null
  canEdit: boolean
}

export type ProductionFactTonnageFactRow = ProductionTonnageFact & {
  section: ProductionFactSection | null
  parentSection: ProductionFactSection | null
  previousTonnage: number
  deltaTonnage: number
  createdByName: string | null
  updatedByName: string | null
  canEdit: boolean
}

export type ProductionFactWorkspaceData = {
  factories: ProductionFactFactoryOption[]
  selectedFactoryId: string | null
  selectedDate: string
  sections: ProductionFactSection[]
  machineOptions: ProductionFactMachineOption[]
  shippingMachinesForDate: ProductionFactMachineOption[]
  machineFacts: ProductionFactMachineFactRow[]
  tonnageFacts: ProductionFactTonnageFactRow[]
  previousTonnageBySection: Record<string, number>
  canEditSelectedDate: boolean
  isDirector: boolean
  stats: {
    machineFactCount: number
    uniqueMachineCount: number
    dayShiftCount: number
    nightShiftCount: number
    totalTonnage: number
    previousTotalTonnage: number
    tonnageDelta: number
  }
}

export type ProductionFactSettingsData = {
  factories: ProductionFactFactoryOption[]
  selectedFactoryId: string | null
  sections: ProductionFactSection[]
}

export type ProductionFactActionResult<T = undefined> = {
  success: boolean
  data?: T
  error: string | null
}

const DIRECTORS: UserRole[] = ['financial_director', 'commercial_director', 'planning_director']
const PRODUCTION_FACT_ROLES: UserRole[] = ['production_manager', ...DIRECTORS]
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CHISINAU_TIME_ZONE = 'Europe/Chisinau'
const CUTTING_STAGE_TYPE = 'cutting' as const
const CUTTING_ROLLBACK_TASK_TYPE = 'production_cutting_rollback_review' as const

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const dbError = error as { message?: string; details?: string; hint?: string; code?: string }
    if (dbError.code === '23505') return 'Такая запись уже существует'
    return [dbError.message, dbError.details, dbError.hint].filter(Boolean).join(' ')
  }
  return String(error || 'Неизвестная ошибка')
}

function looseDb(admin: AdminClient): LooseDb {
  return admin as unknown as LooseDb
}

function isDirector(role: UserRole) {
  return DIRECTORS.includes(role)
}

function assertProductionFactRole(role: UserRole) {
  if (!PRODUCTION_FACT_ROLES.includes(role)) {
    throw new Error('Недостаточно прав для факта производства')
  }
}

function assertFactoryAccess(role: UserRole, userFactoryId: string | null, factoryId: string) {
  if (isDirector(role)) return
  if (role === 'production_manager' && userFactoryId === factoryId) return
  throw new Error('Недостаточно прав для выбранного завода')
}

function chisinauDateOnly(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHISINAU_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function dateOnly(value: string | null | undefined, fallback = chisinauDateOnly()) {
  return value && DATE_RE.test(value) ? value : fallback
}

function addDays(value: string, days: number) {
  const date = new Date(`${dateOnly(value)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function canEditFactDate(role: UserRole, factDate: string) {
  if (isDirector(role)) return true
  const cutoff = addDays(chisinauDateOnly(), -7)
  return dateOnly(factDate) >= cutoff
}

function assertCanEditFactDate(role: UserRole, factDate: string) {
  if (!canEditFactDate(role, factDate)) {
    throw new Error('Дата старше 7 дней: запись доступна только для просмотра')
  }
}

function normalizeText(value: string | null | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function normalizeNullableText(value: string | null | undefined) {
  const normalized = normalizeText(value)
  return normalized.length > 0 ? normalized : null
}

function toMachineOption(machine: MachineOptionRow): ProductionFactMachineOption {
  return {
    id: machine.id,
    name: machine.name,
    production_month: machine.production_month,
    production_queue_number: machine.production_queue_number,
    total_weight: Number(machine.total_weight || 0),
    status: machine.status || null,
    actual_shipping_date: machine.actual_shipping_date || null,
  }
}

function userDisplayName(user: UserNameRow | undefined) {
  if (!user) return null
  return user.full_name || user.email || null
}

async function getContext() {
  const context = await getCurrentUserContext()
  assertProductionFactRole(context.role)
  return {
    ...context,
    admin: createAdminClient() as AdminClient,
  }
}

async function getVisibleFactories(admin: AdminClient, role: UserRole, userFactoryId: string | null) {
  let query = admin.from('factories').select('id, name').order('name')
  if (role === 'production_manager') {
    query = query.eq('id', userFactoryId || '00000000-0000-0000-0000-000000000000')
  }

  const { data, error } = await query
  if (error) throw error
  return ((data || []) as ProductionFactFactoryOption[])
}

async function getFactorySections(admin: AdminClient, factoryId: string) {
  const { data, error } = await looseDb(admin)
    .from('production_fact_sections')
    .select('*')
    .eq('factory_id', factoryId)
    .order('parent_id', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw error
  return (data || []) as ProductionFactSection[]
}

async function findActiveFactSectionByName(
  admin: AdminClient,
  factoryId: string,
  parentId: string | null,
  name: string,
) {
  let query = looseDb(admin)
    .from('production_fact_sections')
    .select('*')
    .eq('factory_id', factoryId)
    .eq('name', name)
    .is('archived_at', null)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(1)

  query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null)

  const { data, error } = await query
  if (error) throw error
  return ((data || []) as ProductionFactSection[])[0] || null
}

async function ensureStandardProductionFactSections(admin: AdminClient, factoryId: string, userId: string | null) {
  for (const stage of PRODUCTION_FACT_STANDARD_STAGES) {
    const stageProductionType = stage.productionStageType
    let parent = await findActiveFactSectionByName(admin, factoryId, null, stage.label)

    if (!parent) {
      const { data, error } = await looseDb(admin)
        .from('production_fact_sections')
        .insert({
          factory_id: factoryId,
          parent_id: null,
          name: stage.label,
          sort_order: stage.sortOrder,
          production_stage_type: stageProductionType,
          created_by: userId,
          updated_by: userId,
        })
        .select('*')
        .single()

      if (error) throw error
      parent = data as ProductionFactSection
    } else if (stageProductionType && parent.production_stage_type !== stageProductionType) {
      const { data, error } = await looseDb(admin)
        .from('production_fact_sections')
        .update({
          production_stage_type: stageProductionType,
          updated_by: userId,
        })
        .eq('id', parent.id)
        .select('*')
        .single()

      if (error) throw error
      parent = data as ProductionFactSection
    }

    for (const child of stage.children) {
      const section = await findActiveFactSectionByName(admin, factoryId, parent.id, child.label)
      if (!section) {
        const { error } = await looseDb(admin)
          .from('production_fact_sections')
          .insert({
            factory_id: factoryId,
            parent_id: parent.id,
            name: child.label,
            sort_order: child.sortOrder,
            production_stage_type: stageProductionType,
            created_by: userId,
            updated_by: userId,
          })

        if (error) throw error
      } else if (stageProductionType && section.production_stage_type !== stageProductionType) {
        const { error } = await looseDb(admin)
          .from('production_fact_sections')
          .update({
            production_stage_type: stageProductionType,
            updated_by: userId,
          })
          .eq('id', section.id)

        if (error) throw error
      }
    }
  }
}

async function getActiveMachineOptions(admin: AdminClient, factoryId: string) {
  const { data, error } = await admin
    .from('machines_with_totals')
    .select('id, name, factory_id, production_month, production_queue_number, total_weight, status, actual_shipping_date, is_archived')
    .eq('factory_id', factoryId)
    .eq('is_archived', false)
    .is('actual_shipping_date', null)
    .not('production_month', 'is', null)
    .order('production_month', { ascending: true })
    .order('production_queue_number', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })

  if (error) throw error
  return ((data || []) as Array<MachineOptionRow & { is_archived?: boolean | null }>)
    .filter((machine) => (
      machine.factory_id === factoryId
      && machine.is_archived !== true
      && !machine.actual_shipping_date
      && Boolean(machine.production_month)
    ))
    .map(toMachineOption)
}

async function getShippingMachineOptionsForDate(admin: AdminClient, factoryId: string, selectedDate: string) {
  const { data, error } = await admin
    .from('machines_with_totals')
    .select('id, name, factory_id, production_month, production_queue_number, total_weight, status, actual_shipping_date, is_archived')
    .eq('factory_id', factoryId)
    .eq('is_archived', false)
    .eq('actual_shipping_date', selectedDate)
    .order('production_month', { ascending: true })
    .order('production_queue_number', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })

  if (error) throw error
  return ((data || []) as Array<MachineOptionRow & { is_archived?: boolean | null }>)
    .filter((machine) => (
      machine.factory_id === factoryId
      && machine.is_archived !== true
      && machine.actual_shipping_date === selectedDate
    ))
    .map(toMachineOption)
}

async function getMachinesByIds(admin: AdminClient, machineIds: string[]) {
  if (machineIds.length === 0) return new Map<string, ProductionFactMachineOption>()
  const { data, error } = await admin
    .from('machines_with_totals')
    .select('id, name, factory_id, production_month, production_queue_number, total_weight, status, actual_shipping_date')
    .in('id', machineIds)

  if (error) throw error
  return new Map(((data || []) as MachineOptionRow[]).map((machine) => [machine.id, toMachineOption(machine)]))
}

async function getUsersByIds(admin: AdminClient, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, UserNameRow>()
  const { data, error } = await admin
    .from('users')
    .select('id, full_name, email')
    .in('id', userIds)

  if (error) throw error
  return new Map(((data || []) as UserNameRow[]).map((user) => [user.id, user]))
}

async function getMachineFacts(admin: AdminClient, factoryId: string, factDate: string) {
  const { data, error } = await looseDb(admin)
    .from('production_machine_facts')
    .select('*')
    .eq('factory_id', factoryId)
    .eq('fact_date', factDate)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data || []) as ProductionMachineFact[]
}

async function getTonnageFacts(admin: AdminClient, factoryId: string, factDate: string) {
  const { data, error } = await looseDb(admin)
    .from('production_tonnage_facts')
    .select('*')
    .eq('factory_id', factoryId)
    .eq('fact_date', factDate)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data || []) as ProductionTonnageFact[]
}

function getActiveFactSectionIds(sections: ProductionFactSection[]) {
  const activeParents = sections
    .filter((section) => !section.parent_id && section.is_active && !section.archived_at)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ru'))
  const activeChildrenByParent = new Map<string, ProductionFactSection[]>()

  for (const section of sections) {
    if (!section.parent_id || !section.is_active || section.archived_at) continue
    const parent = sections.find((candidate) => candidate.id === section.parent_id)
    if (!parent?.is_active || parent.archived_at) continue
    const list = activeChildrenByParent.get(section.parent_id) || []
    list.push(section)
    activeChildrenByParent.set(section.parent_id, list)
  }

  const ids = new Set<string>()
  for (const parent of activeParents) {
    const children = activeChildrenByParent.get(parent.id) || []
    if (children.length > 0) {
      for (const child of children) ids.add(child.id)
    } else {
      ids.add(parent.id)
    }
  }

  return ids
}

function normalizeSectionStageType(value: unknown): Database['public']['Enums']['stage_type'] | null {
  return value === CUTTING_STAGE_TYPE ? CUTTING_STAGE_TYPE : null
}

function isCuttingFactSection(
  section: Pick<ProductionFactSection, 'production_stage_type'> | null | undefined,
  parent?: Pick<ProductionFactSection, 'production_stage_type'> | null,
) {
  return section?.production_stage_type === CUTTING_STAGE_TYPE || parent?.production_stage_type === CUTTING_STAGE_TYPE
}

async function getFactSectionContext(admin: AdminClient, sectionId: string) {
  const { data: sectionRaw, error: sectionError } = await looseDb(admin)
    .from('production_fact_sections')
    .select('*')
    .eq('id', sectionId)
    .maybeSingle()

  if (sectionError || !sectionRaw) throw new Error(sectionError?.message || 'Участок не найден')
  const section = sectionRaw as ProductionFactSection
  let parent: ProductionFactSection | null = null

  if (section.parent_id) {
    const { data: parentRaw, error: parentError } = await looseDb(admin)
      .from('production_fact_sections')
      .select('*')
      .eq('id', section.parent_id)
      .maybeSingle()
    if (parentError) throw parentError
    parent = (parentRaw || null) as ProductionFactSection | null
  }

  return { section, parent }
}

async function isCuttingFact(admin: AdminClient, fact: Pick<ProductionMachineFact, 'section_id'>) {
  const { section, parent } = await getFactSectionContext(admin, fact.section_id)
  return isCuttingFactSection(section, parent)
}

async function hasRemainingCuttingFacts(admin: AdminClient, machineId: string, excludeFactId?: string | null) {
  let query = looseDb(admin)
    .from('production_machine_facts')
    .select('id, section_id')
    .eq('machine_id', machineId)

  if (excludeFactId) query = query.neq('id', excludeFactId)

  const { data, error } = await query
  if (error) throw error

  const facts = (data || []) as Pick<ProductionMachineFact, 'id' | 'section_id'>[]
  if (facts.length === 0) return false

  const sectionIds = Array.from(new Set(facts.map((fact) => fact.section_id)))
  const { data: sectionsRaw, error: sectionsError } = await looseDb(admin)
    .from('production_fact_sections')
    .select('*')
    .in('id', sectionIds)

  if (sectionsError) throw sectionsError
  const sectionMap = new Map(((sectionsRaw || []) as ProductionFactSection[]).map((section) => [section.id, section]))
  const parentIds = Array.from(new Set(
    Array.from(sectionMap.values())
      .map((section) => section.parent_id)
      .filter(Boolean),
  )) as string[]

  const parentMap = new Map<string, ProductionFactSection>()
  if (parentIds.length > 0) {
    const { data: parentsRaw, error: parentsError } = await looseDb(admin)
      .from('production_fact_sections')
      .select('*')
      .in('id', parentIds)
    if (parentsError) throw parentsError
    for (const parent of (parentsRaw || []) as ProductionFactSection[]) parentMap.set(parent.id, parent)
  }

  return facts.some((fact) => {
    const section = sectionMap.get(fact.section_id) || null
    const parent = section?.parent_id ? parentMap.get(section.parent_id) || null : null
    return isCuttingFactSection(section, parent)
  })
}

async function assertActiveFactSection(
  admin: AdminClient,
  factoryId: string,
  sectionId: string,
  options: { allowArchivedSectionId?: string | null } = {},
) {
  const { data, error } = await looseDb(admin)
    .from('production_fact_sections')
    .select('*')
    .eq('id', sectionId)
    .maybeSingle()

  if (error || !data) throw new Error(error?.message || 'Участок не найден')

  const section = data as ProductionFactSection
  const isExistingSection = section.id === options.allowArchivedSectionId
  if (section.factory_id !== factoryId) {
    throw new Error('Факт можно вводить только по участку выбранного завода')
  }

  if (!isExistingSection && (!section.is_active || section.archived_at)) {
    throw new Error('Архивный участок нельзя выбрать для новой записи')
  }

  if (section.parent_id) {
    const { data: parentRaw, error: parentError } = await looseDb(admin)
      .from('production_fact_sections')
      .select('id, is_active, archived_at')
      .eq('id', section.parent_id)
      .maybeSingle()

    const parent = parentRaw as Pick<ProductionFactSection, 'id' | 'is_active' | 'archived_at'> | null
    if (parentError || !parent) throw new Error(parentError?.message || 'Родительский участок не найден')
    if (!isExistingSection && (!parent.is_active || parent.archived_at)) {
      throw new Error('Архивный участок нельзя выбрать для новой записи')
    }

    return section
  }

  const { data: childRaw, error: childError } = await looseDb(admin)
    .from('production_fact_sections')
    .select('id, is_active, archived_at')
    .eq('parent_id', section.id)

  if (childError) throw childError
  const activeChildren = ((childRaw || []) as Pick<ProductionFactSection, 'id' | 'is_active' | 'archived_at'>[])
    .filter((child) => child.is_active && !child.archived_at)
  if (!isExistingSection && activeChildren.length > 0) {
    throw new Error('Факт по участку можно вводить только если у него нет активных подучастков')
  }

  return section
}

async function assertFactoryMachine(admin: AdminClient, factoryId: string, machineId: string) {
  const { data, error } = await looseDb(admin)
    .from('machines')
    .select('id, factory_id, is_archived')
    .eq('id', machineId)
    .maybeSingle()

  const machine = data as { id: string; factory_id: string | null; is_archived: boolean } | null
  if (error || !machine) throw new Error(error?.message || 'Машина не найдена')
  if (machine.factory_id !== factoryId) throw new Error('Машина относится к другому заводу')
  return machine
}

async function assertFactoryMachines(admin: AdminClient, factoryId: string, machineIds: string[]) {
  if (machineIds.length === 0) return
  const { data, error } = await looseDb(admin)
    .from('machines')
    .select('id, factory_id, is_archived')
    .in('id', machineIds)

  if (error) throw error
  const rows = (data || []) as Array<{ id: string; factory_id: string | null; is_archived: boolean }>
  const byId = new Map(rows.map((machine) => [machine.id, machine]))
  for (const machineId of machineIds) {
    const machine = byId.get(machineId)
    if (!machine) throw new Error('Машина не найдена')
    if (machine.factory_id !== factoryId) throw new Error('Машина относится к другому заводу')
  }
}

function revalidateProductionFact() {
  revalidatePath(ROUTES.PRODUCTION_FACT)
}

function revalidateProductionCuttingFlow(machineId?: string | null) {
  revalidateProductionFact()
  revalidatePath(ROUTES.PRODUCTION)
  revalidatePath(ROUTES.GANTT)
  revalidatePath(ROUTES.INVENTORY)
  revalidatePath(ROUTES.TASKS)
  revalidatePath(ROUTES.NOTIFICATIONS)
  if (machineId) revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
}

async function runLimited<T>(
  items: T[],
  limit: number,
  runner: (item: T) => Promise<void>,
) {
  for (let index = 0; index < items.length; index += limit) {
    await Promise.all(items.slice(index, index + limit).map(runner))
  }
}

async function applyCuttingFactSideEffects(admin: AdminClient, factId: string, userId: string) {
  const { error } = await (admin as unknown as RpcClient).rpc('fn_apply_production_fact_cutting', {
    p_fact_id: factId,
    p_performed_by: userId,
  })

  if (error) throw new Error(error.message || 'Не удалось применить списание по факту заготовки')
}

async function getCuttingRollbackAssignee(admin: AdminClient, factoryId: string | null, fallbackUserId: string) {
  const { data: settingsRaw } = await looseDb(admin)
    .from('company_settings')
    .select('auto_task_technologist_user_id')
    .limit(1)

  const configuredId = ((settingsRaw || []) as Array<{ auto_task_technologist_user_id?: string | null }>)[0]
    ?.auto_task_technologist_user_id || null

  if (configuredId) {
    const { data: userRaw } = await looseDb(admin)
      .from('users')
      .select('id')
      .eq('id', configuredId)
      .eq('role', 'technologist')
      .eq('is_active', true)
      .maybeSingle()
    if ((userRaw as { id?: string } | null)?.id) return configuredId
  }

  let technologistQuery = looseDb(admin)
    .from('users')
    .select('id')
    .eq('role', 'technologist')
    .eq('is_active', true)
    .order('full_name', { ascending: true })
    .limit(1)

  if (factoryId) technologistQuery = technologistQuery.eq('factory_id', factoryId)

  const { data: factoryTechnologists } = await technologistQuery
  const factoryTechnologist = ((factoryTechnologists || []) as Array<{ id: string }>)[0]?.id
  if (factoryTechnologist) return factoryTechnologist

  const { data: anyTechnologists } = await looseDb(admin)
    .from('users')
    .select('id')
    .eq('role', 'technologist')
    .eq('is_active', true)
    .order('full_name', { ascending: true })
    .limit(1)

  return ((anyTechnologists || []) as Array<{ id: string }>)[0]?.id || fallbackUserId
}

async function ensureCuttingRollbackTask(admin: AdminClient, input: {
  machineId: string
  factoryId: string | null
  userId: string
  reason: string
}) {
  const { data: machineRaw } = await looseDb(admin)
    .from('machines')
    .select('id, name, factory_id')
    .eq('id', input.machineId)
    .maybeSingle()
  const machine = machineRaw as { id: string; name: string | null; factory_id: string | null } | null
  const machineName = machine?.name || 'машина'
  const factoryId = machine?.factory_id || input.factoryId
  const assignedTo = await getCuttingRollbackAssignee(admin, factoryId, input.userId)
  const today = chisinauDateOnly()
  const title = `Проверить откат заготовки: ${machineName}`
  const description = [
    'Последний факт заготовки по машине удален или перенесен.',
    'Склад автоматически не откатывался.',
    'Откройте задачу, чтобы посмотреть preview и выбрать автоматический откат или оставить списание как есть.',
    `Причина: ${input.reason}`,
  ].join('\n')

  const { data: existingRaw, error: existingError } = await looseDb(admin)
    .from('tasks')
    .select('id, status')
    .eq('machine_id', input.machineId)
    .eq('task_type', CUTTING_ROLLBACK_TASK_TYPE)
    .in('status', ['pending', 'in_progress'])
    .limit(1)

  if (existingError) throw existingError

  const existing = ((existingRaw || []) as Array<{ id: string; status: string }>)[0] || null
  let taskId = existing?.id || null

  if (taskId) {
    const { error } = await looseDb(admin)
      .from('tasks')
      .update({
        assigned_to: assignedTo,
        title,
        description,
        status: 'pending',
        start_date: today,
        deadline: today,
        completed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)
    if (error) throw error
  } else {
    const { data: insertedRaw, error } = await looseDb(admin)
      .from('tasks')
      .insert({
        machine_id: input.machineId,
        assigned_to: assignedTo,
        task_type: CUTTING_ROLLBACK_TASK_TYPE,
        title,
        description,
        status: 'pending',
        start_date: today,
        deadline: today,
      })
      .select('id')
      .single()
    if (error) throw error
    taskId = (insertedRaw as { id: string }).id
  }

  const { error: eventsError } = await looseDb(admin)
    .from('production_fact_cutting_events')
    .update({ rollback_task_id: taskId })
    .eq('machine_id', input.machineId)
    .eq('status', 'applied')
  if (eventsError) throw eventsError

  const { error: notificationError } = await looseDb(admin)
    .from('notifications')
    .insert({
      user_id: assignedTo,
      type: 'task_created',
      title: 'Нужен review отката заготовки',
      message: `По машине "${machineName}" удален или перенесен последний факт заготовки. Откройте задачу для preview автоматического отката.`,
      related_machine_id: input.machineId,
    })
  if (notificationError) throw notificationError

  await dispatchPendingTelegramDeliveries({ userId: assignedTo })
  return taskId
}

export async function getProductionFactWorkspaceData(input: {
  factoryId?: string | null
  date?: string | null
} = {}): Promise<ProductionFactWorkspaceData> {
  const { admin, role, factoryId: userFactoryId, userId } = await getContext()
  const factories = await getVisibleFactories(admin, role, userFactoryId)
  const selectedFactoryId = factories.some((factory) => factory.id === input.factoryId)
    ? input.factoryId!
    : factories[0]?.id || null

  const selectedDate = dateOnly(input.date)

  if (!selectedFactoryId) {
    return {
      factories,
      selectedFactoryId: null,
      selectedDate,
      sections: [],
      machineOptions: [],
      shippingMachinesForDate: [],
      machineFacts: [],
      tonnageFacts: [],
      previousTonnageBySection: {},
      canEditSelectedDate: false,
      isDirector: isDirector(role),
      stats: {
        machineFactCount: 0,
        uniqueMachineCount: 0,
        dayShiftCount: 0,
        nightShiftCount: 0,
        totalTonnage: 0,
        previousTotalTonnage: 0,
        tonnageDelta: 0,
      },
    }
  }

  assertFactoryAccess(role, userFactoryId, selectedFactoryId)
  await ensureStandardProductionFactSections(admin, selectedFactoryId, userId)

  const previousDate = addDays(selectedDate, -1)
  const [
    sections,
    machineOptions,
    shippingMachinesForDate,
    machineFacts,
    tonnageFacts,
    previousTonnageFacts,
  ] = await Promise.all([
    getFactorySections(admin, selectedFactoryId),
    getActiveMachineOptions(admin, selectedFactoryId),
    getShippingMachineOptionsForDate(admin, selectedFactoryId, selectedDate),
    getMachineFacts(admin, selectedFactoryId, selectedDate),
    getTonnageFacts(admin, selectedFactoryId, selectedDate),
    getTonnageFacts(admin, selectedFactoryId, previousDate),
  ])

  const sectionById = new Map(sections.map((section) => [section.id, section]))
  const machineIds = Array.from(new Set([
    ...machineOptions.map((machine) => machine.id),
    ...shippingMachinesForDate.map((machine) => machine.id),
    ...machineFacts.map((fact) => fact.machine_id),
  ]))
  const userIds = Array.from(new Set([
    ...machineFacts.flatMap((fact) => [fact.created_by, fact.updated_by]),
    ...tonnageFacts.flatMap((fact) => [fact.created_by, fact.updated_by]),
  ].filter(Boolean))) as string[]

  const [machinesById, usersById] = await Promise.all([
    getMachinesByIds(admin, machineIds),
    getUsersByIds(admin, userIds),
  ])

  const previousTonnageBySection = previousTonnageFacts.reduce<Record<string, number>>((acc, fact) => {
    acc[fact.section_id] = Number(fact.tonnage || 0)
    return acc
  }, {})

  const machineFactRows = machineFacts.map((fact): ProductionFactMachineFactRow => {
    const section = sectionById.get(fact.section_id) || null
    const parentSection = section ? (section.parent_id ? sectionById.get(section.parent_id) || null : section) : null
    return {
      ...fact,
      machine: machinesById.get(fact.machine_id) || null,
      section,
      parentSection,
      createdByName: userDisplayName(fact.created_by ? usersById.get(fact.created_by) : undefined),
      updatedByName: userDisplayName(fact.updated_by ? usersById.get(fact.updated_by) : undefined),
      canEdit: canEditFactDate(role, fact.fact_date),
    }
  })

  const tonnageFactRows = tonnageFacts.map((fact): ProductionFactTonnageFactRow => {
    const section = sectionById.get(fact.section_id) || null
    const parentSection = section ? (section.parent_id ? sectionById.get(section.parent_id) || null : section) : null
    const previousTonnage = previousTonnageBySection[fact.section_id] || 0
    const tonnage = Number(fact.tonnage || 0)
    return {
      ...fact,
      section,
      parentSection,
      tonnage,
      previousTonnage,
      deltaTonnage: tonnage - previousTonnage,
      createdByName: userDisplayName(fact.created_by ? usersById.get(fact.created_by) : undefined),
      updatedByName: userDisplayName(fact.updated_by ? usersById.get(fact.updated_by) : undefined),
      canEdit: canEditFactDate(role, fact.fact_date),
    }
  })

  const totalTonnage = tonnageFactRows.reduce((sum, fact) => sum + Number(fact.tonnage || 0), 0)
  const previousTotalTonnage = previousTonnageFacts.reduce((sum, fact) => sum + Number(fact.tonnage || 0), 0)

  return {
    factories,
    selectedFactoryId,
    selectedDate,
    sections,
    machineOptions,
    shippingMachinesForDate,
    machineFacts: machineFactRows,
    tonnageFacts: tonnageFactRows,
    previousTonnageBySection,
    canEditSelectedDate: canEditFactDate(role, selectedDate),
    isDirector: isDirector(role),
    stats: {
      machineFactCount: machineFacts.length,
      uniqueMachineCount: new Set(machineFacts.map((fact) => fact.machine_id)).size,
      dayShiftCount: machineFacts.filter((fact) => fact.shift === 'day').length,
      nightShiftCount: machineFacts.filter((fact) => fact.shift === 'night').length,
      totalTonnage,
      previousTotalTonnage,
      tonnageDelta: totalTonnage - previousTotalTonnage,
    },
  }
}

export async function getProductionFactSettingsData(input: {
  factoryId?: string | null
} = {}): Promise<ProductionFactSettingsData> {
  const { admin, role, factoryId: userFactoryId, userId } = await getContext()
  if (!isDirector(role)) throw new Error('Недостаточно прав для настроек факта производства')

  const factories = await getVisibleFactories(admin, role, userFactoryId)
  const selectedFactoryId = factories.some((factory) => factory.id === input.factoryId)
    ? input.factoryId!
    : factories[0]?.id || null

  if (!selectedFactoryId) {
    return { factories, selectedFactoryId: null, sections: [] }
  }

  assertFactoryAccess(role, userFactoryId, selectedFactoryId)
  await ensureStandardProductionFactSections(admin, selectedFactoryId, userId)
  const sections = await getFactorySections(admin, selectedFactoryId)

  return { factories, selectedFactoryId, sections }
}

export async function ensureProductionFactStandardSections(input: {
  factory_id: string
}): Promise<ProductionFactActionResult> {
  try {
    const { admin, role, factoryId: userFactoryId, userId } = await getContext()
    if (!isDirector(role)) throw new Error('Недостаточно прав для настроек факта производства')
    assertFactoryAccess(role, userFactoryId, input.factory_id)
    await ensureStandardProductionFactSections(admin, input.factory_id, userId)
    revalidateProductionFact()
    revalidatePath(ROUTES.ADMIN_PRODUCTION_FACT_SETTINGS)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function createProductionFactSection(input: {
  factory_id: string
  parent_id?: string | null
  name: string
  sort_order?: number | null
  production_stage_type?: Database['public']['Enums']['stage_type'] | null
}): Promise<ProductionFactActionResult<{ id: string }>> {
  try {
    const { admin, role, factoryId: userFactoryId, userId } = await getContext()
    assertFactoryAccess(role, userFactoryId, input.factory_id)
    const name = normalizeText(input.name)
    if (!name) throw new Error('Укажите название участка')

    if (input.parent_id) {
      const { data: parentRaw, error: parentError } = await looseDb(admin)
        .from('production_fact_sections')
        .select('id, factory_id, parent_id, is_active, archived_at')
        .eq('id', input.parent_id)
        .maybeSingle()

      const parent = parentRaw as Pick<ProductionFactSection, 'id' | 'factory_id' | 'parent_id' | 'is_active' | 'archived_at'> | null
      if (parentError || !parent) throw new Error(parentError?.message || 'Участок не найден')
      if (parent.factory_id !== input.factory_id || parent.parent_id) throw new Error('Подучасток можно создать только внутри участка этого завода')
      if (!parent.is_active || parent.archived_at) throw new Error('Нельзя добавить подучасток в архивный участок')
    }

    const { data, error } = await looseDb(admin)
      .from('production_fact_sections')
      .insert({
        factory_id: input.factory_id,
        parent_id: input.parent_id || null,
        name,
        sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 100,
        production_stage_type: normalizeSectionStageType(input.production_stage_type),
        created_by: userId,
        updated_by: userId,
      })
      .select('id')
      .single()

    if (error) throw error
    const inserted = data as { id: string }
    revalidateProductionFact()
    return { success: true, data: { id: inserted.id }, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function updateProductionFactSection(input: {
  id: string
  name: string
  sort_order?: number | null
  production_stage_type?: Database['public']['Enums']['stage_type'] | null
}): Promise<ProductionFactActionResult> {
  try {
    const { admin, role, factoryId: userFactoryId, userId } = await getContext()
    const { data: sectionRaw, error: sectionError } = await looseDb(admin)
      .from('production_fact_sections')
      .select('*')
      .eq('id', input.id)
      .maybeSingle()

    const section = sectionRaw as ProductionFactSection | null
    if (sectionError || !section) throw new Error(sectionError?.message || 'Участок не найден')
    assertFactoryAccess(role, userFactoryId, section.factory_id)

    const name = normalizeText(input.name)
    if (!name) throw new Error('Укажите название участка')
    const productionStageType = Object.prototype.hasOwnProperty.call(input, 'production_stage_type')
      ? normalizeSectionStageType(input.production_stage_type)
      : section.production_stage_type

    const { error } = await looseDb(admin)
      .from('production_fact_sections')
      .update({
        name,
        sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : section.sort_order,
        production_stage_type: productionStageType,
        updated_by: userId,
      })
      .eq('id', input.id)

    if (error) throw error
    revalidateProductionFact()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function archiveProductionFactSection(id: string): Promise<ProductionFactActionResult> {
  try {
    const { admin, role, factoryId: userFactoryId, userId } = await getContext()
    const { data: sectionRaw, error: sectionError } = await looseDb(admin)
      .from('production_fact_sections')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    const section = sectionRaw as ProductionFactSection | null
    if (sectionError || !section) throw new Error(sectionError?.message || 'Участок не найден')
    assertFactoryAccess(role, userFactoryId, section.factory_id)

    const idsToArchive = [section.id]
    if (!section.parent_id) {
      const { data: children, error: childrenError } = await looseDb(admin)
        .from('production_fact_sections')
        .select('id')
        .eq('parent_id', section.id)

      if (childrenError) throw childrenError
      idsToArchive.push(...((children || []) as Array<{ id: string }>).map((child) => child.id))
    }

    const { error } = await looseDb(admin)
      .from('production_fact_sections')
      .update({
        is_active: false,
        archived_at: new Date().toISOString(),
        updated_by: userId,
      })
      .in('id', idsToArchive)

    if (error) throw error
    revalidateProductionFact()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function saveProductionMachineFact(input: {
  id?: string | null
  factory_id: string
  fact_date: string
  machine_id: string
  section_id: string
  shift: ProductionFactShift
  comment?: string | null
}): Promise<ProductionFactActionResult<{ id: string }>> {
  try {
    const { admin, role, factoryId: userFactoryId, userId } = await getContext()
    const factDate = dateOnly(input.fact_date)
    assertFactoryAccess(role, userFactoryId, input.factory_id)
    assertCanEditFactDate(role, factDate)
    if (input.shift !== 'day' && input.shift !== 'night') throw new Error('Некорректная смена')

    let existing: ProductionMachineFact | null = null
    let existingWasCutting = false
    if (input.id) {
      const { data, error } = await looseDb(admin)
        .from('production_machine_facts')
        .select('*')
        .eq('id', input.id)
        .maybeSingle()

      if (error || !data) throw new Error(error?.message || 'Запись факта не найдена')
      existing = data as ProductionMachineFact
      assertFactoryAccess(role, userFactoryId, existing.factory_id)
      assertCanEditFactDate(role, existing.fact_date)
      existingWasCutting = await isCuttingFact(admin, existing)
    }

    await assertFactoryMachine(admin, input.factory_id, input.machine_id)
    await assertActiveFactSection(admin, input.factory_id, input.section_id, {
      allowArchivedSectionId: existing?.section_id === input.section_id ? input.section_id : null,
    })
    const nextSectionContext = await getFactSectionContext(admin, input.section_id)
    const nextIsCutting = isCuttingFactSection(nextSectionContext.section, nextSectionContext.parent)

    const payload = {
      factory_id: input.factory_id,
      fact_date: factDate,
      machine_id: input.machine_id,
      section_id: input.section_id,
      shift: input.shift,
      comment: normalizeNullableText(input.comment),
      updated_by: userId,
    }

    if (existing) {
      const { data, error } = await looseDb(admin)
        .from('production_machine_facts')
        .update(payload)
        .eq('id', existing.id)
        .select('id')
        .single()

      if (error) throw error
      const updated = data as { id: string }
      if (nextIsCutting) await applyCuttingFactSideEffects(admin, updated.id, userId)
      if (existingWasCutting && (!nextIsCutting || existing.machine_id !== input.machine_id)) {
        const hasCuttingFacts = await hasRemainingCuttingFacts(admin, existing.machine_id, existing.id)
        if (!hasCuttingFacts) {
          await ensureCuttingRollbackTask(admin, {
            machineId: existing.machine_id,
            factoryId: existing.factory_id,
            userId,
            reason: 'Факт заготовки перенесен',
          })
        }
      }
      revalidateProductionCuttingFlow(input.machine_id)
      if (existing.machine_id !== input.machine_id) revalidateProductionCuttingFlow(existing.machine_id)
      return { success: true, data: { id: updated.id }, error: null }
    }

    const { data, error } = await looseDb(admin)
      .from('production_machine_facts')
      .insert({ ...payload, created_by: userId })
      .select('id')
      .single()

    if (error) throw error
    const inserted = data as { id: string }
    if (nextIsCutting) await applyCuttingFactSideEffects(admin, inserted.id, userId)
    revalidateProductionCuttingFlow(input.machine_id)
    return { success: true, data: { id: inserted.id }, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function deleteProductionMachineFact(id: string): Promise<ProductionFactActionResult> {
  try {
    const { admin, role, factoryId: userFactoryId, userId } = await getContext()
    const { data: factRaw, error: factError } = await looseDb(admin)
      .from('production_machine_facts')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    const fact = factRaw as ProductionMachineFact | null
    if (factError || !fact) throw new Error(factError?.message || 'Запись факта не найдена')
    assertFactoryAccess(role, userFactoryId, fact.factory_id)
    assertCanEditFactDate(role, fact.fact_date)
    const wasCutting = await isCuttingFact(admin, fact)

    const { error } = await looseDb(admin).from('production_machine_facts').delete().eq('id', id)
    if (error) throw error

    if (wasCutting) {
      const hasCuttingFacts = await hasRemainingCuttingFacts(admin, fact.machine_id)
      if (!hasCuttingFacts) {
        await ensureCuttingRollbackTask(admin, {
          machineId: fact.machine_id,
          factoryId: fact.factory_id,
          userId,
          reason: 'Факт заготовки удален',
        })
      }
    }

    revalidateProductionCuttingFlow(fact.machine_id)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function copyProductionMachineFactsFromPreviousDay(input: {
  factory_id: string
  fact_date: string
}): Promise<ProductionFactActionResult<{ inserted: number; skipped: number }>> {
  try {
    const { admin, role, factoryId: userFactoryId, userId } = await getContext()
    const targetDate = dateOnly(input.fact_date)
    const sourceDate = addDays(targetDate, -1)
    assertFactoryAccess(role, userFactoryId, input.factory_id)
    assertCanEditFactDate(role, targetDate)

    const [sourceFacts, targetFacts, sections] = await Promise.all([
      getMachineFacts(admin, input.factory_id, sourceDate),
      getMachineFacts(admin, input.factory_id, targetDate),
      getFactorySections(admin, input.factory_id),
    ])

    const activeSections = getActiveFactSectionIds(sections)
    const sectionById = new Map(sections.map((section) => [section.id, section]))
    const targetKeys = new Set(targetFacts.map((fact) => `${fact.shift}:${fact.machine_id}:${fact.section_id}`))
    const payload = sourceFacts
      .filter((fact) => activeSections.has(fact.section_id))
      .filter((fact) => !targetKeys.has(`${fact.shift}:${fact.machine_id}:${fact.section_id}`))
      .map((fact) => ({
        factory_id: input.factory_id,
        fact_date: targetDate,
        shift: fact.shift,
        machine_id: fact.machine_id,
        section_id: fact.section_id,
        comment: fact.comment,
        created_by: userId,
        updated_by: userId,
      }))

    if (payload.length === 0) {
      return { success: true, data: { inserted: 0, skipped: sourceFacts.length }, error: null }
    }

    const { data: insertedRaw, error } = await looseDb(admin)
      .from('production_machine_facts')
      .insert(payload)
      .select('id, machine_id, section_id')
    if (error) throw error
    const insertedFacts = (insertedRaw || []) as Array<{ id: string; machine_id: string; section_id: string }>
    for (const fact of insertedFacts) {
      const section = sectionById.get(fact.section_id) || null
      const parent = section?.parent_id ? sectionById.get(section.parent_id) || null : null
      if (isCuttingFactSection(section, parent)) await applyCuttingFactSideEffects(admin, fact.id, userId)
    }
    revalidateProductionCuttingFlow()
    return { success: true, data: { inserted: payload.length, skipped: sourceFacts.length - payload.length }, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function saveProductionTonnageFact(input: {
  id?: string | null
  factory_id: string
  fact_date: string
  section_id: string
  tonnage: number
  comment?: string | null
}): Promise<ProductionFactActionResult<{ id: string }>> {
  try {
    const { admin, role, factoryId: userFactoryId, userId } = await getContext()
    const factDate = dateOnly(input.fact_date)
    const tonnage = Number(input.tonnage)
    if (!Number.isFinite(tonnage) || tonnage < 0) throw new Error('Тоннаж должен быть числом от 0')
    assertFactoryAccess(role, userFactoryId, input.factory_id)
    assertCanEditFactDate(role, factDate)

    let existing: ProductionTonnageFact | null = null
    if (input.id) {
      const { data, error } = await looseDb(admin)
        .from('production_tonnage_facts')
        .select('*')
        .eq('id', input.id)
        .maybeSingle()

      if (error || !data) throw new Error(error?.message || 'Запись тоннажа не найдена')
      existing = data as ProductionTonnageFact
      assertFactoryAccess(role, userFactoryId, existing.factory_id)
      assertCanEditFactDate(role, existing.fact_date)
    } else {
      const { data, error } = await looseDb(admin)
        .from('production_tonnage_facts')
        .select('*')
        .eq('factory_id', input.factory_id)
        .eq('fact_date', factDate)
        .eq('section_id', input.section_id)
        .maybeSingle()

      if (error) throw error
      existing = (data || null) as ProductionTonnageFact | null
    }

    await assertActiveFactSection(admin, input.factory_id, input.section_id, {
      allowArchivedSectionId: existing?.section_id === input.section_id ? input.section_id : null,
    })

    const payload = {
      factory_id: input.factory_id,
      fact_date: factDate,
      section_id: input.section_id,
      tonnage,
      comment: normalizeNullableText(input.comment),
      updated_by: userId,
    }

    if (existing) {
      const { data, error } = await looseDb(admin)
        .from('production_tonnage_facts')
        .update(payload)
        .eq('id', existing.id)
        .select('id')
        .single()

      if (error) throw error
      const updated = data as { id: string }
      revalidateProductionFact()
      return { success: true, data: { id: updated.id }, error: null }
    }

    const { data, error } = await looseDb(admin)
      .from('production_tonnage_facts')
      .insert({ ...payload, created_by: userId })
      .select('id')
      .single()

    if (error) throw error
    const inserted = data as { id: string }
    revalidateProductionFact()
    return { success: true, data: { id: inserted.id }, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function saveUnifiedProductionFact(input: {
  factory_id: string
  fact_date: string
  stage_key: ProductionFactStageKey
  section_id: string
  machine_ids: string[]
  shift: ProductionFactShift
  tonnage?: number | null
  comment?: string | null
}): Promise<ProductionFactActionResult<{ inserted: number; skipped: number; shippingUpdated: number; tonnageSaved: boolean }>> {
  try {
    const { admin, role, factoryId: userFactoryId, userId } = await getContext()
    const factDate = dateOnly(input.fact_date)
    assertFactoryAccess(role, userFactoryId, input.factory_id)
    assertCanEditFactDate(role, factDate)
    if (!isProductionFactStageKey(input.stage_key)) throw new Error('Некорректный этап факта производства')
    if (input.shift !== 'day' && input.shift !== 'night') throw new Error('Некорректная смена')

    const stageDefinition = getProductionFactStageDefinition(input.stage_key)
    const machineIds = Array.from(new Set(input.machine_ids)).filter(Boolean)
    if (machineIds.length === 0) throw new Error('Выберите машины')

    await assertFactoryMachines(admin, input.factory_id, machineIds)

    if (stageDefinition.isShipping) {
      let shippingUpdated = 0
      await runLimited(machineIds, 6, async (machineId) => {
        const result = await updateMachineDate(machineId, 'actual_shipping_date', factDate)
        if (!result.success) throw new Error(result.error || 'Не удалось сохранить факт отгрузки')
        shippingUpdated += 1
      })
      revalidateProductionFact()
      return {
        success: true,
        data: { inserted: 0, skipped: 0, shippingUpdated, tonnageSaved: false },
        error: null,
      }
    }

    await assertActiveFactSection(admin, input.factory_id, input.section_id)
    const sectionContext = await getFactSectionContext(admin, input.section_id)
    const isCuttingSection = isCuttingFactSection(sectionContext.section, sectionContext.parent)

    const { data: existingRaw, error: existingError } = await looseDb(admin)
      .from('production_machine_facts')
      .select('machine_id')
      .eq('factory_id', input.factory_id)
      .eq('fact_date', factDate)
      .eq('shift', input.shift)
      .eq('section_id', input.section_id)
      .in('machine_id', machineIds)

    if (existingError) throw existingError
    const existingMachineIds = new Set(((existingRaw || []) as Array<{ machine_id: string }>).map((fact) => fact.machine_id))
    const missingMachineIds = machineIds.filter((machineId) => !existingMachineIds.has(machineId))
    let inserted = missingMachineIds.length

    if (missingMachineIds.length > 0 && isCuttingSection) {
      await runLimited(missingMachineIds, 4, async (machineId) => {
        const result = await saveProductionMachineFact({
          factory_id: input.factory_id,
          fact_date: factDate,
          machine_id: machineId,
          section_id: input.section_id,
          shift: input.shift,
          comment: input.comment,
        })
        if (!result.success) throw new Error(result.error || 'Не удалось сохранить факт машины')
      })
    } else if (missingMachineIds.length > 0) {
      const machineFactPayload = missingMachineIds.map((machineId) => ({
        factory_id: input.factory_id,
        fact_date: factDate,
        machine_id: machineId,
        section_id: input.section_id,
        shift: input.shift,
        comment: normalizeNullableText(input.comment),
        created_by: userId,
        updated_by: userId,
      }))

      const { data: insertedRaw, error: insertError } = await looseDb(admin)
        .from('production_machine_facts')
        .insert(machineFactPayload)
        .select('id, machine_id')

      if (insertError) throw insertError
      const insertedFacts = (insertedRaw || []) as Array<{ id: string; machine_id: string }>
      inserted = insertedFacts.length
    }

    const tonnage = Number(input.tonnage || 0)
    if (!Number.isFinite(tonnage) || tonnage < 0) throw new Error('Тоннаж должен быть числом от 0')

    const { data: existingTonnageRaw, error: existingTonnageError } = await looseDb(admin)
      .from('production_tonnage_facts')
      .select('id')
      .eq('factory_id', input.factory_id)
      .eq('fact_date', factDate)
      .eq('section_id', input.section_id)
      .maybeSingle()

    if (existingTonnageError) throw existingTonnageError
    const tonnagePayload = {
      factory_id: input.factory_id,
      fact_date: factDate,
      section_id: input.section_id,
      tonnage,
      comment: normalizeNullableText(input.comment),
      updated_by: userId,
    }
    const existingTonnage = existingTonnageRaw as { id: string } | null
    if (existingTonnage) {
      const { error: updateTonnageError } = await looseDb(admin)
        .from('production_tonnage_facts')
        .update(tonnagePayload)
        .eq('id', existingTonnage.id)
      if (updateTonnageError) throw updateTonnageError
    } else {
      const { error: insertTonnageError } = await looseDb(admin)
        .from('production_tonnage_facts')
        .insert({ ...tonnagePayload, created_by: userId })
      if (insertTonnageError) throw insertTonnageError
    }

    revalidateProductionFact()

    return {
      success: true,
      data: {
        inserted,
        skipped: machineIds.length - inserted,
        shippingUpdated: 0,
        tonnageSaved: true,
      },
      error: null,
    }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function deleteProductionTonnageFact(id: string): Promise<ProductionFactActionResult> {
  try {
    const { admin, role, factoryId: userFactoryId } = await getContext()
    const { data: factRaw, error: factError } = await looseDb(admin)
      .from('production_tonnage_facts')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    const fact = factRaw as ProductionTonnageFact | null
    if (factError || !fact) throw new Error(factError?.message || 'Запись тоннажа не найдена')
    assertFactoryAccess(role, userFactoryId, fact.factory_id)
    assertCanEditFactDate(role, fact.fact_date)

    const { error } = await looseDb(admin).from('production_tonnage_facts').delete().eq('id', id)
    if (error) throw error
    revalidateProductionFact()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}
