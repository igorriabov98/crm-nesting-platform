import { displayedStockCoverage, hasLayoutStockCoverage } from '@/lib/supply-request-stock-coverage'

type Props = {
  reserved: number | null | undefined
  covered: number | null | undefined
  unit: string
  showLayoutSource?: boolean
}

export function StockCoverageValue({ reserved, covered, unit, showLayoutSource = true }: Props) {
  const input = { reservedQuantity: reserved, coveredQuantity: covered }
  const quantity = displayedStockCoverage(input)
  const includesLayoutCoverage = showLayoutSource && hasLayoutStockCoverage(input)

  return (
    <div className="flex flex-col items-start gap-0.5">
      <span>{formatAmount(quantity)} {unit}</span>
      {includesLayoutCoverage && (
        <span
          className="whitespace-nowrap text-xs font-medium text-emerald-700"
          title="Складской материал учтён утверждённой раскладкой"
        >
          По раскладке
        </span>
      )}
    </div>
  )
}

function formatAmount(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}
