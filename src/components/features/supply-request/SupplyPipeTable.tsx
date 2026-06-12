import type { ReactNode } from 'react'
import { PIPE_SUBTYPE_LABELS } from '@/lib/constants/procurement'
import { ReserveButton } from './ReserveButton'
import { UnreserveButton } from './UnreserveButton'
import { EmptyRows, OrderStatusCell, formatAmount, stockText, stickyCellClass, tableClass, tdClass, thClass } from './SupplyRequestTableShared'
import type { SupplyRequestRow } from '@/lib/actions/supply-request'
import type { RequestPipe } from '@/lib/types'

type Props = {
  rows: SupplyRequestRow<RequestPipe>[]
  machineId: string
  canManageOrders?: boolean
}

export function SupplyPipeTable({ rows, machineId, canManageOrders = true }: Props) {
  return (
    <Section title="Труба">
      <table className={tableClass}>
        <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA]">
          <tr>
            {['Материал', 'Подтип', 'Тип стали', 'Размер', 'Толщина стенки, мм', 'Диаметр, мм', 'Необходимо длина, мм', 'Необходимо, кг', 'Вес, кг', 'На складе', 'Забронировано', 'Статус', 'Действия'].map((header, index) => (
              <th key={header} className={`${thClass} ${index === 0 ? stickyCellClass : ''}`}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F1F5F9]">
          {rows.length === 0 ? <EmptyRows colSpan={13} /> : rows.map((row) => {
            const isWire = row.pipe_type === 'wire'
            const needed = Number((isWire ? row.remainder_kg : row.remainder_length_mm) || 0)
            const reserved = Number(row.reserved_quantity || 0)
            const unit = row.stock_unit || (isWire ? 'кг' : 'мм')
            return (
              <tr key={row.id}>
                <td className={`${tdClass} min-w-[220px] font-medium text-[#1B3A6B] ${stickyCellClass}`}>{row.materials?.name || '—'}</td>
                <td className={tdClass}>{PIPE_SUBTYPE_LABELS[row.pipe_type]}</td>
                <td className={tdClass}>{isWire ? '—' : row.steel_type_name || '—'}</td>
                <td className={tdClass}>{isWire ? '—' : row.size || '—'}</td>
                <td className={tdClass}>{isWire ? '—' : formatAmount(row.wall_thickness_mm)}</td>
                <td className={tdClass}>{row.pipe_type === 'wire' || row.pipe_type === 'round' ? formatAmount(row.diameter_mm) : '—'}</td>
                <td className={tdClass}>{isWire ? '—' : formatAmount(row.remainder_length_mm)}</td>
                <td className={tdClass}>{isWire ? formatAmount(row.remainder_kg) : '—'}</td>
                <td className={tdClass}>{row.calculated_weight_kg ? `${formatAmount(row.calculated_weight_kg)} кг` : '—'}</td>
                <td className={`${tdClass} ${Number(row.available_stock || 0) <= 0 ? 'text-red-700' : ''}`}>{stockBreakdown(row.stock_items, unit) || stockText(row.available_stock, unit)}</td>
                <td className={tdClass}>{formatAmount(reserved)} {unit}</td>
                <td className={tdClass}><OrderStatusCell table="request_pipe" id={row.id} status={row.order_status} canEdit={canManageOrders} /></td>
                <td className={tdClass}>
                  <div className="flex items-center gap-2">
                    <ReserveButton table="request_pipe" itemId={row.id} materialId={row.material_id} machineId={machineId} needed={needed} reserved={reserved} available={row.available_stock} unit={unit} stockItems={row.stock_items} />
                    {row.reservation_id && <UnreserveButton table="request_pipe" itemId={row.id} />}
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

function stockBreakdown(items: SupplyRequestRow<RequestPipe>['stock_items'], fallbackUnit: string) {
  const lengthItems = items.filter((item) => item.piece_length_mm !== null && Number(item.available_quantity || 0) > 0)
  if (lengthItems.length === 0) return null
  return (
    <div className="space-y-1">
      {lengthItems.map((item) => (
        <div key={item.id} className="whitespace-nowrap">
          {item.is_business_scrap && <span className="mr-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">Отход</span>}
          {formatPieceLength(item.piece_length_mm)}: {formatStockQuantity(item.available_quantity, item.unit || fallbackUnit, item.available_secondary_quantity, item.secondary_unit)}
        </div>
      ))}
    </div>
  )
}

function formatPieceLength(value: number | null) {
  return `${formatAmount(Number(value || 0))} мм`
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
