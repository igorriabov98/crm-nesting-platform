"use client"

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Factory } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { GanttChart } from '@/components/features/production/GanttChart'
import { ProductionTable } from '@/components/features/production/ProductionTable'
import { STAGE_ORDER } from '@/lib/constants/stages'
import { cn } from '@/lib/utils'
import type { GanttData } from '@/app/(protected)/production/gantt/actions'
import type { ProductionRow } from '@/app/(protected)/production/actions'
import type { ProductionFilterValues } from '@/components/features/production/ProductionFilters'
import type { GanttFilters } from '@/components/features/production/gantt/GanttControls'
import type { FactorySummary, StageType } from '@/lib/types'

type FilterMode = 'shared' | 'separate'

interface ProductionWorkspaceProps {
  factories: FactorySummary[]
  activeFactoryId: string
  ganttData: GanttData
  productionData: ProductionRow[]
}

const emptyProductionFilters: ProductionFilterValues = {
  search: '',
  workshop: '',
  stageType: '',
  status: '',
  confirmation: '',
  dateFrom: undefined,
  dateTo: undefined,
}

const defaultGanttFilters: GanttFilters = {
  search: '',
  workshop: '',
  confirmation: '',
  showSupply: false,
  visibleStages: [...STAGE_ORDER],
}

export function ProductionWorkspace({
  factories,
  activeFactoryId,
  ganttData,
  productionData,
}: ProductionWorkspaceProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>('shared')
  const [sharedGanttFilters, setSharedGanttFilters] = useState<GanttFilters>(defaultGanttFilters)

  const sharedProductionFilters = useMemo<ProductionFilterValues>(() => ({
    ...emptyProductionFilters,
    search: sharedGanttFilters.search,
    workshop: sharedGanttFilters.workshop,
    confirmation: sharedGanttFilters.confirmation,
  }), [sharedGanttFilters])

  const sharedVisibleStages = sharedGanttFilters.visibleStages as StageType[]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1B3A6B]">Производство</h1>
          <p className="mt-1 text-sm text-[#6B7280]">Гант-график и таблица производственных дат на одном экране.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-[#E8ECF0] bg-white p-1">
            {factories.map((factory) => (
              <Link
                key={factory.id}
                className={cn(
                  'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors hover:bg-[#E8ECF0]',
                  activeFactoryId === factory.id && 'bg-[#1B3A6B] text-white hover:bg-[#1B3A6B] hover:text-white'
                )}
                href={`/production?factory=${factory.id}`}
              >
                <Factory className="h-3.5 w-3.5" />
                {factory.name}
              </Link>
            ))}
          </div>

          <div className="flex rounded-lg border border-[#E8ECF0] bg-white p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn('h-8 px-3 text-xs', filterMode === 'shared' && 'bg-[#E8ECF0] text-[#1B3A6B]')}
              onClick={() => setFilterMode('shared')}
            >
              Общие фильтры
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn('h-8 px-3 text-xs', filterMode === 'separate' && 'bg-[#E8ECF0] text-[#1B3A6B]')}
              onClick={() => setFilterMode('separate')}
            >
              Раздельные
            </Button>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#1B3A6B]">Гант-график</h2>
          <span className="text-xs text-[#6B7280]">{ganttData.machines.length} машин</span>
        </div>
        <GanttChart
          data={ganttData}
          height="520px"
          filters={filterMode === 'shared' ? sharedGanttFilters : undefined}
          onFiltersChange={filterMode === 'shared' ? setSharedGanttFilters : undefined}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-[#1B3A6B]">Машины и даты</h2>
          <p className="text-xs text-[#6B7280]">
            {filterMode === 'shared'
              ? 'Таблица использует те же поиск, цех, подтверждение и этапы, что и график.'
              : 'Таблица и график фильтруются отдельно.'}
          </p>
        </div>
        <ProductionTable
          data={productionData}
          filters={filterMode === 'shared' ? sharedProductionFilters : undefined}
          hideFilters={filterMode === 'shared'}
          visibleStageTypes={filterMode === 'shared' ? sharedVisibleStages : undefined}
        />
      </section>
    </div>
  )
}
