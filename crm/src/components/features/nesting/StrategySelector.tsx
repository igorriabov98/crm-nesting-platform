'use client'

import { Layers, Scissors, Target } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { NestingStrategy } from '@/lib/nesting/api'

const strategies: { value: NestingStrategy; title: string; description: string; icon: React.ElementType }[] = [
  {
    value: 'minWaste',
    title: 'Минимум отхода',
    description: 'Максимальная плотность упаковки деталей',
    icon: Target,
  },
  {
    value: 'remnant',
    title: 'Деловой остаток',
    description: 'Оставить прямоугольный остаток для повторного использования',
    icon: Scissors,
  },
  {
    value: 'minSheets',
    title: 'Минимум листов',
    description: 'Минимизировать количество использованных листов',
    icon: Layers,
  },
]

export function StrategySelector({
  value,
  onChange,
  disabled,
}: {
  value: NestingStrategy
  onChange: (value: NestingStrategy) => void
  disabled?: boolean
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {strategies.map((strategy) => {
        const Icon = strategy.icon
        const selected = value === strategy.value

        return (
          <button
            key={strategy.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(strategy.value)}
            className="text-left disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Card className={cn('h-full border border-transparent bg-white transition', selected && 'ring-2 ring-[#1B3A6B]')}>
              <CardContent className="flex gap-3">
                <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F4F6F9] text-[#1B3A6B]', selected && 'bg-[#1B3A6B] text-white')}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-medium text-[#1B3A6B]">{strategy.title}</p>
                  <p className="mt-1 text-xs text-[#6B7280]">{strategy.description}</p>
                </div>
              </CardContent>
            </Card>
          </button>
        )
      })}
    </div>
  )
}
