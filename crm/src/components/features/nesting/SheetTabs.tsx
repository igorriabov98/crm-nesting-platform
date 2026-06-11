'use client'

import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { SheetResult } from '@/lib/nesting/api'

function formatPercent(value: number) {
  return `${Number.isFinite(value) ? value.toFixed(1) : '0.0'}%`
}

export function SheetTabs({
  sheets,
  activeIndex,
  onChange,
}: {
  sheets: SheetResult[]
  activeIndex: number
  onChange: (index: number) => void
}) {
  const activeSheet = sheets[activeIndex] ?? sheets[0]

  if (!activeSheet) {
    return null
  }

  if (sheets.length === 1) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#E8ECF0] bg-white px-4 py-3 text-sm text-[#6B7280]">
        <span className="font-medium text-[#1B3A6B]">Лист {activeSheet.sheetIndex}</span>
        <span>{activeSheet.width}×{activeSheet.height} мм</span>
        {activeSheet.steelTypeName && <span>{activeSheet.steelTypeName}</span>}
        <span>{formatPercent(activeSheet.utilization)}</span>
        {activeSheet.isRemnant && <Badge className="bg-violet-100 text-violet-700">Остаток</Badge>}
      </div>
    )
  }

  return (
    <Tabs value={String(activeIndex)} onValueChange={(value) => onChange(Number(value) || 0)} className="w-full">
      <div className="overflow-x-auto pb-1">
        <TabsList className="!h-auto min-w-max justify-start gap-2 bg-transparent p-0">
          {sheets.map((sheet, index) => (
            <TabsTrigger
              key={sheet.id}
              value={String(index)}
              className={cn(
                'h-auto min-w-[148px] flex-col items-start rounded-lg border border-[#E8ECF0] bg-white px-3 py-2 text-left shadow-none',
                'data-active:border-[#1B3A6B] data-active:bg-[#F8F9FA] data-active:text-[#1B3A6B]'
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="font-medium">Лист {sheet.sheetIndex}</span>
                {sheet.isRemnant && <Badge className="bg-violet-100 text-[10px] text-violet-700">Остаток</Badge>}
              </span>
              <span className="text-xs text-[#6B7280]">{sheet.width}×{sheet.height} мм</span>
              {sheet.steelTypeName && <span className="text-xs text-[#6B7280]">{sheet.steelTypeName}</span>}
              <span className="text-xs font-medium text-[#1B3A6B]">{formatPercent(sheet.utilization)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </Tabs>
  )
}
