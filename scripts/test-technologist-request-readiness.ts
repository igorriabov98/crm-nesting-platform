import assert from 'node:assert/strict'
import {
  assertMachineReadyForTechnologistRequest,
  getMachineReadiness,
  pickActiveTechnologistRequest,
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

const operationalRequest = {
  id: 'operational',
  status: 'submitted_to_supply' as const,
  created_at: '2026-09-15T10:00:00.000Z',
}
const newerDraft = {
  id: 'draft',
  status: 'draft' as const,
  created_at: '2026-09-16T10:00:00.000Z',
}
assert.equal(
  pickActiveTechnologistRequest([operationalRequest, newerDraft])?.id,
  operationalRequest.id,
  'Новый черновик не должен подменять действующую заявку в прогрессе заказа',
)
assert.equal(pickActiveTechnologistRequest([newerDraft]), null, 'Черновик не учитывается как действующая заявка')

console.log('Technologist request readiness tests passed')
