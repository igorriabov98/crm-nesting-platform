"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { differenceInCalendarDays } from 'date-fns'
import { formatDate } from '@/lib/utils/gantt'
import type { GanttMaterialItem } from '@/app/(protected)/production/gantt/actions'
import { GANTT_MARKER_SIZE } from './types'

type MaterialMarkerType = 'planned' | 'actual'

type PopoverPosition = {
  top: number
  left: number
}

interface GanttMaterialMarkerProps {
  type: MaterialMarkerType
  date: string
  items: GanttMaterialItem[]
  rangeStart: Date
  unitWidth: number
  machineId: string
  machineName: string
  title?: string
}

const statusLabel: Record<string, string> = {
  received: 'Получено',
  ordered: 'Заказано',
  not_ordered: 'Не заказано',
}

function totalPrice(item: GanttMaterialItem) {
  const quantity = Number(item.quantity || 0)
  const price = Number(item.price_per_unit || 0)
  return quantity > 0 && price > 0 ? quantity * price : 0
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' }).format(value)
}

export const GanttMaterialMarker = React.memo(function GanttMaterialMarker({
  type,
  date,
  items,
  rangeStart,
  unitWidth,
  machineId,
  machineName,
}: GanttMaterialMarkerProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  const markerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const markerDate = useMemo(() => new Date(date), [date])
  const left = differenceInCalendarDays(markerDate, rangeStart) * unitWidth + unitWidth / 2 - GANTT_MARKER_SIZE / 2
  const label = type === 'planned' ? 'План поставки материала' : 'Факт поставки материала'
  const emptyText = type === 'planned' ? 'Нет позиций на эту дату' : 'Нет полученных позиций'
  const isActual = type === 'actual'

  const updatePosition = useCallback(() => {
    if (typeof window === 'undefined') return
    const markerRect = markerRef.current?.getBoundingClientRect()
    if (!markerRect) return

    const gap = 8
    const popoverWidth = popoverRef.current?.offsetWidth || 300
    const popoverHeight = popoverRef.current?.offsetHeight || 180
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    const centeredLeft = markerRect.left + markerRect.width / 2 - popoverWidth / 2
    const leftPosition = Math.min(
      Math.max(centeredLeft, gap),
      Math.max(gap, viewportWidth - popoverWidth - gap)
    )

    let topPosition = markerRect.bottom + gap
    if (topPosition + popoverHeight > viewportHeight - gap) {
      topPosition = markerRect.top - popoverHeight - gap
    }

    setPosition({
      top: Math.min(Math.max(topPosition, gap), Math.max(gap, viewportHeight - popoverHeight - gap)),
      left: leftPosition,
    })
  }, [])

  useEffect(() => {
    if (!open) return

    const frame = window.requestAnimationFrame(updatePosition)
    const handleResize = () => updatePosition()
    const handleScroll = () => updatePosition()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setPosition(null)
      }
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (markerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
      setPosition(null)
    }

    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handlePointerDown)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [open, updatePosition])

  return (
    <>
      <button
        ref={markerRef}
        type="button"
        className="absolute z-20 cursor-pointer"
        style={{
          left,
          top: '50%',
          width: GANTT_MARKER_SIZE,
          height: GANTT_MARKER_SIZE,
          transform: 'translateY(-50%)',
        }}
        title={`${label}: ${formatDate(markerDate)}`}
        aria-label={`${label}: ${machineName}`}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
          window.requestAnimationFrame(updatePosition)
        }}
      >
        <span
          className="block h-full w-full rotate-45 shadow-[0_1px_2px_rgba(22,163,74,0.25)]"
          style={{
            backgroundColor: isActual ? '#16A34A' : '#FFFFFF',
            border: isActual ? 'none' : '2px solid #16A34A',
          }}
        />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          className="fixed max-h-[320px] w-[300px] overflow-hidden rounded-md border border-[#D1D5DB] bg-white text-xs text-[#1B3A6B] shadow-xl"
          style={{
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            zIndex: 1000,
          }}
        >
          <div className="border-b border-[#E8ECF0] px-3 py-2">
            <div className="font-semibold">{label}</div>
            <div className="mt-0.5 text-[#6B7280]">{machineName} · {formatDate(markerDate)}</div>
          </div>

          <div className="max-h-[220px] overflow-y-auto px-3 py-2">
            {items.length === 0 ? (
              <div className="py-4 text-center text-[#9CA3AF]">{emptyText}</div>
            ) : (
              <div className="space-y-2">
                {items.map((item) => {
                  const total = totalPrice(item)
                  return (
                    <div key={item.id} className="rounded border border-[#E8ECF0] bg-[#F8F9FA] p-2">
                      <div className="font-medium text-[#1B3A6B]">{item.nomenclature || 'Без названия'}</div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[#6B7280]">
                        <span>{Number(item.quantity || 0).toLocaleString('ru-RU')} {item.unit || 'шт'}</span>
                        <span>{statusLabel[item.supply_status] ?? item.supply_status}</span>
                        {item.supplier && <span>{item.supplier}</span>}
                        {total > 0 && <span>{formatMoney(total)}</span>}
                      </div>
                      {item.comment && <div className="mt-1 text-[#6B7280]">{item.comment}</div>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="border-t border-[#E8ECF0] px-3 py-2">
            <Link href={`/supply/${machineId}`} className="font-medium text-[#2563EB] hover:underline">
              Открыть снабжение
            </Link>
          </div>
        </div>,
        document.body
      )}
    </>
  )
})
