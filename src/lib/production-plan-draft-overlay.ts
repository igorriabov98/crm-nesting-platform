import type { ProductionRow } from '@/app/(protected)/production/actions'
import type { GanttData } from '@/app/(protected)/production/gantt/actions'
import type { ProductionPlanDraftSummary, ProductionPlanDraftPatch } from '@/lib/actions/production-plan-versions'
import { normalizeProductionMonthValue } from '@/lib/utils/production-months'
import { STAGE_ORDER } from '@/lib/constants/stages'

function applyPatch(rows: ProductionRow[], patch: ProductionPlanDraftPatch) {
  if (patch.target === 'machine') {
    const row = rows.find((item) => item.machine.id === patch.id)
    if (row) Object.assign(row.machine, patch.fields)
    return
  }
  if (patch.target === 'stage' || patch.target === 'interval') {
    const stage = rows.flatMap((row) => row.stages).find((item) => item.id === patch.stage_id)
    if (!stage) return
    if (patch.target === 'stage') {
      Object.assign(stage, patch.fields)
      return
    }
    const operation = patch.fields.operation
    if (operation === 'delete') {
      stage.intervals = stage.intervals.filter((interval) => interval.id !== patch.id)
    } else {
      const old = stage.intervals.find((interval) => interval.id === patch.id)
      const interval = {
        id: patch.id,
        production_stage_id: stage.id,
        position: old?.position ?? stage.intervals.length + 1,
        date_start: (patch.fields.date_start as string | null) ?? null,
        date_end: (patch.fields.date_end as string | null) ?? null,
        workshop: (patch.fields.workshop as number | null) ?? null,
      }
      stage.intervals = old
        ? stage.intervals.map((item) => item.id === patch.id ? interval : item)
        : [...stage.intervals, interval]
    }
    const starts = stage.intervals.map((item) => item.date_start).filter((value): value is string => Boolean(value)).sort()
    const ends = stage.intervals.map((item) => item.date_end).filter((value): value is string => Boolean(value)).sort()
    stage.date_start = starts[0] ?? null
    stage.date_end = ends.at(-1) ?? null
    if (stage.stage_type === 'assembly') {
      const workshops = new Set(stage.intervals.map((item) => item.workshop).filter((value): value is number => value !== null))
      stage.workshop = workshops.size === 1 ? [...workshops][0] : null
    }
  }
}

export function applyProductionPlanDraftOverlay(
  productionData: ProductionRow[], ganttData: GanttData[],
  drafts: ProductionPlanDraftSummary[], activeFactoryId: string,
): { productionData: ProductionRow[]; ganttData: GanttData } {
  const rows: ProductionRow[] = productionData.map((row) => ({
    ...row,
    machine: { ...row.machine },
    stages: row.stages.map((stage) => ({
      ...stage,
      intervals: stage.intervals.map((interval) => ({ ...interval })),
    })),
  }))
  const patches = drafts.flatMap((draft) => Object.values(draft.changes))
  for (const patch of patches) applyPatch(rows, patch)

  const selectedRows = rows.filter((row) => row.machine.factory_id === activeFactoryId)
  const selectedIds = new Set(selectedRows.map((row) => row.machine.id))
  const ganttMachines = ganttData.flatMap((data) => data.machines)
  const selectedRowsById = new Map(selectedRows.map((row) => [row.machine.id, row]))
  const selectedGanttMachines = ganttMachines
    .map((machine) => {
      const plannedRow = selectedRowsById.get(machine.id)
      const planned = plannedRow?.machine
      const originalStages = new Map(machine.stages.map((stage) => [stage.id, stage]))
      return planned ? {
        ...machine,
        factory_id: planned.factory_id,
        production_month: planned.production_month,
        production_workshop: planned.production_workshop,
        production_queue_number: planned.production_queue_number,
        planned_material_date: planned.planned_material_date,
        stages: plannedRow.stages
          .filter((stage) => !stage.is_skipped && (stage.date_start || stage.date_end))
          .sort((left, right) => STAGE_ORDER.indexOf(left.stage_type) - STAGE_ORDER.indexOf(right.stage_type))
          .map((stage) => {
            const original = originalStages.get(stage.id)
            const start = stage.date_start || stage.date_end!
            return {
              ...original,
              id: stage.id,
              stage_type: stage.stage_type,
              workshop: stage.workshop,
              date_start: start,
              date_end: stage.date_end || start,
              manual_overdue: stage.manual_overdue,
              is_night_shift: stage.is_night_shift,
              night_shift_date: stage.night_shift_date,
              night_shift_dates: stage.night_shift_dates,
              status: original?.status || 'not_planned' as const,
              delay_days: original?.delay_days || 0,
            }
          }),
      } : machine
    })
    .filter((machine) => selectedIds.has(machine.id))
  const template = ganttData[0]
  const dates = selectedGanttMachines.flatMap((machine) => [
    machine.planned_material_date,
    ...machine.stages.flatMap((stage) => [stage.date_start, stage.date_end]),
  ]).filter((value): value is string => Boolean(value)).sort()
  return {
    productionData: selectedRows,
    ganttData: {
      ...template,
      machines: selectedGanttMachines,
      dateRange: dates.length > 0
        ? {
          start: [template.dateRange.start, dates[0]].sort()[0],
          end: [template.dateRange.end, dates.at(-1)!].sort().at(-1)!,
        }
        : template.dateRange,
    },
  }
}

export function draftForMonth(drafts: ProductionPlanDraftSummary[], factoryId: string, month: string) {
  const normalized = normalizeProductionMonthValue(month)
  return drafts.find((draft) => draft.factory_id === factoryId && draft.production_month === normalized) ?? null
}
