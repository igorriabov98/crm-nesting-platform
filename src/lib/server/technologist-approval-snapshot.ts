import 'server-only'
/* eslint-disable @typescript-eslint/no-explicit-any -- migration-bound database adapter */
import type { ApprovalSummaryItem, ApprovalSummarySnapshot } from '@/lib/technologist-request-approval'
import { PIPE_SUBTYPE_LABELS, CHAIN_CORD_SUBTYPE_LABELS } from '@/lib/constants/procurement'

const CATEGORY_TABLES = [
  ['request_sheet_metal', 'Листовой металл'],
  ['request_round_tube', 'Круглая труба'],
  ['request_circle', 'Круг'],
  ['request_pipe', 'Труба, профиль и проволока'],
  ['request_knives', 'Ножи'],
  ['request_components', 'Комплектующие'],
  ['request_paint', 'Краска'],
  ['request_mesh', 'Сетка'],
  ['request_chain_cord', 'Цепь и шнур'],
] as const

type CompletionInput = {
  decision: 'has_items' | 'none'
  enteredPlasmaMinutes: number
  wasteItems: Array<{ sourceTable: string; sourceId: string; wastePercent: number }>
  futureItems: unknown[]
  archives: Array<{ objectPath: string; fileName: string; mimeType: string | null; fileSize: number }>
}

function numberOrNull(value: unknown) {
  const parsed = Number(value)
  return value !== null && value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : null
}

function describeRow(table: string, row: Record<string, unknown>) {
  const name = [
    row.material_name, row.material_grade, row.steel_grade, PIPE_SUBTYPE_LABELS[String(row.pipe_type)], row.knife_type,
    row.component_name, row.paint_name, row.mesh_type, CHAIN_CORD_SUBTYPE_LABELS[String(row.chain_cord_type)], row.size, row.sheet_size,
    row.thickness_mm ? `${row.thickness_mm} мм` : null,
  ].filter(Boolean).join(' · ')
  const candidates: Array<[string, string]> = table === 'request_sheet_metal'
    ? [['remainder_qty', 'шт.'], ['quantity_sheets', 'шт.'], ['weight_order_kg', 'кг']]
    : table === 'request_components'
      ? [['quantity_needed', 'шт.']]
      : table === 'request_circle'
        ? [['remainder_mm', 'мм']]
        : table === 'request_pipe'
          ? row.pipe_type === 'wire' ? [['remainder_kg', 'кг']] : [['remainder_length_mm', 'мм']]
          : table === 'request_knives'
            ? [['to_order_mm', 'мм'], ['remainder_qty', 'шт.']]
            : table === 'request_chain_cord'
              ? [['remainder_meters', 'м']]
              : [['remainder_qty', 'шт.'], ['remainder_kg', 'кг'], ['order_kg', 'кг']]
  const selected = candidates.find(([field]) => numberOrNull(row[field]) !== null)
  return {
    name: name || `Позиция ${String(row.id).slice(0, 8)}`,
    quantity: selected ? numberOrNull(row[selected[0]]) : null,
    unit: selected?.[1] || '',
    weightKg: numberOrNull(row.calculated_weight_kg ?? row.weight_order_kg ?? row.order_kg),
  }
}

export async function buildTechnologistApprovalSnapshot(
  client: any,
  requestId: string,
  machine: { id: string; name: string | null; material_type: string | null },
  completion: CompletionInput,
): Promise<ApprovalSummarySnapshot> {
  const sourceResult = await client.rpc('fn_technologist_approval_source', { p_request_id: requestId })
  if (sourceResult.error) throw sourceResult.error
  const partIds = completion.futureItems.flatMap((item: any) => item.partId ? [item.partId] : [])
  const partsResult = partIds.length ? await client.from('detailing_parts').select('id,name,drawing_number,unit_weight_kg').in('id', partIds) : { data: [], error: null }
  if (partsResult.error) throw partsResult.error
  const enriched = { ...completion, futureItems: completion.futureItems.map((item: any) => {
    const part = (partsResult.data || []).find((row: any) => row.id === item.partId)
    return part ? { ...item, name: part.name, drawingNumber: part.drawing_number, unitWeightKg: part.unit_weight_kg } : item
  }) }
  return snapshotFromSource(sourceResult.data, requestId, machine, enriched)
}

export function snapshotFromSource(
  sourceData: Record<string, any[]>, requestId: string,
  machine: { id: string; name: string | null; material_type: string | null }, completion: CompletionInput,
): ApprovalSummarySnapshot {
  const source = sourceData
  const tableResults = CATEGORY_TABLES.map(([table]) => [...(source[table] || [])].sort((a, b) => Number(a.sort_order) - Number(b.sort_order)))
  const wasteByKey = new Map(completion.wasteItems.map((item) => [`${item.sourceTable}:${item.sourceId}`, item.wastePercent]))
  const reservations = source.reservations || []
  const items: ApprovalSummaryItem[] = []
  CATEGORY_TABLES.forEach(([table, categoryLabel], index) => {
    for (const raw of tableResults[index] as Record<string, unknown>[]) {
      if (raw.order_status === 'cancelled' || raw.is_cutting_plan_draft === true) continue
      const key = `${table}:${raw.id}`
      const rowReservations = reservations.filter((reservation: any) => `${reservation.request_item_table}:${reservation.request_item_id}` === key && reservation.reservation_source !== 'correction_hold')
      const reservationTotal = (business: boolean) => rowReservations
        .filter((reservation: any) => Boolean(reservation.is_business_scrap) === business)
        .reduce((sum: number, reservation: any) => sum + Number(reservation.logical_reserved_quantity ?? reservation.reserved_quantity ?? 0), 0)
      const described = describeRow(table, raw)
      items.push({
        key, category: table, categoryLabel, ...described,
        attributes: Object.fromEntries(Object.entries(raw).filter(([field]) => !['id','request_id','created_at','sort_order','order_status','ordered_at','delivered_at','supplier_id','custom_delivery_date'].includes(field))),
        businessScrapReserved: reservationTotal(true) / (table === 'request_chain_cord' ? 1000 : 1),
        regularStockReserved: reservationTotal(false) / (table === 'request_chain_cord' ? 1000 : 1),
        wastePercent: wasteByKey.get(key) ?? null,
      })
    }
  })
  return {
    schemaVersion: 1,
    sourceData,
    requestId,
    machineId: machine.id,
    orderName: machine.name || 'Без названия',
    materialType: machine.material_type,
    items,
    futureItems: completion.futureItems,
    enteredPlasmaMinutes: completion.enteredPlasmaMinutes,
    archives: completion.archives,
  }
}
