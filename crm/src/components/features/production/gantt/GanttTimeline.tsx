"use client"

import React from 'react'
import { cn } from '@/lib/utils'
import { generateDateScale, generateMonthScale, SCALE_UNIT_WIDTH, type GanttScale } from '@/lib/utils/gantt'

interface GanttTimelineProps {
  rangeStart: Date
  rangeEnd: Date
  scale: GanttScale
  todayOffset: number
  unitWidth?: number
}

export function GanttTimeline({ rangeStart, rangeEnd, scale, todayOffset, unitWidth = SCALE_UNIT_WIDTH[scale] }: GanttTimelineProps) {
  const scaleItems = generateDateScale(rangeStart, rangeEnd, scale)
  const monthItems = generateMonthScale(scaleItems, scale)

  return (
    <div className="relative select-none border-b border-[#E8ECF0] bg-[#F8F9FA]">
      {/* Row 1: Months */}
      <div className="flex border-b border-[#E8ECF0]">
        {monthItems.map((m, i) => (
          <div
            key={i}
            className="shrink-0 truncate border-r border-[#D7DEE8] px-2 py-1 text-xs font-medium text-[#374151]"
            style={{ width: `${m.spanUnits * unitWidth}px` }}
          >
            {m.label}
          </div>
        ))}
      </div>

      {/* Row 2: Scale units (days / weeks / months) */}
      <div className="flex relative">
        {scaleItems.map((item, i) => (
          <div
            key={i}
            className={cn(
              "shrink-0 border-r border-[#EEF2F6] py-1 text-center text-[10px] font-mono",
              item.isWeekend && "bg-[#E8ECF0]/30 text-[#9CA3AF]",
              item.isToday && "bg-red-100 text-red-700 font-bold shadow-[inset_0_0_0_1px_rgba(220,38,38,0.2)]",
              !item.isWeekend && !item.isToday && "text-[#6B7280]"
            )}
            style={{ width: `${unitWidth}px` }}
          >
            {item.label}
          </div>
        ))}

        {/* Today red line */}
        {todayOffset >= 0 && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-0 w-0.5 bg-red-500"
            style={{ left: `${todayOffset + unitWidth / 2}px` }}
          />
        )}
      </div>
    </div>
  )
}
