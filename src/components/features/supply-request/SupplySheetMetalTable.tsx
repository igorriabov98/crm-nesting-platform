import type { ReactNode } from 'react'
import { ReserveButton } from './ReserveButton'
import { UnreserveButton } from './UnreserveButton'
import { EmptyRows, OrderStatusCell, formatAmount, stockText, stickyCellClass, tableClass, tdClass, thClass } from './SupplyRequestTableShared'
import type { SupplyRequestRow } from '@/lib/actions/supply-request'
import type { RequestSheetMetal } from '@/lib/types'

type Props = {
  rows: SupplyRequestRow<RequestSheetMetal>[]
  machineId: string
  canManageOrders?: boolean
}

export function SupplySheetMetalTable({ rows, machineId, canManageOrders = true }: Props) {
  return (
    <Section title="Листовой металл">
      <table className={tableClass}>
        <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA]">
          <tr>
            {['Материал', 'Тип стали', 'Размер листа', 'Толщина, мм', 'Необходимо, шт', 'Вес, кг', 'На складе', 'Забронировано', 'Статус', 'Действия'].map((header, index) => (
              <th key={header} className={`${thClass} ${index === 0 ? stickyCellClass : ''}`}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F1F5F9]">
          {rows.length === 0 ? <EmptyRows colSpan={10} /> : rows.map((row) => {
            const needed = Number(row.remainder_qty || 0)
            const reserved = Number(row.reserved_quantity || 0)
            const unit = row.stock_unit || 'шт'
            return (
              <tr key={row.id}>
                <td className={`${tdClass} min-w-[220px] font-medium text-[#1B3A6B] ${stickyCellClass}`}>{row.materials?.name || row.material_name || '—'}</td>
                <td className={tdClass}>{row.material_grade || '—'}</td>
                <td className={tdClass}>{row.sheet_size || '—'}</td>
                <td className={tdClass}>{formatAmount(row.thickness_mm)}</td>
                <td className={tdClass}>{formatAmount(needed)}</td>
                <td className={tdClass}>{row.calculated_weight_kg ? `${formatAmount(row.calculated_weight_kg)} кг` : '—'}</td>
                <td className={`${tdClass} ${Number(row.available_stock || 0) <= 0 ? 'text-red-700' : ''}`}>{stockText(row.available_stock, unit)}</td>
                <td className={tdClass}>{formatAmount(reserved)} {unit}</td>
                <td className={tdClass}><OrderStatusCell table="request_sheet_metal" id={row.id} status={row.order_status} canEdit={canManageOrders} /></td>
                <td className={tdClass}>
                  <div className="flex items-center gap-2">
                    <ReserveButton table="request_sheet_metal" itemId={row.id} materialId={row.material_id} machineId={machineId} needed={needed} reserved={reserved} available={row.available_stock} unit={unit} stockItems={row.stock_items} />
                    {row.reservation_id && <UnreserveButton table="request_sheet_metal" itemId={row.id} />}
                  </div>
                </td>
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
