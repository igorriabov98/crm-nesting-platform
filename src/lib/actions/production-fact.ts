'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import type { PermissionOperation, ResourceKey } from '@/lib/permissions/resources'
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
import {
  productionFactCuttingReadinessError,
  productionFactCuttingReadinessReason,
  type ProductionFactCuttingReadiness,
} from '@/lib/production-fact-cutting-readiness'

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

export type ProductionFactMachineItemOption = {
  id: string
  productName: string
  drawingNumber: string
  coating: Database['public']['Enums']['coating_type']
  orderedQuantity: number
  completedQuantity: number
  remainingQuantity: number
  replacementLimit: number
  currentQuantity: number
  unitWeightKg: number
}

export type ProductionFactMachineItemsData = {
  factId: string | null
  comment: string | null
  items: ProductionFactMachineItemOption[]
  totalWeightKg: number
  legacyManualTonnage: number | null
}

type MachineItemLookupRow = Pick<
  Database['public']['Tables']['machine_items']['Row'],
  'id' | 'product_name' | 'drawing_number' | 'coating' | 'quantity' | 'weight' | 'sort_order'
>
type MachineItemFactLookupRow = Pick<
  Database['public']['Tables']['production_machine_item_facts']['Row'],
  'production_machine_fact_id' | 'machine_item_snapshot_id' | 'quantity'
>

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
  canManage: boolean
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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CHISINAU_TIME_ZONE = 'Europe/Chisinau'
const CUTTING_STAGE_TYPE = 'cutting' as const

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

function assertFactoryAccess(role: UserRole, userFactoryId: string | null, factoryId: string) {
  if (isDirector(role)) return
  if (userFactoryId === factoryId) return
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

function validatedDateOnly(value: string) {
  if (!DATE_RE.test(value)) throw new Error('Некорректная дата факта')
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Некорректная дата факта')
  }
  return value
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

async function getContext(
  resourceKey: Extract<ResourceKey, 'production_fact' | 'production_fact_settings'>,
  operation: PermissionOperation,
) {
  const context = await requirePermission(resourceKey, operation)
  return {
    ...context,
    admin: createAdminClient() as AdminClient,
  }
}

async function getVisibleFactories(admin: AdminClient, role: UserRole, userFactoryId: string | null) {
  let query = admin.from('factories').select('id, name').order('name')
  if (!isDirector(role) && userFactoryId) {
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

function hasStandardProductionFactSections(sections: ProductionFactSection[]) {
  const activeSections = sections.filter((section) => section.is_active && !section.archived_at)

  return PRODUCTION_FACT_STANDARD_STAGES.every((stage) => {
    const parent = activeSections.find((section) => (
      !section.parent_id
      && section.name === stage.label
      && section.production_stage_type === stage.productionStageType
    ))
    if (!parent) return false

    return stage.children.every((child) => activeSections.some((section) => (
      section.parent_id === parent.id
      && section.name === child.label
      && section.production_stage_type === stage.productionStageType
    )))
  })
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
  return value === 'cutting'
    || value === 'assembly'
    || value === 'cleaning'
    || value === 'painting'
    || value === 'packaging'
    || value === 'actual_shipping'
    ? value
    : null
}

function isCuttingFactSection(
  section: Pick<ProductionFactSection, 'production_stage_type'> | null | undefined,
  parent?: Pick<ProductionFactSection, 'production_stage_type'> | null,
) {
  return section?.production_stage_type === CUTTING_STAGE_TYPE || parent?.production_stage_type === CUTTING_STAGE_TYPE
}

function sectionStageType(
  section: Pick<ProductionFactSection, 'production_stage_type'>,
  parent: Pick<ProductionFactSection, 'production_stage_type'> | null,
) {
  return section.production_stage_type || parent?.production_stage_type || null
}

function isItemizedProductionFactStage(key: ProductionFactStageKey) {
  return key === 'assembly' || key === 'cleaning' || key === 'painting' || key === 'packaging'
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
      .select('*')
      .eq('id', section.parent_id)
      .maybeSingle()

    const parent = parentRaw as ProductionFactSection | null
    if (parentError || !parent) throw new Error(parentError?.message || 'Родительский участок не найден')
    if (!isExistingSection && (!parent.is_active || parent.archived_at)) {
      throw new Error('Архивный участок нельзя выбрать для новой записи')
    }

    return { section, parent }
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

  return { section, parent: null }
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
  await loadFactoryMachines(admin, factoryId, machineIds)
}

async function loadFactoryMachines(admin: AdminClient, factoryId: string, machineIds: string[]) {
  if (machineIds.length === 0) return
  const { data, error } = await looseDb(admin)
    .from('machines')
    .select('id, name, factory_id, is_archived, production_queue_number')
    .in('id', machineIds)

  if (error) throw error
  const rows = (data || []) as Array<{
    id: string
    name: string
    factory_id: string | null
    is_archived: boolean
    production_queue_number: number | null
  }>
  const byId = new Map(rows.map((machine) => [machine.id, machine]))
  for (const machineId of machineIds) {
    const machine = byId.get(machineId)
    if (!machine) throw new Error('Машина не найдена')
    if (machine.factory_id !== factoryId) throw new Error('Машина относится к другому заводу')
  }
  return machineIds.map((machineId) => byId.get(machineId)!)
}

async function loadProductionFactCuttingReadiness(
  admin: AdminClient,
  factoryId: string,
  machineIds: string[],
): Promise<ProductionFactCuttingReadiness[]> {
  const uniqueMachineIds = Array.from(new Set(machineIds)).filter(Boolean)
  const machines = await loadFactoryMachines(admin, factoryId, uniqueMachineIds) || []
  return Promise.all(machines.map(async (machine) => {
    const { error } = await (admin as unknown as RpcClient).rpc(
      'fn_assert_long_stock_cutting_ready',
      { p_machine_id: machine.id },
    )
    const message = error ? getErrorMessage(error) : null
    const blocker = message
      ? await loadProductionFactCuttingBlocker(admin, machine.id, message)
      : null
    return {
      machineId: machine.id,
      machineName: machine.production_queue_number
        ? `${machine.production_queue_number}. ${machine.name}`
        : machine.name,
      ready: !error,
      reason: message
        ? `${productionFactCuttingReadinessReason(message)}${blocker ? ` (${blocker.requestLabel})` : ''}`
        : null,
      actionHref: blocker?.href ?? null,
      actionLabel: blocker ? `Открыть ${blocker.requestLabel.toLocaleLowerCase('ru-RU')}` : null,
    }
  }))
}

async function loadProductionFactCuttingBlocker(
  admin: AdminClient,
  machineId: string,
  message: string,
) {
  const requestsResult = await looseDb(admin)
    .from('technologist_requests')
    .select('id, created_at')
    .eq('machine_id', machineId)
    .order('created_at', { ascending: true })
  if (requestsResult.error) throw requestsResult.error
  const requests = (requestsResult.data || []) as Array<{ id: string; created_at: string }>
  if (requests.length === 0) return null

  const itemsResult = await looseDb(admin)
    .from('long_stock_cutting_plan_items')
    .select('request_id, request_item_table, request_item_id, cutting_status, linked_at')
    .in('request_id', requests.map((request) => request.id))
    .order('linked_at', { ascending: false })
  if (itemsResult.error) throw itemsResult.error
  const items = (itemsResult.data || []) as Array<{
    request_id: string
    request_item_table: string
    request_item_id: string
    cutting_status: string
    linked_at: string
  }>
  const requiresRecalculation = message.toLocaleLowerCase('ru-RU').includes('требует пересч')
  const candidates = items.filter((item) => requiresRecalculation
    ? item.cutting_status === 'requires_recalculation'
    : item.cutting_status === 'planning')

  for (const item of candidates) {
    if (!['request_circle', 'request_pipe', 'request_knives'].includes(item.request_item_table)) continue
    const requestItemResult = await looseDb(admin)
      .from(item.request_item_table)
      .select('id')
      .eq('id', item.request_item_id)
      .maybeSingle()
    if (requestItemResult.error) throw requestItemResult.error
    if (!requestItemResult.data) continue
    const requestIndex = requests.findIndex((request) => request.id === item.request_id)
    const requestLabel = requestIndex >= 0 ? `Заявка №${requestIndex + 1}` : 'заявка с картой'
    return {
      requestLabel,
      href: `${ROUTES.SALES_PLAN}/${machineId}/request/${item.request_id}#request-item-${item.request_item_id}`,
    }
  }
  return null
}

async function assertProductionFactCuttingReady(
  admin: AdminClient,
  factoryId: string,
  machineIds: string[],
) {
  const readiness = await loadProductionFactCuttingReadiness(admin, factoryId, machineIds)
  const error = productionFactCuttingReadinessError(readiness)
  if (error) throw new Error(error)
}

async function assertInventoryTransfersReceived(admin: AdminClient, machineIds: string[]) {
  const uniqueMachineIds = Array.from(new Set(machineIds)).filter(Boolean)
  if (uniqueMachineIds.length === 0) return

  const { data: transfersRaw, error: transfersError } = await looseDb(admin)
    .from('inventory_transfers')
    .select('id')
    .in('machine_id', uniqueMachineIds)
    .in('status', ['needs_date', 'scheduled', 'partially_received'])

  if (transfersError) throw transfersError
  const transferIds = ((transfersRaw || []) as Array<{ id: string }>).map((transfer) => transfer.id)
  if (transferIds.length === 0) return

  const { data: itemsRaw, error: itemsError } = await looseDb(admin)
    .from('inventory_transfer_items')
    .select('requested_quantity, received_quantity')
    .in('transfer_id', transferIds)

  if (itemsError) throw itemsError
  const hasPendingItems = ((itemsRaw || []) as Array<{
    requested_quantity: number
    received_quantity: number
  }>).some((item) => Number(item.received_quantity) < Number(item.requested_quantity))

  if (hasPendingItems) {
    throw new Error('Нельзя зафиксировать заготовку: не весь межзаводской материал принят на склад назначения')
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

type AtomicMachineFactPayload = {
  factory_id: string
  fact_date: string
  machine_id: string
  section_id: string
  shift: ProductionFactShift
  comment: string | null
}

async function saveMachineFactAtomic(
  admin: AdminClient,
  payload: AtomicMachineFactPayload,
  factId: string | null,
  userId: string,
) {
  const { data, error } = await (admin as unknown as RpcClient).rpc(
    'fn_save_production_machine_fact_atomic_v1',
    {
      p_fact_id: factId,
      p_factory_id: payload.factory_id,
      p_fact_date: payload.fact_date,
      p_machine_id: payload.machine_id,
      p_section_id: payload.section_id,
      p_shift: payload.shift,
      p_comment: payload.comment,
      p_actor: userId,
    },
  )

  if (error) throw new Error(error.message || 'Не удалось атомарно сохранить факт заготовки')
  if (typeof data !== 'string') throw new Error('Сервер не вернул идентификатор сохранённого факта')
  return data
}

async function saveMachineFactsAtomic(
  admin: AdminClient,
  payload: AtomicMachineFactPayload[],
  userId: string,
) {
  const { data, error } = await (admin as unknown as RpcClient).rpc(
    'fn_save_production_machine_facts_atomic_v1',
    {
      p_facts: payload,
      p_actor: userId,
    },
  )

  if (error) throw new Error(error.message || 'Не удалось атомарно сохранить факты заготовки')
  const result = data as { inserted?: unknown; skipped?: unknown } | null
  const inserted = Number(result?.inserted)
  const skipped = Number(result?.skipped)
  if (!Number.isInteger(inserted) || inserted < 0 || !Number.isInteger(skipped) || skipped < 0) {
    throw new Error('Сервер вернул некорректный результат сохранения фактов')
  }
  return { inserted, skipped }
}

export async function getProductionFactCuttingReadiness(input: {
  factory_id: string
  machine_ids: string[]
}): Promise<ProductionFactActionResult<{ machines: ProductionFactCuttingReadiness[] }>> {
  try {
    const { admin, role, factoryId: userFactoryId } = await getContext('production_fact', 'view')
    assertFactoryAccess(role, userFactoryId, input.factory_id)
    const machines = await loadProductionFactCuttingReadiness(
      admin,
      input.factory_id,
      Array.from(new Set(input.machine_ids)).filter(Boolean),
    )
    return { success: true, data: { machines }, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function getProductionFactWorkspaceData(input: {
  factoryId?: string | null
  date?: string | null
} = {}): Promise<ProductionFactWorkspaceData> {
  const { admin, role, factoryId: userFactoryId, userId, permissions } = await getContext('production_fact', 'view')
  const canManage = Boolean(permissions.production_fact?.canManage)
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
      canManage,
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
  const previousDate = addDays(selectedDate, -1)
  const [
    initialSections,
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

  let sections = initialSections
  if (canManage && !hasStandardProductionFactSections(sections)) {
    await ensureStandardProductionFactSections(admin, selectedFactoryId, userId)
    sections = await getFactorySections(admin, selectedFactoryId)
  }

  const sectionById = new Map(sections.map((section) => [section.id, section]))
  const machinesById = new Map<string, ProductionFactMachineOption>([
    ...machineOptions,
    ...shippingMachinesForDate,
  ].map((machine) => [machine.id, machine]))
  const missingMachineIds = Array.from(new Set(
    machineFacts
      .map((fact) => fact.machine_id)
      .filter((machineId) => !machinesById.has(machineId)),
  ))
  const userIds = Array.from(new Set([
    ...machineFacts.flatMap((fact) => [fact.created_by, fact.updated_by]),
    ...tonnageFacts.flatMap((fact) => [fact.created_by, fact.updated_by]),
  ].filter(Boolean))) as string[]

  const [missingMachinesById, usersById] = await Promise.all([
    getMachinesByIds(admin, missingMachineIds),
    getUsersByIds(admin, userIds),
  ])
  for (const [machineId, machine] of missingMachinesById) machinesById.set(machineId, machine)

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
      canEdit: canManage && canEditFactDate(role, fact.fact_date),
    }
  })

  const nonCuttingTonnageFacts = tonnageFacts.filter((fact) => {
    const section = sectionById.get(fact.section_id) || null
    const parent = section?.parent_id ? sectionById.get(section.parent_id) || null : null
    return !isCuttingFactSection(section, parent)
  })
  const nonCuttingPreviousTonnageFacts = previousTonnageFacts.filter((fact) => {
    const section = sectionById.get(fact.section_id) || null
    const parent = section?.parent_id ? sectionById.get(section.parent_id) || null : null
    return !isCuttingFactSection(section, parent)
  })
  const visiblePreviousTonnageBySection = nonCuttingPreviousTonnageFacts.reduce<Record<string, number>>((acc, fact) => {
    acc[fact.section_id] = Number(fact.tonnage || 0)
    return acc
  }, {})

  const tonnageFactRows = nonCuttingTonnageFacts.map((fact): ProductionFactTonnageFactRow => {
    const section = sectionById.get(fact.section_id) || null
    const parentSection = section ? (section.parent_id ? sectionById.get(section.parent_id) || null : section) : null
    const previousTonnage = visiblePreviousTonnageBySection[fact.section_id] || 0
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
      canEdit: canManage && canEditFactDate(role, fact.fact_date),
    }
  })

  const totalTonnage = tonnageFactRows.reduce((sum, fact) => sum + Number(fact.tonnage || 0), 0)
  const previousTotalTonnage = nonCuttingPreviousTonnageFacts.reduce((sum, fact) => sum + Number(fact.tonnage || 0), 0)

  return {
    factories,
    selectedFactoryId,
    selectedDate,
    sections,
    machineOptions,
    shippingMachinesForDate,
    machineFacts: machineFactRows,
    tonnageFacts: tonnageFactRows,
    previousTonnageBySection: visiblePreviousTonnageBySection,
    canEditSelectedDate: canManage && canEditFactDate(role, selectedDate),
    canManage,
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

export async function getProductionFactMachineItems(input: {
  factory_id: string
  fact_date: string
  stage_key: ProductionFactStageKey
  section_id: string
  machine_id: string
  shift: ProductionFactShift
}): Promise<ProductionFactActionResult<ProductionFactMachineItemsData>> {
  try {
    const { admin, role, factoryId: userFactoryId } = await getContext('production_fact', 'view')
    const factDate = validatedDateOnly(input.fact_date)
    assertFactoryAccess(role, userFactoryId, input.factory_id)
    if (!isItemizedProductionFactStage(input.stage_key)) {
      throw new Error('Этап не поддерживает ввод по номенклатуре')
    }
    if (input.shift !== 'day' && input.shift !== 'night') throw new Error('Некорректная смена')

    const [, context] = await Promise.all([
      assertFactoryMachine(admin, input.factory_id, input.machine_id),
      assertActiveFactSection(admin, input.factory_id, input.section_id),
    ])
    const expectedStageType = getProductionFactStageDefinition(input.stage_key).productionStageType
    if (!expectedStageType || sectionStageType(context.section, context.parent) !== expectedStageType) {
      throw new Error('Выбранный участок не соответствует этапу')
    }

    let itemsQuery = admin
      .from('machine_items')
      .select('id, product_name, drawing_number, coating, quantity, weight, sort_order')
      .eq('machine_id', input.machine_id)
      .order('sort_order', { ascending: true })
    if (input.stage_key === 'painting') itemsQuery = itemsQuery.eq('coating', 'powder_coating')

    const [itemsResult, headerResult, aggregateResult] = await Promise.all([
      itemsQuery,
      admin.from('production_machine_facts')
        .select('id, comment')
        .eq('factory_id', input.factory_id)
        .eq('fact_date', factDate)
        .eq('shift', input.shift)
        .eq('machine_id', input.machine_id)
        .eq('section_id', input.section_id)
        .maybeSingle(),
      admin.from('production_tonnage_facts')
        .select('tonnage, source')
        .eq('factory_id', input.factory_id)
        .eq('fact_date', factDate)
        .eq('section_id', input.section_id)
        .maybeSingle(),
    ])
    if (itemsResult.error) throw itemsResult.error
    if (headerResult.error) throw headerResult.error
    if (aggregateResult.error) throw aggregateResult.error

    const itemRows = (itemsResult.data || []) as unknown as MachineItemLookupRow[]
    const itemIds = itemRows.map((item) => item.id)
    const itemFactsResult = itemIds.length > 0
      ? await admin.from('production_machine_item_facts')
        .select('production_machine_fact_id, machine_item_snapshot_id, quantity')
        .eq('stage_type', expectedStageType)
        .in('machine_item_snapshot_id', itemIds)
      : { data: [], error: null }
    if (itemFactsResult.error) throw itemFactsResult.error

    const currentHeader = headerResult.data as unknown as { id: string; comment: string | null } | null
    const currentFactId = currentHeader?.id || null
    const completedByItem = new Map<string, number>()
    const currentByItem = new Map<string, number>()
    for (const fact of (itemFactsResult.data || []) as unknown as MachineItemFactLookupRow[]) {
      const quantity = Number(fact.quantity || 0)
      completedByItem.set(
        fact.machine_item_snapshot_id,
        (completedByItem.get(fact.machine_item_snapshot_id) || 0) + quantity,
      )
      if (currentFactId && fact.production_machine_fact_id === currentFactId) {
        currentByItem.set(fact.machine_item_snapshot_id, quantity)
      }
    }

    const items = itemRows.map((item): ProductionFactMachineItemOption => {
      const orderedQuantity = Number(item.quantity || 0)
      const completedQuantity = completedByItem.get(item.id) || 0
      const currentQuantity = currentByItem.get(item.id) || 0
      return {
        id: item.id,
        productName: item.product_name,
        drawingNumber: item.drawing_number,
        coating: item.coating,
        orderedQuantity,
        completedQuantity,
        remainingQuantity: Math.max(0, orderedQuantity - completedQuantity),
        replacementLimit: Math.max(0, orderedQuantity - completedQuantity + currentQuantity),
        currentQuantity,
        unitWeightKg: Number(item.weight || 0),
      }
    })
    const totalWeightKg = items.reduce(
      (total, item) => total + item.currentQuantity * item.unitWeightKg,
      0,
    )
    const aggregate = aggregateResult.data as { tonnage: number; source: 'legacy_manual' | 'itemized' } | null

    return {
      success: true,
      data: {
        factId: currentFactId,
        comment: currentHeader?.comment || null,
        items,
        totalWeightKg,
        legacyManualTonnage: aggregate?.source === 'legacy_manual' ? Number(aggregate.tonnage || 0) : null,
      },
      error: null,
    }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function saveProductionMachineItemFact(input: {
  factory_id: string
  fact_date: string
  stage_key: ProductionFactStageKey
  section_id: string
  machine_id: string
  shift: ProductionFactShift
  lines: Array<{ machine_item_id: string; quantity: number }>
  comment?: string | null
}): Promise<ProductionFactActionResult<{ factId: string; lineCount: number; tonnage: number }>> {
  try {
    const { admin, role, factoryId: userFactoryId, userId } = await getContext('production_fact', 'manage')
    const factDate = validatedDateOnly(input.fact_date)
    assertFactoryAccess(role, userFactoryId, input.factory_id)
    assertCanEditFactDate(role, factDate)
    if (!isItemizedProductionFactStage(input.stage_key)) {
      throw new Error('Этап не поддерживает ввод по номенклатуре')
    }
    if (input.shift !== 'day' && input.shift !== 'night') throw new Error('Некорректная смена')
    if (!userId) throw new Error('Пользователь не найден')

    const stageType = getProductionFactStageDefinition(input.stage_key).productionStageType
    if (!stageType) throw new Error('Для этапа не настроен тип производства')
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new Error('Укажите изготовленное количество')
    }
    const lines = input.lines.map((line) => ({
      machine_item_id: String(line.machine_item_id || '').trim(),
      quantity: Number(line.quantity),
    }))
    if (lines.some((line) => !line.machine_item_id || !Number.isSafeInteger(line.quantity) || line.quantity <= 0)) {
      throw new Error('Количество по каждой позиции должно быть целым числом больше нуля')
    }
    if (new Set(lines.map((line) => line.machine_item_id)).size !== lines.length) {
      throw new Error('Одна позиция не может быть указана дважды')
    }
    if (lines.length === 0) throw new Error('Укажите изготовленное количество')

    const { data, error } = await (admin as unknown as RpcClient).rpc(
      'fn_save_production_machine_item_fact_v1',
      {
        p_factory_id: input.factory_id,
        p_fact_date: factDate,
        p_shift: input.shift,
        p_machine_id: input.machine_id,
        p_section_id: input.section_id,
        p_stage_type: stageType,
        p_lines: lines,
        p_comment: normalizeNullableText(input.comment),
        p_actor: userId,
      },
    )
    if (error) throw new Error(error.message || 'Не удалось сохранить факт по номенклатуре')
    const result = data as { fact_id?: unknown; line_count?: unknown; tonnage?: unknown } | null
    const factId = typeof result?.fact_id === 'string' ? result.fact_id : ''
    const lineCount = Number(result?.line_count)
    const tonnage = Number(result?.tonnage)
    if (!factId || !Number.isInteger(lineCount) || lineCount <= 0 || !Number.isFinite(tonnage)) {
      throw new Error('Сервер вернул некорректный результат сохранения факта')
    }

    revalidateProductionFact()
    revalidatePath(ROUTES.DASHBOARD)
    revalidatePath('/reports/production')
    return { success: true, data: { factId, lineCount, tonnage }, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function getProductionFactSettingsData(input: {
  factoryId?: string | null
} = {}): Promise<ProductionFactSettingsData> {
  const { admin, role, factoryId: userFactoryId } = await getContext('production_fact_settings', 'view')

  const factories = await getVisibleFactories(admin, role, userFactoryId)
  const selectedFactoryId = factories.some((factory) => factory.id === input.factoryId)
    ? input.factoryId!
    : factories[0]?.id || null

  if (!selectedFactoryId) {
    return { factories, selectedFactoryId: null, sections: [] }
  }

  assertFactoryAccess(role, userFactoryId, selectedFactoryId)
  const sections = await getFactorySections(admin, selectedFactoryId)

  return { factories, selectedFactoryId, sections }
}

export async function ensureProductionFactStandardSections(input: {
  factory_id: string
}): Promise<ProductionFactActionResult> {
  try {
    const { admin, role, factoryId: userFactoryId, userId } = await getContext('production_fact_settings', 'manage')
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
    const { admin, role, factoryId: userFactoryId, userId } = await getContext('production_fact_settings', 'manage')
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
    const { admin, role, factoryId: userFactoryId, userId } = await getContext('production_fact_settings', 'manage')
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
    const { admin, role, factoryId: userFactoryId, userId } = await getContext('production_fact_settings', 'manage')
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
    const { admin, role, factoryId: userFactoryId, userId } = await getContext('production_fact', 'manage')
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

    const [, nextSectionContext] = await Promise.all([
      assertFactoryMachine(admin, input.factory_id, input.machine_id),
      assertActiveFactSection(admin, input.factory_id, input.section_id, {
        allowArchivedSectionId: existing?.section_id === input.section_id ? input.section_id : null,
      }),
    ])
    const nextIsCutting = isCuttingFactSection(nextSectionContext.section, nextSectionContext.parent)
    if (!nextIsCutting) {
      throw new Error('Для этого этапа используйте точный ввод по номенклатуре')
    }
    if (nextIsCutting) {
      await assertInventoryTransfersReceived(admin, [input.machine_id])
      await assertProductionFactCuttingReady(admin, input.factory_id, [input.machine_id])
    }

    if (existingWasCutting && existing
      && (existing.machine_id !== input.machine_id || existing.section_id !== input.section_id)) {
      throw new Error(
        'Проведённый факт заготовки нельзя перенести на другую машину или участок; сначала выполните откат',
      )
    }

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
      const updatedId = await saveMachineFactAtomic(admin, payload, existing.id, userId)
      revalidateProductionCuttingFlow(input.machine_id)
      if (existing.machine_id !== input.machine_id) revalidateProductionCuttingFlow(existing.machine_id)
      return { success: true, data: { id: updatedId }, error: null }
    }

    const insertedId = await saveMachineFactAtomic(admin, payload, null, userId)
    revalidateProductionCuttingFlow(input.machine_id)
    return { success: true, data: { id: insertedId }, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function deleteProductionMachineFact(id: string): Promise<ProductionFactActionResult> {
  try {
    const { admin, role, factoryId: userFactoryId, userId } = await getContext('production_fact', 'manage')
    const { data: factRaw, error: factError } = await looseDb(admin)
      .from('production_machine_facts')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    const fact = factRaw as ProductionMachineFact | null
    if (factError || !fact) throw new Error(factError?.message || 'Запись факта не найдена')
    assertFactoryAccess(role, userFactoryId, fact.factory_id)
    assertCanEditFactDate(role, fact.fact_date)
    const { data: itemizedRaw, error: itemizedError } = await looseDb(admin)
      .from('production_machine_item_facts')
      .select('id')
      .eq('production_machine_fact_id', id)
      .limit(1)
    if (itemizedError) throw itemizedError
    if (((itemizedRaw || []) as Array<{ id: string }>).length > 0) {
      const { error } = await (admin as unknown as RpcClient).rpc(
        'fn_delete_production_machine_item_fact_v1',
        { p_fact_id: id, p_actor: userId },
      )
      if (error) throw new Error(error.message || 'Не удалось удалить детализированный факт')
      revalidateProductionFact()
      revalidatePath(ROUTES.DASHBOARD)
      revalidatePath('/reports/production')
      return { success: true, error: null }
    }
    const { data, error } = await (admin as unknown as RpcClient).rpc(
      'fn_delete_production_machine_fact_atomic_v1',
      { p_fact_id: id, p_actor: userId },
    )
    if (error) throw new Error(error.message || 'Не удалось атомарно удалить факт заготовки')
    const result = data as { assigned_to?: string | null } | null
    if (result?.assigned_to) {
      after(async () => {
        try {
          await dispatchPendingTelegramDeliveries({ userId: result.assigned_to! })
        } catch {
          // CRM notification is already persisted; Telegram retries on the next delivery run.
        }
      })
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
    const { admin, role, factoryId: userFactoryId, userId } = await getContext('production_fact', 'manage')
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

    const cuttingMachineIds = payload
      .filter((fact) => {
        const section = sectionById.get(fact.section_id) || null
        const parent = section?.parent_id ? sectionById.get(section.parent_id) || null : null
        return isCuttingFactSection(section, parent)
      })
      .map((fact) => fact.machine_id)
    await assertInventoryTransfersReceived(admin, cuttingMachineIds)
    await assertProductionFactCuttingReady(admin, input.factory_id, cuttingMachineIds)

    const atomicResult = await saveMachineFactsAtomic(admin, payload, userId)
    revalidateProductionCuttingFlow()
    return {
      success: true,
      data: {
        inserted: atomicResult.inserted,
        skipped: sourceFacts.length - atomicResult.inserted,
      },
      error: null,
    }
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
    const { admin, role, factoryId: userFactoryId, userId } = await getContext('production_fact', 'manage')
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

    if (existing?.source === 'itemized') {
      throw new Error('Автоматический тоннаж изменяется только через факт по номенклатуре')
    }

    await assertActiveFactSection(admin, input.factory_id, input.section_id, {
      allowArchivedSectionId: existing?.section_id === input.section_id ? input.section_id : null,
    })

    const payload = {
      factory_id: input.factory_id,
      fact_date: factDate,
      section_id: input.section_id,
      tonnage,
      source: 'legacy_manual' as const,
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
    const { admin, role, factoryId: userFactoryId, userId } = await getContext('production_fact', 'manage')
    const factDate = dateOnly(input.fact_date)
    assertFactoryAccess(role, userFactoryId, input.factory_id)
    assertCanEditFactDate(role, factDate)
    if (!isProductionFactStageKey(input.stage_key)) throw new Error('Некорректный этап факта производства')
    if (input.shift !== 'day' && input.shift !== 'night') throw new Error('Некорректная смена')

    if (isItemizedProductionFactStage(input.stage_key)) {
      throw new Error('Для этого этапа используйте точный ввод по номенклатуре')
    }

    const stageDefinition = getProductionFactStageDefinition(input.stage_key)
    const machineIds = Array.from(new Set(input.machine_ids)).filter(Boolean)
    if (machineIds.length === 0) throw new Error('Выберите машины')

    if (stageDefinition.isShipping) {
      await assertFactoryMachines(admin, input.factory_id, machineIds)
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

    const [, sectionContext] = await Promise.all([
      assertFactoryMachines(admin, input.factory_id, machineIds),
      assertActiveFactSection(admin, input.factory_id, input.section_id),
    ])
    const isCuttingSection = isCuttingFactSection(sectionContext.section, sectionContext.parent)
    if (isCuttingSection) {
      await assertInventoryTransfersReceived(admin, machineIds)
      await assertProductionFactCuttingReady(admin, input.factory_id, machineIds)
    }

    const { data: existingRaw, error: existingError } = await looseDb(admin)
      .from('production_machine_facts')
      .select('id, machine_id')
      .eq('factory_id', input.factory_id)
      .eq('fact_date', factDate)
      .eq('shift', input.shift)
      .eq('section_id', input.section_id)
      .in('machine_id', machineIds)

    if (existingError) throw existingError
    const existingFacts = (existingRaw || []) as Array<{ id: string; machine_id: string }>
    const existingMachineIds = new Set(existingFacts.map((fact) => fact.machine_id))
    const missingMachineIds = machineIds.filter((machineId) => !existingMachineIds.has(machineId))
    let inserted = 0

    if (missingMachineIds.length > 0) {
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

      if (!isCuttingSection) {
        const { data: insertedRaw, error: insertError } = await looseDb(admin)
          .from('production_machine_facts')
          .insert(machineFactPayload)
          .select('id, machine_id')

        if (insertError) throw insertError
        inserted = ((insertedRaw || []) as Array<{ id: string; machine_id: string }>).length
      }
    }

    if (isCuttingSection) {
      const machineFactPayload = machineIds.map((machineId) => ({
        factory_id: input.factory_id,
        fact_date: factDate,
        machine_id: machineId,
        section_id: input.section_id,
        shift: input.shift,
        comment: normalizeNullableText(input.comment),
      }))
      const atomicResult = await saveMachineFactsAtomic(admin, machineFactPayload, userId)
      inserted = atomicResult.inserted

      revalidateProductionCuttingFlow()
      for (const machineId of machineIds) {
        revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
      }

      return {
        success: true,
        data: {
          inserted,
          skipped: machineIds.length - inserted,
          shippingUpdated: 0,
          tonnageSaved: false,
        },
        error: null,
      }
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
    const { admin, role, factoryId: userFactoryId } = await getContext('production_fact', 'manage')
    const { data: factRaw, error: factError } = await looseDb(admin)
      .from('production_tonnage_facts')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    const fact = factRaw as ProductionTonnageFact | null
    if (factError || !fact) throw new Error(factError?.message || 'Запись тоннажа не найдена')
    assertFactoryAccess(role, userFactoryId, fact.factory_id)
    assertCanEditFactDate(role, fact.fact_date)
    if (fact.source === 'itemized') {
      throw new Error('Автоматический тоннаж удаляется вместе с детализированным фактом')
    }

    const { error } = await looseDb(admin).from('production_tonnage_facts').delete().eq('id', id)
    if (error) throw error
    revalidateProductionFact()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}
