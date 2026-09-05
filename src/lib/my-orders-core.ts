import {
  roundToThree,
  weightedProgress,
  type ProgressItem,
  type QuantitativeStage,
} from '@/lib/reports/production-analytics-core'

export const MY_ORDER_STAGE_KEYS = ['assembly', 'cleaning', 'painting', 'packaging'] as const

export type MyOrderProgressFact = {
  stageType: QuantitativeStage
  itemId: string
  orderedQuantity: number
  unitWeightKg: number
  coating: string
  totalWeightKg: number
}

export type MyOrderStage = {
  stageType: string
  isSkipped: boolean
}

export type MyOrderProductionProgress =
  | {
      state: 'exact'
      percent: number
      completedKg: number
      applicableKg: number
    }
  | {
      state: 'legacy'
      percent: null
      completedKg: null
      applicableKg: number
    }
  | {
      state: 'no_stages'
      percent: null
      completedKg: null
      applicableKg: 0
    }

export type UndeliveredOrderInput = {
  created_by: string
  client_id: string | null
  is_archived: boolean
  delivery_to_client_date: string | null
}

export function isQuantitativeStage(value: string | null | undefined): value is QuantitativeStage {
  return MY_ORDER_STAGE_KEYS.includes(value as QuantitativeStage)
}

export function mergePersonalOrderIds(...groups: readonly (readonly string[])[]) {
  return Array.from(new Set(groups.flat()))
}

export function isPersonalUndeliveredOrder(
  order: UndeliveredOrderInput,
  userId: string,
  responsibleClientIds: ReadonlySet<string>,
) {
  if (order.is_archived || order.delivery_to_client_date) return false
  return order.created_by === userId
    || Boolean(order.client_id && responsibleClientIds.has(order.client_id))
}

export function isUndeliveredOrderVisibleForCompanyScope(
  order: UndeliveredOrderInput,
  userId: string,
  responsibleClientIds: ReadonlySet<string>,
  canViewAllCompanies: boolean,
) {
  if (canViewAllCompanies) return !order.is_archived && !order.delivery_to_client_date
  return isPersonalUndeliveredOrder(order, userId, responsibleClientIds)
}

export function calculateMyOrderProductionProgress(input: {
  stages: readonly MyOrderStage[]
  items: readonly ProgressItem[]
  facts: readonly MyOrderProgressFact[]
  legacyStages?: readonly QuantitativeStage[]
}): MyOrderProductionProgress {
  const activeStages = new Set(
    input.stages
      .filter((stage) => !stage.isSkipped && isQuantitativeStage(stage.stageType))
      .map((stage) => stage.stageType as QuantitativeStage),
  )
  const legacyStages = new Set(input.legacyStages || [])
  let completedKg = 0
  let applicableKg = 0
  let hasApplicableLegacyFact = false

  for (const stage of MY_ORDER_STAGE_KEYS) {
    if (!activeStages.has(stage)) continue
    const stageFacts = input.facts.filter((fact) => fact.stageType === stage)
    const itemsById = new Map(input.items.map((item) => [item.id, item]))

    // Historical item snapshots preserve the denominator even if an order line
    // was later edited or removed from the current machine specification.
    for (const fact of stageFacts) {
      itemsById.set(fact.itemId, {
        id: fact.itemId,
        quantity: fact.orderedQuantity,
        unitWeightKg: fact.unitWeightKg,
        coating: fact.coating,
      })
    }

    const stageProgress = weightedProgress(
      Array.from(itemsById.values()),
      stageFacts.map((fact) => ({ itemId: fact.itemId, totalWeightKg: fact.totalWeightKg })),
      stage,
    )
    if (stageProgress.applicableKg <= 0) continue

    applicableKg += stageProgress.applicableKg
    completedKg += stageProgress.completedKg
    if (legacyStages.has(stage)) hasApplicableLegacyFact = true
  }

  const roundedApplicableKg = roundToThree(applicableKg)
  if (roundedApplicableKg <= 0) {
    return { state: 'no_stages', percent: null, completedKg: null, applicableKg: 0 }
  }
  if (hasApplicableLegacyFact) {
    return {
      state: 'legacy',
      percent: null,
      completedKg: null,
      applicableKg: roundedApplicableKg,
    }
  }

  const roundedCompletedKg = roundToThree(completedKg)
  return {
    state: 'exact',
    percent: Math.max(0, roundToThree(roundedCompletedKg / roundedApplicableKg * 100)),
    completedKg: roundedCompletedKg,
    applicableKg: roundedApplicableKg,
  }
}
