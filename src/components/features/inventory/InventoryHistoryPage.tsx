import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import {
  CHAIN_CORD_SUBTYPE_LABELS,
  INVENTORY_TRANSACTION_LABELS,
  MATERIAL_CATEGORY_LABELS,
  PIPE_SUBTYPE_LABELS,
} from '@/lib/constants/procurement'
import type { InventoryTransactionWithRelations } from '@/lib/actions/inventory'

type Props = {
  rows: InventoryTransactionWithRelations[]
  materialId: string
  page: number
  pageSize: number
  total: number
  factoryId?: string | null
}

const TYPE_CLASSES = {
  receipt: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  reserve: 'border-blue-200 bg-blue-50 text-blue-700',
  unreserve: 'border-orange-200 bg-orange-50 text-orange-700',
  write_off: 'border-red-200 bg-red-50 text-red-700',
  adjustment: 'border-slate-200 bg-slate-100 text-slate-700',
  transfer_out: 'border-violet-200 bg-violet-50 text-violet-700',
  transfer_in: 'border-cyan-200 bg-cyan-50 text-cyan-700',
} as const

export function InventoryHistoryPage({ rows, materialId, page, pageSize, total, factoryId }: Props) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentFrom = total === 0 ? 0 : page * pageSize + 1
  const currentTo = Math.min(total, (page + 1) * pageSize)
  const pageHref = (nextPage: number) => {
    const params = new URLSearchParams({ page: String(nextPage) })
    if (factoryId) params.set('factory', factoryId)
    return `/inventory/${materialId}/history?${params.toString()}`
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 rounded-xl border border-[#E8ECF0] bg-white px-4 py-3 text-sm text-[#6B7280] sm:flex-row sm:items-center sm:justify-between">
        <span>
          Записи {currentFrom}-{currentTo} из {total}. Страница {page + 1} из {pageCount}.
        </span>
        <div className="flex gap-2">
          <Link
            href={pageHref(page)}
            className={page <= 0 ? 'pointer-events-none rounded-md border border-[#E8ECF0] px-3 py-1.5 font-medium text-[#1B3A6B] opacity-50' : 'rounded-md border border-[#E8ECF0] px-3 py-1.5 font-medium text-[#1B3A6B]'}
          >
            Назад
          </Link>
          <Link
            href={pageHref(page + 2)}
            className={page + 1 >= pageCount ? 'pointer-events-none rounded-md border border-[#E8ECF0] px-3 py-1.5 font-medium text-[#1B3A6B] opacity-50' : 'rounded-md border border-[#E8ECF0] px-3 py-1.5 font-medium text-[#1B3A6B]'}
          >
            Вперёд
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA] text-[#6B7280]">
              <tr>
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3">Тип</th>
                <th className="px-4 py-3">Категория</th>
                <th className="px-4 py-3">Характеристики</th>
                <th className="px-4 py-3">Количество</th>
                <th className="px-4 py-3">Машина</th>
                <th className="px-4 py-3">Поставщик</th>
                <th className="px-4 py-3">Кто</th>
                <th className="px-4 py-3">Комментарий</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF0]">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 text-[#6B7280]">{new Date(row.created_at).toLocaleString('ru-RU')}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={TYPE_CLASSES[row.transaction_type]}>{INVENTORY_TRANSACTION_LABELS[row.transaction_type]}</Badge></td>
                  <td className="px-4 py-3">{row.material_category ? MATERIAL_CATEGORY_LABELS[row.material_category] ?? row.material_category : '—'}</td>
                  <td className="px-4 py-3 text-[#6B7280]">{variantSummary(row)}</td>
                  <td className={row.quantity < 0 ? 'px-4 py-3 font-medium text-red-700' : 'px-4 py-3 font-medium text-emerald-700'}>
                    {signedAmount(row.quantity)} {row.unit || ''}
                    {row.secondary_quantity !== null ? ` / ${signedAmount(row.secondary_quantity)} ${row.secondary_unit || ''}` : ''}
                  </td>
                  <td className="px-4 py-3">{row.machine_name || '—'}</td>
                  <td className="px-4 py-3">{row.supplier_name || '—'}</td>
                  <td className="px-4 py-3">{row.user_name || '—'}</td>
                  <td className="px-4 py-3">{row.comment || '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-[#9CA3AF]">История пуста</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function signedAmount(value: number) {
  return `${value > 0 ? '+' : ''}${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)}`
}

function variantSummary(row: InventoryTransactionWithRelations) {
  const variant = row.variant
  if (!variant) return '—'

  const values: Array<string | number | null | undefined> = []
  if (row.material_category === 'sheet_metal') values.push(variant.material_grade, variant.sheet_size, variant.thickness_mm ? `${variant.thickness_mm} мм` : null)
  else if (row.material_category === 'circle') values.push(variant.material_grade, variant.diameter_mm ? `Ø${variant.diameter_mm}` : null, variant.is_calibrated ? 'калибр.' : null)
  else if (row.material_category === 'pipe') {
    values.push(variant.pipe_type ? PIPE_SUBTYPE_LABELS[variant.pipe_type] ?? variant.pipe_type : null)
    if (variant.pipe_type === 'wire') values.push(variant.diameter_mm ? `Ø${variant.diameter_mm}` : null)
    else values.push(variant.piece_description, variant.wall_thickness_mm ? `${variant.wall_thickness_mm} мм` : null)
  } else if (row.material_category === 'knives') values.push(variant.knife_dimensions, variant.knife_material)
  else if (row.material_category === 'paint') values.push(variant.ral_code, variant.finish)
  else if (row.material_category === 'components') values.push(variant.specification, variant.diameter_mm ? `Ø${variant.diameter_mm}` : null)
  else if (row.material_category === 'mesh') values.push(variant.mesh_description, variant.mesh_length_mm ? `${variant.mesh_length_mm} мм` : null, variant.mesh_width_mm ? `${variant.mesh_width_mm} мм` : null)
  else if (row.material_category === 'chain_cord') values.push(variant.chain_cord_type ? CHAIN_CORD_SUBTYPE_LABELS[variant.chain_cord_type] ?? variant.chain_cord_type : null, variant.chain_cord_parameters)

  return values.filter(Boolean).join(', ') || '—'
}
