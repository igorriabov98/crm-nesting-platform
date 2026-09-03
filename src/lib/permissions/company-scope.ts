import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { PermissionDeniedError, requireAnyPermission, requirePermission } from '@/lib/permissions/server'
import { hasPermission } from '@/lib/permissions/resources'
import type { CompanyAccessScope, PermissionOperation, ResourceKey } from '@/lib/permissions/resources'

export type CompanyScopedResource = Extract<ResourceKey, 'invoices' | 'client_payments'>

export async function requireCompanyScope(
  resourceKey: CompanyScopedResource,
  operation: PermissionOperation,
) {
  const context = await requirePermission(resourceKey, operation)
  const scope: CompanyAccessScope = context.permissionDetails.companyScopes[resourceKey]?.[operation] || 'own'
  return { ...context, companyScope: scope }
}

export async function requireCompanyRecordAccess(
  resourceKey: CompanyScopedResource,
  operation: PermissionOperation,
  clientId: string | null | undefined,
) {
  const context = await requireCompanyScope(resourceKey, operation)
  if (context.companyScope === 'all') return context
  if (!clientId) throw new PermissionDeniedError(resourceKey, operation)

  const { data, error } = await createAdminClient()
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('responsible_user_id', context.userId)
    .maybeSingle()

  if (error || !data) throw new PermissionDeniedError(resourceKey, operation)
  return context
}

export async function requireAnyCompanyRecordAccess(
  requirements: ReadonlyArray<{ resourceKey: CompanyScopedResource; operation: PermissionOperation }>,
  clientId: string | null | undefined,
) {
  const context = await requireAnyPermission(requirements)
  for (const requirement of requirements) {
    if (!hasPermission(context.permissions, requirement.resourceKey, requirement.operation)) continue
    const scope = context.permissionDetails.companyScopes[requirement.resourceKey]?.[requirement.operation] || 'own'
    if (scope === 'all') return context
    if (!clientId) continue
    const { data } = await createAdminClient()
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .eq('responsible_user_id', context.userId)
      .maybeSingle()
    if (data) return context
  }
  throw new PermissionDeniedError(requirements[0].resourceKey, requirements[0].operation)
}
