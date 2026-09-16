import assert from 'node:assert/strict'
import test from 'node:test'
import { canUseClientDocumentPolicy, resolveCommercialPolicy, type CommercialPolicyInput } from './commercial-policy'

const base: CommercialPolicyInput = {
  userId: 'viewer',
  isAdmin: false,
  responsibleUserId: 'owner',
  identityView: false,
  identityViewScope: 'own',
  priceView: false,
  priceViewScope: 'own',
  priceManage: false,
  priceManageScope: 'own',
  salesPlanManage: false,
}

test('owner receives own-scope capabilities only when the matrix grants them', () => {
  const decision = resolveCommercialPolicy({
    ...base,
    responsibleUserId: base.userId,
    identityView: true,
    priceView: true,
    priceManage: true,
    salesPlanManage: true,
  })
  assert.deepEqual(decision, {
    isOwner: true,
    isAdmin: false,
    canViewFullClientName: true,
    canViewOrderPrices: true,
    canManageOrderPrices: true,
    canAccessClientCard: true,
  })
})

test('legacy role cannot override an explicit all-company matrix grant', () => {
  const decision = resolveCommercialPolicy({
    ...base,
    identityView: true,
    identityViewScope: 'all',
    priceView: true,
    priceViewScope: 'all',
    priceManage: true,
    priceManageScope: 'all',
    salesPlanManage: true,
  })
  assert.equal(decision.canAccessClientCard, true)
  assert.equal(decision.canManageOrderPrices, true)
  assert.equal(canUseClientDocumentPolicy(decision, true, true), true)
})

test('another department follows own/all scopes and functional document permission', () => {
  const ownOnly = resolveCommercialPolicy({
    ...base,
    identityView: true,
    priceView: true,
    priceManage: true,
    salesPlanManage: true,
  })
  assert.equal(ownOnly.canViewFullClientName, false)
  assert.equal(ownOnly.canViewOrderPrices, false)
  assert.equal(ownOnly.canManageOrderPrices, false)

  const all = resolveCommercialPolicy({
    ...base,
    identityView: true,
    identityViewScope: 'all',
    priceView: true,
    priceViewScope: 'all',
    priceManage: true,
    priceManageScope: 'all',
    salesPlanManage: true,
  })
  assert.equal(all.canManageOrderPrices, true)
  assert.equal(canUseClientDocumentPolicy(all, false, true), false)
  assert.equal(canUseClientDocumentPolicy(all, true, true), true)
})

test('CRM admin can access assigned and unassigned companies', () => {
  for (const responsibleUserId of ['owner', null]) {
    const decision = resolveCommercialPolicy({ ...base, isAdmin: true, responsibleUserId })
    assert.equal(decision.canAccessClientCard, true)
    assert.equal(decision.canManageOrderPrices, true)
    assert.equal(canUseClientDocumentPolicy(decision, false, true), true)
  }
})

test('inactive or permissionless user cannot access an unassigned company', () => {
  const decision = resolveCommercialPolicy({ ...base, responsibleUserId: null })
  assert.equal(decision.canViewFullClientName, false)
  assert.equal(decision.canViewOrderPrices, false)
  assert.equal(decision.canAccessClientCard, false)
})
