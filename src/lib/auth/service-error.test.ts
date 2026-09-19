import assert from 'node:assert/strict'
import test from 'node:test'
import { isAuthServiceUnavailable } from './service-error'

test('Auth transport errors and throttling remain retryable instead of denying the session', () => {
  for (const status of [undefined, 0, 408, 429, 500, 502, 503, 504]) {
    assert.equal(isAuthServiceUnavailable({ status }), true, String(status))
  }
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(isAuthServiceUnavailable({ status }), false, String(status))
  }
  assert.equal(isAuthServiceUnavailable(null), false)
})
