'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserContext } from '@/lib/auth/current-user'
import { ROUTES } from '@/lib/constants/routes'
import { dispatchPendingTelegramDeliveries } from '@/lib/services/task-notifications'
import {
  consumableCategoryInputSchema,
  consumableDeliveryInputSchema,
  consumableDraftInputSchema,
  consumableItemInputSchema,
  consumablePrioritySchema,
  consumableStockOperationSchema,
  type ConsumableCategory,
  type ConsumableDeliveryInput,
  type ConsumableDraftInput,
  type ConsumableItemInput,
  type ConsumableMovement,
  type ConsumablePriority,
  type ConsumableRequest,
  type ConsumableRequestStatus,
  type ConsumableStockOperationInput,
  type ConsumableStockRow,
} from '@/lib/types/consumables'
import type { CurrentUser, FactorySummary, UserRole } from '@/lib/types'

const DIRECTORS: UserRole[] = ['financial_director', 'commercial_director', 'planning_director']
const SUPPLY_ROLES: UserRole[] = ['supply_manager', 'procurement_head', ...DIRECTORS]
const PRODUCTION_ROLES: UserRole[] = ['production_manager', ...DIRECTORS]
const CRM_ADMIN_POSITION_NAME = 'Администратор CRM'
const PLANNING_DEPARTMENT_KEYWORD = 'планирован'
type AdminClient = SupabaseClient

type ActionResult<T = undefined> = {
  success: boolean
  data?: T
  error: string | null
}

type LooseError = { message?: string; details?: string; hint?: string; code?: string }
type FactoryIdRow = { factory_id: string }

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const dbError = error as LooseError
    if (dbError.code === '23505') return 'Запись с такими данными уже существует'
    return [dbError.message, dbError.details, dbError.hint].filter(Boolean).join(' ')
  }
  return String(error || 'Неизвестная ошибка')
}

function isDirector(role: UserRole) {
  return DIRECTORS.includes(role)
}

function isCrmAdminUser(user: Pick<CurrentUser, 'department_memberships'>) {
  return Boolean(
    user.department_memberships?.some((membership) => membership.position?.name === CRM_ADMIN_POSITION_NAME),
  )
}

function normalizeText(value: string | null | undefined) {
  return (value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim()
}

function isIgorRiabov(user: Pick<CurrentUser, 'full_name' | 'email'>) {
  const fullName = normalizeText(user.full_name)
  const email = normalizeText(user.email)
  return (
    fullName === 'игорь рябов'
    || fullName === 'игор рябов'
    || fullName === 'igor riabov'
    || fullName === 'ihor riabov'
    || email.includes('igorriabov')
  )
}

function isPlanningDepartmentHead(user: Pick<CurrentUser, 'department_memberships'>) {
  return Boolean(
    user.department_memberships?.some((membership) => (
      membership.is_department_head
      && (
        normalizeText(membership.department?.name).includes(PLANNING_DEPARTMENT_KEYWORD)
        || normalizeText(membership.position?.name).includes(PLANNING_DEPARTMENT_KEYWORD)
      )
    )),
  )
}

function canAdjustConsumableStock(user: CurrentUser, role: UserRole, isCrmAdmin: boolean) {
  return role === 'planning_director' || isPlanningDepartmentHead(user) || (isCrmAdmin && isIgorRiabov(user))
}

function canManageProductionConsumables(role: UserRole, isCrmAdmin: boolean) {
  return isCrmAdmin || PRODUCTION_ROLES.includes(role)
}

function canManageSupplyConsumables(role: UserRole, isCrmAdmin: boolean) {
  return isCrmAdmin || SUPPLY_ROLES.includes(role)
}

async function getContext() {
  const context = await getCurrentUserContext()
  return {
    ...context,
    isCrmAdmin: isCrmAdminUser(context.user),
    admin: createAdminClient() as AdminClient,
    client: context.supabase as SupabaseClient,
  }
}

function assertFactoryAccess(
  role: UserRole,
  userFactoryId: string | null,
  factoryId: string,
  mode: 'catalog' | 'requests',
  isCrmAdmin = false,
) {
  if (isCrmAdmin) return
  if (isDirector(role)) return
  if (role === 'production_manager' && userFactoryId === factoryId) return
  if (mode === 'requests' && (role === 'supply_manager' || role === 'procurement_head')) return
  throw new Error('Недостаточно прав для выбранного завода')
}

function assertCatalogRole(role: UserRole, isCrmAdmin = false) {
  if (!canManageProductionConsumables(role, isCrmAdmin)) throw new Error('Недостаточно прав для управления расходниками')
}

function assertRequestsRole(role: UserRole, isCrmAdmin = false) {
  if (isCrmAdmin) return
  if (![...PRODUCTION_ROLES, 'supply_manager', 'procurement_head'].includes(role)) {
    throw new Error('Недостаточно прав для заявок на расходники')
  }
}

async function getFactoryIdForConsumable(admin: AdminClient, consumableId: string) {
  const { data, error } = await admin
    .from('consumables')
    .select('factory_id')
    .eq('id', consumableId)
    .maybeSingle()
  const row = data as FactoryIdRow | null
  if (error || !row) throw new Error(error?.message || 'Расходник не найден')
  return row.factory_id
}

async function getFactoryIdForRequest(admin: AdminClient, requestId: string) {
  const { data, error } = await admin
    .from('consumable_requests')
    .select('factory_id')
    .eq('id', requestId)
    .maybeSingle()
  const row = data as FactoryIdRow | null
  if (error || !row) throw new Error(error?.message || 'Заявка не найдена')
  return row.factory_id
}

function revalidateConsumables() {
  revalidatePath(ROUTES.PRODUCTION_CONSUMABLES)
  revalidatePath(ROUTES.PRODUCTION_CONSUMABLE_REQUESTS)
  revalidatePath(ROUTES.SUPPLY_CONSUMABLE_REQUESTS)
  revalidatePath(ROUTES.TASKS)
  revalidatePath(ROUTES.NOTIFICATIONS)
}

async function getVisibleFactoriesForRole(
  role: UserRole,
  factoryId: string | null,
  catalogOnly = false,
  isCrmAdmin = false,
) {
  const admin = createAdminClient() as AdminClient
  let query = admin.from('factories').select('id, name').order('name')
  if (role === 'production_manager' && !isCrmAdmin) query = query.eq('id', factoryId || '00000000-0000-0000-0000-000000000000')
  if (catalogOnly && !canManageProductionConsumables(role, isCrmAdmin)) return []
  const { data, error } = await query
  if (error) throw error
  return (data || []) as FactorySummary[]
}

export async function getConsumablesWorkspaceData(factoryId?: string | null) {
  const { role, factoryId: userFactoryId, isCrmAdmin, user, admin } = await getContext()
  assertCatalogRole(role, isCrmAdmin)
  const factories = await getVisibleFactoriesForRole(role, userFactoryId, true, isCrmAdmin)
  const selectedFactoryId = factories.some((factory) => factory.id === factoryId)
    ? factoryId!
    : factories[0]?.id

  if (!selectedFactoryId) {
    return { factories, selectedFactoryId: null, categories: [], stock: [], movements: [], canAdjustStock: false }
  }
  assertFactoryAccess(role, userFactoryId, selectedFactoryId, 'catalog', isCrmAdmin)

  const [categoriesResult, stockResult, movementsResult] = await Promise.all([
    admin
      .from('consumable_categories')
      .select('*')
      .eq('factory_id', selectedFactoryId)
      .order('is_active', { ascending: false })
      .order('name'),
    admin
      .from('consumable_stock_overview')
      .select('*')
      .eq('factory_id', selectedFactoryId)
      .order('is_active', { ascending: false })
      .order('category_name')
      .order('name'),
    admin
      .from('consumable_movements')
      .select(`
        *,
        consumable:consumables(name, unit),
        author:users!consumable_movements_created_by_fkey(full_name)
      `)
      .eq('factory_id', selectedFactoryId)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const error = categoriesResult.error || stockResult.error || movementsResult.error
  if (error) throw error

  return {
    factories,
    selectedFactoryId,
    categories: (categoriesResult.data || []) as ConsumableCategory[],
    stock: (stockResult.data || []) as ConsumableStockRow[],
    movements: (movementsResult.data || []) as ConsumableMovement[],
    canAdjustStock: canAdjustConsumableStock(user, role, isCrmAdmin),
  }
}

export async function getConsumableRequestsPageData(
  mode: 'production' | 'supply',
  factoryId?: string | null,
) {
  const { role, factoryId: userFactoryId, isCrmAdmin, admin } = await getContext()
  assertRequestsRole(role, isCrmAdmin)
  if (mode === 'production' && !canManageProductionConsumables(role, isCrmAdmin)) throw new Error('Недостаточно прав производства')
  if (mode === 'supply' && !canManageSupplyConsumables(role, isCrmAdmin)) throw new Error('Недостаточно прав снабжения')

  const factories = await getVisibleFactoriesForRole(role, userFactoryId, false, isCrmAdmin)
  const selectedFactoryId = factoryId === 'all' && (role !== 'production_manager' || isCrmAdmin)
    ? 'all'
    : factories.some((factory) => factory.id === factoryId)
      ? factoryId!
      : role === 'production_manager' && !isCrmAdmin
        ? factories[0]?.id
        : 'all'

  let requestQuery = admin
    .from('consumable_requests')
    .select(`
      *,
      consumable:consumables(
        id,
        name,
        article,
        characteristics,
        unit,
        category:consumable_categories(name)
      ),
      factory:factories(id, name),
      creator:users!consumable_requests_created_by_fkey(id, full_name),
      receipts:consumable_request_receipts(
        id,
        quantity,
        received_at,
        receiver:users!consumable_request_receipts_received_by_fkey(full_name)
      )
    `)
    .order('created_at', { ascending: false })
    .limit(500)

  if (selectedFactoryId !== 'all') requestQuery = requestQuery.eq('factory_id', selectedFactoryId)
  if (mode === 'supply') requestQuery = requestQuery.neq('status', 'draft')

  let stockQuery = admin
    .from('consumable_stock_overview')
    .select('*')
    .eq('is_active', true)
    .order('name')
  if (selectedFactoryId !== 'all') stockQuery = stockQuery.eq('factory_id', selectedFactoryId)

  const [requestsResult, stockResult] = await Promise.all([requestQuery, stockQuery])
  const error = requestsResult.error || stockResult.error
  if (error) throw error

  return {
    mode,
    role,
    isCrmAdmin,
    factories,
    selectedFactoryId,
    requests: (requestsResult.data || []) as ConsumableRequest[],
    stock: (stockResult.data || []) as ConsumableStockRow[],
  }
}

export async function getConsumableRequestDetails(requestId: string) {
  const { role, factoryId, isCrmAdmin, admin } = await getContext()
  assertRequestsRole(role, isCrmAdmin)
  const requestFactoryId = await getFactoryIdForRequest(admin, requestId)
  assertFactoryAccess(role, factoryId, requestFactoryId, 'requests', isCrmAdmin)

  const { data, error } = await admin
    .from('consumable_requests')
    .select(`
      *,
      consumable:consumables(
        id,
        name,
        article,
        characteristics,
        unit,
        category:consumable_categories(name)
      ),
      factory:factories(id, name),
      creator:users!consumable_requests_created_by_fkey(id, full_name),
      receipts:consumable_request_receipts(
        id,
        quantity,
        received_at,
        receiver:users!consumable_request_receipts_received_by_fkey(full_name)
      ),
      events:consumable_request_events(
        id,
        event_type,
        old_status,
        new_status,
        details,
        created_at,
        author:users!consumable_request_events_created_by_fkey(full_name)
      )
    `)
    .eq('id', requestId)
    .maybeSingle()

  if (error || !data) throw new Error(error?.message || 'Заявка не найдена')
  const request = data as ConsumableRequest
  if (request.status === 'draft' && !canManageProductionConsumables(role, isCrmAdmin)) {
    throw new Error('Черновик еще не оформлен производством')
  }
  return request
}

export async function createConsumableCategory(input: {
  factoryId: string
  name: string
  description?: string | null
}): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = consumableCategoryInputSchema.parse(input)
    const { role, factoryId, isCrmAdmin, userId, admin } = await getContext()
    assertCatalogRole(role, isCrmAdmin)
    assertFactoryAccess(role, factoryId, parsed.factoryId, 'catalog', isCrmAdmin)

    const { data, error } = await admin
      .from('consumable_categories')
      .insert({
        factory_id: parsed.factoryId,
        name: parsed.name,
        description: parsed.description || null,
        created_by: userId,
      })
      .select('id')
      .single()
    if (error) throw error
    revalidateConsumables()
    return { success: true, data: { id: data.id }, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function archiveConsumableCategory(categoryId: string): Promise<ActionResult> {
  try {
    const { role, factoryId, isCrmAdmin, admin } = await getContext()
    assertCatalogRole(role, isCrmAdmin)
    const { data: category, error: categoryError } = await admin
      .from('consumable_categories')
      .select('factory_id')
      .eq('id', categoryId)
      .maybeSingle()
    if (categoryError || !category) throw new Error(categoryError?.message || 'Категория не найдена')
    assertFactoryAccess(role, factoryId, category.factory_id, 'catalog', isCrmAdmin)

    const updatedAt = new Date().toISOString()
    const { error: itemsError } = await admin
      .from('consumables')
      .update({ is_active: false, updated_at: updatedAt })
      .eq('factory_id', category.factory_id)
      .eq('category_id', categoryId)
      .eq('is_active', true)
    if (itemsError) throw itemsError

    const { error } = await admin
      .from('consumable_categories')
      .update({ is_active: false, updated_at: updatedAt })
      .eq('id', categoryId)
    if (error) throw error
    revalidateConsumables()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function createConsumable(input: ConsumableItemInput): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = consumableItemInputSchema.parse(input)
    const { role, factoryId, isCrmAdmin, client } = await getContext()
    assertCatalogRole(role, isCrmAdmin)
    assertFactoryAccess(role, factoryId, parsed.factoryId, 'catalog', isCrmAdmin)

    const { data, error } = await client.rpc('create_consumable_item', {
      p_factory_id: parsed.factoryId,
      p_category_id: parsed.categoryId,
      p_name: parsed.name,
      p_characteristics: parsed.characteristics,
      p_article: parsed.article,
      p_unit: parsed.unit,
      p_minimum_quantity: parsed.minimumQuantity,
      p_initial_quantity: parsed.initialQuantity,
    })
    if (error) throw error
    revalidateConsumables()
    return { success: true, data: { id: data as string }, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function updateConsumable(
  consumableId: string,
  input: Omit<ConsumableItemInput, 'factoryId' | 'initialQuantity'>,
): Promise<ActionResult> {
  try {
    const parsed = consumableItemInputSchema.omit({ factoryId: true, initialQuantity: true }).parse(input)
    const { role, factoryId, isCrmAdmin, admin, client } = await getContext()
    assertCatalogRole(role, isCrmAdmin)
    const itemFactoryId = await getFactoryIdForConsumable(admin, consumableId)
    assertFactoryAccess(role, factoryId, itemFactoryId, 'catalog', isCrmAdmin)

    const { data: category } = await admin
      .from('consumable_categories')
      .select('id')
      .eq('id', parsed.categoryId)
      .eq('factory_id', itemFactoryId)
      .eq('is_active', true)
      .maybeSingle()
    if (!category) throw new Error('Категория не найдена')

    const { error } = await admin
      .from('consumables')
      .update({
        category_id: parsed.categoryId,
        name: parsed.name,
        characteristics: parsed.characteristics,
        article: parsed.article,
        unit: parsed.unit,
        minimum_quantity: parsed.minimumQuantity,
        updated_at: new Date().toISOString(),
      })
      .eq('id', consumableId)
    if (error) throw error

    const { error: syncError } = await client.rpc('sync_consumable_auto_draft', {
      p_consumable_id: consumableId,
    })
    if (syncError) throw syncError
    revalidateConsumables()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function archiveConsumable(consumableId: string): Promise<ActionResult> {
  try {
    const { role, factoryId, isCrmAdmin, admin, client } = await getContext()
    assertCatalogRole(role, isCrmAdmin)
    const itemFactoryId = await getFactoryIdForConsumable(admin, consumableId)
    assertFactoryAccess(role, factoryId, itemFactoryId, 'catalog', isCrmAdmin)

    const { count } = await admin
      .from('consumable_requests')
      .select('id', { count: 'exact', head: true })
      .eq('consumable_id', consumableId)
      .in('status', ['new', 'invoice_taken', 'delivery'])
    if ((count || 0) > 0) throw new Error('Нельзя архивировать расходник с открытыми заявками')

    const { error } = await admin
      .from('consumables')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', consumableId)
    if (error) throw error
    await client.rpc('sync_consumable_auto_draft', { p_consumable_id: consumableId })
    revalidateConsumables()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function recordConsumableStockOperation(
  input: ConsumableStockOperationInput,
): Promise<ActionResult<{ balance: number }>> {
  try {
    const parsed = consumableStockOperationSchema.parse(input)
    const { role, factoryId, isCrmAdmin, user, admin, client } = await getContext()
    assertCatalogRole(role, isCrmAdmin)
    const itemFactoryId = await getFactoryIdForConsumable(admin, parsed.consumableId)
    assertFactoryAccess(role, factoryId, itemFactoryId, 'catalog', isCrmAdmin)
    if (parsed.operation === 'manual_receipt') {
      throw new Error('Ручной приход отключен. Приход расходников фиксируется только через получение заявки.')
    }
    if (parsed.operation === 'adjustment' && !canAdjustConsumableStock(user, role, isCrmAdmin)) {
      throw new Error('Сверка остатков доступна только Игорю Рябову (Администратор CRM) и начальнику отдела планирования.')
    }

    const { data, error } = await client.rpc('record_consumable_stock_operation', {
      p_consumable_id: parsed.consumableId,
      p_operation: parsed.operation,
      p_quantity: parsed.quantity,
      p_comment: parsed.comment || null,
      p_new_balance: parsed.newBalance ?? null,
    })
    if (error) throw error
    revalidateConsumables()
    return { success: true, data: { balance: Number(data) }, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function createConsumableRequestDraft(
  input: ConsumableDraftInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = consumableDraftInputSchema.parse(input)
    const { role, factoryId, isCrmAdmin, userId, admin } = await getContext()
    if (!canManageProductionConsumables(role, isCrmAdmin)) throw new Error('Создавать заявки может производство')
    const itemFactoryId = await getFactoryIdForConsumable(admin, parsed.consumableId)
    assertFactoryAccess(role, factoryId, itemFactoryId, 'requests', isCrmAdmin)

    const { data, error } = await admin
      .from('consumable_requests')
      .insert({
        factory_id: itemFactoryId,
        consumable_id: parsed.consumableId,
        created_by: userId,
        requested_quantity: parsed.quantity,
        priority: parsed.priority,
        notes: parsed.notes || null,
        auto_generated: false,
        quantity_is_automatic: false,
      })
      .select('id')
      .single()
    if (error) throw error
    revalidateConsumables()
    return { success: true, data: { id: data.id }, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function updateConsumableRequestDraft(
  requestId: string,
  input: Pick<ConsumableDraftInput, 'quantity' | 'priority' | 'notes'>,
): Promise<ActionResult> {
  try {
    const parsed = consumableDraftInputSchema.omit({ consumableId: true }).parse(input)
    const { role, factoryId, isCrmAdmin, admin } = await getContext()
    const requestFactoryId = await getFactoryIdForRequest(admin, requestId)
    assertFactoryAccess(role, factoryId, requestFactoryId, 'requests', isCrmAdmin)

    const { error } = await admin
      .from('consumable_requests')
      .update({
        requested_quantity: parsed.quantity,
        priority: parsed.priority,
        notes: parsed.notes || null,
        quantity_is_automatic: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('status', 'draft')
    if (error) throw error
    revalidateConsumables()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function submitConsumableRequest(
  requestId: string,
  priority: ConsumablePriority,
): Promise<ActionResult> {
  try {
    const parsedPriority = consumablePrioritySchema.parse(priority)
    const { role, factoryId, isCrmAdmin, admin, client } = await getContext()
    const requestFactoryId = await getFactoryIdForRequest(admin, requestId)
    assertFactoryAccess(role, factoryId, requestFactoryId, 'requests', isCrmAdmin)

    const { error } = await client.rpc('submit_consumable_request', {
      p_request_id: requestId,
      p_priority: parsedPriority,
    })
    if (error) throw error
    await dispatchPendingTelegramDeliveries()
    revalidateConsumables()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function cancelConsumableRequest(requestId: string, reason = ''): Promise<ActionResult> {
  try {
    const { role, factoryId, isCrmAdmin, admin, client } = await getContext()
    const requestFactoryId = await getFactoryIdForRequest(admin, requestId)
    assertFactoryAccess(role, factoryId, requestFactoryId, 'requests', isCrmAdmin)
    const { error } = await client.rpc('cancel_consumable_request', {
      p_request_id: requestId,
      p_reason: reason,
    })
    if (error) throw error
    revalidateConsumables()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function takeConsumableInvoice(requestId: string): Promise<ActionResult> {
  return transitionSupplyRequest(requestId, 'invoice_taken')
}

export async function startConsumableDelivery(input: ConsumableDeliveryInput): Promise<ActionResult> {
  try {
    const parsed = consumableDeliveryInputSchema.parse(input)
    return transitionSupplyRequest(parsed.requestId, 'delivery', parsed)
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

async function transitionSupplyRequest(
  requestId: string,
  status: Extract<ConsumableRequestStatus, 'invoice_taken' | 'delivery'>,
  delivery?: ConsumableDeliveryInput,
): Promise<ActionResult> {
  try {
    const { role, isCrmAdmin, client } = await getContext()
    if (!canManageSupplyConsumables(role, isCrmAdmin)) throw new Error('Недостаточно прав снабжения')

    const { error } = await client.rpc('transition_consumable_request_supply', {
      p_request_id: requestId,
      p_new_status: status,
      p_delivery_method: delivery?.method || null,
      p_nova_poshta_ttn: delivery?.ttn || null,
      p_carrier_name: delivery?.carrierName || null,
      p_carrier_eta: delivery?.carrierEta || null,
    })
    if (error) throw error
    await dispatchPendingTelegramDeliveries()
    revalidateConsumables()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function updateOtherDeliveryEta(requestId: string, carrierEta: string): Promise<ActionResult> {
  try {
    const { role, isCrmAdmin, client } = await getContext()
    if (!canManageSupplyConsumables(role, isCrmAdmin)) throw new Error('Недостаточно прав снабжения')
    const { error } = await client.rpc('update_consumable_other_delivery_eta', {
      p_request_id: requestId,
      p_carrier_eta: carrierEta,
    })
    if (error) throw error
    revalidateConsumables()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function receiveConsumableRequest(
  requestId: string,
  quantity: number,
): Promise<ActionResult> {
  try {
    const { role, factoryId, isCrmAdmin, admin, client } = await getContext()
    const requestFactoryId = await getFactoryIdForRequest(admin, requestId)
    assertFactoryAccess(role, factoryId, requestFactoryId, 'requests', isCrmAdmin)
    const { error } = await client.rpc('receive_consumable_request', {
      p_request_id: requestId,
      p_quantity: quantity,
    })
    if (error) throw error
    await dispatchPendingTelegramDeliveries()
    revalidateConsumables()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function closeConsumableRequestRemainder(
  requestId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const { role, factoryId, isCrmAdmin, admin, client } = await getContext()
    const requestFactoryId = await getFactoryIdForRequest(admin, requestId)
    assertFactoryAccess(role, factoryId, requestFactoryId, 'requests', isCrmAdmin)
    const { error } = await client.rpc('close_consumable_request_remainder', {
      p_request_id: requestId,
      p_reason: reason,
    })
    if (error) throw error
    revalidateConsumables()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}
