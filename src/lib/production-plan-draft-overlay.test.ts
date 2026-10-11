import assert from 'node:assert/strict'
import test from 'node:test'

import { applyProductionPlanDraftOverlay } from './production-plan-draft-overlay'
import type { ProductionRow } from '@/app/(protected)/production/actions'
import type { GanttData } from '@/app/(protected)/production/gantt/actions'
import type { ProductionPlanDraftSummary } from '@/lib/actions/production-plan-versions'

const originFactory = '11111111-1111-4111-8111-111111111111'
const targetFactory = '22222222-2222-4222-8222-222222222222'
const machineId = '33333333-3333-4333-8333-333333333333'
const machine = {
  id: machineId, name: 'Машина', factory_id: originFactory,
  production_month: '2026-09-01', planned_material_date: null,
  is_fully_paid: false,
} as ProductionRow['machine']
const row = { machine, stages: [] } as ProductionRow
const gantt = {
  machines: [{ ...machine, stages: [], supply_deadlines: [], material_items: [] }],
  dateRange: { start: '2026-09-01', end: '2026-12-01' },
} as unknown as GanttData
const draft = {
  production_month_plan_id: '44444444-4444-4444-8444-444444444444',
  factory_id: originFactory, production_month: '2026-09-01',
  base_version_number: 1, revision: 2, updated_at: '2026-10-10T00:00:00.000Z',
  changes: {
    [`machine:${machineId}`]: {
      target: 'machine', id: machineId,
      fields: { factory_id: targetFactory, production_month: '2026-11-01', planned_material_date: '2026-10-20' },
    },
  },
} satisfies ProductionPlanDraftSummary

test('перенос и дата Мат.плана остаются в одном черновике после обновления', () => {
  const moved = applyProductionPlanDraftOverlay([row], [gantt], [draft], targetFactory)
  assert.equal(moved.productionData.length, 1)
  assert.equal(moved.productionData[0].machine.production_month, '2026-11-01')
  assert.equal(moved.productionData[0].machine.planned_material_date, '2026-10-20')
  assert.equal(moved.ganttData.machines[0].id, machineId)
  assert.equal(applyProductionPlanDraftOverlay([row], [gantt], [draft], originFactory).productionData.length, 0)
})

test('дата Мат.плана без переноса видна в черновике текущего месяца', () => {
  const novemberRow = {
    ...row,
    machine: { ...machine, production_month: '2026-11-01' },
  }
  const dateDraft = {
    ...draft,
    production_month: '2026-11-01',
    changes: {
      [`machine:${machineId}`]: {
        target: 'machine' as const,
        id: machineId,
        fields: { planned_material_date: '2026-11-01' },
      },
    },
  }
  const editor = applyProductionPlanDraftOverlay([novemberRow], [gantt], [dateDraft], originFactory)
  assert.equal(editor.productionData[0].machine.production_month, '2026-11-01')
  assert.equal(editor.productionData[0].machine.planned_material_date, '2026-11-01')
  assert.equal(novemberRow.machine.planned_material_date, null)
})
