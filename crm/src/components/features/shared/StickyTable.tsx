"use client"

import React from 'react'
import { cn } from '@/lib/utils'

interface StickyTableProps {
  children: React.ReactNode
  stickyColumns?: number
  stickyColumnWidths?: number[]
  className?: string
  scrollRef?: React.Ref<HTMLDivElement>
}

/**
 * Table wrapper providing:
 * - Horizontal scroll for wide tables
 * - Sticky first N columns (left-pinned)  
 * - Sticky header (top-pinned)
 * - Shadow separator between frozen and scrollable areas
 */
export function StickyTable({
  children,
  stickyColumns = 4,
  stickyColumnWidths = [40, 160, 60, 90, 90, 90, 90],
  className,
  scrollRef,
}: StickyTableProps) {
  const offsets = stickyColumnWidths.map((_, index) =>
    stickyColumnWidths.slice(0, index).reduce((sum, width) => sum + width, 0)
  )
  const stickyWidthRules = stickyColumnWidths
    .slice(0, stickyColumns)
    .map((width, index) => {
      const child = index + 1
      const left = offsets[index] || 0
      return `
        .sticky-table thead tr:first-child th:nth-child(${child}),
        .sticky-table tbody td:nth-child(${child}) {
          left: ${left}px;
          min-width: ${width}px;
          width: ${width}px;
          max-width: ${width}px;
        }
      `
    })
    .join('\n')

  return (
    <div ref={scrollRef} className={cn("relative overflow-x-auto scroll-smooth rounded-md border border-[#E8ECF0]", className)}>
      <style>{`
        .sticky-table thead tr:first-child th:nth-child(-n+${stickyColumns}),
        .sticky-table tbody td:nth-child(-n+${stickyColumns}) {
          position: sticky;
          z-index: 10;
        }
        ${stickyWidthRules}
        /* Shadow on the last sticky column */
        .sticky-table thead tr:first-child th:nth-child(${stickyColumns}),
        .sticky-table tbody td:nth-child(${stickyColumns}) {
          box-shadow: 4px 0 8px -2px rgba(27,58,107,0.16);
        }
        .sticky-table thead th {
          position: sticky;
          top: 0;
          z-index: 20;
          white-space: nowrap;
        }
        .sticky-table thead tr:first-child th:nth-child(-n+${stickyColumns}) {
          z-index: 30;
        }
        .sticky-table {
          border-collapse: separate;
          border-spacing: 0;
        }
      `}</style>
      <table className="sticky-table w-max min-w-full table-fixed text-sm text-left">
        {children}
      </table>
    </div>
  )
}
