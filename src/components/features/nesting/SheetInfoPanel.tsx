import { CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SheetResult } from '@/lib/nesting/api'

function formatPercent(value: number) {
  return `${Number.isFinite(value) ? value.toFixed(1) : '0.0'}%`
}

function formatArea(areaMm2: number) {
  return `${(areaMm2 / 1_000_000).toFixed(3)} м²`
}

function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-[#6B7280]">{label}:</span>
      <span className="font-medium text-[#1B3A6B]">{value}</span>
    </span>
  )
}

export function SheetInfoPanel({ sheet }: { sheet: SheetResult }) {
  const selectedRemnants = sheet.selectedRemnants?.length ? sheet.selectedRemnants : sheet.remnantGeom ? [sheet.remnantGeom] : []

  return (
    <div className="space-y-3 rounded-lg border border-[#E8ECF0] bg-white p-4 text-sm">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <InfoItem label="Материал" value={`${sheet.material}${sheet.steelTypeName ? ` · ${sheet.steelTypeName}` : ''} ${sheet.thickness} мм`} />
        <InfoItem label="Размер" value={`${sheet.width}×${sheet.height} мм`} />
        <InfoItem label="Использование" value={formatPercent(sheet.utilization)} />
        <InfoItem label="Деталей на листе" value={sheet.placements.length} />
      </div>

      {selectedRemnants.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[#E8ECF0] pt-3">
          <InfoItem label="Деловых остатков" value={selectedRemnants.length} />
          <InfoItem label="Общая площадь" value={formatArea(selectedRemnants.reduce((sum, remnant) => sum + remnant.area, 0))} />
          <span className="inline-flex items-center gap-1 font-medium text-green-700">
            <CheckCircle2 className="h-4 w-4" />
            Выбраны для использования
          </span>
          <div className="basis-full text-[#6B7280]">
            {selectedRemnants.map((remnant, index) => (
              <span key={remnant.id} className="mr-4 inline-flex">
                #{index + 1}: {Math.round(remnant.width)}×{Math.round(remnant.height)} мм
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
