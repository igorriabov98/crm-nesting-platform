import type { ReactNode } from 'react'
import { LayoutCoveragePurchase, LayoutCoverageSources, LayoutCoverageState } from './LayoutCoverageSummary'
import { EmptyRows, OrderStatusCell, formatAmount, stickyCellClass, tableClass, tdClass, thClass } from './SupplyRequestTableShared'
import type { SupplyRequestRow } from '@/lib/actions/supply-request'
import type { RequestCircle } from '@/lib/types'

type Props = {
  rows: SupplyRequestRow<RequestCircle>[]
}

export function SupplyCircleTable({ rows }: Props) {
  return (
    <Section title="Круг">
      <table className={tableClass}>
        <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA]">
          <tr>
            {['Материал', 'Диаметр, мм', 'Тип стали', 'Калибровка', 'Необходимо, мм', 'Вес, кг', 'Обеспечение по раскладке', 'К закупке по раскладке', 'Раскладка', 'Статус'].map((header, index) => (
              <th key={header} className={`${thClass} ${index === 0 ? stickyCellClass : ''}`}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F1F5F9]">
          {rows.length === 0 ? <EmptyRows colSpan={10} /> : rows.map((row) => {
            const needed = Number(row.remainder_mm || 0)
            const reserved = Number(row.reserved_quantity || 0)
            return (
              <tr key={row.id}>
                <td className={`${tdClass} min-w-[220px] font-medium text-[#1B3A6B] ${stickyCellClass}`}>{row.materials?.name || '—'}</td>
                <td className={tdClass}>{formatAmount(row.diameter_mm)}</td>
                <td className={tdClass}>{row.steel_type_name || row.steel_grade || '—'}</td>
                <td className={tdClass}>{row.is_calibrated ? 'Да' : 'Нет'}</td>
                <td className={tdClass}>{formatAmount(needed)}</td>
                <td className={tdClass}>{row.calculated_weight_kg ? `${formatAmount(row.calculated_weight_kg)} кг` : '—'}</td>
                <td className={tdClass}><LayoutCoverageSources coverage={row.layout_coverage} /></td>
                <td className={tdClass}><LayoutCoveragePurchase coverage={row.layout_coverage} /></td>
                <td className={tdClass}><LayoutCoverageState coverage={row.layout_coverage} /></td>
                <td className={tdClass}><OrderStatusCell table="request_circle" status={row.order_status} needed={needed} reserved={reserved} covered={row.covered_quantity} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
      <div className="border-b border-[#E8ECF0] px-4 py-3"><h2 className="font-semibold text-[#1B3A6B]">{title}</h2></div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}
