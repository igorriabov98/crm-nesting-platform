import assert from 'node:assert/strict'
import {
  assertMachineReadyForTechnologistRequest,
  getMachineReadiness,
} from '../src/lib/machine-progress'

const confirmedWithoutStageDates = {
  is_confirmed: true,
  machine_items: [{ is_sample: false }],
  production_stages: [],
}

assert.equal(getMachineReadiness(confirmedWithoutStageDates).planned, false)
assert.doesNotThrow(() => assertMachineReadyForTechnologistRequest(confirmedWithoutStageDates))

assert.throws(
  () => assertMachineReadyForTechnologistRequest({
    is_confirmed: false,
    machine_items: [{ is_sample: false }],
    production_stages: [{
      stage_type: 'shipping',
      date_end: '2026-07-27',
    }],
  }),
  new Error('Нельзя оформить заявку технолога: заказ не подтверждён и может меняться'),
)

console.log('Technologist request readiness tests passed')
