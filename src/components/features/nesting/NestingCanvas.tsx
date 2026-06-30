'use client'

import { useId, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { Placement, SheetResult } from '@/lib/nesting/api'

const PADDING = 50
const MAX_SVG_WIDTH = 900
const GRID_STEP = 100
const GRID_STEP_BIG = 500

const PART_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
]

function getPartColor(name: string) {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = ((hash << 5) - hash) + name.charCodeAt(index)
    hash |= 0
  }
  return PART_COLORS[Math.abs(hash) % PART_COLORS.length]
}

function createTicks(max: number, step: number) {
  const safeMax = Math.max(0, Math.round(max))
  const ticks: number[] = []

  for (let value = 0; value <= safeMax; value += step) {
    ticks.push(value)
  }

  if (ticks[ticks.length - 1] !== safeMax) {
    ticks.push(safeMax)
  }

  return ticks
}

function formatMm(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function shortenLabel(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value
  }

  return `${value.slice(0, Math.max(1, maxChars - 1))}…`
}

export function NestingCanvas({
  sheet,
  hoveredPart,
  selectedPart,
  onPartHover,
  onPartSelect,
}: {
  sheet: SheetResult
  hoveredPart: string | null
  selectedPart: string | null
  onPartHover: (partId: string | null) => void
  onPartSelect: (partId: string | null) => void
}) {
  const reactId = useId().replace(/:/g, '')
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [tooltip, setTooltip] = useState<{ part: Placement; x: number; y: number } | null>(null)

  const safeSheetWidth = Math.max(sheet.width, 1)
  const safeSheetHeight = Math.max(sheet.height, 1)
  const scale = (MAX_SVG_WIDTH - PADDING * 2) / safeSheetWidth
  const sheetSvgWidth = safeSheetWidth * scale
  const sheetSvgHeight = safeSheetHeight * scale
  const svgWidth = MAX_SVG_WIDTH
  const svgHeight = Math.max(180, sheetSvgHeight + PADDING * 2)
  const gridSmallId = `nesting-grid-small-${reactId}`
  const gridBigId = `nesting-grid-big-${reactId}`
  const xTicks = createTicks(sheet.width, GRID_STEP_BIG)
  const yTicks = createTicks(sheet.height, GRID_STEP_BIG)

  function getSvgX(x: number) {
    return PADDING + x * scale
  }

  function getSvgY(y: number, height: number) {
    return PADDING + (sheet.height - y - height) * scale
  }

  function getSvgPoint(point: { x: number; y: number }) {
    return {
      x: getSvgX(point.x),
      y: PADDING + (sheet.height - point.y) * scale,
    }
  }

  function pointsToPath(points: { x: number; y: number }[], close = true) {
    if (points.length === 0) return ''
    const [first, ...rest] = points.map(getSvgPoint)
    const commands = [`M ${first.x} ${first.y}`, ...rest.map((point) => `L ${point.x} ${point.y}`)]
    if (close) commands.push('Z')
    return commands.join(' ')
  }

  function updateTooltip(event: ReactMouseEvent<SVGGElement>, part: Placement) {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }

    setTooltip({
      part,
      x: event.clientX - rect.left + 14,
      y: event.clientY - rect.top + 14,
    })
  }

  function clearHover() {
    onPartHover(null)
    setTooltip(null)
  }

  return (
    <div ref={wrapperRef} className="relative" onMouseLeave={clearHover}>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Раскладка листа ${sheet.sheetIndex}`}
        onClick={() => onPartSelect(null)}
      >
        <defs>
          <pattern id={gridSmallId} width={GRID_STEP * scale} height={GRID_STEP * scale} patternUnits="userSpaceOnUse">
            <path
              d={`M ${GRID_STEP * scale} 0 L 0 0 0 ${GRID_STEP * scale}`}
              fill="none"
              stroke="currentColor"
              className="text-slate-200"
              strokeWidth="0.5"
            />
          </pattern>
          <pattern id={gridBigId} width={GRID_STEP_BIG * scale} height={GRID_STEP_BIG * scale} patternUnits="userSpaceOnUse">
            <path
              d={`M ${GRID_STEP_BIG * scale} 0 L 0 0 0 ${GRID_STEP_BIG * scale}`}
              fill="none"
              stroke="currentColor"
              className="text-slate-300"
              strokeWidth="0.8"
            />
          </pattern>
        </defs>

        <rect x={PADDING} y={PADDING} width={sheetSvgWidth} height={sheetSvgHeight} fill="#ffffff" rx="2" />
        <rect x={PADDING} y={PADDING} width={sheetSvgWidth} height={sheetSvgHeight} fill={`url(#${gridSmallId})`} rx="2" />
        <rect x={PADDING} y={PADDING} width={sheetSvgWidth} height={sheetSvgHeight} fill={`url(#${gridBigId})`} rx="2" />
        <rect
          x={PADDING}
          y={PADDING}
          width={sheetSvgWidth}
          height={sheetSvgHeight}
          fill="none"
          stroke="currentColor"
          className="text-[#9CA3AF]"
          strokeWidth="1.5"
          rx="2"
        />

        <text x={PADDING + sheetSvgWidth / 2} y={PADDING - 12} textAnchor="middle" className="fill-[#6B7280] text-[10px]">
          {formatMm(sheet.width)} мм
        </text>
        <text
          x={PADDING - 34}
          y={PADDING + sheetSvgHeight / 2}
          textAnchor="middle"
          className="fill-[#6B7280] text-[10px]"
          transform={`rotate(-90 ${PADDING - 34} ${PADDING + sheetSvgHeight / 2})`}
        >
          {formatMm(sheet.height)} мм
        </text>

        {xTicks.map((tick) => (
          <g key={`x-${tick}`}>
            <line
              x1={getSvgX(tick)}
              y1={PADDING + sheetSvgHeight}
              x2={getSvgX(tick)}
              y2={PADDING + sheetSvgHeight + 5}
              stroke="currentColor"
              className="text-[#9CA3AF]"
              strokeWidth="0.7"
            />
            <text
              x={getSvgX(tick)}
              y={PADDING + sheetSvgHeight + 18}
              textAnchor="middle"
              className="fill-[#6B7280] text-[9px]"
            >
              {tick}
            </text>
          </g>
        ))}

        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              x1={PADDING - 5}
              y1={getSvgY(tick, 0)}
              x2={PADDING}
              y2={getSvgY(tick, 0)}
              stroke="currentColor"
              className="text-[#9CA3AF]"
              strokeWidth="0.7"
            />
            <text
              x={PADDING - 10}
              y={getSvgY(tick, 0) + 3}
              textAnchor="end"
              className="fill-[#6B7280] text-[9px]"
            >
              {tick}
            </text>
          </g>
        ))}

        {sheet.placements.map((placement, index) => {
          const partName = placement.name || placement.partId
          const color = getPartColor(partName)
          const hovered = hoveredPart === placement.partId
          const selected = selectedPart === placement.partId
          const x = getSvgX(placement.x)
          const y = getSvgY(placement.y, placement.placedH)
          const width = placement.placedW * scale
          const height = placement.placedH * scale
          const labelLimit = Math.max(4, Math.floor(width / 7))
          const hasContour = Boolean(placement.contour && placement.contour.length >= 3)

          return (
            <g
              key={`${placement.partId}-${index}`}
              className="cursor-pointer"
              onMouseEnter={(event) => {
                onPartHover(placement.partId)
                updateTooltip(event, placement)
              }}
              onMouseMove={(event) => updateTooltip(event, placement)}
              onMouseLeave={clearHover}
              onClick={(event) => {
                event.stopPropagation()
                onPartSelect(selected ? null : placement.partId)
              }}
            >
              {hasContour ? (
                <>
                  <path
                    d={pointsToPath(placement.contour || [])}
                    fill={color}
                    fillOpacity={selected ? 0.35 : hovered ? 0.4 : 0.2}
                    stroke={color}
                    strokeWidth={selected ? 2.5 : hovered ? 2 : 1}
                  />
                  {(placement.holes || []).map((hole, holeIndex) => (
                    <path
                      key={`hole-${holeIndex}`}
                      d={pointsToPath(hole)}
                      fill="#ffffff"
                      fillOpacity="0.85"
                      stroke={color}
                      strokeOpacity="0.7"
                      strokeWidth="1"
                    />
                  ))}
                </>
              ) : (
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  fill={color}
                  fillOpacity={selected ? 0.35 : hovered ? 0.4 : 0.2}
                  stroke={color}
                  strokeWidth={selected ? 2.5 : hovered ? 2 : 1}
                  rx="1"
                />
              )}

              {(placement.leadIn || []).map((segment, segmentIndex) => {
                const from = getSvgPoint(segment.from)
                const to = getSvgPoint(segment.to)

                return (
                  <g key={`lead-in-${segmentIndex}`}>
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#2563EB" strokeWidth="1.8" />
                    <circle cx={from.x} cy={from.y} r="2.4" fill="#2563EB" />
                  </g>
                )
              })}

              {(placement.leadOut || []).map((segment, segmentIndex) => {
                const from = getSvgPoint(segment.from)
                const to = getSvgPoint(segment.to)

                return (
                  <g key={`lead-out-${segmentIndex}`}>
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#EA580C" strokeWidth="1.8" />
                    <circle cx={to.x} cy={to.y} r="2.4" fill="#EA580C" />
                  </g>
                )
              })}

              {width > 50 && height > 20 && (
                <text
                  x={x + width / 2}
                  y={y + height / 2 - (height > 35 ? 6 : 0)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="pointer-events-none text-[10px] font-medium"
                  fill={color}
                >
                  {shortenLabel(partName, labelLimit)}
                </text>
              )}

              {width > 70 && height > 35 && (
                <text
                  x={x + width / 2}
                  y={y + height / 2 + 9}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="pointer-events-none fill-[#6B7280] text-[8px]"
                >
                  {formatMm(placement.placedW)}×{formatMm(placement.placedH)}
                  {placement.rotation === 90 ? ', 90°' : ''}
                </text>
              )}
            </g>
          )
        })}

        {sheet.remnantGeom && (
          <g>
            <rect
              x={getSvgX(sheet.remnantGeom.x)}
              y={getSvgY(sheet.remnantGeom.y, sheet.remnantGeom.height)}
              width={sheet.remnantGeom.width * scale}
              height={sheet.remnantGeom.height * scale}
              fill="rgb(34, 197, 94)"
              fillOpacity="0.1"
              stroke="rgb(34, 197, 94)"
              strokeWidth="1"
              strokeDasharray="8 4"
              rx="2"
            />
            {sheet.remnantGeom.width * scale > 90 && sheet.remnantGeom.height * scale > 28 && (
              <text
                x={getSvgX(sheet.remnantGeom.x + sheet.remnantGeom.width / 2)}
                y={getSvgY(sheet.remnantGeom.y, sheet.remnantGeom.height) + (sheet.remnantGeom.height * scale) / 2}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-green-700 text-[11px] font-medium"
              >
                Остаток {formatMm(sheet.remnantGeom.width)}×{formatMm(sheet.remnantGeom.height)}
              </text>
            )}
          </g>
        )}
      </svg>

      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 rounded-md border border-[#E8ECF0] bg-white p-2 text-xs text-[#374151] shadow-md"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-medium text-[#1B3A6B]">{tooltip.part.name || tooltip.part.partId}</div>
          {tooltip.part.sourceMachineName || tooltip.part.sourceLabel ? (
            <div>{tooltip.part.sourceMachineName || tooltip.part.sourceLabel}</div>
          ) : null}
          <div>Размер: {formatMm(tooltip.part.placedW)} × {formatMm(tooltip.part.placedH)} мм</div>
          <div>Позиция: x {formatMm(tooltip.part.x)}, y {formatMm(tooltip.part.y)} мм</div>
          <div>Поворот: {tooltip.part.rotation}°</div>
        </div>
      )}
    </div>
  )
}
