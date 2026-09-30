import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { assertFactoryAccess, canAccessAllFactories, type FactoryScopedPermissionContext } from '@/lib/permissions/factory-scope'
import { hasPermission, type PermissionMap } from '@/lib/permissions/resources'

type Context = FactoryScopedPermissionContext & { permissions: PermissionMap }
type Query = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  select: (columns: string) => Query
  in: (column: string, values: string[]) => Query
  eq: (column: string, value: string) => Query
}

export async function assertProductionDraftMachineAccess(
  context: Context,
  factoryFilter: string | null | undefined,
  draftMachineIds: string[],
) {
  if (factoryFilter === 'all' && !canAccessAllFactories(context, 'production', 'view')) {
    throw new Error('Недостаточно прав для просмотра всех заводов')
  }
  if (!factoryFilter && !canAccessAllFactories(context, 'production', 'view')) {
    throw new Error('Выберите доступный завод')
  }
  if (factoryFilter && factoryFilter !== 'all') {
    assertFactoryAccess(context, 'production', 'view', factoryFilter)
  }
  if (draftMachineIds.length === 0) return
  if (!hasPermission(context.permissions, 'production', 'manage')) {
    throw new Error('Черновик доступен только редактору плана')
  }
  const factoryIds = canAccessAllFactories(context, 'production', 'manage')
    ? null : context.factoryId ? [context.factoryId] : []
  if (factoryIds?.length === 0) throw new Error('Недостаточно прав для черновика завода')
  const db = createAdminClient() as unknown as { from: (table: string) => Query }
  let plansQuery = db.from('production_month_plans').select('id, factory_id')
  if (factoryIds) plansQuery = plansQuery.in('factory_id', factoryIds)
  if (factoryFilter && factoryFilter !== 'all') plansQuery = plansQuery.eq('factory_id', factoryFilter)
  const { data: plans, error: plansError } = await plansQuery
  if (plansError) throw new Error(plansError.message)
  const planIds = ((plans || []) as Array<{ id: string }>).map((plan) => plan.id)
  if (planIds.length === 0) throw new Error('Нет доступного черновика')
  const { data: drafts, error: draftsError } = await db.from('production_plan_drafts')
    .select('changes').in('production_month_plan_id', planIds)
  if (draftsError) throw new Error(draftsError.message)
  const allowed = new Set<string>()
  for (const draft of (drafts || []) as Array<{ changes: unknown }>) {
    const changes = draft.changes as Record<string, { target?: string; id?: string }>
    for (const patch of Object.values(changes || {})) {
      if (patch.target === 'machine' && patch.id) allowed.add(patch.id)
    }
  }
  if (draftMachineIds.some((id) => !allowed.has(id))) {
    throw new Error('Машина не входит в доступный черновик')
  }
}
