import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserContext } from '@/lib/auth/current-user'
import { getCurrentUserPermissions, PermissionDeniedError } from '@/lib/permissions/server'
import { hasPermission, type PermissionOperation, type ResourceKey } from '@/lib/permissions/resources'
import { buildClientPublicAlias } from '@/lib/clients/public-alias'
import { canUseClientDocumentPolicy, resolveCommercialPolicy } from '@/lib/permissions/commercial-policy'

type ClientIdentityRow = {
  id: string
  name: string
  public_alias?: string | null
  responsible_user_id: string | null
}

type PermissionContext = Awaited<ReturnType<typeof getCurrentUserContext>> & {
  permissions: Awaited<ReturnType<typeof getCurrentUserPermissions>>['permissions']
  permissionDetails: Awaited<ReturnType<typeof getCurrentUserPermissions>>
}

export type CommercialVisibility = {
  clientId: string
  responsibleUserId: string | null
  displayName: string
  isNameMasked: boolean
  isOwner: boolean
  isAdmin: boolean
  canViewFullClientName: boolean
  canViewOrderPrices: boolean
  canManageOrderPrices: boolean
  canAccessClientCard: boolean
}

export type DocumentAccessRequirement = {
  resourceKey: ResourceKey
  operation: PermissionOperation
  includesPrices: boolean
}

type LooseResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<LooseResult> & {
  select: (columns?: string) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  maybeSingle: () => Promise<LooseResult>
}
type LooseDb = { from: (table: string) => LooseQuery }

export async function getCommercialPermissionContext(): Promise<PermissionContext> {
  const context = await getCurrentUserContext()
  const permissionDetails = await getCurrentUserPermissions(context.userId)
  return { ...context, permissions: permissionDetails.permissions, permissionDetails }
}

function resolveRow(context: PermissionContext, row: ClientIdentityRow): CommercialVisibility {
  const decision = resolveCommercialPolicy({
    userId: context.userId,
    isAdmin: context.permissionDetails.isAdminPosition,
    responsibleUserId: row.responsible_user_id,
    identityView: hasPermission(context.permissions, 'client_identity', 'view'),
    identityViewScope: context.permissionDetails.companyScopes.client_identity?.view || 'own',
    priceView: hasPermission(context.permissions, 'client_prices', 'view'),
    priceViewScope: context.permissionDetails.companyScopes.client_prices?.view || 'own',
    priceManage: hasPermission(context.permissions, 'client_prices', 'manage'),
    priceManageScope: context.permissionDetails.companyScopes.client_prices?.manage || 'own',
    salesPlanManage: hasPermission(context.permissions, 'sales_plan', 'manage'),
  })
  const { isOwner, isAdmin, canViewFullClientName, canViewOrderPrices, canManageOrderPrices, canAccessClientCard } = decision

  return {
    clientId: row.id,
    responsibleUserId: row.responsible_user_id,
    displayName: canViewFullClientName ? row.name : row.public_alias || buildClientPublicAlias(row.name),
    isNameMasked: !canViewFullClientName,
    isOwner,
    isAdmin,
    canViewFullClientName,
    canViewOrderPrices,
    canManageOrderPrices,
    canAccessClientCard,
  }
}

export async function getCommercialVisibilityForClients(
  clientIds: readonly (string | null | undefined)[],
  providedContext?: PermissionContext,
) {
  const context = providedContext || await getCommercialPermissionContext()
  const ids = Array.from(new Set(clientIds.filter((id): id is string => Boolean(id))))
  if (ids.length === 0) return new Map<string, CommercialVisibility>()

  const db = createAdminClient() as unknown as LooseDb
  const { data, error } = await db.from('clients')
    .select('id, name, public_alias, responsible_user_id')
    .in('id', ids)
  if (error) throw new Error(error.message || 'Не удалось проверить коммерческий доступ')

  return new Map(((data || []) as ClientIdentityRow[]).map((row) => [row.id, resolveRow(context, row)]))
}

export async function getCommercialVisibilityForClient(
  clientId: string,
  providedContext?: PermissionContext,
) {
  const map = await getCommercialVisibilityForClients([clientId], providedContext)
  const visibility = map.get(clientId)
  if (!visibility) throw new Error('Клиент не найден')
  return visibility
}

export async function requireClientCardAccess(clientId: string, context?: PermissionContext) {
  const visibility = await getCommercialVisibilityForClient(clientId, context)
  if (!visibility.canAccessClientCard) throw new PermissionDeniedError('clients', 'view')
  return visibility
}

export async function requireOrderPriceManagement(clientId: string, context?: PermissionContext) {
  const visibility = await getCommercialVisibilityForClient(clientId, context)
  if (!visibility.canManageOrderPrices) throw new PermissionDeniedError('client_prices', 'manage')
  return visibility
}

export async function requireOrderPriceView(clientId: string, context?: PermissionContext) {
  const visibility = await getCommercialVisibilityForClient(clientId, context)
  if (!visibility.canViewOrderPrices) throw new PermissionDeniedError('client_prices', 'view')
  return visibility
}

export function canUseClientDocuments(
  context: PermissionContext,
  visibility: CommercialVisibility,
  requirement: DocumentAccessRequirement,
) {
  return canUseClientDocumentPolicy(
    visibility,
    hasPermission(context.permissions, requirement.resourceKey, requirement.operation),
    requirement.includesPrices,
  )
}

export async function requireClientDocumentAccess(
  clientId: string,
  requirement: DocumentAccessRequirement,
  context?: PermissionContext,
) {
  const resolvedContext = context || await getCommercialPermissionContext()
  const visibility = await getCommercialVisibilityForClient(clientId, resolvedContext)
  if (!canUseClientDocuments(resolvedContext, visibility, requirement)) {
    throw new PermissionDeniedError(requirement.resourceKey, requirement.operation)
  }
  return { ...resolvedContext, visibility }
}

export async function requireClientCommercialDocumentVisibility(
  clientId: string,
  includesPrices: boolean,
  context?: PermissionContext,
) {
  const resolvedContext = context || await getCommercialPermissionContext()
  const visibility = await getCommercialVisibilityForClient(clientId, resolvedContext)
  const allowed = visibility.isAdmin || (
    visibility.canViewFullClientName
    && (!includesPrices || visibility.canViewOrderPrices)
  )
  if (!allowed) throw new PermissionDeniedError(includesPrices ? 'client_prices' : 'client_identity', 'view')
  return { ...resolvedContext, visibility }
}

function collectClientRelationIds(value: unknown, parentKey = '', ids = new Set<string>()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectClientRelationIds(item, parentKey, ids))
    return ids
  }
  if (!value || typeof value !== 'object') return ids
  const record = value as Record<string, unknown>
  if ((parentKey === 'client' || parentKey === 'clients') && typeof record.id === 'string') ids.add(record.id)
  Object.entries(record).forEach(([key, child]) => collectClientRelationIds(child, key, ids))
  return ids
}

function maskClientRelations<T>(value: T, visibility: Map<string, CommercialVisibility>, parentKey = ''): T {
  if (Array.isArray(value)) return value.map((item) => maskClientRelations(item, visibility, parentKey)) as T
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(source)) result[key] = maskClientRelations(child, visibility, key)
  if ((parentKey === 'client' || parentKey === 'clients') && typeof source.id === 'string') {
    const access = visibility.get(source.id)
    if (access) {
      result.name = access.displayName
      result.display_name = access.displayName
      result.is_name_masked = access.isNameMasked
      delete result.responsible_user_id
    }
  }
  return result as T
}

export async function sanitizeStructuredClientRelations<T>(value: T, context?: PermissionContext): Promise<T> {
  const ids = Array.from(collectClientRelationIds(value))
  if (ids.length === 0) return value
  const visibility = await getCommercialVisibilityForClients(ids, context)
  return maskClientRelations(value, visibility)
}

export async function getSafeClientSummaries(clientIds: readonly (string | null | undefined)[], context?: PermissionContext) {
  const visibility = await getCommercialVisibilityForClients(clientIds, context)
  return new Map(Array.from(visibility.entries()).map(([id, access]) => [id, {
    id,
    name: access.displayName,
    display_name: access.displayName,
    is_name_masked: access.isNameMasked,
  }]))
}
