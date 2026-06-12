import type { ReactNode } from 'react'
import { ReserveButton } from './ReserveButton'
import { UnreserveButton } from './UnreserveButton'
import { EmptyRows, OrderStatusCell, formatAmount, stockText, stickyCellClass, tableClass, tdClass, thClass } from './SupplyRequestTableShared'
import type { SupplyRequestRow } from '@/lib/actions/supply-request'
import type { RequestKnives } from '@/lib/types'

type Props = {
  rows: SupplyRequestRow<RequestKnives>[]
  machineId: string
  canManageOrders?: boolean
}

export function SupplyKnivesTable({ rows, machineId, canManageOrders = true }: Props) {
  return (
    <Section title="Ножи">
      <table className={tableClass}>
        <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA]">
          <tr>
            {['Нож', 'Тип стали', 'Длина, мм', 'Ширина, мм', 'Высота, мм', 'Необходимо, мм', 'Вес, кг', 'На складе', 'Забронировано', 'Статус', 'Действия'].map((header, index) => (
              <th key={header} className={`${thClass} ${index === 0 ? stickyCellClass : ''}`}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F1F5F9]">
          {rows.length === 0 ? <EmptyRows colSpan={11} /> : rows.map((row) => {
            const needed = Number(row.remainder_meters || 0) > 0 ? Number(row.remainder_meters || 0) * 1000 : Number(row.to_order_mm || 0)
            const reserved = Number(row.reserved_quantity || 0)
            const unit = row.stock_unit || 'мм'
            return (
              <tr key={row.id}>
                <td className={`${tdClass} min-w-[220px] font-medium text-[#1B3A6B] ${stickyCellClass}`}>{row.materials?.name || row.knife_type || '—'}</td>
                <td className={tdClass}>{row.steel_grade || '—'}</td>
                <td className={tdClass}>{formatAmount(row.length_mm)}</td>
                <td className={tdClass}>{formatAmount(row.width_mm)}</td>
                <td className={tdClass}>{formatAmount(row.height_mm)}</td>
                <td className={tdClass}>{formatAmount(needed)}</td>
                <td className={tdClass}>{row.calculated_weight_kg ? `${formatAmount(row.calculated_weight_kg)} кг` : '—'}</td>
                <td className={`${tdClass} ${Number(row.available_stock || 0) <= 0 ? 'text-red-700' : ''}`}>
                  {stockBreakdown(row.stock_items, unit) || stockText(row.available_stock, unit)}
                  {Number(row.available_stock || 0) <= 0 && Number(row.incompatible_stock_available || 0) > 0 && (
                    <div className="mt-1 whitespace-normal text-xs leading-snug text-amber-700">
                      Есть остаток по материалу, но характеристики ножа не совпадают
                    </div>
                  )}
                </td>
                <td className={tdClass}>{formatAmount(reserved)} {unit}</td>
                <td className={tdClass}><OrderStatusCell table="request_knives" id={row.id} status={row.order_status} canEdit={canManageOrders} /></td>
                <td className={tdClass}>
                  <div className="flex items-center gap-2">
                    <ReserveButton table="request_knives" itemId={row.id} materialId={row.material_id} machineId={machineId} needed={needed} reserved={reserved} available={row.available_stock} unit={unit} stockItems={row.stock_items} />
                    {row.reservation_id && <UnreserveButton table="request_knives" itemId={row.id} />}
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

function stockBreakdown(items: SupplyRequestRow<RequestKnives>['stock_items'], fallbackUnit: string) {
  const lengthItems = items.filter((item) => item.piece_length_mm !== null && Number(item.available_quantity || 0) > 0)
  if (lengthItems.length === 0) return null
  return (
    <div className="space-y-1">
      {lengthItems.map((item) => (
        <div key={item.id} className="whitespace-nowrap">
          {item.is_business_scrap && <span className="mr-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">Отход</span>}
          {formatAmount(item.piece_length_mm ?? 0)} мм: {formatStockQuantity(item.available_quantity, item.unit || fallbackUnit, item.available_secondary_quantity, item.secondary_unit)}
        </div>
      ))}
    </div>
  )
}

function formatStockQuantity(quantity: number, unit: string, secondaryQuantity: number | null, secondaryUnit: string | null) {
  const primary = `${formatAmount(quantity)} ${unit}`
  if (secondaryQuantity === null || secondaryQuantity === undefined || !secondaryUnit) return primary
  return `${primary} / ${formatAmount(secondaryQuantity)} ${secondaryUnit}`
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
      <div className="border-b border-[#E8ECF0] px-4 py-3"><h2 className="font-semibold text-[#1B3A6B]">{title}</h2></div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}
