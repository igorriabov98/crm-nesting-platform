import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { NestingPart, PartType } from '@/lib/nesting/api'

function getPartType(part: NestingPart): PartType {
  return part.partType || (part.isSheetMetal ? 'SHEET' : 'PROFILE')
}

export function StatsCards({ parts }: { parts: NestingPart[] }) {
  const sheetMetal = parts.filter((part) => getPartType(part) === 'SHEET')
  const profile = parts.filter((part) => getPartType(part) === 'PROFILE')
  const purchased = parts.filter((part) => getPartType(part) === 'PURCHASED')
  const thicknesses = Array.from(new Set(
    sheetMetal
      .map((part) => part.thickness)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  )).sort((a, b) => a - b)

  const cards = [
    { label: 'Всего', value: parts.length, detail: 'деталей' },
    { label: 'Листовых', value: sheetMetal.length, detail: 'для раскладки' },
    { label: 'Профильных', value: profile.length, detail: 'не в раскладку' },
    { label: 'Покупных', value: purchased.length, detail: 'не в раскладку' },
    {
      label: 'Толщин',
      value: thicknesses.length,
      detail: thicknesses.length ? thicknesses.map((value) => `${value} мм`).join(', ') : '—',
    },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.label} className="bg-white">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm text-[#6B7280]">{card.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-[#1B3A6B]">{card.value}</div>
            <p className="mt-1 truncate text-xs text-[#6B7280]">{card.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
