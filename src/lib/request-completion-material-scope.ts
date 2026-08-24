export type CompletionMaterialScopeItem = {
  sourceTable: string
}

export type CompletionLongStockPlanState = {
  versionId: string | null
  planStatus: string
  plannedBarCount: number
}

export function hasSheetMetalForCompletion(items: CompletionMaterialScopeItem[]) {
  return items.some((item) => item.sourceTable === 'request_sheet_metal')
}

export function isLongStockPlanReadyForSupply(plan: CompletionLongStockPlanState) {
  return Boolean(
    plan.versionId
    && plan.plannedBarCount > 0
    && (plan.planStatus === 'open' || plan.planStatus === 'closed')
  )
}
