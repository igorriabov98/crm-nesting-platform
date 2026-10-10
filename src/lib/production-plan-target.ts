export type ProductionPlanLocation = { factoryId: string; month: string }

export function resolveMachinePlanLocation(
  published: { factory_id: string | null; production_month: string | null },
  pending: ProductionPlanLocation | null,
  fields: Record<string, unknown>,
): ProductionPlanLocation | null {
  if (pending) return pending
  const factoryId = published.factory_id || (fields.factory_id as string | null)
  const month = published.production_month || (fields.production_month as string | null)
  return factoryId && month ? { factoryId, month } : null
}
