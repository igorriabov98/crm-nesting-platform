"use client"

import Link from 'next/link'
import { useState } from 'react'
import { Factory } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ProductionPlanner } from '@/components/features/production/ProductionPlanner'
import { STAGE_ORDER } from '@/lib/constants/stages'
import { cn } from '@/lib/utils'
import type { GanttData } from '@/app/(protected)/production/gantt/actions'
import type { ProductionRow } from '@/app/(protected)/production/actions'
import type { GanttFilters } from '@/components/features/production/gantt/GanttControls'
import type { FactorySummary } from '@/lib/types'

interface ProductionWorkspaceProps {
  factories: FactorySummary[]
  activeFactoryId: string
  ganttData: GanttData
  productionData: ProductionRow[]
}

const defaultGanttFilters: GanttFilters = {
  search: '',
  workshop: '',
  confirmation: '',
  productionMonth: '',
  showSupply: false,
  visibleStages: [...STAGE_ORDER],
}

export function ProductionWorkspace({
  factories,
  activeFactoryId,
  ganttData,
  productionData,
}: ProductionWorkspaceProps) {
  const [plannerFilters, setPlannerFilters] = useState<GanttFilters>(defaultGanttFilters)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight text-blue-950 sm:text-2xl">Производство</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Единый planner: машины, timeline, нагрузка сварки и редактирование выбранной машины.
          </p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:justify-end">
          <div className="flex w-full overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1 sm:w-auto">
            {factories.map((factory) => (
              <Link
                key={factory.id}
                className={cn(
                  'inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200 hover:text-blue-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:min-h-10',
                  activeFactoryId === factory.id && 'bg-blue-800 text-white hover:bg-blue-800 hover:text-white'
                )}
                href={`/production?factory=${factory.id}`}
                aria-current={activeFactoryId === factory.id ? 'page' : undefined}
              >
                <Factory className="h-3.5 w-3.5" />
                {factory.name}
              </Link>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 px-3 text-sm text-slate-700 sm:min-h-10"
            onClick={() => setPlannerFilters(defaultGanttFilters)}
          >
            Сбросить фильтры
          </Button>
        </div>
      </div>

      <ProductionPlanner
        data={ganttData}
        productionData={productionData}
        filters={plannerFilters}
        onFiltersChange={setPlannerFilters}
      />
    </div>
  )
}
