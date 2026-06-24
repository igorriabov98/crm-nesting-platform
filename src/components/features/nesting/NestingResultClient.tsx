'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { DxfDownloadButtons } from '@/components/features/nesting/DxfDownloadButtons'
import { FutureFillPanel } from '@/components/features/nesting/FutureFillPanel'
import { NestingCanvas } from '@/components/features/nesting/NestingCanvas'
import { ResultStatsCards } from '@/components/features/nesting/ResultStatsCards'
import { SheetInfoPanel } from '@/components/features/nesting/SheetInfoPanel'
import { SheetTabs } from '@/components/features/nesting/SheetTabs'
import { StatusBadge } from '@/components/features/nesting/StatusBadge'
import { UnplacedPartsList } from '@/components/features/nesting/UnplacedPartsList'
import type { NestingProject, NestingResult } from '@/lib/nesting/api'
import type { FutureFillContext } from '@/lib/actions/nesting-future-fill'

export function NestingResultClient({
  project,
  result,
  futureFillContext,
}: {
  project: NestingProject
  result: NestingResult
  futureFillContext: FutureFillContext | null
}) {
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)
  const [hoveredPart, setHoveredPart] = useState<string | null>(null)
  const [selectedPart, setSelectedPart] = useState<string | null>(null)
  const activeSheet = result.sheets[activeSheetIndex] ?? result.sheets[0]

  function handleSheetChange(index: number) {
    setActiveSheetIndex(index)
    setHoveredPart(null)
    setSelectedPart(null)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-lg border border-[#E8ECF0] bg-white p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/nesting/${project.id}/parts`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
              К деталям
            </Button>
          </Link>
          <Separator orientation="vertical" className="hidden h-6 md:block" />
          <div>
            <p className="text-sm text-[#6B7280]">Заказ</p>
            <h2 className="text-lg font-semibold text-[#1B3A6B]">{project.orderNumber}</h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={project.status} />
          <span className="text-sm text-[#6B7280]">Изделий: {project.quantity}</span>
        </div>
      </div>

      <ResultStatsCards result={result} />

      <GroupedDemandSummary result={result} />

      <FutureFillPanel context={futureFillContext} />

      <UnplacedPartsList parts={result.unplacedParts} />

      <SheetTabs sheets={result.sheets} activeIndex={activeSheetIndex} onChange={handleSheetChange} />

      {activeSheet ? (
        <>
          <Card className="bg-white">
            <CardContent>
              <NestingCanvas
                sheet={activeSheet}
                hoveredPart={hoveredPart}
                selectedPart={selectedPart}
                onPartHover={setHoveredPart}
                onPartSelect={setSelectedPart}
              />
            </CardContent>
          </Card>

          <SheetInfoPanel sheet={activeSheet} />

          <DxfDownloadButtons
            projectId={project.id}
            sheetId={activeSheet.id}
            orderNumber={project.orderNumber}
            sheetIndex={activeSheet.sheetIndex}
          />
        </>
      ) : (
        <Card className="bg-white">
          <CardContent>
            <p className="text-sm font-medium text-red-600">Листы результата не найдены.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function GroupedDemandSummary({ result }: { result: NestingResult }) {
  const groups = new Map<string, {
    material: string
    steelTypeName: string | null
    thickness: number
    size: string
    sheets: number
    utilizationSum: number
    sources: Set<string>
  }>()

  for (const sheet of result.sheets) {
    const size = `${sheet.width}x${sheet.height}`
    const key = [sheet.material, sheet.steelTypeName || '', sheet.thickness, size, sheet.isRemnant ? 'remnant' : 'sheet'].join('|')
    const current = groups.get(key) || {
      material: sheet.material,
      steelTypeName: sheet.steelTypeName,
      thickness: sheet.thickness,
      size,
      sheets: 0,
      utilizationSum: 0,
      sources: new Set<string>(),
    }
    current.sheets += 1
    current.utilizationSum += sheet.utilization
    for (const placement of sheet.placements) {
      const source = placement.sourceMachineName || placement.sourceLabel
      if (source) current.sources.add(source)
    }
    groups.set(key, current)
  }

  const rows = Array.from(groups.values())
  if (rows.length === 0) return null

  return (
    <Card className="bg-white">
      <CardContent>
        <div className="mb-3">
          <h3 className="font-semibold text-[#1B3A6B]">Групповая потребность пакета</h3>
          <p className="text-sm text-[#6B7280]">Сводка листов по общему результату раскладки.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[#E8ECF0] text-left text-[#6B7280]">
              <tr>
                <th className="py-2 pr-4 font-medium">Материал</th>
                <th className="py-2 pr-4 font-medium">Размер</th>
                <th className="py-2 pr-4 text-right font-medium">Листов</th>
                <th className="py-2 pr-4 text-right font-medium">Утилизация</th>
                <th className="py-2 font-medium">Источники</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF0]">
              {rows.map((row) => (
                <tr key={`${row.material}-${row.thickness}-${row.size}`}>
                  <td className="py-2 pr-4 font-medium text-[#374151]">
                    {row.material}{row.steelTypeName ? ` / ${row.steelTypeName}` : ''}, {row.thickness} мм
                  </td>
                  <td className="py-2 pr-4 text-[#374151]">{row.size} мм</td>
                  <td className="py-2 pr-4 text-right text-[#374151]">{row.sheets}</td>
                  <td className="py-2 pr-4 text-right text-[#374151]">{(row.utilizationSum / row.sheets).toFixed(1)}%</td>
                  <td className="py-2 text-[#6B7280]">
                    {row.sources.size > 0 ? Array.from(row.sources).slice(0, 4).join(', ') : '—'}
                    {row.sources.size > 4 ? ` +${row.sources.size - 4}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
