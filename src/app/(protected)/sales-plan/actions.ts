'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { dispatchPendingTelegramDeliveries, notifyNewTasks } from '@/lib/services/task-notifications'
import { createMachineSchema, machineExpenseSchema, machineItemSchema, machinePackingSettingsSchema } from '@/lib/types/schemas'
import { isFactoryWorkshopAllowed } from '@/lib/constants/factory-workshops'
import { syncMaterialTypeTask } from '@/lib/actions/material-type-tasks'
import { syncTransportCostTask } from '@/lib/actions/transport-cost-tasks'
import { ensureProductVersionCompletionTask, type ProductVersionCompletionSnapshot } from '@/lib/actions/product-version-completion-tasks'
import { isMachineInConfirmedProductionPlan, notifyMachineEnteredReadyProductionPlan } from '@/lib/actions/production-plan'
import { promoteShippedProjectSamplesToProducts } from '@/lib/actions/products'
import { loadMachineProgressContexts, resolveMachineProgressWithContext } from '@/lib/actions/machine-progress'
import { loadClientProductPriceLookup, resolveClientProductPrice, type ClientPriceDb, type ClientProductPriceLookup } from '@/lib/client-prices/server'
import { formatProductionMonth, normalizeProductionMonthValue, type ProductionMonthOption } from '@/lib/utils/production-months'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import type { CreateMachineInput, MachinePackingSettingsInput, UpdateMachineInput } from '@/lib/types/schemas'
import type { CoatingType, CurrentUser, MachineDetails, MachineExpense, MachineItem, MachineListItem, MachineStatus, MaterialType, Product } from '@/lib/types'
import type { Database } from '@/lib/types/database'

const machineItemActionSchema = machineItemSchema.strict()
const machineItemUpdateSchema = machineItemSchema.partial().strict()
const machineExpenseActionSchema = machineExpenseSchema.strict()
const machineExpenseUpdateSchema = machineExpenseSchema.partial().strict()
const materialTypeActionSchema = z.enum(['standard', 'non_standard', 'undefined'])
const machineDocumentFieldsSchema = z.object({
  contract_id: z.string().uuid().optional().nullable(),
  specification_number: z.string().trim().min(1, 'Укажите номер инвойса / спецификации'),
  specification_date: z.string().trim().min(1, 'Укажите дату документов'),
})
const machineIdSchema = z.string().uuid('Некорректный ID машины')
const productionQueueMoveSchema = z.object({
  machineId: z.string().uuid('Некорректный ID машины'),
  targetFactoryId: z.string().uuid('Некорректный ID завода'),
  targetWorkshop: z.number().int().min(1).max(2),
  targetQueueNumber: z.number().int().positive(),
})
type MachineInsert = Database['public']['Tables']['machines']['Insert']
type MachineUpdate = Database['public']['Tables']['machines']['Update']
type MachineItemInsert = Database['public']['Tables']['machine_items']['Insert']
type MachineItemUpdate = Database['public']['Tables']['machine_items']['Update']
type MachineExpenseInsert = Database['public']['Tables']['machine_expenses']['Insert']
type MachineExpenseUpdate = Database['public']['Tables']['machine_expenses']['Update']
type MachinePackingGroupInsert = Database['public']['Tables']['machine_packing_groups']['Insert']
type InventoryReservation = Database['public']['Tables']['inventory_reservations']['Row']
type ProductVersionRow = Database['public']['Tables']['product_versions']['Row']
export type MachineDocumentFieldsInput = z.input<typeof machineDocumentFieldsSchema>
type ProductSnapshot = Pick<Product, 'id' | 'name_uk' | 'name_en' | 'uktzed' | 'drawing_number' | 'characteristics' | 'unit_weight_kg' | 'base_price_eur' | 'status'>
type ProductVersionSnapshot = Pick<ProductVersionRow, 'id' | 'product_id' | 'version_number' | 'status' | 'drawing_number' | 'fastening_types' | 'completion_type'>
type MachineItemVersionStatus = MachineItem & {
  is_product_version_outdated?: boolean
}
type ProjectSampleSnapshot = {
  project_id: string
  version_id: string
  client_id: string | null
  name_uk: string
  name_en: string
  uktzed: string
  drawing_number: string
  characteristics: string
  unit_weight_kg: number
  base_price_eur: number
}
type DbResult = { data: unknown; error: { message?: string; code?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  delete: () => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  single: () => Promise<DbResult>
}
type LooseDb = {
  from: (table: string) => LooseQuery
}

type RpcClient = Awaited<ReturnType<typeof createServerSupabaseClient>> & {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
}

export type ProductionQueueMoveResult = {
  machineId: string
  machineName: string
  productionMonth: string
  before: { factoryId: string; factoryName: string; workshop: number; queueNumber: number }
  after: { factoryId: string; factoryName: string; workshop: number; queueNumber: number }
  message: string
}

const DIRECTOR_ROLES = ['planning_director', 'financial_director', 'commercial_director'] as const
const SUPPLY_ORDER_REQUEST_STATUSES = ['submitted_to_supply', 'completed']
const SUPPLY_ORDER_TABLES = [
  'request_sheet_metal',
  'request_round_tube',
  'request_circle',
  'request_pipe',
  'request_knives',
  'request_components',
  'request_paint',
  'request_mesh',
  'request_chain_cord',
]

type SupplyOrderRequestRow = {
  id: string
  machine_id: string
}
type SupplyOrderItemRow = Record<string, unknown> & {
  id: string
  request_id: string
  order_status?: string | null
  delivered_at?: string | null
}
type SupplyOrderScheduleRow = {
  request_item_table: string
  request_item_id: string
  delivery_date: string | null
  status: string | null
  delivered_at: string | null
}

function omitExpenseId<T extends { id?: unknown }>(expense: T) {
  const { id: _id, ...payload } = expense
  void _id
  return payload
}

function applyProductionManagerFactoryScope<T>(query: T, factoryId: string | null): T {
  const scopedQuery = query as { or: (filters: string) => T; is: (column: string, value: unknown) => T }
  if (!factoryId) return scopedQuery.is('factory_id', null)
  return scopedQuery.or(`factory_id.eq.${factoryId},factory_id.is.null`)
}

function applySalesPlanFactoryScope<T>(query: T, user: CurrentUser, factoryFilter?: string | null): T {
  const scopedQuery = query as { eq: (column: string, value: unknown) => T; is: (column: string, value: unknown) => T }
  if (user.role === 'production_manager') return applyProductionManagerFactoryScope(query, user.factory_id)
  if (factoryFilter === 'no_factory') return scopedQuery.is('factory_id', null)
  if (factoryFilter && factoryFilter !== 'all') return scopedQuery.eq('factory_id', factoryFilter)
  return query
}

async function requireSalesPlanPermission(operation: 'view' | 'manage') {
  const { supabase, user } = await requirePermission('sales_plan', operation)
  return { supabase, db: supabase as unknown as LooseDb, user }
}

function requireMachineMutationAccess(user: CurrentUser) {
  void user
}

async function getMachineGoodsCount(db: LooseDb, machineId: string) {
  const { data, error } = await db
    .from('machine_items')
    .select('id, is_sample')
    .eq('machine_id', machineId)

  if (error) throw new Error(error.message || 'Не удалось проверить товары машины')
  return ((data || []) as Array<{ id: string; is_sample: boolean | null }>).filter((item) => !item.is_sample).length
}

async function getMachineGoodsCountAfterDeleting(db: LooseDb, machineId: string, deletedItemIds: string[] = []) {
  const deletedIds = new Set(deletedItemIds)
  const { data, error } = await db
    .from('machine_items')
    .select('id, is_sample')
    .eq('machine_id', machineId)

  if (error) throw new Error(error.message || 'Не удалось проверить товары машины')
  return ((data || []) as Array<{ id: string; is_sample: boolean | null }>)
    .filter((item) => !item.is_sample && !deletedIds.has(item.id))
    .length
}

async function refreshMaterialUndefinedAgenda(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  materialType?: string | null
) {
  if (materialType && materialType !== 'undefined') return

  const { error } = await supabase.rpc('fn_refresh_meeting_agenda_pool')
  if (error) {
    console.error('Не удалось обновить пул повесток по типу материала:', error)
    return
  }

  revalidatePath(ROUTES.MEETINGS)
  revalidatePath(ROUTES.MEETINGS_AGENDA_POOL)
}

async function cleanupMachineAgendaReferences(supabase: RpcClient, machineId: string) {
  const { error } = await supabase.rpc('fn_cleanup_machine_agenda_references', {
    p_machine_id: machineId,
  })

  if (error) throw error
}

function requireItemProductId(item: { product_id?: string | null }, context: string) {
  if (!item.product_id) {
    throw new Error(`${context}: выберите товар из базы продукции`)
  }
  return item.product_id
}

function itemProductVersionId(item: { product_version_id?: string | null; productVersionId?: string | null }) {
  return item.product_version_id || item.productVersionId || null
}

function productVersionSelectionKey(productId: string, productVersionId: string | null) {
  return `${productId}:${productVersionId || 'current'}`
}

function sampleKey(projectId: string, versionId: string) {
  return `${projectId}:${versionId}`
}

function requireSampleProjectRef(item: { product_project_id?: string | null; product_project_version_id?: string | null }, context: string) {
  if (!item.product_project_id || !item.product_project_version_id) {
    throw new Error(`${context}: выберите утвержденный проект изделия для образца`)
  }
  return {
    project_id: item.product_project_id,
    version_id: item.product_project_version_id,
  }
}

function clientPriceDb() {
  return createAdminClient() as unknown as ClientPriceDb
}

function itemCoating(item: { coating?: CoatingType | null }) {
  return (item.coating || 'none') as CoatingType
}

async function resolveProductBackedPrice(
  db: ClientPriceDb,
  lookup: ClientProductPriceLookup,
  clientId: string | null | undefined,
  productId: string,
  coating: CoatingType,
  fallbackPrice: unknown,
  userId: string,
) {
  if (!clientId) throw new Error('Выберите клиента для расчета цены товара')
  return resolveClientProductPrice(db, lookup, {
    clientId,
    productId,
    coating,
    priceEur: Number(fallbackPrice || 0),
    userId,
  })
}

async function loadActiveProductSnapshots(db: LooseDb, productIds: string[]) {
  const ids = Array.from(new Set(productIds.filter(Boolean)))
  if (ids.length === 0) return new Map<string, ProductSnapshot>()

  const { data, error } = await db
    .from('products')
    .select('id, name_uk, name_en, uktzed, drawing_number, characteristics, unit_weight_kg, base_price_eur, status')
    .in('id', ids)

  if (error) throw new Error(error.message || 'Не удалось загрузить продукцию')
  const products = (data || []) as ProductSnapshot[]
  const map = new Map(products.map((product) => [product.id, product]))
  for (const id of ids) {
    const product = map.get(id)
    if (!product) throw new Error('Выбранный товар не найден в базе продукции')
    if (product.status !== 'active') throw new Error(`Товар "${product.name_uk}" не активен и не может быть добавлен в машину`)
  }
  return map
}

async function loadProductVersionSnapshots(
  db: LooseDb,
  refs: Array<{ productId: string; productVersionId?: string | null; context: string }>,
) {
  const uniqueRefs = Array.from(new Map(
    refs.map((ref) => [productVersionSelectionKey(ref.productId, ref.productVersionId || null), ref])
  ).values())
  if (uniqueRefs.length === 0) return new Map<string, ProductVersionSnapshot>()

  const explicitVersionIds = Array.from(new Set(
    uniqueRefs.map((ref) => ref.productVersionId).filter((id): id is string => Boolean(id))
  ))
  const currentProductIds = Array.from(new Set(
    uniqueRefs.filter((ref) => !ref.productVersionId).map((ref) => ref.productId)
  ))

  const [explicitResult, currentResult] = await Promise.all([
    explicitVersionIds.length > 0
      ? db
          .from('product_versions')
          .select('id, product_id, version_number, status, drawing_number, fastening_types, completion_type')
          .in('id', explicitVersionIds)
      : Promise.resolve({ data: [], error: null } as DbResult),
    currentProductIds.length > 0
      ? db
          .from('product_versions')
          .select('id, product_id, version_number, status, drawing_number, fastening_types, completion_type')
          .in('product_id', currentProductIds)
          .eq('status', 'current')
      : Promise.resolve({ data: [], error: null } as DbResult),
  ])

  if (explicitResult.error) throw new Error(explicitResult.error.message || 'Не удалось загрузить версии товаров')
  if (currentResult.error) throw new Error(currentResult.error.message || 'Не удалось загрузить текущие версии товаров')

  const explicitById = new Map(((explicitResult.data || []) as ProductVersionSnapshot[]).map((version) => [version.id, version]))
  const currentByProductId = new Map(((currentResult.data || []) as ProductVersionSnapshot[]).map((version) => [version.product_id, version]))
  const resolved = new Map<string, ProductVersionSnapshot>()

  for (const ref of uniqueRefs) {
    if (ref.productVersionId) {
      const version = explicitById.get(ref.productVersionId)
      if (!version) throw new Error(`${ref.context}: выбранная версия товара не найдена`)
      if (version.product_id !== ref.productId) {
        throw new Error(`${ref.context}: выбранная версия не относится к выбранному товару`)
      }
      resolved.set(productVersionSelectionKey(ref.productId, ref.productVersionId), version)
      continue
    }

    const version = currentByProductId.get(ref.productId)
    if (!version) throw new Error(`${ref.context}: у выбранного товара нет текущей версии`)
    resolved.set(productVersionSelectionKey(ref.productId, null), version)
  }

  return resolved
}

async function markOutdatedProductVersions(db: LooseDb, items: MachineItem[]) {
  const productIds = Array.from(new Set(
    items
      .filter((item) => !item.is_sample && item.product_id && item.product_version_id)
      .map((item) => item.product_id as string)
  ))
  if (productIds.length === 0) return items

  const { data, error } = await db
    .from('product_versions')
    .select('id, product_id')
    .in('product_id', productIds)
    .eq('status', 'current')

  if (error) throw new Error(error.message || 'Не удалось загрузить текущие версии товаров')

  const currentVersionByProductId = new Map(
    ((data || []) as Pick<ProductVersionRow, 'id' | 'product_id'>[]).map((version) => [version.product_id, version.id])
  )

  return items.map((item): MachineItemVersionStatus => {
    if (item.is_sample || !item.product_id || !item.product_version_id) return item
    return {
      ...item,
      is_product_version_outdated: currentVersionByProductId.get(item.product_id) !== item.product_version_id,
    }
  })
}

function resolvedProductVersion(
  versions: Map<string, ProductVersionSnapshot>,
  productId: string,
  productVersionId: string | null,
) {
  const version = versions.get(productVersionSelectionKey(productId, productVersionId))
  if (!version) throw new Error('Версия выбранного товара не найдена')
  return version
}

async function loadApprovedProjectSampleSnapshots(
  db: LooseDb,
  refs: Array<{ project_id: string; version_id: string }>,
  clientId: string | null | undefined,
) {
  const uniqueRefs = Array.from(new Map(refs.map((ref) => [sampleKey(ref.project_id, ref.version_id), ref])).values())
  if (uniqueRefs.length === 0) return new Map<string, ProjectSampleSnapshot>()

  const projectIds = Array.from(new Set(uniqueRefs.map((ref) => ref.project_id)))
  const versionIds = Array.from(new Set(uniqueRefs.map((ref) => ref.version_id)))
  const [{ data: projectsData, error: projectsError }, { data: versionsData, error: versionsError }] = await Promise.all([
    db.from('product_projects').select('id, client_id, status, approved_version_id').in('id', projectIds),
    db.from('product_project_versions').select('*').in('id', versionIds),
  ])
  if (projectsError) throw new Error(projectsError.message || 'Не удалось загрузить проекты образцов')
  if (versionsError) throw new Error(versionsError.message || 'Не удалось загрузить версии образцов')

  const projects = new Map(((projectsData || []) as Array<{ id: string; client_id: string | null; status: string; approved_version_id: string | null }>).map((project) => [project.id, project]))
  const versions = new Map(((versionsData || []) as Array<{
    id: string
    project_id: string
    name_uk: string | null
    name_en: string | null
    uktzed: string | null
    drawing_number: string | null
    characteristics: string
    description: string
    unit_weight_kg: number | null
    base_price_eur: number | null
  }>).map((version) => [version.id, version]))

  const map = new Map<string, ProjectSampleSnapshot>()
  for (const ref of uniqueRefs) {
    const project = projects.get(ref.project_id)
    const version = versions.get(ref.version_id)
    if (!project || !version) throw new Error('Выбранный проект образца не найден')
    if (project.status !== 'approved' || project.approved_version_id !== ref.version_id) {
      throw new Error('В образцы можно добавить только утвержденный проект изделия')
    }
    if (!clientId || project.client_id !== clientId) {
      throw new Error('Образец можно добавить только в заказ клиента, к которому относится проект изделия')
    }
    if (!version.name_uk || !version.name_en || !version.uktzed || !version.drawing_number || !version.unit_weight_kg) {
      throw new Error('В утвержденном проекте образца не заполнены данные изделия')
    }
    map.set(sampleKey(ref.project_id, ref.version_id), {
      project_id: ref.project_id,
      version_id: ref.version_id,
      client_id: project.client_id,
      name_uk: version.name_uk,
      name_en: version.name_en,
      uktzed: version.uktzed,
      drawing_number: version.drawing_number,
      characteristics: version.characteristics || version.description || '',
      unit_weight_kg: Number(version.unit_weight_kg),
      base_price_eur: Number(version.base_price_eur || 0),
    })
  }

  return map
}

async function assertContractBelongsToClient(db: LooseDb, contractId: string | null | undefined, clientId: string | null | undefined) {
  if (!contractId) return
  if (!clientId) throw new Error('Выберите клиента для контракта')

  const { data, error } = await db
    .from('contracts')
    .select('id, client_id')
    .eq('id', contractId)
    .single()

  if (error || !data) throw new Error('Контракт не найден')
  if ((data as { client_id: string }).client_id !== clientId) {
    throw new Error('Выбранный контракт не относится к клиенту машины')
  }
}

async function getMachineClientId(db: LooseDb, machineId: string) {
  const { data, error } = await db
    .from('machines')
    .select('client_id')
    .eq('id', machineId)
    .single()

  if (error || !data) throw new Error('Машина не найдена')
  return (data as { client_id: string | null }).client_id
}

function productBackedItemPayload(
  machineId: string,
  item: NonNullable<CreateMachineInput['items']>[number],
  product: ProductSnapshot,
  productVersion: ProductVersionSnapshot,
  priceEur: number,
  index: number
): MachineItemInsert {
  return {
    machine_id: machineId,
    product_id: product.id,
    product_version_id: productVersion.id,
    drawing_number: productVersion.drawing_number,
    product_name: product.name_uk,
    product_name_uk: product.name_uk,
    product_name_en: product.name_en,
    product_uktzed: product.uktzed,
    product_drawing_number: productVersion.drawing_number,
    product_characteristics: product.characteristics,
    weight: Number(product.unit_weight_kg),
    price: priceEur,
    quantity: item.quantity,
    coating: item.coating,
    ral_number: item.ral_number || null,
    is_sample: item.is_sample ?? false,
    sort_order: index,
  }
}

function projectSampleItemPayload(
  machineId: string,
  item: NonNullable<CreateMachineInput['items']>[number],
  sample: ProjectSampleSnapshot,
  index: number
): MachineItemInsert {
  return {
    machine_id: machineId,
    product_id: null,
    product_project_id: sample.project_id,
    product_project_version_id: sample.version_id,
    drawing_number: sample.drawing_number,
    product_name: sample.name_uk,
    product_name_uk: sample.name_uk,
    product_name_en: sample.name_en,
    product_uktzed: sample.uktzed,
    product_drawing_number: sample.drawing_number,
    product_characteristics: sample.characteristics,
    weight: Number(sample.unit_weight_kg),
    price: Number(sample.base_price_eur),
    quantity: item.quantity,
    coating: item.coating,
    ral_number: item.ral_number || null,
    is_sample: true,
    sort_order: index,
  }
}

function productBackedItemUpdate(
  item: NonNullable<UpdateMachineInput['items']>[number],
  index: number,
  priceEur?: number,
): MachineItemUpdate {
  const payload: MachineItemUpdate = {
    quantity: item.quantity,
    coating: item.coating,
    ral_number: item.ral_number || null,
    is_sample: item.is_sample ?? false,
    sort_order: index,
  }
  if (priceEur !== undefined) payload.price = priceEur
  return payload
}

function assertCanConfirmMachine(hasGoods: boolean) {
  if (!hasGoods) {
    throw new Error('Нельзя подтвердить машину без товаров. Добавьте хотя бы одну товарную позицию.')
  }
}

function isMissingDeleteCleanupRpc(error: { message?: string; code?: string } | null) {
  const message = error?.message || ''
  return error?.code === 'PGRST202'
    || error?.code === '42883'
    || message.includes('fn_delete_machine_with_inventory_cleanup')
    || message.includes('Could not find the function')
}

async function unreserveMachineInventory(db: LooseDb, rpc: RpcClient, machineId: string, userId: string) {
  const { data, error } = await db
    .from('inventory_reservations')
    .select('id')
    .eq('machine_id', machineId)

  if (error) throw new Error(error.message || 'Не удалось проверить складские брони машины')

  const reservations = (data || []) as Pick<InventoryReservation, 'id'>[]
  for (const reservation of reservations) {
    const { error: unreserveError } = await rpc.rpc('fn_unreserve_inventory_reservation', {
      p_reservation_id: reservation.id,
      p_performed_by: userId,
      p_comment: 'Снятие брони при удалении машины',
    })

    if (unreserveError) {
      throw new Error(unreserveError.message || 'Не удалось снять складскую бронь перед удалением машины')
    }
  }
}

async function detachMachineInventoryTransactions(machineId: string) {
  const adminDb = createAdminClient() as unknown as LooseDb
  const { error } = await adminDb
    .from('inventory_transactions')
    .update({ machine_id: null })
    .eq('machine_id', machineId)

  if (error) throw new Error(error.message || 'Не удалось отвязать складские транзакции от удаляемой машины')
}

async function deleteMachineRow(db: LooseDb, machineId: string) {
  const { data, error } = await db
    .from('machines')
    .delete()
    .eq('id', machineId)
    .select('id')
    .single()

  if (error) throw error
  if (!data) throw new Error('Машина не найдена или уже удалена')
}

async function deleteMachineWithInventoryCleanup(supabase: RpcClient, db: LooseDb, machineId: string, userId: string) {
  const { error } = await supabase.rpc('fn_delete_machine_with_inventory_cleanup', {
    p_machine_id: machineId,
    p_performed_by: userId,
  })

  if (!error) return
  if (!isMissingDeleteCleanupRpc(error)) throw error

  await unreserveMachineInventory(db, supabase, machineId, userId)
  await detachMachineInventoryTransactions(machineId)
  await deleteMachineRow(db, machineId)
}

async function assertMachineNotArchived(db: LooseDb, machineId: string) {
  const { data, error } = await db
    .from('machines')
    .select('is_archived')
    .eq('id', machineId)
    .single()

  if (error || !data) throw new Error('Машина не найдена')
  if ((data as { is_archived?: boolean }).is_archived) {
    throw new Error('Машина архивирована. Действия с ней остановлены.')
  }
}

function todayDateOnly() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeProductionMonth(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error('Выберите месяц производства')
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

async function getFactoryName(db: LooseDb, factoryId: string) {
  const { data, error } = await db
    .from('factories')
    .select('id, name')
    .eq('id', factoryId)
    .single()

  if (error || !data) throw new Error('Завод не найден')
  return (data as { id: string; name: string }).name
}

async function getNextProductionQueueNumber(
  db: LooseDb,
  productionMonth: string,
  factoryId: string,
  productionWorkshop: number,
  excludeMachineId?: string
) {
  const query = db
    .from('machines')
    .select('id, production_queue_number')
    .eq('production_month', productionMonth)
    .eq('factory_id', factoryId)
    .eq('production_workshop', productionWorkshop)

  const { data, error } = await query
  if (error) throw new Error(error.message || 'Не удалось рассчитать очередь машины')

  const rows = ((data || []) as Array<{ id: string; production_queue_number: number | null }>)
    .filter((row) => row.id !== excludeMachineId)
  const maxQueueNumber = rows.reduce((max, row) => Math.max(max, row.production_queue_number || 0), 0)
  return maxQueueNumber + 1
}

async function notifyDirectorsAboutNewMachine(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, machineId: string, machineName: string) {
  const rpcClient = supabase as RpcClient
  for (const role of DIRECTOR_ROLES) {
    const { error } = await rpcClient.rpc('notify_users_by_role', {
      p_role: role,
      p_type: 'new_machine',
      p_title: 'Новая машина',
      p_message: `Создана новая машина ${machineName}. Нужно ознакомиться с карточкой.`,
      p_machine_id: machineId,
    })
    if (error) throw new Error(error.message || 'Не удалось отправить уведомление директорам')
  }
}

async function createPlanningDirectorReviewTasks(db: LooseDb, machineId: string, machineName: string) {
  const { data: usersData, error: usersError } = await db
    .from('users')
    .select('id')
    .eq('role', 'planning_director')
    .eq('is_active', true)

  if (usersError) throw new Error(usersError.message || 'Не удалось загрузить директоров планирования')

  const planningDirectors = (usersData || []) as { id: string }[]
  const deadline = todayDateOnly()

  for (const director of planningDirectors) {
    const { data: existingData, error: existingError } = await db
      .from('tasks')
      .select('id')
      .eq('machine_id', machineId)
      .eq('assigned_to', director.id)
      .eq('task_type', 'machine_review')

    if (existingError) throw new Error(existingError.message || 'Не удалось проверить задачу ознакомления')
    if (((existingData || []) as { id: string }[]).length > 0) continue

    const { error: taskError } = await db.from('tasks').insert({
      machine_id: machineId,
      assigned_to: director.id,
      task_type: 'machine_review',
      title: `Ознакомиться с машиной: ${machineName}`,
      description: `Проверьте карточку новой машины ${machineName}.`,
      status: 'pending',
      deadline,
    })

    if (taskError && taskError.code !== '23505') {
      throw new Error(taskError.message || 'Не удалось создать задачу ознакомления с машиной')
    }
  }
}

async function notifyProductionManagersAboutFactoryAssignment(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  factoryId: string,
  machineId: string,
  machineName: string
) {
  const { error } = await (supabase as RpcClient).rpc('notify_users_by_role_in_factory', {
    p_factory_id: factoryId,
    p_role: 'production_manager',
    p_type: 'factory_assigned',
    p_title: 'Машина назначена на завод',
    p_message: `Машина ${machineName} назначена на ваш завод.`,
    p_machine_id: machineId,
  })

  if (error) throw new Error(error.message || 'Не удалось отправить уведомление начальнику производства')
}

function getDisplayMachineStatus(machine: {
  status: MachineStatus
  is_confirmed?: boolean | null
  factory_id?: string | null
  material_type?: string | null
  planned_material_date?: string | null
  actual_material_date?: string | null
  actual_shipping_date?: string | null
}) {
  if (machine.actual_shipping_date) return 'shipped' satisfies MachineStatus
  if (machine.actual_material_date) return 'material_received' satisfies MachineStatus
  if (machine.status !== 'in_production') return machine.status
  if (machine.factory_id && machine.material_type && machine.material_type !== 'undefined' && machine.planned_material_date) {
    return 'planned' satisfies MachineStatus
  }
  if (machine.is_confirmed) return 'confirmed' satisfies MachineStatus
  return 'created' satisfies MachineStatus
}

function supplyOrderRequestedQuantity(table: string, row: SupplyOrderItemRow) {
  if (table === 'request_sheet_metal') return Number(row.remainder_qty || row.to_order_kg || 0)
  if (table === 'request_round_tube') return Number(row.order_kg || 0)
  if (table === 'request_circle') return Number(row.remainder_mm || 0)
  if (table === 'request_pipe') return row.pipe_type === 'wire' ? Number(row.remainder_kg || 0) : Number(row.remainder_length_mm || 0)
  if (table === 'request_knives') {
    const meters = Number(row.remainder_meters || 0)
    return meters > 0 ? meters * 1000 : Number(row.to_order_mm || 0)
  }
  if (table === 'request_components') return Math.max(Number(row.quantity_needed || 0) - Number(row.stock_remainder || 0), 0)
  if (table === 'request_mesh') return Number(row.remainder_qty || 0)
  if (table === 'request_chain_cord') return Number(row.remainder_meters || 0) * 1000
  return Number(row.remainder_kg || row.to_order_kg || 0)
}

function supplyOrderReservedQuantity(table: string, row: SupplyOrderItemRow) {
  if (table === 'request_sheet_metal') return Number(row.reserved_from_stock_kg || 0)
  if (table === 'request_round_tube') return Number(row.reserved_from_stock_kg || 0)
  if (table === 'request_circle') return Number(row.reserved_from_stock_mm || 0)
  if (table === 'request_pipe') return row.pipe_type === 'wire' ? Number(row.reserved_from_stock_kg || 0) : Number(row.reserved_from_stock_length_mm || 0)
  if (table === 'request_knives') return Number(row.reserved_from_stock_mm || 0)
  if (table === 'request_components') return Number(row.reserved_from_stock || 0)
  if (table === 'request_mesh') return Number(row.reserved_from_stock_qty || 0)
  if (table === 'request_chain_cord') return Number(row.reserved_from_stock_meters || 0) * 1000
  return Number(row.reserved_from_stock_kg || 0)
}

function actualMaterialDateOnly(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 10) : null
}

function rememberLatestActualMaterialDate(current: string | null, next: string | null) {
  if (!next) return current
  return !current || next > current ? next : current
}

async function loadSupplyOrderActualMaterialDates(db: LooseDb, machineIds: string[]) {
  const uniqueMachineIds = Array.from(new Set(machineIds.filter(Boolean)))
  const actualDates = new Map<string, string>()
  if (uniqueMachineIds.length === 0) return actualDates

  const readDb = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createAdminClient() as unknown as LooseDb
    : db

  const { data: requestsData, error: requestsError } = await readDb
    .from('technologist_requests')
    .select('id, machine_id')
    .in('machine_id', uniqueMachineIds)
    .in('status', SUPPLY_ORDER_REQUEST_STATUSES)

  if (requestsError) throw new Error(requestsError.message || 'Не удалось проверить заявки снабжения')

  const requests = (requestsData || []) as SupplyOrderRequestRow[]
  const requestIds = requests.map((request) => request.id)
  if (requestIds.length === 0) return actualDates

  const requestMachineMap = new Map(requests.map((request) => [request.id, request.machine_id]))
  const stateByMachine = new Map(uniqueMachineIds.map((machineId) => [machineId, {
    hasOrderableItems: false,
    allDelivered: true,
    latestDeliveredDate: null as string | null,
  }]))

  const rowsByTable = await Promise.all(SUPPLY_ORDER_TABLES.map(async (table) => {
    const { data, error } = await readDb
      .from(table)
      .select('*')
      .in('request_id', requestIds)
    if (error) throw new Error(error.message || 'Не удалось загрузить позиции снабжения')
    return { table, rows: (data || []) as SupplyOrderItemRow[] }
  }))

  const orderableItems: Array<{ table: string; row: SupplyOrderItemRow; machineId: string }> = []
  for (const { table, rows } of rowsByTable) {
    for (const row of rows) {
      const machineId = requestMachineMap.get(row.request_id)
      if (!machineId) continue

      const toOrder = Math.max(supplyOrderRequestedQuantity(table, row) - supplyOrderReservedQuantity(table, row), 0)
      if (toOrder <= 0) continue
      orderableItems.push({ table, row, machineId })
    }
  }

  const itemIds = orderableItems.map((item) => item.row.id)
  const { data: schedulesData, error: schedulesError } = itemIds.length > 0
    ? await readDb
        .from('supply_order_delivery_schedules')
        .select('request_item_table, request_item_id, delivery_date, status, delivered_at')
        .in('request_item_id', itemIds)
    : { data: [], error: null }

  if (schedulesError) throw new Error(schedulesError.message || 'Не удалось загрузить график снабжения')

  const schedulesByItem = new Map<string, SupplyOrderScheduleRow[]>()
  for (const schedule of (schedulesData || []) as SupplyOrderScheduleRow[]) {
    const key = `${schedule.request_item_table}:${schedule.request_item_id}`
    schedulesByItem.set(key, [...(schedulesByItem.get(key) || []), schedule])
  }

  for (const { table, row, machineId } of orderableItems) {
    const state = stateByMachine.get(machineId)
    if (!state) continue

    state.hasOrderableItems = true
    const schedules = schedulesByItem.get(`${table}:${row.id}`) || []
    const itemDelivered = schedules.length > 0
      ? schedules.every((schedule) => schedule.status === 'delivered')
      : row.order_status === 'delivered'

    if (!itemDelivered) {
      state.allDelivered = false
      continue
    }

    state.latestDeliveredDate = rememberLatestActualMaterialDate(state.latestDeliveredDate, actualMaterialDateOnly(row.delivered_at))
    for (const schedule of schedules) {
      if (schedule.status !== 'delivered') continue
      state.latestDeliveredDate = rememberLatestActualMaterialDate(
        state.latestDeliveredDate,
        actualMaterialDateOnly(schedule.delivered_at) || actualMaterialDateOnly(schedule.delivery_date)
      )
    }
  }

  for (const [machineId, state] of stateByMachine.entries()) {
    if (state.hasOrderableItems && state.allDelivered && state.latestDeliveredDate) {
      actualDates.set(machineId, state.latestDeliveredDate)
    }
  }

  return actualDates
}

async function syncCoatingDependentProductionStages(db: LooseDb, machineId: string) {
  const { data: itemsData, error: itemsError } = await db
    .from('machine_items')
    .select('coating')
    .eq('machine_id', machineId)

  if (itemsError) throw itemsError

  const coatings = ((itemsData || []) as Pick<MachineItem, 'coating'>[]).map((item) => item.coating)
  const hasZinc = coatings.includes('zinc')
  const hasPainting = coatings.includes('powder_coating')

  const zincStages = ['galvanizing', 'post_galvanizing_cleaning']
  const { error: zincError } = await db
    .from('production_stages')
    .update({ is_skipped: !hasZinc })
    .eq('machine_id', machineId)
    .in('stage_type', zincStages)

  if (zincError) throw zincError

  const { error: paintingError } = await db
    .from('production_stages')
    .update({ is_skipped: !hasPainting })
    .eq('machine_id', machineId)
    .eq('stage_type', 'painting')

  if (paintingError) throw paintingError
}

// === Получение списка ===
export async function getProductionMonthFilterOptions(factoryFilter?: string | null) {
  try {
    const { supabase, user } = await requireSalesPlanPermission('view')

    let query = supabase
      .from('machines')
      .select('production_month')
      .eq('is_archived', false)
      .not('production_month', 'is', null)

    query = applySalesPlanFactoryScope(query, user, factoryFilter)

    const { data, error } = await query
      .order('production_month', { ascending: false })
      .limit(120)

    if (error) throw error

    const months = Array.from(new Set(
      ((data || []) as Array<{ production_month: string | null }>)
        .map((row) => normalizeProductionMonthValue(row.production_month))
        .filter((value): value is string => Boolean(value))
    ))

    return {
      data: months.map((value) => ({ value, label: formatProductionMonth(value) } satisfies ProductionMonthOption)),
      error: null,
    }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function moveMachineInProductionQueue(input: unknown) {
  try {
    const parsed = productionQueueMoveSchema.parse(input)
    const { user } = await requireSalesPlanPermission('manage')
    const admin = createAdminClient() as unknown as RpcClient
    const { data, error } = await admin.rpc('reorder_machine_production_queue', {
      p_machine_id: parsed.machineId,
      p_target_factory_id: parsed.targetFactoryId,
      p_target_workshop: parsed.targetWorkshop,
      p_target_queue_number: parsed.targetQueueNumber,
      p_changed_by: user.id,
    })

    if (error) throw new Error(error.message || 'Не удалось изменить очередь производства')
    if (!data) throw new Error('Сервер не вернул результат изменения очереди')

    after(async () => {
      await dispatchPendingTelegramDeliveries({ machineId: parsed.machineId }).catch((telegramError) => {
        console.error('Не удалось отправить Telegram-уведомления об изменении очереди:', telegramError)
      })
    })

    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(`${ROUTES.SALES_PLAN}/${parsed.machineId}`)
    revalidatePath(ROUTES.PRODUCTION)

    return { success: true as const, data: data as ProductionQueueMoveResult }
  } catch (error: unknown) {
    return { success: false as const, error: getErrorMessage(error) }
  }
}

export async function getMachines(factoryFilter?: string | null, productionMonthFilter?: string | null) {
  try {
    const { supabase, db, user } = await requireSalesPlanPermission('view')
    const normalizedProductionMonth = normalizeProductionMonthValue(productionMonthFilter)

    let query = supabase
      .from('machines_with_totals')
      .select(`
        id, name, material_type, status, factory_id, is_confirmed, planned_material_date,
        actual_material_date, actual_shipping_date, created_at, created_by, total_weight,
        total_cost, item_count, production_month, production_workshop, production_queue_number,
        contract_id, specification_number, specification_date,
        factory:factories(name),
        client:clients(id, name, primary_contact_name),
        created_by_user:users!machines_created_by_fkey(full_name),
        machine_items(id, product_id, product_version_id, product_project_id, product_project_version_id, drawing_number, product_name, product_name_uk, product_name_en, product_uktzed, product_drawing_number, weight, price, quantity, coating, ral_number, is_sample),
        production_stages(stage_type, date_start, date_end, is_skipped),
        supply_items(id, status),
        invoice:invoices(status, payment_date, due_date, amount, paid_amount)
      `)
      .eq('is_archived', false)

    query = applySalesPlanFactoryScope(query, user, factoryFilter)

    if (normalizedProductionMonth) {
      query = query.eq('production_month', normalizedProductionMonth)
    }

    const { data: rawData, error } = await query
      .order('created_at', { ascending: false })

    if (error) throw error

    const rows = (rawData || []) as unknown as Omit<MachineListItem, 'production_progress' | 'supply_progress' | 'uniqueCoatings' | 'progress'>[]
    const machineIds = rows.map((machine) => machine.id)
    const [progressContexts, actualMaterialDateFallbacks] = await Promise.all([
      loadMachineProgressContexts(db, machineIds),
      loadSupplyOrderActualMaterialDates(db, rows.filter((machine) => !machine.actual_material_date).map((machine) => machine.id)),
    ])
    const mappedData: MachineListItem[] = rows.map((m) => {
      const machine = {
        ...m,
        actual_material_date: m.actual_material_date || actualMaterialDateFallbacks.get(m.id) || null,
      }
      // Производство
      const activeStages = (machine.production_stages || []).filter((s) => !s.is_skipped)
      const completedStages = activeStages.filter((s) => !!s.date_end)
      const production_progress = {
        completed: completedStages.length,
        total: activeStages.length,
      }

      // Снабжение
      const allSupply = machine.supply_items || []
      const receivedSupply = allSupply.filter((s) => s.status === 'received')
      const supply_progress = {
        completed: receivedSupply.length,
        total: allSupply.length,
      }
      
      // Уникальные покрытия
      const uniqueCoatings = Array.from(new Set((machine.machine_items || []).map((i) => i.coating)))

      return {
        ...machine,
        product: (machine.machine_items || []).find((item) => !item.is_sample && item.product_name)?.product_name || null,
        status: getDisplayMachineStatus(machine),
        production_progress,
        supply_progress,
        uniqueCoatings,
        progress: resolveMachineProgressWithContext(machine, progressContexts.get(machine.id)),
      }
    })

    return { data: mappedData, error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

// === Получение одной машины ===
export async function getMachine(id: string) {
  try {
    const { supabase, db, user } = await requireSalesPlanPermission('view')

    let query = supabase
      .from('machines')
      .select(`
        *,
        machine_items(id, machine_id, product_id, product_version_id, product_project_id, product_project_version_id, drawing_number, product_name, product_name_uk, product_name_en, product_uktzed, product_drawing_number, product_characteristics, weight, price, quantity, coating, ral_number, is_sample, sort_order, created_at),
        machine_expenses(*),
        machine_packing_groups(*),
        production_stages(*),
        supply_items(*),
        invoice:invoices(*),
        created_by_user:users!machines_created_by_fkey(full_name),
        client:clients(id, name, primary_contact_name, phone, email, country_city),
        factory:factories(name)
      `)
      .eq('id', id)

    if (user.role === 'production_manager') {
      query = applyProductionManagerFactoryScope(query, user.factory_id)
    }
    
    const { data, error } = await query.single()

    if (error) throw error
    
    // Sort items
    const machineData = data as unknown as MachineDetails
    if (machineData.machine_items) {
      machineData.machine_items.sort((a, b) => a.sort_order - b.sort_order)
      machineData.machine_items = await markOutdatedProductVersions(db, machineData.machine_items)
    }
    if (machineData.machine_packing_groups) {
      machineData.machine_packing_groups.sort((a, b) => {
        const byOrder = (a.sort_order || 0) - (b.sort_order || 0)
        return byOrder || a.start_item_number - b.start_item_number
      })
    }
    
    // Считаем totals на лету для страницы деталей.
    const items = machineData.machine_items || []
    const expenses = machineData.machine_expenses || []
    
    const total_weight = items.reduce((sum, item) => sum + (Number(item.weight) * Number(item.quantity)), 0)
    const total_items_cost = items.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0)
    const total_expenses = expenses.reduce((sum, exp) => sum + Number(exp.amount), 0)
    const total_cost = total_items_cost + total_expenses
    const has_zinc = items.some((i) => i.coating === 'zinc')
    const has_painting = items.some((i) => i.coating === 'powder_coating')
    const [progressContexts, actualMaterialDateFallbacks] = await Promise.all([
      loadMachineProgressContexts(db, [machineData.id]),
      machineData.actual_material_date
        ? Promise.resolve(new Map<string, string>())
        : loadSupplyOrderActualMaterialDates(db, [machineData.id]),
    ])
    const machineWithActualMaterialDate: MachineDetails = {
      ...machineData,
      actual_material_date: machineData.actual_material_date || actualMaterialDateFallbacks.get(machineData.id) || null,
    }

    const enrichedData: MachineDetails = {
      ...machineWithActualMaterialDate,
      status: getDisplayMachineStatus(machineWithActualMaterialDate),
      total_weight,
      total_items_cost,
      total_expenses,
      total_cost,
      item_count: items.length,
      has_zinc,
      has_painting,
      progress: resolveMachineProgressWithContext(machineWithActualMaterialDate, progressContexts.get(machineData.id)),
    }

    return { data: enrichedData, error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

// === Создание ===
export async function createMachine(data: CreateMachineInput) {
  try {
    const { supabase, db, user } = await requireSalesPlanPermission('manage')

    const parsed = createMachineSchema.parse(data)
    const allItems = [
      ...(parsed.items || []).map((item) => ({ ...item, is_sample: item.is_sample ?? false })),
      ...(parsed.samples || []).map((item) => ({ ...item, is_sample: true })),
    ]
    const goods = allItems.filter((item) => !item.is_sample)
    const samples = allItems.filter((item) => item.is_sample)
    const productIds = goods.map((item, index) => requireItemProductId(item, `Позиция ${index + 1}`))
    const sampleRefs = samples.map((item, index) => requireSampleProjectRef(item, `Образец ${index + 1}`))
    const productMap = await loadActiveProductSnapshots(db, productIds)
    const productVersionMap = await loadProductVersionSnapshots(
      db,
      goods.map((item, index) => ({
        productId: requireItemProductId(item, `Позиция ${index + 1}`),
        productVersionId: itemProductVersionId(item),
        context: `Позиция ${index + 1}`,
      })),
    )
    const sampleMap = await loadApprovedProjectSampleSnapshots(db, sampleRefs, parsed.client_id)
    const priceDb = clientPriceDb()
    const clientPriceLookup = await loadClientProductPriceLookup(priceDb, parsed.client_id, productIds)
    if (parsed.is_confirmed) {
      assertCanConfirmMachine(goods.length > 0)
    }

    const { data: clientData, error: clientError } = await db
      .from('clients')
      .select('payment_terms_type, payment_due_days, prepayment_percent, final_payment_due_days')
      .eq('id', parsed.client_id)
      .single()
    if (clientError || !clientData) throw clientError || new Error('Клиент не найден')
    const clientTerms = clientData as {
      payment_terms_type: MachineInsert['payment_terms_type']
      payment_due_days: number
      prepayment_percent: number | null
      final_payment_due_days: number | null
    }
    await assertContractBelongsToClient(db, parsed.contract_id, parsed.client_id)
    if (!parsed.factory_id) throw new Error('Выберите завод')
    if (!parsed.production_month) throw new Error('Выберите месяц производства')
    if (!parsed.production_workshop) throw new Error('Выберите цех')

    const productionMonth = normalizeProductionMonth(parsed.production_month)
    const productionWorkshop = parsed.production_workshop
    const factoryName = await getFactoryName(db, parsed.factory_id)
    if (!isFactoryWorkshopAllowed(factoryName, productionWorkshop)) {
      throw new Error('Выбранный цех недоступен для этого завода')
    }
    const productionQueueNumber = await getNextProductionQueueNumber(
      db,
      productionMonth,
      parsed.factory_id,
      productionWorkshop
    )

    // 1. Создать машину
    const { data: newMachineData, error: machineError } = await db
      .from('machines')
      .insert({
        name: parsed.name,
        factory_id: parsed.factory_id,
        status: 'factory_assigned',
        client_id: parsed.client_id,
        contract_id: parsed.contract_id || null,
        specification_number: parsed.specification_number || null,
        specification_date: parsed.specification_date || null,
        payment_terms_type: clientTerms.payment_terms_type,
        payment_due_days: clientTerms.payment_due_days,
        prepayment_percent: clientTerms.payment_terms_type === 'prepayment_full' ? clientTerms.prepayment_percent ?? 50 : null,
        final_payment_due_days: clientTerms.payment_terms_type === 'prepayment_full' ? clientTerms.final_payment_due_days ?? clientTerms.payment_due_days : null,
        material_type: 'undefined',
        is_confirmed: parsed.is_confirmed || false,
        desired_shipping_date: parsed.desired_shipping_date || null,
        production_month: productionMonth,
        production_workshop: productionWorkshop,
        production_queue_number: productionQueueNumber,
        created_by: user.id
      } satisfies MachineInsert)
      .select()
      .single()

    if (machineError) throw machineError

    const newMachine = newMachineData as MachineDetails
    const machineId = newMachine.id

    try {
      // 2. Создать machine_items
      if (allItems.length > 0) {
        const itemsToInsert: MachineItemInsert[] = []
        const productVersionTasksToEnsure: Array<{ productVersion: ProductVersionCompletionSnapshot; productName: string }> = []
        for (const [index, item] of allItems.entries()) {
          if (item.is_sample) {
            const ref = requireSampleProjectRef(item, `Образец ${index + 1}`)
            const sample = sampleMap.get(sampleKey(ref.project_id, ref.version_id))
            if (!sample) throw new Error('Выбранный проект образца не найден')
            itemsToInsert.push(projectSampleItemPayload(machineId, item, sample, index))
            continue
          }
          const product = productMap.get(item.product_id || '')
          if (!product) throw new Error('Выбранный товар не найден в базе продукции')
          const productVersion = resolvedProductVersion(productVersionMap, product.id, itemProductVersionId(item))
          const priceEur = await resolveProductBackedPrice(
            priceDb,
            clientPriceLookup,
            parsed.client_id,
            product.id,
            itemCoating(item),
            item.price,
            user.id,
          )
          itemsToInsert.push(productBackedItemPayload(machineId, item, product, productVersion, priceEur, index))
          productVersionTasksToEnsure.push({ productVersion, productName: product.name_uk })
        }
        
        const { error: itemsError } = await db.from('machine_items').insert(itemsToInsert satisfies MachineItemInsert[])
        if (itemsError) throw itemsError
        for (const taskInput of productVersionTasksToEnsure) {
          await ensureProductVersionCompletionTask(db, {
            ...taskInput,
            machineId,
            assignedTo: user.id,
          })
        }
      }

      // 3. Создать machine_expenses
      if (parsed.expenses && parsed.expenses.length > 0) {
        const expToInsert = parsed.expenses.map(e => ({
          machine_id: machineId,
          category: e.category,
          amount: e.amount,
          comment: e.comment || null
        }))
        const { error: expError } = await db.from('machine_expenses').insert(expToInsert satisfies MachineExpenseInsert[])
        if (expError) throw expError
      }
      
    } catch (nestedError: unknown) {
      // Если добавление items/expenses упало, вручную откатываем машину
      await db.from('machines').delete().eq('id', machineId)
      throw nestedError
    }

    await notifyDirectorsAboutNewMachine(supabase, machineId, newMachine.name)
    await notifyProductionManagersAboutFactoryAssignment(supabase, parsed.factory_id, machineId, newMachine.name)
    await createPlanningDirectorReviewTasks(db, machineId, newMachine.name)
    await notifyMachineEnteredReadyProductionPlan(machineId, user.id)
    await syncTransportCostTask(db, machineId)
    await syncMaterialTypeTask(db, machineId)
    await refreshMaterialUndefinedAgenda(supabase, 'undefined')
    await dispatchPendingTelegramDeliveries({ machineId })

    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(ROUTES.NESTING)
    revalidatePath(ROUTES.TASKS)
    return { success: true, machine: newMachine, error: null }
  } catch (error: unknown) {
    return { success: false, machine: null, error: getErrorMessage(error) }
  }
}

export async function updateMachineDocumentFields(machineId: string, data: MachineDocumentFieldsInput) {
  try {
    const { db } = await requireSalesPlanPermission('manage')
    const parsedMachineId = machineIdSchema.parse(machineId)
    const parsed = machineDocumentFieldsSchema.parse(data)

    await assertMachineNotArchived(db, parsedMachineId)

    const { data: machineData, error: machineError } = await db
      .from('machines')
      .select('client_id')
      .eq('id', parsedMachineId)
      .single()

    if (machineError || !machineData) throw new Error('Машина не найдена')

    const clientId = (machineData as { client_id: string | null }).client_id
    await assertContractBelongsToClient(db, parsed.contract_id, clientId)

    const { error } = await db
      .from('machines')
      .update({
        contract_id: parsed.contract_id || null,
        specification_number: parsed.specification_number,
        specification_date: parsed.specification_date,
      } satisfies MachineUpdate)
      .eq('id', parsedMachineId)

    if (error) throw error

    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(`${ROUTES.SALES_PLAN}/${parsedMachineId}`)

    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function updateMachinePackingSettings(machineId: string, data: MachinePackingSettingsInput) {
  try {
    const { db, user } = await requireSalesPlanPermission('manage')
    requireMachineMutationAccess(user)
    const parsedMachineId = machineIdSchema.parse(machineId)
    const parsed = machinePackingSettingsSchema.parse(data)

    await assertMachineNotArchived(db, parsedMachineId)
    const clientId = await getMachineClientId(db, parsedMachineId)
    await assertContractBelongsToClient(db, parsed.contract_id, clientId)

    const goodsCount = await getMachineGoodsCount(db, parsedMachineId)
    for (const group of parsed.groups) {
      if (group.end_item_number > goodsCount) {
        throw new Error(`Диапазон упаковки ${group.start_item_number}-${group.end_item_number} выходит за количество товаров (${goodsCount})`)
      }
    }

    const { error: machineUpdateError } = await db
      .from('machines')
      .update({
        contract_id: parsed.contract_id || null,
        specification_number: parsed.specification_number?.trim() || null,
        specification_date: parsed.specification_date?.trim() || null,
        delivery_basis_type: parsed.delivery_basis_type,
        packing_boxes_count: parsed.packing_boxes_count,
      } satisfies MachineUpdate)
      .eq('id', parsedMachineId)

    if (machineUpdateError) throw machineUpdateError

    const { error: deleteError } = await db
      .from('machine_packing_groups')
      .delete()
      .eq('machine_id', parsedMachineId)

    if (deleteError) throw deleteError

    const rows: MachinePackingGroupInsert[] = parsed.groups.map((group, index) => ({
      machine_id: parsedMachineId,
      start_item_number: group.start_item_number,
      end_item_number: group.end_item_number,
      packing_type_en: group.packing_type_en.trim(),
      packing_type_ua: group.packing_type_ua?.trim() || null,
      places: group.places,
      sort_order: index,
      updated_at: new Date().toISOString(),
    }))

    if (rows.length > 0) {
      const { error: insertError } = await db
        .from('machine_packing_groups')
        .insert(rows)

      if (insertError) throw insertError
    }

    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(`${ROUTES.SALES_PLAN}/${parsedMachineId}`)

    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function updateMachineMaterialType(machineId: string, materialType: MaterialType) {
  try {
    const { supabase, db, user } = await requireSalesPlanPermission('manage')
    requireMachineMutationAccess(user)
    const parsedMachineId = machineIdSchema.parse(machineId)
    const parsedMaterialType = materialTypeActionSchema.parse(materialType)

    await assertMachineNotArchived(db, parsedMachineId)

    const { error } = await db
      .from('machines')
      .update({
        material_type: parsedMaterialType,
        updated_at: new Date().toISOString(),
      } satisfies MachineUpdate)
      .eq('id', parsedMachineId)

    if (error) throw error

    await refreshMaterialUndefinedAgenda(supabase, parsedMaterialType)
    after(async () => {
      await notifyNewTasks(parsedMachineId).catch((notificationError) => {
        console.error('Не удалось отправить уведомления после смены типа материала:', notificationError)
      })
    })

    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(`${ROUTES.SALES_PLAN}/${parsedMachineId}`)
    revalidatePath(ROUTES.TASKS)
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.GANTT)

    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

// === Обновление ===
export async function updateMachine(id: string, data: UpdateMachineInput & { deletedItemIds?: string[], deletedExpenseIds?: string[] }) {
  try {
    const { supabase, db, user } = await requireSalesPlanPermission('manage')
    await assertMachineNotArchived(db, id)
    if (data.actual_material_date !== undefined) {
      throw new Error('Факт поставки материала заполняется автоматически после приемки всех материалов по заявке')
    }
    if (
      user.role === 'production_manager' &&
      data.planned_material_date !== undefined &&
      await isMachineInConfirmedProductionPlan(id)
    ) {
      throw new Error('План месяца подтверждён. Отправьте запрос на изменение дат руководителю отдела планирования.')
    }

    const currentClientIdForPricing = data.client_id !== undefined || data.items !== undefined
      ? await getMachineClientId(db, id)
      : undefined

    if (
      data.is_confirmed === true ||
      data.items !== undefined ||
      (data.deletedItemIds && data.deletedItemIds.length > 0)
    ) {
      const { data: machineData, error: machineError } = await db
        .from('machines')
        .select('is_confirmed')
        .eq('id', id)
        .single()

      if (machineError || !machineData) throw new Error('Машина не найдена')
      const currentMachine = machineData as { is_confirmed: boolean | null }
      const willBeConfirmed = data.is_confirmed ?? Boolean(currentMachine.is_confirmed)
      const resultingGoodsCount = data.items !== undefined
        ? data.items.filter((item) => !item.is_sample).length
        : await getMachineGoodsCountAfterDeleting(db, id, data.deletedItemIds || [])

      if (willBeConfirmed) {
        assertCanConfirmMachine(resultingGoodsCount > 0)
      }
    }

    let previousFactoryId: string | null | undefined
    let machineNameForNotifications: string | undefined
    let currentProductionMonth: string | null | undefined
    let currentProductionWorkshop: number | null | undefined
    let currentProductionQueueNumber: number | null | undefined
    if (
      data.factory_id !== undefined ||
      data.production_month !== undefined ||
      data.production_workshop !== undefined
    ) {
      const { data: machineData, error: machineError } = await db
        .from('machines')
        .select('name, factory_id, production_month, production_workshop, production_queue_number')
        .eq('id', id)
        .single()

      if (machineError || !machineData) throw new Error('Машина не найдена')
      const machine = machineData as {
        name: string
        factory_id: string | null
        production_month: string | null
        production_workshop: number | null
        production_queue_number: number | null
      }
      previousFactoryId = machine.factory_id
      machineNameForNotifications = machine.name
      currentProductionMonth = machine.production_month
      currentProductionWorkshop = machine.production_workshop
      currentProductionQueueNumber = machine.production_queue_number
    }

    // 1. Обновляем основные поля машины
    const machineUpdates: MachineUpdate = {}
    if (data.name !== undefined) machineUpdates.name = data.name
    if (data.client_id !== undefined) machineUpdates.client_id = data.client_id
    if (data.contract_id !== undefined) machineUpdates.contract_id = data.contract_id || null
    if (data.specification_number !== undefined) machineUpdates.specification_number = data.specification_number || null
    if (data.specification_date !== undefined) machineUpdates.specification_date = data.specification_date || null
    if (data.is_confirmed !== undefined) machineUpdates.is_confirmed = data.is_confirmed
    if (data.factory_id !== undefined) machineUpdates.factory_id = data.factory_id === 'none' ? null : data.factory_id
    if (data.material_type !== undefined) machineUpdates.material_type = data.material_type
    if (data.desired_shipping_date !== undefined) machineUpdates.desired_shipping_date = data.desired_shipping_date || null
    if (data.planned_material_date !== undefined) machineUpdates.planned_material_date = data.planned_material_date || null
    if (data.actual_shipping_date !== undefined) machineUpdates.actual_shipping_date = data.actual_shipping_date || null
    if (data.delivery_to_client_date !== undefined) machineUpdates.delivery_to_client_date = data.delivery_to_client_date || null
    if (data.production_month !== undefined) machineUpdates.production_month = data.production_month ? normalizeProductionMonth(data.production_month) : null
    if (data.production_workshop !== undefined) machineUpdates.production_workshop = data.production_workshop || null

    if (data.contract_id) {
      const contractClientId = data.client_id !== undefined ? data.client_id : await getMachineClientId(db, id)
      await assertContractBelongsToClient(db, data.contract_id, contractClientId)
    }

    const nextFactoryForQueue = data.factory_id !== undefined
      ? (data.factory_id === 'none' ? null : data.factory_id)
      : previousFactoryId
    const nextProductionMonth = machineUpdates.production_month !== undefined
      ? machineUpdates.production_month
      : currentProductionMonth
    const nextProductionWorkshop = machineUpdates.production_workshop !== undefined
      ? machineUpdates.production_workshop
      : currentProductionWorkshop
    const productionQueueGroupChanged =
      data.factory_id !== undefined ||
      data.production_month !== undefined ||
      data.production_workshop !== undefined

    if (productionQueueGroupChanged) {
      if (nextFactoryForQueue && nextProductionMonth && nextProductionWorkshop) {
        const factoryName = await getFactoryName(db, nextFactoryForQueue)
        if (!isFactoryWorkshopAllowed(factoryName, nextProductionWorkshop)) {
          throw new Error('Выбранный цех недоступен для этого завода')
        }
        const sameProductionGroup =
          nextFactoryForQueue === previousFactoryId &&
          nextProductionMonth === currentProductionMonth &&
          nextProductionWorkshop === currentProductionWorkshop &&
          currentProductionQueueNumber

        machineUpdates.production_queue_number = sameProductionGroup
          ? currentProductionQueueNumber
          : await getNextProductionQueueNumber(db, nextProductionMonth, nextFactoryForQueue, nextProductionWorkshop, id)
      } else {
        machineUpdates.production_month = null
        machineUpdates.production_workshop = null
        machineUpdates.production_queue_number = null
      }
    }

    if (Object.keys(machineUpdates).length > 0) {
      const { error } = await db.from('machines')
        .update(machineUpdates)
        .eq('id', id)
      
      if (error) throw error
      if (data.actual_shipping_date) {
        const promotion = await promoteShippedProjectSamplesToProducts(id)
        if (!promotion.success) throw new Error(promotion.error || 'Не удалось добавить изготовленный образец в базу продукции')
      }

      const nextFactoryId = data.factory_id === 'none' ? null : data.factory_id
      if (data.factory_id !== undefined && nextFactoryId && previousFactoryId !== nextFactoryId) {
        await notifyProductionManagersAboutFactoryAssignment(
          supabase,
          nextFactoryId,
          id,
          data.name || machineNameForNotifications || 'Машина'
        )
      }

      if (
        data.factory_id !== undefined ||
        data.material_type !== undefined ||
        data.planned_material_date !== undefined
      ) {
        await notifyNewTasks(id)
      }

      if (data.material_type !== undefined) {
        await refreshMaterialUndefinedAgenda(supabase, data.material_type)
      }
      if (productionQueueGroupChanged) {
        await notifyMachineEnteredReadyProductionPlan(id, user.id)
      }
    }

    // 2. Machine Items: создание, обновление, удаление
    // Обновляем записи с id, добавляем новые без id, удаляем явно удаленные.
    if (data.deletedItemIds && data.deletedItemIds.length > 0) {
      await db.from('machine_items').delete().in('id', data.deletedItemIds)
    }
    
    if (data.items) {
      const nextClientId = data.client_id !== undefined ? data.client_id : currentClientIdForPricing
      const clientChanged = data.client_id !== undefined && data.client_id !== currentClientIdForPricing
      const existingIds = data.items
        .map((item) => (item as MachineItem & { id?: string }).id)
        .filter((id): id is string => Boolean(id))
      const { data: existingItemsData, error: existingItemsError } = existingIds.length > 0
        ? await db.from('machine_items').select('id, product_id, product_version_id, product_project_id, product_project_version_id, coating, price').in('id', existingIds)
        : { data: [], error: null }
      if (existingItemsError) throw existingItemsError
      const existingItems = new Map(((existingItemsData || []) as Pick<MachineItem, 'id' | 'product_id' | 'product_version_id' | 'product_project_id' | 'product_project_version_id' | 'coating' | 'price'>[]).map((item) => [item.id, item]))
      const productIdsForInsert = data.items.flatMap((item) => {
        const itemObj = item as MachineItem & { id?: string }
        const existing = itemObj.id ? existingItems.get(itemObj.id) : null
        if (existing?.product_id || existing?.product_project_id) return []
        if (item.product_project_id) return []
        if (!itemObj.id || item.product_id) return [requireItemProductId(item, `Позиция ${data.items!.indexOf(item) + 1}`)]
        return []
      })
      const productVersionRefsForInsert = data.items.flatMap((item) => {
        const itemObj = item as MachineItem & { id?: string }
        const existing = itemObj.id ? existingItems.get(itemObj.id) : null
        if (existing?.product_id || existing?.product_project_id) return []
        if (item.product_project_id) return []
        if (!itemObj.id || item.product_id) {
          const index = data.items!.indexOf(item)
          return [{
            productId: requireItemProductId(item, `Позиция ${index + 1}`),
            productVersionId: itemProductVersionId(item),
            context: `Позиция ${index + 1}`,
          }]
        }
        return []
      })
      const sampleRefsForInsert = data.items.flatMap((item) => {
        const itemObj = item as MachineItem & { id?: string }
        const existing = itemObj.id ? existingItems.get(itemObj.id) : null
        if (existing?.product_id || existing?.product_project_id) return []
        if (item.product_project_id || item.is_sample) return [requireSampleProjectRef(item, `Образец ${data.items!.indexOf(item) + 1}`)]
        return []
      })
      const productIdsForPriceLookup = data.items.flatMap((item) => {
        const itemObj = item as MachineItem & { id?: string }
        const existing = itemObj.id ? existingItems.get(itemObj.id) : null
        const productId = existing?.product_id || item.product_id
        if (!productId || item.product_project_id || item.is_sample) return []
        return [productId]
      })
      const productMap = await loadActiveProductSnapshots(db, productIdsForInsert)
      const productVersionMap = await loadProductVersionSnapshots(db, productVersionRefsForInsert)
      const sampleMap = await loadApprovedProjectSampleSnapshots(db, sampleRefsForInsert, nextClientId)
      const priceDb = clientPriceDb()
      const clientPriceLookup = await loadClientProductPriceLookup(priceDb, nextClientId, productIdsForPriceLookup)

      for (const [index, item] of data.items.entries()) {
        const itemObj = item as MachineItem & { id?: string }
        if (itemObj.id) {
          const existing = existingItems.get(itemObj.id)
          if (!existing) throw new Error('Позиция машины не найдена')
          if (existing.product_id || existing.product_project_id) {
            if (item.product_id && item.product_id !== existing.product_id) {
              throw new Error('Нельзя менять продукт в существующей строке машины. Удалите строку и добавьте новый товар из базы.')
            }
            const requestedProductVersionId = itemProductVersionId(item)
            if (existing.product_id && existing.product_version_id && requestedProductVersionId && requestedProductVersionId !== existing.product_version_id) {
              throw new Error('Нельзя менять версию продукта в существующей строке машины. Удалите строку и добавьте новый товар из базы.')
            }
            if (item.product_project_id && item.product_project_id !== existing.product_project_id) {
              throw new Error('Нельзя менять проект образца в существующей строке машины. Удалите строку и добавьте новый образец.')
            }
            let priceEur: number | undefined
            if (existing.product_id) {
              const nextCoating = itemCoating({ coating: item.coating || existing.coating })
              if (clientChanged || nextCoating !== existing.coating) {
                priceEur = await resolveProductBackedPrice(
                  priceDb,
                  clientPriceLookup,
                  nextClientId,
                  existing.product_id,
                  nextCoating,
                  item.price ?? existing.price,
                  user.id,
                )
              }
            }
            await db.from('machine_items').update(productBackedItemUpdate(item, index, priceEur)).eq('id', itemObj.id)
          } else if (item.product_project_id) {
            const ref = requireSampleProjectRef(item, `Образец ${index + 1}`)
            const sample = sampleMap.get(sampleKey(ref.project_id, ref.version_id))
            if (!sample) throw new Error('Выбранный проект образца не найден')
            const payload = projectSampleItemPayload(id, item, sample, index)
            const { machine_id, ...updatePayload } = payload
            void machine_id
            await db.from('machine_items').update(updatePayload satisfies MachineItemUpdate).eq('id', itemObj.id)
          } else if (item.product_id) {
            const product = productMap.get(item.product_id)
            if (!product) throw new Error('Выбранный товар не найден в базе продукции')
            const priceEur = await resolveProductBackedPrice(
              priceDb,
              clientPriceLookup,
              nextClientId,
              product.id,
              itemCoating(item),
              item.price,
              user.id,
            )
            const productVersion = resolvedProductVersion(productVersionMap, product.id, itemProductVersionId(item))
            const payload = productBackedItemPayload(id, item, product, productVersion, priceEur, index)
            const { machine_id, ...updatePayload } = payload
            void machine_id
            const { error: updateError } = await db
              .from('machine_items')
              .update(updatePayload satisfies MachineItemUpdate)
              .eq('id', itemObj.id)
            if (updateError) throw updateError
            await ensureProductVersionCompletionTask(db, {
              productVersion,
              productName: product.name_uk,
              machineId: id,
              assignedTo: user.id,
            })
          } else {
            await db.from('machine_items').update({
              drawing_number: item.drawing_number,
              product_name: item.product_name,
              price: item.price,
              quantity: item.quantity,
              coating: item.coating,
              ral_number: item.ral_number || null,
              is_sample: item.is_sample ?? false,
              sort_order: index
            } satisfies MachineItemUpdate).eq('id', itemObj.id)
          }
        } else {
          if (item.is_sample || item.product_project_id) {
            const ref = requireSampleProjectRef(item, `Образец ${index + 1}`)
            const sample = sampleMap.get(sampleKey(ref.project_id, ref.version_id))
            if (!sample) throw new Error('Выбранный проект образца не найден')
            await db.from('machine_items').insert(projectSampleItemPayload(id, item, sample, index) satisfies MachineItemInsert)
            continue
          }
          const productId = requireItemProductId(item, `Позиция ${index + 1}`)
          const product = productMap.get(productId)
          if (!product) throw new Error('Выбранный товар не найден в базе продукции')
          const productVersion = resolvedProductVersion(productVersionMap, product.id, itemProductVersionId(item))
          const priceEur = await resolveProductBackedPrice(
            priceDb,
            clientPriceLookup,
            nextClientId,
            product.id,
            itemCoating(item),
            item.price,
            user.id,
          )
          const { error: insertError } = await db
            .from('machine_items')
            .insert(productBackedItemPayload(id, item, product, productVersion, priceEur, index) satisfies MachineItemInsert)
          if (insertError) throw insertError
          await ensureProductVersionCompletionTask(db, {
            productVersion,
            productName: product.name_uk,
            machineId: id,
            assignedTo: user.id,
          })
        }
      }
    }

    // 3. Machine Expenses
    if (data.deletedExpenseIds && data.deletedExpenseIds.length > 0) {
      await db.from('machine_expenses').delete().in('id', data.deletedExpenseIds)
    }

    if (data.expenses) {
      for (const exp of data.expenses) {
        const expObj = exp as MachineExpense & { id?: string }
        if (expObj.id) {
          await db.from('machine_expenses').update({
            category: exp.category,
            amount: exp.amount,
            comment: exp.comment || null
          } satisfies MachineExpenseUpdate).eq('id', expObj.id)
        } else {
          await db.from('machine_expenses').insert({
            machine_id: id,
            category: exp.category,
            amount: exp.amount,
            comment: exp.comment || null
          } satisfies MachineExpenseInsert)
        }
      }
    }

    if (
      data.items !== undefined ||
      data.deletedItemIds !== undefined ||
      data.is_confirmed !== undefined ||
      data.material_type !== undefined
    ) {
      await syncMaterialTypeTask(db, id)
      await notifyNewTasks(id)
    }

    if (
      data.expenses !== undefined ||
      data.deletedExpenseIds !== undefined ||
      data.desired_shipping_date !== undefined
    ) {
      await syncTransportCostTask(db, id)
    }

    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(`${ROUTES.SALES_PLAN}/${id}`)
    revalidatePath(ROUTES.TASKS)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

// === Удаление ===
export async function deleteMachine(id: string) {
  try {
    const { supabase, db, user } = await requireSalesPlanPermission('manage')

    await cleanupMachineAgendaReferences(supabase as unknown as RpcClient, id)
    await deleteMachineWithInventoryCleanup(supabase as unknown as RpcClient, db, id, user.id)

    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(`${ROUTES.SALES_PLAN}/${id}`)
    revalidatePath(ROUTES.TASKS)
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.GANTT)
    revalidatePath(ROUTES.MEETINGS)
    revalidatePath(ROUTES.MEETINGS_AGENDA_POOL)
    revalidatePath(ROUTES.SUPPLY)
    revalidatePath(ROUTES.SUPPLY_ORDERS)
    revalidatePath(ROUTES.INVENTORY)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function archiveMachine(id: string, reason?: string) {
  try {
    const { supabase, db, user } = await requireSalesPlanPermission('manage')

    const { data: machineData, error: machineError } = await db
      .from('machines')
      .select('id, is_archived')
      .eq('id', id)
      .single()

    if (machineError || !machineData) throw new Error('Машина не найдена')
    if ((machineData as { is_archived?: boolean }).is_archived) {
      throw new Error('Машина уже архивирована')
    }

    await cleanupMachineAgendaReferences(supabase as unknown as RpcClient, id)

    const { error: updateError } = await db
      .from('machines')
      .update({
        is_archived: true,
        archived_at: new Date().toISOString(),
        archived_by: user.id,
        archive_reason: reason?.trim() || null,
        updated_at: new Date().toISOString(),
      } satisfies MachineUpdate)
      .eq('id', id)

    if (updateError) throw updateError

    const { error: taskError } = await db
      .from('tasks')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('machine_id', id)
      .in('status', ['pending', 'in_progress'])

    if (taskError) throw taskError

    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(`${ROUTES.SALES_PLAN}/${id}`)
    revalidatePath(ROUTES.TASKS)
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.GANTT)
    revalidatePath(ROUTES.MEETINGS)
    revalidatePath(ROUTES.MEETINGS_AGENDA_POOL)
    revalidatePath(ROUTES.SUPPLY)
    revalidatePath(ROUTES.SUPPLY_ORDERS)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

// === MACHINE ITEMS (Single Actions) ===
export async function addMachineItem(machineId: string, data: unknown) {
  try {
    const { db, user } = await requireSalesPlanPermission('manage')
    requireMachineMutationAccess(user)
    await assertMachineNotArchived(db, machineId)
    const parsed = machineItemActionSchema.parse(data)
    const clientId = await getMachineClientId(db, machineId)
    if (parsed.is_sample || parsed.product_project_id) {
      const ref = requireSampleProjectRef(parsed, 'Новый образец')
      const sampleMap = await loadApprovedProjectSampleSnapshots(db, [ref], clientId)
      const sample = sampleMap.get(sampleKey(ref.project_id, ref.version_id))
      if (!sample) throw new Error('Выбранный проект образца не найден')
      const { error } = await db.from('machine_items').insert(projectSampleItemPayload(machineId, parsed, sample, 0))
      if (error) throw error
      await syncCoatingDependentProductionStages(db, machineId)
      await syncMaterialTypeTask(db, machineId)
      await notifyNewTasks(machineId)
      revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
      revalidatePath(ROUTES.PRODUCTION)
      revalidatePath(ROUTES.GANTT)
      return { success: true, error: null }
    }
    const productId = requireItemProductId(parsed, 'Новая позиция')
    const productMap = await loadActiveProductSnapshots(db, [productId])
    const product = productMap.get(productId)
    if (!product) throw new Error('Выбранный товар не найден в базе продукции')
    const productVersionMap = await loadProductVersionSnapshots(db, [{
      productId,
      productVersionId: itemProductVersionId(parsed),
      context: 'Новая позиция',
    }])
    const productVersion = resolvedProductVersion(productVersionMap, product.id, itemProductVersionId(parsed))
    const priceDb = clientPriceDb()
    const clientPriceLookup = await loadClientProductPriceLookup(priceDb, clientId, [productId])
    const priceEur = await resolveProductBackedPrice(
      priceDb,
      clientPriceLookup,
      clientId,
      product.id,
      itemCoating(parsed),
      parsed.price,
      user.id,
    )
    const { error } = await db.from('machine_items').insert(productBackedItemPayload(machineId, parsed, product, productVersion, priceEur, 0))
    if (error) throw error
    await ensureProductVersionCompletionTask(db, {
      productVersion,
      productName: product.name_uk,
      machineId,
      assignedTo: user.id,
    })
    await syncCoatingDependentProductionStages(db, machineId)
    await syncMaterialTypeTask(db, machineId)
    await notifyNewTasks(machineId)
    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.GANTT)
    return { success: true, error: null }
  } catch (err: unknown) { return { success: false, error: getErrorMessage(err) } }
}

export async function updateMachineConfirmation(id: string, isConfirmed: boolean) {
  try {
    const { db, user } = await requireSalesPlanPermission('manage')

    const { data: machineData, error: machineError } = await db
      .from('machines')
      .select('created_by, is_archived')
      .eq('id', id)
      .single()

    if (machineError || !machineData) throw new Error('Машина не найдена')
    const machine = machineData as { created_by: string; is_archived?: boolean }
    if (machine.is_archived) throw new Error('Машина архивирована. Действия с ней остановлены.')

    const canEditConfirmation = user.role === 'sales_manager'
      ? machine.created_by === user.id
      : true

    if (!canEditConfirmation) {
      throw new Error('Недостаточно прав для изменения подтверждения')
    }

    if (isConfirmed) {
      const goodsCount = await getMachineGoodsCount(db, id)
      assertCanConfirmMachine(goodsCount > 0)
    }

    const { error } = await db
      .from('machines')
      .update({ is_confirmed: isConfirmed } satisfies MachineUpdate)
      .eq('id', id)

    if (error) throw error

    after(async () => {
      await notifyNewTasks(id).catch((notificationError) => {
        console.error('Не удалось отправить уведомления после подтверждения машины:', notificationError)
      })
    })

    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(`${ROUTES.SALES_PLAN}/${id}`)
    revalidatePath(ROUTES.TASKS)
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.GANTT)

    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function updateMachineItem(itemId: string, data: unknown, machineId: string) {
  try {
    const { db, user } = await requireSalesPlanPermission('manage')
    requireMachineMutationAccess(user)
    await assertMachineNotArchived(db, machineId)
    const parsed = machineItemUpdateSchema.parse(data)
    const { data: existingData, error: existingError } = await db
      .from('machine_items')
      .select('id, product_id, product_version_id, product_project_id, product_project_version_id, quantity, coating, price, is_sample, sort_order')
      .eq('id', itemId)
      .eq('machine_id', machineId)
      .single()
    if (existingError || !existingData) throw existingError || new Error('Позиция не найдена')
    const existing = existingData as Pick<MachineItem, 'id' | 'product_id' | 'product_version_id' | 'product_project_id' | 'product_project_version_id' | 'quantity' | 'coating' | 'price' | 'is_sample' | 'sort_order'>
    const clientId = await getMachineClientId(db, machineId)
    let updatePayload: MachineItemUpdate
    let productVersionTaskToEnsure: { productVersion: ProductVersionCompletionSnapshot; productName: string } | null = null
    if (existing.product_id || existing.product_project_id) {
      const requestedProductVersionId = itemProductVersionId(parsed)
      if (existing.product_id && existing.product_version_id && requestedProductVersionId && requestedProductVersionId !== existing.product_version_id) {
        throw new Error('Нельзя менять версию продукта в существующей строке машины. Удалите строку и добавьте новый товар из базы.')
      }
      updatePayload = {
        quantity: parsed.quantity,
        coating: parsed.coating,
        ral_number: parsed.ral_number || null,
      }
      if (existing.product_id && parsed.coating && parsed.coating !== existing.coating) {
        const priceDb = clientPriceDb()
        const clientPriceLookup = await loadClientProductPriceLookup(priceDb, clientId, [existing.product_id])
        updatePayload.price = await resolveProductBackedPrice(
          priceDb,
          clientPriceLookup,
          clientId,
          existing.product_id,
          itemCoating({ coating: parsed.coating }),
          parsed.price ?? existing.price,
          user.id,
        )
      }
    } else if (parsed.product_project_id) {
      const ref = requireSampleProjectRef(parsed, 'Образец')
      const sampleMap = await loadApprovedProjectSampleSnapshots(db, [ref], clientId)
      const sample = sampleMap.get(sampleKey(ref.project_id, ref.version_id))
      if (!sample) throw new Error('Выбранный проект образца не найден')
      const { machine_id, ...payload } = projectSampleItemPayload(machineId, {
        ...parsed,
        quantity: parsed.quantity || existing.quantity,
        coating: parsed.coating || existing.coating,
        is_sample: true,
      } as NonNullable<CreateMachineInput['items']>[number], sample, existing.sort_order)
      void machine_id
      updatePayload = payload
    } else if (parsed.product_id) {
      const productMap = await loadActiveProductSnapshots(db, [parsed.product_id])
      const product = productMap.get(parsed.product_id)
      if (!product) throw new Error('Выбранный товар не найден в базе продукции')
      const productVersionMap = await loadProductVersionSnapshots(db, [{
        productId: parsed.product_id,
        productVersionId: itemProductVersionId(parsed),
        context: 'Позиция',
      }])
      const productVersion = resolvedProductVersion(productVersionMap, product.id, itemProductVersionId(parsed))
      const priceDb = clientPriceDb()
      const clientPriceLookup = await loadClientProductPriceLookup(priceDb, clientId, [parsed.product_id])
      const priceEur = await resolveProductBackedPrice(
        priceDb,
        clientPriceLookup,
        clientId,
        product.id,
        itemCoating({ coating: parsed.coating || existing.coating }),
        parsed.price ?? existing.price,
        user.id,
      )
      const { machine_id, ...payload } = productBackedItemPayload(machineId, {
        ...parsed,
        quantity: parsed.quantity || existing.quantity,
        coating: parsed.coating || existing.coating,
        is_sample: parsed.is_sample ?? existing.is_sample,
      } as NonNullable<CreateMachineInput['items']>[number], product, productVersion, priceEur, existing.sort_order)
      void machine_id
      updatePayload = payload
      productVersionTaskToEnsure = { productVersion, productName: product.name_uk }
    } else {
      const {
        weight: _ignoredWeight,
        product_id: _ignoredProductId,
        product_version_id: _ignoredProductVersionId,
        productVersionId: _ignoredProductVersionIdCamel,
        product_project_id: _ignoredProjectId,
        product_project_version_id: _ignoredVersionId,
        ...legacyPayload
      } = parsed
      void _ignoredWeight
      void _ignoredProductId
      void _ignoredProductVersionId
      void _ignoredProductVersionIdCamel
      void _ignoredProjectId
      void _ignoredVersionId
      updatePayload = legacyPayload
    }
    const { error } = await db.from('machine_items').update(updatePayload).eq('id', itemId).eq('machine_id', machineId)
    if (error) throw error
    if (productVersionTaskToEnsure) {
      await ensureProductVersionCompletionTask(db, {
        ...productVersionTaskToEnsure,
        machineId,
        assignedTo: user.id,
      })
    }
    await syncCoatingDependentProductionStages(db, machineId)
    await syncMaterialTypeTask(db, machineId)
    await notifyNewTasks(machineId)
    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.GANTT)
    return { success: true, error: null }
  } catch (err: unknown) { return { success: false, error: getErrorMessage(err) } }
}

export async function deleteMachineItem(itemId: string, machineId: string) {
  try {
    const { db, user } = await requireSalesPlanPermission('manage')
    requireMachineMutationAccess(user)
    await assertMachineNotArchived(db, machineId)
    const { data: machineData, error: machineError } = await db
      .from('machines')
      .select('is_confirmed')
      .eq('id', machineId)
      .single()

    if (machineError || !machineData) throw new Error('Машина не найдена')
    const machine = machineData as { is_confirmed: boolean | null }
    if (machine.is_confirmed && (await getMachineGoodsCountAfterDeleting(db, machineId, [itemId])) <= 0) {
      throw new Error('Нельзя удалить последний товар у подтверждённой машины. Сначала снимите подтверждение.')
    }

    const { error } = await db.from('machine_items').delete().eq('id', itemId).eq('machine_id', machineId)
    if (error) throw error
    await syncCoatingDependentProductionStages(db, machineId)
    await syncMaterialTypeTask(db, machineId)
    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.GANTT)
    return { success: true, error: null }
  } catch (err: unknown) { return { success: false, error: getErrorMessage(err) } }
}

// === MACHINE EXPENSES (Single Actions) ===
export async function addMachineExpense(machineId: string, data: unknown) {
  try {
    const { db, user } = await requireSalesPlanPermission('manage')
    requireMachineMutationAccess(user)
    await assertMachineNotArchived(db, machineId)
    const parsed = machineExpenseActionSchema.parse(data)
    const expensePayload = omitExpenseId(parsed)
    const { error } = await db.from('machine_expenses').insert({
      machine_id: machineId,
      ...expensePayload
    })
    if (error) throw error
    await syncTransportCostTask(db, machineId)
    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    revalidatePath(ROUTES.TASKS)
    return { success: true, error: null }
  } catch (err: unknown) { return { success: false, error: getErrorMessage(err) } }
}

export async function updateMachineExpense(expenseId: string, data: unknown, machineId: string) {
  try {
    const { db, user } = await requireSalesPlanPermission('manage')
    requireMachineMutationAccess(user)
    await assertMachineNotArchived(db, machineId)
    const parsed = machineExpenseUpdateSchema.parse(data)
    const expensePayload = omitExpenseId(parsed)
    const { error } = await db.from('machine_expenses').update(expensePayload).eq('id', expenseId).eq('machine_id', machineId)
    if (error) throw error
    await syncTransportCostTask(db, machineId)
    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    revalidatePath(ROUTES.TASKS)
    return { success: true, error: null }
  } catch (err: unknown) { return { success: false, error: getErrorMessage(err) } }
}

export async function deleteMachineExpense(expenseId: string, machineId: string) {
  try {
    const { db, user } = await requireSalesPlanPermission('manage')
    requireMachineMutationAccess(user)
    await assertMachineNotArchived(db, machineId)
    const { error } = await db.from('machine_expenses').delete().eq('id', expenseId).eq('machine_id', machineId)
    if (error) throw error
    await syncTransportCostTask(db, machineId)
    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    revalidatePath(ROUTES.TASKS)
    return { success: true, error: null }
  } catch (err: unknown) { return { success: false, error: getErrorMessage(err) } }
}
