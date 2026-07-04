"use client"

import React from 'react'
import Link from 'next/link'
import { ROUTES } from '@/lib/constants/routes'
import { stageHasSingleDate } from '@/lib/constants/stages'
import { cn } from '@/lib/utils'
import {
  GANTT_LEFT_WIDTH,
  GANTT_MACHINE_COL_WIDTH,
  GANTT_ROW_HEIGHT,
  GANTT_STAGE_COL_WIDTH,
  GANTT_TIMELINE_HEIGHT,
  GANTT_WORKSHOP_COL_WIDTH,
  getGanttStageColor,
  getGanttStageLabel,
  getStageWorkshopLabel,
  type GanttMachineGroup,
} from './types'

interface GanttMachineListProps {
  groups: GanttMachineGroup[]
}

export function GanttMachineList({ groups }: GanttMachineListProps) {
  return (
    <div
      className="shrink-0 border-r border-[#D7DEE8] bg-white"
      style={{ width: GANTT_LEFT_WIDTH }}
    >
      <div
        className="grid border-b border-[#D7DEE8] bg-[#F8F9FA] text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]"
        style={{
          height: GANTT_TIMELINE_HEIGHT,
          gridTemplateColumns: `${GANTT_MACHINE_COL_WIDTH}px ${GANTT_STAGE_COL_WIDTH}px ${GANTT_WORKSHOP_COL_WIDTH}px`,
        }}
      >
        <div className="flex items-end px-3 pb-2">Машина</div>
        <div className="flex items-end border-l border-[#D7DEE8] px-3 pb-2">Этап</div>
        <div className="flex items-end justify-center border-l border-[#D7DEE8] pb-2">Ц</div>
      </div>

      {groups.map((group) => {
        const groupHeight = group.rows.length * GANTT_ROW_HEIGHT

        return (
          <div
            key={group.machine.id}
            className="grid border-b border-[#C9D2DF] bg-white"
            style={{
              minHeight: groupHeight,
              gridTemplateColumns: `${GANTT_MACHINE_COL_WIDTH}px ${GANTT_STAGE_COL_WIDTH}px ${GANTT_WORKSHOP_COL_WIDTH}px`,
            }}
          >
            <div
              className="flex flex-col justify-center px-3"
              style={{ minHeight: groupHeight }}
            >
              <Link
                href={`${ROUTES.SALES_PLAN}/${group.machine.id}`}
                className="truncate text-sm font-semibold text-[#2563EB] hover:underline"
                title={group.machine.name}
              >
                {group.machine.name}
              </Link>
              <span className="mt-1 text-xs text-[#6B7280]">
                {Number(group.machine.total_weight || 0).toFixed(1)} т
              </span>
            </div>

            <div className="border-l border-[#E8ECF0]">
              {group.rows.map((row) => (
                <div
                  key={`${row.id}-stage`}
                  className="flex items-center gap-2 border-b border-[#EEF2F6] px-3 text-xs text-[#374151] last:border-b-0"
                  style={{ height: GANTT_ROW_HEIGHT }}
                >
                  {row.type === 'stage' ? (
                    <>
                      <span
                        className={cn(
                          "h-2.5 w-2.5 shrink-0",
                          stageHasSingleDate(row.stage.stage_type) ? "rounded-full" : "rounded-sm"
                        )}
                        style={{ backgroundColor: getGanttStageColor(row.stage.stage_type) }}
                      />
                      <span className="truncate">{getGanttStageLabel(row.stage.stage_type)}</span>
                    </>
                  ) : (
                    <>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-[#70AD47]" />
                      <span className="truncate">Материал СТ</span>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="border-l border-[#E8ECF0]">
              {group.rows.map((row) => (
                <div
                  key={`${row.id}-workshop`}
                  className="flex items-center justify-center border-b border-[#EEF2F6] text-xs font-medium text-[#374151] last:border-b-0"
                  style={{ height: GANTT_ROW_HEIGHT }}
                >
                  {row.type === 'stage' ? getStageWorkshopLabel(row.stage) : ''}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
