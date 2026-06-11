"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { canSeeAllFactories } from '@/lib/utils/permissions'
import { useFactoryFilter } from '@/lib/hooks/useFactoryFilter'
import type { CurrentUser, FactorySummary } from '@/lib/types'

interface FactoryFilterProps {
  user: CurrentUser
  factories: FactorySummary[]
}

export function FactoryFilter({ user, factories }: FactoryFilterProps) {
  const { selectedFactory, setFactory } = useFactoryFilter(user, factories)
  const selectedFactoryLabel =
    selectedFactory === 'no_factory'
      ? 'Без завода'
      : selectedFactory && selectedFactory !== 'all'
        ? factories.find((factory) => factory.id === selectedFactory)?.name || 'Завод'
        : 'Все заводы'

  if (!canSeeAllFactories(user.role)) return null

  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:inline-block text-sm text-[#6B7280]">Завод:</span>
      <Select value={selectedFactory || 'all'} onValueChange={(value) => setFactory(value || null)}>
        <SelectTrigger className="w-[140px] sm:w-[160px] h-8 text-sm bg-[#F4F6F9] border-[#E8ECF0]">
          <SelectValue>{selectedFactoryLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все заводы</SelectItem>
          {factories.map((factory) => (
            <SelectItem key={factory.id} value={factory.id}>
              {factory.name}
            </SelectItem>
          ))}
          <SelectItem value="no_factory">Без завода</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
