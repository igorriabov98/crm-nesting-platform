import assert from 'node:assert/strict'
import test from 'node:test'
import {
  productionFactCuttingReadinessError,
  productionFactCuttingReadinessReason,
  type ProductionFactCuttingReadiness,
} from './production-fact-cutting-readiness'

test('turns cutting RPC failures into operator-facing reasons', () => {
  assert.equal(
    productionFactCuttingReadinessReason(
      'Резка заблокирована: для позиции длинномера нет утверждённой версии карты раскроя',
    ),
    'Нет утверждённой версии карты раскроя',
  )
  assert.equal(
    productionFactCuttingReadinessReason('Резка заблокирована: позиция длинномера требует пересчёта'),
    'Карта раскроя требует пересчёта',
  )
})

test('names every machine that blocks a batch production fact', () => {
  const readiness: ProductionFactCuttingReadiness[] = [
    { machineId: 'ready', machineName: '4. test 06/08', ready: true, reason: null },
    {
      machineId: 'blocked',
      machineName: '3. test 6/08',
      ready: false,
      reason: 'Нет утверждённой версии карты раскроя',
    },
  ]

  assert.equal(
    productionFactCuttingReadinessError(readiness),
    'Нельзя зафиксировать факт заготовки: 3. test 6/08 — нет утверждённой версии карты раскроя',
  )
})
