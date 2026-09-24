import type { ReactNode } from 'react'
import { ReserveButton } from './ReserveButton'
import { UnreserveButton } from './UnreserveButton'
import { SheetBusinessScrapMatches } from './SheetBusinessScrapMatches'
import { EmptyRows, OrderStatusCell, formatAmount, stockText, stickyCellClass, tableClass, tdClass, thClass } from './SupplyRequestTableShared'
import type { SupplyRequestRow } from '@/lib/actions/supply-request'
import type { RequestSheetMetal } from '@/lib/types'

type Props = {
  rows: SupplyRequestRow<RequestSheetMetal>[]
  machineId: string
  canReserve?: boolean
  canUnreserve?: boolean
  businessScrapMode?: boolean
}

export function SupplySheetMetalTable({ rows, machineId, canReserve = false, canUnreserve = false, businessScrapMode = false }: Props) {
  return (
    <Section title="Листовой металл">
      <table className={tableClass}>
        <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA]">
          <tr>
            {['Материал', 'Тип стали', 'Размер листа', 'Толщина, мм', 'Необходимо, шт', 'Вес, кг', businessScrapMode ? 'Остатки, все заводы' : 'На складе', businessScrapMode ? 'Бронь остатка' : 'Забронировано', 'Статус', 'Действия'].map((header, index) => (
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
                <td className={tdClass}>{row.steel_type_name || row.material_grade || '—'}</td>
                <td className={tdClass}>{row.sheet_size || '—'}</td>
                <td className={tdClass}>{formatAmount(row.thickness_mm)}</td>
                <td className={tdClass}>{formatAmount(needed)}</td>
                <td className={tdClass}>{row.calculated_weight_kg ? `${formatAmount(row.calculated_weight_kg)} кг` : '—'}</td>
                <td className={`${tdClass} ${Number(row.available_stock || 0) <= 0 ? 'text-red-700' : ''}`}>
                  {stockText(row.available_stock, unit)}
                </td>
                <td className={tdClass}>{formatAmount(reserved)} {unit}{businessScrapMode && <div className="text-xs text-slate-500">Покрытие листов: {formatAmount(row.covered_quantity)} шт</div>}</td>
                <td className={tdClass}><OrderStatusCell table="request_sheet_metal" status={row.order_status} needed={needed} reserved={businessScrapMode ? 0 : reserved} covered={row.covered_quantity} /></td>
                <td className={tdClass}>
                  {(canReserve || (canUnreserve && row.reservation_id)) ? <div className="flex items-center gap-2">
                    {canReserve && (businessScrapMode
                      ? <SheetBusinessScrapMatches itemId={row.id} requestMaterialId={row.material_id} machineId={machineId}
                          steelTypeName={row.steel_type_name || row.material_grade || 'Тип стали'} thicknessMm={row.thickness_mm}
                          items={row.stock_items} />
                      : <ReserveButton table="request_sheet_metal" itemId={row.id} materialId={row.material_id} machineId={machineId} needed={needed} reserved={reserved} covered={row.covered_quantity} available={row.available_stock} unit={unit} stockItems={row.stock_items} />)}
                    {canUnreserve && row.reservation_id && <UnreserveButton table="request_sheet_metal" itemId={row.id} />}
                  </div> : <span className="text-xs text-slate-400">Только просмотр</span>}
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
