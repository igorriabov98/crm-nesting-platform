import 'server-only'

import { loadMachineProgressContexts, resolveMachineProgressWithContext } from '@/lib/actions/machine-progress'
import {
  calculateMyOrderProductionProgress,
  isUndeliveredOrderVisibleForCompanyScope,
  isQuantitativeStage,
  mergePersonalOrderIds,
  type MyOrderProgressFact,
  type MyOrderProductionProgress,
} from '@/lib/my-orders-core'
import { hasPermission } from '@/lib/permissions/resources'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MachineProgress } from '@/lib/types'
import type { Database } from '@/lib/types/database'

const PAGE_SIZE = 500
const ID_CHUNK_SIZE = 100
const PROGRESS_CHUNK_SIZE = 40

type StageType = Database['public']['Enums']['stage_type']
type CoatingType = Database['public']['Enums']['coating_type']
type QueryError = { message?: string } | null
type IdRow = { id: string }
type ClientRow = { id: string; name: string }
type ItemRow = {
  id: string
  quantity: number
  weight: number
  coating: CoatingType
  is_sample: boolean
}
type StageRow = {
  id: string
  stage_type: StageType
  date_start: string | null
  date_end: string | null
  is_skipped: boolean
}
type MachineRow = {
  id: string
  name: string
  created_by: string
  client_id: string | null
  is_confirmed: boolean
  desired_shipping_date: string | null
  actual_shipping_date: string | null
  delivery_to_client_date: string | null
  is_archived: boolean
  created_at: string
  client: ClientRow | ClientRow[] | null
  machine_items: ItemRow[] | null
  production_stages: StageRow[] | null
}
type FactHeaderRow = {
  id: string
  machine_id: string
  section_id: string
}
type ItemFactRow = {
  production_machine_fact_id: string
  machine_item_snapshot_id: string
  stage_type: StageType
  ordered_quantity: number
  unit_weight_kg: number
  coating: CoatingType
  total_weight_kg: number
}
type SectionRow = {
  id: string
  parent_id: string | null
  production_stage_type: StageType | null
}

export type MyOrderSummary = {
  id: string
  name: string
  clientName: string | null
  desiredShippingDate: string | null
  status: MachineProgress
  productionProgress: MyOrderProductionProgress
  canOpenDetails: boolean
}

type PageResult<T> = { data: T[]; error: QueryError }

function chunks<T>(values: readonly T[], size = ID_CHUNK_SIZE) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] || null : value || null
}

async function loadAllPages<T>(
  loader: (from: number, to: number) => Promise<PageResult<T>>,
  errorMessage: string,
) {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await loader(offset, offset + PAGE_SIZE - 1)
    if (result.error) throw new Error(result.error.message || errorMessage)
    rows.push(...result.data)
    if (result.data.length < PAGE_SIZE) break
  }
  return rows
}

async function loadCreatedMachineIds(admin: ReturnType<typeof createAdminClient>, userId: string) {
  return loadAllPages<IdRow>(async (from, to) => {
    const result = await admin.from('machines')
      .select('id')
      .eq('created_by', userId)
      .eq('is_archived', false)
      .is('delivery_to_client_date', null)
      .order('id')
      .range(from, to)
    return { data: (result.data || []) as IdRow[], error: result.error }
  }, 'Не удалось загрузить созданные заказы')
}

async function loadAllUndeliveredMachineIds(admin: ReturnType<typeof createAdminClient>) {
  return loadAllPages<IdRow>(async (from, to) => {
    const result = await admin.from('machines')
      .select('id')
      .eq('is_archived', false)
      .is('delivery_to_client_date', null)
      .order('id')
      .range(from, to)
    return { data: (result.data || []) as IdRow[], error: result.error }
  }, 'Не удалось загрузить заказы без даты получения')
}

async function loadResponsibleClients(admin: ReturnType<typeof createAdminClient>, userId: string) {
  return loadAllPages<ClientRow>(async (from, to) => {
    const result = await admin.from('clients')
      .select('id, name')
      .eq('responsible_user_id', userId)
      .order('id')
      .range(from, to)
    return { data: (result.data || []) as ClientRow[], error: result.error }
  }, 'Не удалось загрузить ответственные компании')
}

async function loadResponsibleMachineIds(admin: ReturnType<typeof createAdminClient>, clientIds: string[]) {
  const groups = await Promise.all(chunks(clientIds).map((ids) => (
    loadAllPages<IdRow>(async (from, to) => {
      const result = await admin.from('machines')
        .select('id')
        .in('client_id', ids)
        .eq('is_archived', false)
        .is('delivery_to_client_date', null)
        .order('id')
        .range(from, to)
      return { data: (result.data || []) as IdRow[], error: result.error }
    }, 'Не удалось загрузить заказы ответственных компаний')
  )))
  return groups.flat()
}

async function loadMachines(admin: ReturnType<typeof createAdminClient>, machineIds: string[]) {
  const groups = await Promise.all(chunks(machineIds).map((ids) => (
    loadAllPages<MachineRow>(async (from, to) => {
      const result = await admin.from('machines')
        .select(`
          id, name, created_by, client_id, is_confirmed, desired_shipping_date,
          actual_shipping_date, delivery_to_client_date, is_archived, created_at,
          client:clients(id, name),
          machine_items(id, quantity, weight, coating, is_sample),
          production_stages(id, stage_type, date_start, date_end, is_skipped)
        `)
        .in('id', ids)
        .eq('is_archived', false)
        .is('delivery_to_client_date', null)
        .order('id')
        .range(from, to)
      return { data: (result.data || []) as unknown as MachineRow[], error: result.error }
    }, 'Не удалось загрузить заказы')
  )))
  return groups.flat()
}

async function loadFactHeaders(admin: ReturnType<typeof createAdminClient>, machineIds: string[]) {
  const groups = await Promise.all(chunks(machineIds).map((ids) => (
    loadAllPages<FactHeaderRow>(async (from, to) => {
      const result = await admin.from('production_machine_facts')
        .select('id, machine_id, section_id')
        .in('machine_id', ids)
        .order('id')
        .range(from, to)
      return { data: (result.data || []) as FactHeaderRow[], error: result.error }
    }, 'Не удалось загрузить факты производства')
  )))
  return groups.flat()
}

async function loadItemFacts(admin: ReturnType<typeof createAdminClient>, headerIds: string[]) {
  const groups = await Promise.all(chunks(headerIds).map((ids) => (
    loadAllPages<ItemFactRow>(async (from, to) => {
      const result = await admin.from('production_machine_item_facts')
        .select('production_machine_fact_id, machine_item_snapshot_id, stage_type, ordered_quantity, unit_weight_kg, coating, total_weight_kg')
        .in('production_machine_fact_id', ids)
        .order('id')
        .range(from, to)
      return { data: (result.data || []) as unknown as ItemFactRow[], error: result.error }
    }, 'Не удалось загрузить точный факт производства')
  )))
  return groups.flat()
}

async function loadSections(admin: ReturnType<typeof createAdminClient>, sectionIds: string[]) {
  const groups = await Promise.all(chunks(Array.from(new Set(sectionIds))).map((ids) => (
    loadAllPages<SectionRow>(async (from, to) => {
      const result = await admin.from('production_fact_sections')
        .select('id, parent_id, production_stage_type')
        .in('id', ids)
        .order('id')
        .range(from, to)
      return { data: (result.data || []) as SectionRow[], error: result.error }
    }, 'Не удалось определить этапы производственного факта')
  )))
  return groups.flat()
}

async function loadProductionProgressRows(admin: ReturnType<typeof createAdminClient>, machineIds: string[]) {
  const headers = await loadFactHeaders(admin, machineIds)
  if (headers.length === 0) {
    return {
      factsByMachine: new Map<string, MyOrderProgressFact[]>(),
      legacyStagesByMachine: new Map<string, StageType[]>(),
    }
  }

  const firstSections = await loadSections(admin, headers.map((header) => header.section_id))
  const parentIds = firstSections
    .filter((section) => !section.production_stage_type && section.parent_id)
    .map((section) => section.parent_id as string)
  const [parentSections, itemFacts] = await Promise.all([
    loadSections(admin, parentIds),
    loadItemFacts(admin, headers.map((header) => header.id)),
  ])
  const sectionById = new Map([...firstSections, ...parentSections].map((section) => [section.id, section]))
  const machineByHeader = new Map(headers.map((header) => [header.id, header.machine_id]))
  const itemFactHeaderIds = new Set(itemFacts.map((fact) => fact.production_machine_fact_id))
  const factsByMachine = new Map<string, MyOrderProgressFact[]>()

  for (const fact of itemFacts) {
    if (!isQuantitativeStage(fact.stage_type)) continue
    const machineId = machineByHeader.get(fact.production_machine_fact_id)
    if (!machineId) continue
    factsByMachine.set(machineId, [
      ...(factsByMachine.get(machineId) || []),
      {
        stageType: fact.stage_type,
        itemId: fact.machine_item_snapshot_id,
        orderedQuantity: Number(fact.ordered_quantity || 0),
        unitWeightKg: Number(fact.unit_weight_kg || 0),
        coating: fact.coating,
        totalWeightKg: Number(fact.total_weight_kg || 0),
      },
    ])
  }

  const legacyStagesByMachine = new Map<string, StageType[]>()
  for (const header of headers) {
    if (itemFactHeaderIds.has(header.id)) continue
    const section = sectionById.get(header.section_id)
    const stageType = section?.production_stage_type
      || (section?.parent_id ? sectionById.get(section.parent_id)?.production_stage_type : null)
    if (!isQuantitativeStage(stageType)) continue
    legacyStagesByMachine.set(header.machine_id, [
      ...(legacyStagesByMachine.get(header.machine_id) || []),
      stageType,
    ])
  }

  return { factsByMachine, legacyStagesByMachine }
}

async function loadProgressContexts(admin: ReturnType<typeof createAdminClient>, machineIds: string[]) {
  const groups = await Promise.all(chunks(machineIds, PROGRESS_CHUNK_SIZE).map((ids) => (
    loadMachineProgressContexts(
      admin as unknown as Parameters<typeof loadMachineProgressContexts>[0],
      ids,
    )
  )))
  return new Map(groups.flatMap((group) => Array.from(group.entries())))
}

function sortMachines(left: MachineRow, right: MachineRow) {
  if (left.desired_shipping_date && right.desired_shipping_date) {
    const dateOrder = left.desired_shipping_date.localeCompare(right.desired_shipping_date)
    if (dateOrder !== 0) return dateOrder
  } else if (left.desired_shipping_date) {
    return -1
  } else if (right.desired_shipping_date) {
    return 1
  }
  return right.created_at.localeCompare(left.created_at)
}

export async function loadMyOrdersPageData(): Promise<MyOrderSummary[]> {
  const auth = await requirePermission('my_orders', 'view')
  const userId = auth.user.id
  const canViewAllCompanies = auth.permissionDetails.companyScopes.my_orders?.view === 'all'

  // The service-role client is intentionally created only after the explicit
  // permission check. Detailed rows are loaded only for the authorized ID set.
  const admin = createAdminClient()
  if (canViewAllCompanies) {
    const openRows = await loadAllUndeliveredMachineIds(admin)
    if (openRows.length === 0) return []
    return buildMyOrderSummaries(admin, auth, openRows.map((row) => row.id), new Set(), true)
  }

  const [createdRows, responsibleClients] = await Promise.all([
    loadCreatedMachineIds(admin, userId),
    loadResponsibleClients(admin, userId),
  ])
  const responsibleClientIds = responsibleClients.map((client) => client.id)
  const responsibleRows = responsibleClientIds.length > 0
    ? await loadResponsibleMachineIds(admin, responsibleClientIds)
    : []
  const personalIds = mergePersonalOrderIds(
    createdRows.map((row) => row.id),
    responsibleRows.map((row) => row.id),
  )
  if (personalIds.length === 0) return []

  return buildMyOrderSummaries(admin, auth, personalIds, new Set(responsibleClientIds), false)
}

async function buildMyOrderSummaries(
  admin: ReturnType<typeof createAdminClient>,
  auth: Awaited<ReturnType<typeof requirePermission>>,
  machineIdsToLoad: string[],
  responsibleClientIdSet: ReadonlySet<string>,
  canViewAllCompanies: boolean,
): Promise<MyOrderSummary[]> {
  const userId = auth.user.id
  const machines = (await loadMachines(admin, machineIdsToLoad))
    .filter((machine) => isUndeliveredOrderVisibleForCompanyScope(
      machine,
      userId,
      responsibleClientIdSet,
      canViewAllCompanies,
    ))
    .sort(sortMachines)
  const machineIds = machines.map((machine) => machine.id)
  const [progressContexts, productionRows] = await Promise.all([
    loadProgressContexts(admin, machineIds),
    loadProductionProgressRows(admin, machineIds),
  ])
  const canOpenDetails = hasPermission(auth.permissions, 'sales_plan', 'view')

  return machines.map((machine) => {
    const machineItems = machine.machine_items || []
    const productionStages = machine.production_stages || []
    return {
      id: machine.id,
      name: machine.name,
      clientName: firstRelation(machine.client)?.name || null,
      desiredShippingDate: machine.desired_shipping_date,
      status: resolveMachineProgressWithContext({
        is_confirmed: machine.is_confirmed,
        actual_shipping_date: machine.actual_shipping_date,
        machine_items: machineItems.map((item) => ({ is_sample: item.is_sample })),
        production_stages: productionStages,
      }, progressContexts.get(machine.id)),
      productionProgress: calculateMyOrderProductionProgress({
        stages: productionStages.map((stage) => ({
          stageType: stage.stage_type,
          isSkipped: stage.is_skipped,
        })),
        items: machineItems.map((item) => ({
          id: item.id,
          quantity: Number(item.quantity || 0),
          unitWeightKg: Number(item.weight || 0),
          coating: item.coating,
        })),
        facts: productionRows.factsByMachine.get(machine.id) || [],
        legacyStages: (productionRows.legacyStagesByMachine.get(machine.id) || [])
          .filter(isQuantitativeStage),
      }),
      canOpenDetails,
    }
  })
}
