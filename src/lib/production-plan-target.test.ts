import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveMachinePlanLocation } from './production-plan-target'

test('дата Мат.плана записывается в действующий черновик перенесённой машины', () => {
  assert.deepEqual(resolveMachinePlanLocation(
    { factory_id: 'old-factory', production_month: '2026-09-01' },
    { factoryId: 'new-factory', month: '2026-11-01' },
    { planned_material_date: '2026-10-20' },
  ), { factoryId: 'new-factory', month: '2026-11-01' })
})

test('размещение из нового изменения доступно до публикации машины', () => {
  assert.deepEqual(resolveMachinePlanLocation(
    { factory_id: null, production_month: null }, null,
    { factory_id: 'factory', production_month: '2026-11-01' },
  ), { factoryId: 'factory', month: '2026-11-01' })
  assert.equal(resolveMachinePlanLocation(
    { factory_id: 'factory', production_month: null }, null,
    { planned_material_date: '2026-10-20' },
  ), null)
})
