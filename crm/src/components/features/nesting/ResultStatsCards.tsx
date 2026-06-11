import { AlertTriangle, CheckCircle, Layers, Package, Trash2, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { NestingResult } from '@/lib/nesting/api'

function getUtilizationClass(value: number) {
  if (value > 75) return 'text-green-600'
  if (value >= 50) return 'text-yellow-600'
  return 'text-red-600'
}

function getWasteClass(value: number) {
  if (value < 25) return 'text-green-600'
  if (value <= 50) return 'text-yellow-600'
  return 'text-red-600'
}

function formatPercent(value: number) {
  return `${Number.isFinite(value) ? value.toFixed(1) : '0.0'}%`
}

export function ResultStatsCards({ result }: { result: NestingResult }) {
  const cards = [
    {
      label: 'Листов',
      value: result.totalSheets,
      icon: Layers,
      className: 'text-[#1B3A6B]',
    },
    {
      label: 'Всего деталей',
      value: result.totalParts,
      icon: Package,
      className: 'text-[#1B3A6B]',
    },
    {
      label: 'Размещено',
      value: result.placedParts,
      icon: CheckCircle,
      className: result.placedParts === result.totalParts ? 'text-green-600' : 'text-[#1B3A6B]',
    },
    {
      label: 'Не размещено',
      value: result.unplacedParts.length,
      icon: AlertTriangle,
      className: result.unplacedParts.length > 0 ? 'text-red-600' : 'text-green-600',
    },
    {
      label: 'Использование',
      value: formatPercent(result.avgUtilization),
      icon: TrendingUp,
      className: getUtilizationClass(result.avgUtilization),
    },
    {
      label: 'Отходы',
      value: formatPercent(result.totalWaste),
      icon: Trash2,
      className: getWasteClass(result.totalWaste),
    },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => {
        const Icon = card.icon

        return (
          <Card key={card.label} className="bg-white" size="sm">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-xs text-[#6B7280]">
                <Icon className="h-4 w-4" />
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={cn('text-2xl font-semibold leading-none', card.className)}>{card.value}</div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
