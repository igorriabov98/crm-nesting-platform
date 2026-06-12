import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { PaintingCheckListItem, ProcurementCheckListItem } from '@/lib/actions/stock-check'

type Props =
  | { type: 'procurement'; items: ProcurementCheckListItem[] }
  | { type: 'painting'; items: PaintingCheckListItem[] }

function statusLabel(status: string) {
  return status === 'stock_checked' ? 'Остатки проверены' : 'Ожидает проверки остатков'
}

export function StockCheckList(props: Props) {
  const basePath = props.type === 'procurement' ? '/stock-check/procurement' : '/stock-check/painting'
  const isProcurement = props.type === 'procurement'

  if (props.items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
        Нет заявок для проверки.
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      {props.items.map((item) => {
        const uncheckedText = isProcurement
          ? `Непроверено: ${(item as ProcurementCheckListItem).uncheckedKnives} ножей, ${(item as ProcurementCheckListItem).uncheckedComponents} комплектации`
          : `Непроверено: ${(item as PaintingCheckListItem).uncheckedPaint} позиций краски`

        return (
          <div key={item.requestId} className="rounded-xl border border-[#E8ECF0] bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-bold text-[#1B3A6B]">🔵 Машина: {item.machineName}</h2>
                <div className="mt-2 text-sm text-slate-600">Статус: {statusLabel(item.status)}</div>
                <div className="mt-1 text-sm font-medium text-slate-800">{uncheckedText}</div>
              </div>
              <Link
                href={`${basePath}/${item.requestId}`}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-base font-medium text-primary-foreground hover:bg-primary/90"
              >
                Открыть
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </div>
          </div>
        )
      })}
    </div>
  )
}
