"use client"

import React from 'react'
import { generateDateScale, SCALE_UNIT_WIDTH, type GanttScale } from '@/lib/utils/gantt'
import { cn } from '@/lib/utils'
import { GanttBar } from './GanttBar'
import { GanttSupplyMarker } from './GanttSupplyMarker'
import { GANTT_ROW_HEIGHT, type GanttMachineGroup } from './types'

interface GanttRowsProps {
  groups: GanttMachineGroup[]
  rangeStart: Date
  rangeEnd: Date
  scale: GanttScale
  todayOffset: number
}

export function GanttRows({ groups, rangeStart, rangeEnd, scale, todayOffset }: GanttRowsProps) {
  const unitWidth = SCALE_UNIT_WIDTH[scale]
  const scaleItems = generateDateScale(rangeStart, rangeEnd, scale)
  const totalWidth = scaleItems.length * unitWidth

  return (
    <div className="relative">
      <div className="absolute inset-0 flex pointer-events-none">
        {scaleItems.map((item, i) => (
          <div
            key={i}
            className={cn(
              "shrink-0 border-r border-[#EEF2F6]",
              item.isWeekend && "bg-[#EEF2F6]/70",
              item.isToday && "bg-red-100/70"
            )}
            style={{ width: unitWidth }}
          />
        ))}
      </div>

      {todayOffset >= 0 && (
        <div
          className="pointer-events-none absolute top-0 bottom-0 z-0 w-0.5 bg-red-500"
          style={{ left: todayOffset + unitWidth / 2 }}
        />
      )}

      {groups.map((group) => (
        <div key={group.machine.id} className="border-b border-[#C9D2DF]">
          {group.rows.map((row) => (
            <div
              key={row.id}
              className="relative border-b border-[#EEF2F6] last:border-b-0 hover:bg-[#F8F9FA]/50"
              style={{ height: GANTT_ROW_HEIGHT, width: totalWidth }}
            >
              {row.type === 'stage' ? (
                <GanttBar
                  stage={row.stage}
                  rangeStart={rangeStart}
                  scale={scale}
                  unitWidth={unitWidth}
                  machineId={group.machine.id}
                />
              ) : (
                row.items.map((item) => (
                  <GanttSupplyMarker
                    key={item.id}
                    item={item}
                    rangeStart={rangeStart}
                    scale={scale}
                    unitWidth={unitWidth}
                  />
                ))
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
