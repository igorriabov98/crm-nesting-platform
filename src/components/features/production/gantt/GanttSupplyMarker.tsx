"use client"

import React, { useState } from 'react'
import { barGeometry, formatDate, type GanttScale } from '@/lib/utils/gantt'
import type { GanttSupplyItem } from '@/app/(protected)/production/gantt/actions'
import { GANTT_MARKER_SIZE } from './types'

interface GanttSupplyMarkerProps {
  item: GanttSupplyItem
  rangeStart: Date
  scale: GanttScale
  unitWidth: number
}

function markerColor(item: GanttSupplyItem): string {
  if (item.supply_status === 'received') return '#70AD47'
  if (item.is_overdue) return '#DC2626'
  if (item.supply_status === 'ordered') return '#FFC000'
  return '#70AD47'
}

const statusLabel: Record<string, string> = {
  received: 'Получено',
  ordered: 'Заказано',
  not_ordered: 'Не заказано',
}

export const GanttSupplyMarker = React.memo(function GanttSupplyMarker({ item, rangeStart, scale, unitWidth }: GanttSupplyMarkerProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const date = new Date(item.planned_delivery_date)
  const { left } = barGeometry(date, date, rangeStart, scale, unitWidth)
  const color = markerColor(item)
  const size = GANTT_MARKER_SIZE

  return (
    <div
      className="absolute top-1/2 cursor-pointer"
      style={{
        left: left + unitWidth / 2 - size / 2,
        width: size,
        height: size,
        transform: 'translateY(-50%)',
        zIndex: 8,
      }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="h-full w-full rounded-sm shadow-[0_1px_2px_rgba(15,23,42,0.18)]" style={{ backgroundColor: color }} />

      {showTooltip && (
        <div className="absolute bottom-full left-1/2 z-50 mb-2 min-w-[190px] -translate-x-1/2 rounded-md border border-[#D1D5DB] bg-white p-3 text-xs text-[#1B3A6B] shadow-md pointer-events-none">
          <p className="mb-1.5 flex items-center gap-2 font-semibold">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
            {item.nomenclature}
          </p>
          <p className="text-[#6B7280]">Плановая дата: <span className="text-[#1B3A6B]">{formatDate(date)}</span></p>
          <p className="text-[#6B7280]">Статус: <span className="text-[#1B3A6B]">{statusLabel[item.supply_status] ?? item.supply_status}</span></p>
          {item.is_overdue && <p className="mt-1 font-medium text-[#DC2626]">Просрочено</p>}
        </div>
      )}
    </div>
  )
})
