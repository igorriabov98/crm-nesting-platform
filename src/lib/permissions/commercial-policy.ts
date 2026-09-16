import type { CompanyAccessScope } from '@/lib/permissions/resources'

export type CommercialPolicyInput = {
  userId: string
  isAdmin: boolean
  responsibleUserId: string | null
  identityView: boolean
  identityViewScope: CompanyAccessScope
  priceView: boolean
  priceViewScope: CompanyAccessScope
  priceManage: boolean
  priceManageScope: CompanyAccessScope
  salesPlanManage: boolean
}

export type CommercialPolicyDecision = {
  isOwner: boolean
  isAdmin: boolean
  canViewFullClientName: boolean
  canViewOrderPrices: boolean
  canManageOrderPrices: boolean
  canAccessClientCard: boolean
}

function appliesToCompany(enabled: boolean, scope: CompanyAccessScope, isOwner: boolean) {
  return enabled && (scope === 'all' || isOwner)
}

export function resolveCommercialPolicy(input: CommercialPolicyInput): CommercialPolicyDecision {
  const isOwner = input.responsibleUserId === input.userId
  const canViewFullClientName = input.isAdmin
    || appliesToCompany(input.identityView, input.identityViewScope, isOwner)
  const canViewOrderPrices = input.isAdmin
    || appliesToCompany(input.priceView, input.priceViewScope, isOwner)
  const matrixCanManagePrices = appliesToCompany(input.priceManage, input.priceManageScope, isOwner)
  const canManageOrderPrices = input.isAdmin || (input.salesPlanManage && matrixCanManagePrices)

  return {
    isOwner,
    isAdmin: input.isAdmin,
    canViewFullClientName,
    canViewOrderPrices,
    canManageOrderPrices,
    canAccessClientCard: input.isAdmin || appliesToCompany(input.identityView, input.identityViewScope, isOwner),
  }
}

export function canUseClientDocumentPolicy(
  decision: CommercialPolicyDecision,
  hasFunctionalPermission: boolean,
  includesPrices: boolean,
) {
  if (decision.isAdmin) return true
  return hasFunctionalPermission
    && decision.canViewFullClientName
    && (!includesPrices || decision.canViewOrderPrices)
}
