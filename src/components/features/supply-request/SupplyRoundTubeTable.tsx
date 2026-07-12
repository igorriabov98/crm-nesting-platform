import type { ReactNode } from 'react'
import { ReserveButton } from './ReserveButton'
import { UnreserveButton } from './UnreserveButton'
import { EmptyRows, OrderStatusCell, formatAmount, stockText, stickyCellClass, tableClass, tdClass, thClass, toOrderCell } from './SupplyRequestTableShared'
import type { SupplyRequestRow } from '@/lib/actions/supply-request'
import type { RequestRoundTube } from '@/lib/types'

type Props = {
  rows: SupplyRequestRow<RequestRoundTube>[]
  machineId: string
  canManageOrders?: boolean
}

export function SupplyRoundTubeTable({ rows, machineId, canManageOrders = true }: Props) {
  return (
    <Section title="Круг / Труба">
      <table className={tableClass}>
        <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA]">
          <tr>
            {['Материал', 'Заявка, м', 'Заявка, кг', 'На складе', 'Забронировать', 'Забронировано', 'К заказу', 'Статус'].map((header, index) => (
              <th key={header} className={`${thClass} ${index === 0 ? stickyCellClass : ''}`}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F1F5F9]">
          {rows.length === 0 ? <EmptyRows colSpan={8} /> : rows.map((row) => {
            const needed = Number(row.order_kg || 0)
            const reserved = Number(row.reserved_from_stock_kg || 0)
            return (
              <tr key={row.id}>
                <td className={`${tdClass} min-w-[220px] font-medium text-[#1B3A6B] ${stickyCellClass}`}>{row.material_name}</td>
                <td className={tdClass}>{formatAmount(row.order_meters)} м</td>
                <td className={tdClass}>{formatAmount(row.order_kg)} кг</td>
                <td className={`${tdClass} ${Number(row.available_stock || 0) <= 0 ? 'text-red-700' : ''}`}>
                  {stockText(row.available_stock, row.stock_unit || 'кг')}
                  {row.available_secondary_stock !== null && row.available_secondary_stock !== undefined && (
                    <div className="text-xs text-slate-500">{formatAmount(row.available_secondary_stock)} {row.secondary_stock_unit || 'м'}</div>
                  )}
                </td>
                <td className={tdClass}>
                  <ReserveButton table="request_round_tube" itemId={row.id} materialId={row.material_id} machineId={machineId} needed={needed} reserved={reserved} covered={row.covered_quantity} available={row.available_stock} unit="кг" stockItems={row.stock_items} />
                </td>
                <td className={tdClass}>
                  <div className="flex items-center gap-2">
                    <span>{formatAmount(reserved)} кг</span>
                    {row.reservation_id && <UnreserveButton table="request_round_tube" itemId={row.id} />}
                  </div>
                  {Number(row.reserved_from_stock_m || 0) > 0 && <div className="text-xs text-slate-500">{formatAmount(row.reserved_from_stock_m)} м</div>}
                </td>
                <td className={tdClass}>{toOrderCell(needed, reserved, 'кг')}</td>
                <td className={tdClass}><OrderStatusCell table="request_round_tube" id={row.id} status={row.order_status} canEdit={canManageOrders} /></td>
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
