import { STAGES } from '@/lib/constants/stages'
import type { StageType } from '@/lib/types'

type SnapshotInterval = { id: string; position: number; date_start: string | null; date_end: string | null; workshop: number | null }
type SnapshotStage = {
  id: string; stage_type: string; date_start: string | null; date_end: string | null
  workshop: number | null; is_skipped: boolean; night_shift_dates: string[]
  intervals: SnapshotInterval[]
}
type SnapshotOperation = { id: string; [field: string]: unknown }
type SnapshotMachine = {
  id: string; name: string; factory_id: string; production_month: string
  production_workshop: number | null; production_queue_number: number | null
  planned_material_date: string | null; stages: SnapshotStage[]; outsourcing: SnapshotOperation[]
}
export type ProductionPlanSnapshot = { machines: SnapshotMachine[]; incoming: SnapshotOperation[] }

function byId<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]))
}

function different(left: unknown, right: unknown) {
  return JSON.stringify(left) !== JSON.stringify(right)
}

function stageName(stageType: string) {
  return STAGES[stageType as StageType]?.label || stageType
}

const machineFieldLabels = {
  production_workshop: 'цех',
  production_queue_number: 'очередь',
  planned_material_date: 'плановая дата материала',
} as const

const stageFieldLabels = {
  date_start: 'начало',
  date_end: 'завершение',
  workshop: 'цех',
  is_skipped: 'пропуск этапа',
} as const

export function diffProductionPlanSnapshots(current: ProductionPlanSnapshot, target: ProductionPlanSnapshot) {
  const changes: string[] = []
  const currentMachines = byId(current.machines)
  const targetMachines = byId(target.machines)
  for (const machine of current.machines) {
    if (!targetMachines.has(machine.id)) changes.push(`${machine.name}: убрать из плана месяца`)
  }
  for (const machine of target.machines) {
    const old = currentMachines.get(machine.id)
    if (!old) {
      changes.push(`${machine.name}: вернуть в план месяца`)
      continue
    }
    for (const field of ['production_workshop', 'production_queue_number', 'planned_material_date'] as const) {
      if (old[field] !== machine[field]) changes.push(`${machine.name}: ${machineFieldLabels[field]} ${old[field] ?? '—'} → ${machine[field] ?? '—'}`)
    }
    const oldStages = byId(old.stages)
    const targetStages = byId(machine.stages)
    for (const previous of old.stages) {
      if (!targetStages.has(previous.id)) {
        changes.push(`${machine.name} · ${stageName(previous.stage_type)}: плановые даты этапа будут очищены`)
      }
    }
    for (const stage of machine.stages) {
      const previous = oldStages.get(stage.id)
      if (!previous) {
        changes.push(`${machine.name}: этап ${stageName(stage.stage_type)} восстановится`)
        continue
      }
      for (const field of ['date_start', 'date_end', 'workshop', 'is_skipped'] as const) {
        if (previous[field] !== stage[field]) {
          changes.push(`${machine.name} · ${stageName(stage.stage_type)}: ${stageFieldLabels[field]} ${previous[field] ?? '—'} → ${stage[field] ?? '—'}`)
        }
      }
      if (different(previous.night_shift_dates, stage.night_shift_dates)) {
        changes.push(`${machine.name} · ${stageName(stage.stage_type)}: изменятся ночные смены`)
      }
      if (different(previous.intervals, stage.intervals)) {
        changes.push(`${machine.name} · ${stageName(stage.stage_type)}: изменятся подходы`)
      }
    }
    if (different(old.outsourcing, machine.outsourcing)) {
      changes.push(`${machine.name}: изменятся плановые даты аутсорсинга`)
    }
  }
  if (different(current.incoming, target.incoming)) changes.push('Изменится входящий аутсорсинг')
  return changes
}
