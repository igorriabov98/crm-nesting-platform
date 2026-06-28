"use client"

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { NIGHT_SHIFT_COLOR } from '@/lib/constants/stages'
import { barGeometry, formatDate, type GanttScale } from '@/lib/utils/gantt'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/lib/constants/routes'
import type { GanttStage } from '@/app/(protected)/production/gantt/actions'
import { getGanttStageColor, getGanttStageLabel } from './types'

interface GanttBarProps {
  stage: GanttStage
  rangeStart: Date
  scale: GanttScale
  unitWidth: number
  machineId: string
  isConfirmed?: boolean
  onSelect?: () => void
  planOnly?: boolean
}

type TooltipPosition = {
  top: number
  left: number
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized, 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export const GanttBar = React.memo(function GanttBar({
  stage,
  rangeStart,
  scale,
  unitWidth,
  machineId,
  isConfirmed = true,
  onSelect,
  planOnly = false,
}: GanttBarProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const updateTooltipPosition = useCallback(() => {
    if (typeof window === 'undefined') return
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return

    const gap = 8
    const tooltipWidth = tooltipRef.current?.offsetWidth || 220
    const tooltipHeight = tooltipRef.current?.offsetHeight || 130
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    const maxLeft = Math.max(gap, viewportWidth - tooltipWidth - gap)
    const left = Math.min(Math.max(rect.left, gap), maxLeft)
    let top = rect.top - tooltipHeight - gap

    if (top < gap) {
      top = rect.bottom + gap
    }

    const maxTop = Math.max(gap, viewportHeight - tooltipHeight - gap)
    setTooltipPosition({
      top: Math.min(Math.max(top, gap), maxTop),
      left,
    })
  }, [])

  useEffect(() => {
    if (!showTooltip) return

    const frame = window.requestAnimationFrame(updateTooltipPosition)
    window.addEventListener('resize', updateTooltipPosition)
    window.addEventListener('scroll', updateTooltipPosition, true)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateTooltipPosition)
      window.removeEventListener('scroll', updateTooltipPosition, true)
    }
  }, [showTooltip, updateTooltipPosition])

  if (!stage.date_start) return null

  const startDate = new Date(stage.date_start)
  const endDate = new Date(stage.date_end)
  const { left, width } = barGeometry(startDate, endDate, rangeStart, scale, unitWidth)
  const color = getGanttStageColor(stage.stage_type)
  const visibleStatus = planOnly ? 'not_planned' : stage.status
  const isPlanned = visibleStatus === 'not_planned'
  const showLabel = width > 70

  let nightLeft = 0
  let showNight = false
  if (stage.is_night_shift && stage.night_shift_date) {
    const nightDate = new Date(stage.night_shift_date)
    const { left: nLeft } = barGeometry(nightDate, nightDate, rangeStart, scale, unitWidth)
    nightLeft = nLeft - left
    showNight = nightLeft >= 0 && nightLeft < width
  }

  const durationDays = Math.max(
    1,
    Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
  )
  const usesExpandedHitArea = Boolean(onSelect)

  return (
    <div
      ref={barRef}
      className={cn(
        "absolute rounded-none",
        usesExpandedHitArea ? "top-1/2 -translate-y-1/2" : "inset-y-0",
        "cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1"
      )}
      style={{
        left,
        width,
        height: usesExpandedHitArea ? 44 : '100%',
        zIndex: 5,
      }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => {
        setShowTooltip(false)
        setTooltipPosition(null)
      }}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (!onSelect) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      data-stage-status={visibleStatus}
      data-stage-type={stage.stage_type}
    >
      <div
        className={cn(
          "absolute left-0 right-0 overflow-hidden rounded-none transition-[filter,box-shadow] hover:brightness-105",
          usesExpandedHitArea ? "top-1/2 h-[18px] -translate-y-1/2" : "inset-0",
          isPlanned ? "border-2 border-dashed" : "shadow-sm",
          visibleStatus === 'overdue' && "ring-2 ring-red-500"
        )}
        style={{
          borderColor: isPlanned ? color : undefined,
          backgroundColor: isPlanned ? hexToRgba(color, 0.16) : color,
        }}
      >
        {showNight && !isPlanned && (
          <div
            className="absolute top-0 bottom-0 opacity-75"
            style={{
              left: nightLeft,
              width: unitWidth,
              backgroundColor: NIGHT_SHIFT_COLOR,
            }}
          />
        )}

        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${Math.max(1, unitWidth - 1)}px, rgba(255,255,255,0.28) ${Math.max(1, unitWidth - 1)}px, rgba(255,255,255,0.28) ${unitWidth}px)`,
          }}
        />

        {!isConfirmed && !isPlanned && (
          <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,0.22)_4px,rgba(255,255,255,0.22)_8px)]" />
        )}

        {showLabel && (onSelect ? (
          <span
            className={cn(
              "relative z-10 flex h-full items-center truncate px-3 text-[11px] font-medium",
              isPlanned ? "text-[#374151]" : "text-white"
            )}
          >
            {getGanttStageLabel(stage.stage_type)}
          </span>
        ) : (
          <Link
            href={`${ROUTES.SALES_PLAN}/${machineId}`}
            className={cn(
              "relative z-10 flex h-full items-center truncate px-3 text-[11px] font-medium",
              isPlanned ? "text-[#374151]" : "text-white"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {getGanttStageLabel(stage.stage_type)}
          </Link>
        ))}
      </div>

      {showTooltip && typeof document !== 'undefined' && createPortal(
        <div
          ref={tooltipRef}
          className="pointer-events-none fixed min-w-[190px] rounded-md border border-[#D1D5DB] bg-white p-3 text-xs text-[#1B3A6B] shadow-lg"
          style={{
            top: tooltipPosition?.top ?? -9999,
            left: tooltipPosition?.left ?? -9999,
            zIndex: 1000,
            minWidth: 190,
          }}
        >
          <p className="mb-1.5 flex items-center gap-2 font-semibold">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
            {getGanttStageLabel(stage.stage_type)}
          </p>
          {stage.workshop && <p className="text-[#6B7280]">Цех: <span className="text-[#1B3A6B]">{stage.workshop}</span></p>}
          <p className="text-[#6B7280]">Начало: <span className="text-[#1B3A6B]">{formatDate(startDate)}</span></p>
          <p className="text-[#6B7280]">Конец: <span className="text-[#1B3A6B]">{formatDate(endDate)}</span></p>
          <p className="text-[#6B7280]">Длительность: <span className="text-[#1B3A6B]">{durationDays} дн.</span></p>
          {isPlanned && <p className="mt-1 text-[#6B7280]">Запланировано</p>}
          {visibleStatus === 'active' && <p className="mt-1 text-[#2563EB]">В работе</p>}
          {visibleStatus === 'completed' && <p className="mt-1 text-[#16A34A]">Завершен</p>}
          {visibleStatus === 'overdue' && (
            <p className="mt-1 font-medium text-[#DC2626]">
              {stage.delay_days > 0 ? `Просрочено вручную на ${stage.delay_days} дн.` : 'Просрочено вручную'}
            </p>
          )}
        </div>,
        document.body
      )}
    </div>
  )
})
