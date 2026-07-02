import { STAGES } from '@/lib/constants/stages'
import type { GanttMachine, GanttStage, GanttSupplyItem } from '@/app/(protected)/production/gantt/actions'
import type { StageType } from '@/lib/types'

export const GANTT_STAGE_COLORS: Record<StageType, string> = {
  cutting: '#4472C4',
  assembly: '#ED7D31',
  cleaning: '#FFC000',
  galvanizing: '#A5A5A5',
  post_galvanizing_cleaning: '#D6A500',
  painting: '#70AD47',
  packaging: '#F4B183',
  shipping: '#16A34A',
  actual_shipping: '#B91C1C',
}

export const GANTT_ROW_HEIGHT = 56
export const GANTT_TIMELINE_HEIGHT = 56
export const GANTT_BAR_HEIGHT = 22
export const GANTT_STAGE_DOT_SIZE = 10
export const GANTT_SHIPPING_READY_MARKER_SIZE = 16
export const GANTT_MARKER_SIZE = 12
export const GANTT_SHIPPING_MARKER_HEIGHT = 10
export const GANTT_MACHINE_COL_WIDTH = 184
export const GANTT_STAGE_COL_WIDTH = 112
export const GANTT_WORKSHOP_COL_WIDTH = 44
export const GANTT_LEFT_WIDTH =
  GANTT_MACHINE_COL_WIDTH + GANTT_STAGE_COL_WIDTH + GANTT_WORKSHOP_COL_WIDTH

export type GanttGroupRow =
  | {
      id: string
      type: 'stage'
      machine: GanttMachine
      stage: GanttStage
    }
  | {
      id: string
      type: 'supply'
      machine: GanttMachine
      items: GanttSupplyItem[]
    }

export interface GanttMachineGroup {
  machine: GanttMachine
  rows: GanttGroupRow[]
}

export function getGanttStageLabel(stageType: StageType) {
  return STAGES[stageType]?.label ?? stageType
}

export function getGanttStageColor(stageType: StageType) {
  return GANTT_STAGE_COLORS[stageType]
}

export function getWorkshopLabel(workshop: number | null) {
  return workshop ? `Ц${workshop}` : ''
}
