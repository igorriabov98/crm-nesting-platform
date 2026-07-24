import assert from 'node:assert/strict'
import { isAIMatchApplyEligible } from '../src/lib/nesting/ai-match-policy'

assert.equal(
  isAIMatchApplyEligible({ matchConfidence: 0.35, identityConfirmed: false }),
  false,
  'scope-only low-confidence match must not be applicable'
)
assert.equal(
  isAIMatchApplyEligible({ matchConfidence: 0.6, identityConfirmed: false }),
  false,
  'scope-only match below the threshold must not be applicable'
)
assert.equal(
  isAIMatchApplyEligible({ matchConfidence: 0.95, identityConfirmed: true }),
  true,
  'confirmed match above the threshold must remain applicable'
)
assert.equal(
  isAIMatchApplyEligible({ matchConfidence: 0.95, identityConfirmed: false }),
  false,
  'confidence alone must not bypass identity confirmation'
)

console.log('[nesting-ai-match-policy] confidence and identity matrix passed')
