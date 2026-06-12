import type { SupplyRequestPayload } from '@/lib/actions/supply-request'

type Props = {
  summary: SupplyRequestPayload['summary']
  totalWeight: number
}

const labels = {
  sheetMetal: 'Листовой',
  circles: 'Круг',
  pipes: 'Труба',
  knives: 'Ножи',
  components: 'Комплект.',
  paint: 'Краска',
  meshItems: 'Сетка',
  chainCords: 'Цепь/Шнур',
} as const

export function SupplyRequestSummary({ summary, totalWeight }: Props) {
  return (
    <section className="rounded-xl border border-[#E8ECF0] bg-white p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-[#1B3A6B]">Сводка</h2>
        <div className="rounded-md bg-[#F8F9FA] px-3 py-2 text-sm font-medium text-[#1B3A6B]">
          Общий вес: {formatValue(totalWeight, 'кг')}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-[#E8ECF0] text-[#6B7280]">
            <tr>
              <th className="py-2 pr-4">Раздел</th>
              <th className="py-2 pr-4">Позиций</th>
              <th className="py-2 pr-4">Нужно</th>
              <th className="py-2 pr-4">Со склада</th>
              <th className="py-2 pr-4">К заказу</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {(Object.keys(labels) as Array<keyof typeof labels>).map((key) => {
              const item = summary[key]
              return (
                <tr key={key}>
                  <td className="py-2 pr-4 font-medium text-[#1B3A6B]">{labels[key]}</td>
                  <td className="py-2 pr-4 text-[#374151]">{item.positions}</td>
                  <td className="py-2 pr-4 text-[#374151]">{formatValue(item.needed, item.unit)}</td>
                  <td className="py-2 pr-4 text-emerald-700">{formatValue(item.reserved, item.unit)}</td>
                  <td className="py-2 pr-4 font-medium text-[#111827]">{formatValue(item.toOrder, item.unit)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function formatValue(value: number | null, unit?: string) {
  if (value === null) return '—'
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} ${unit || ''}`.trim()
}
