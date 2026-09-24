import 'server-only'
import { approvedProcurement, isLayoutProcurement } from '@/lib/approval-procurement'
/* eslint-disable @typescript-eslint/no-explicit-any -- migration-bound database adapter */
import type { ApprovalSummaryItem, ApprovalSummarySnapshot } from '@/lib/technologist-request-approval'
import { PIPE_SUBTYPE_LABELS, CHAIN_CORD_SUBTYPE_LABELS } from '@/lib/constants/procurement'
import { calculateSheetScrap, type SheetScrapInput } from '@/lib/request-completion-sheet-scrap'

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
  wasteItems: Array<{ sourceTable: string; sourceId: string; wastePercent: number; futureScraps?: SheetScrapInput[] }>
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
    row.component_name, row.paint_name, row.paint_type, row.ral_code, row.finish, row.mesh_type, CHAIN_CORD_SUBTYPE_LABELS[String(row.chain_cord_type)], row.size, row.sheet_size,
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
  const partsResult = partIds.length ? await client.from('detailing_parts').select('id,name,drawing_number,unit_weight_kg,width_mm,height_mm,thickness_mm').in('id', partIds) : { data: [], error: null }
  if (partsResult.error) throw partsResult.error
  const enriched = { ...completion, futureItems: completion.futureItems.map((item: any) => {
    const part = (partsResult.data || []).find((row: any) => row.id === item.partId)
    return part ? { ...item, name: part.name, drawingNumber: part.drawing_number, unitWeightKg: part.unit_weight_kg, widthMm: part.width_mm, heightMm: part.height_mm, thicknessMm: part.thickness_mm } : item
  }) }
  return (await withApprovalProcurement(client, await withSheetSteelTypeNames(client, snapshotFromSource(sourceResult.data, requestId, machine, enriched))))!
}

export function snapshotFromSource(
  sourceData: Record<string, any[]>, requestId: string,
  machine: { id: string; name: string | null; material_type: string | null }, completion: CompletionInput,
): ApprovalSummarySnapshot {
  const source = sourceData
  const tableResults = CATEGORY_TABLES.map(([table]) => [...(source[table] || [])].sort((a, b) => Number(a.sort_order) - Number(b.sort_order)))
  const wasteByKey = new Map(completion.wasteItems.map((item) => [`${item.sourceTable}:${item.sourceId}`, item]))
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
      const waste = wasteByKey.get(key)
      let sheetCalculation: ReturnType<typeof calculateSheetScrap> | null = null
      if (table === 'request_sheet_metal' && waste && described.weightKg && raw.sheet_size && raw.quantity_sheets) {
        try {
          sheetCalculation = calculateSheetScrap(String(raw.sheet_size), Number(raw.quantity_sheets), described.weightKg, waste.futureScraps || [], waste.wastePercent)
        } catch { /* A returned draft can contain an older completion payload. */ }
      }
      items.push({
        key, category: table, categoryLabel, ...described,
        attributes: Object.fromEntries(Object.entries(raw).filter(([field]) => !['id','request_id','created_at','sort_order','order_status','ordered_at','delivered_at','supplier_id','custom_delivery_date'].includes(field))),
        businessScrapReserved: reservationTotal(true) / (table === 'request_chain_cord' ? 1000 : 1),
        regularStockReserved: reservationTotal(false) / (table === 'request_chain_cord' ? 1000 : 1),
        wastePercent: waste?.wastePercent ?? null,
        wasteBasisKg: sheetCalculation?.wasteBasisKg ?? described.weightKg,
        businessScrapWeightKg: sheetCalculation?.scrapWeightKg ?? 0,
        metalScrapKg: sheetCalculation?.metalScrapKg ?? null,
        processedUsefulKg: sheetCalculation?.usefulKg ?? null,
        futureSheetScraps: sheetCalculation?.rows ?? [],
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

// Resolve legacy snapshots by their saved steel ID, never by the current request row.
// Keep sourceData byte-for-byte equivalent for the SQL approval freshness check.
export async function withSheetSteelTypeNames(
  client: any,
  snapshot: ApprovalSummarySnapshot | null,
  storedSnapshot?: ApprovalSummarySnapshot | null,
): Promise<ApprovalSummarySnapshot | null> {
  if (!snapshot?.items) return snapshot
  const saved = new Map((storedSnapshot?.items || []).map(item => [item.key, item]))
  const items = snapshot.items.map(item => {
    if (item.category !== 'request_sheet_metal') return item
    const previous = saved.get(item.key)?.attributes
    const current = item.attributes || {}
    const name = current.steel_type_name || (current.steel_type_id === previous?.steel_type_id ? previous?.steel_type_name : null)
    return name ? { ...item, attributes: { ...current, steel_type_name: name } } : item
  })
  const ids = [...new Set(items.flatMap(item => item.category === 'request_sheet_metal'
    && !item.attributes?.steel_type_name && typeof item.attributes?.steel_type_id === 'string'
    ? [item.attributes.steel_type_id] : []))]
  const result = ids.length ? await client.from('steel_types').select('id,name').in('id', ids) : { data: [], error: null }
  if (result.error) throw new Error('Не удалось загрузить типы стали для итогов заявки')
  const names = new Map<string, string>((result.data || []).map((row: { id: string; name: string }) => [row.id, row.name]))
  return { ...snapshot, items: items.map(item => {
    if (item.category !== 'request_sheet_metal' || item.attributes?.steel_type_name) return item
    const name = names.get(String(item.attributes?.steel_type_id))
    return name ? { ...item, attributes: { ...item.attributes, steel_type_name: name } } : item
  }) }
}

// Historical display reads only the exact candidate IDs captured at approval.
// Never change sourceData: SQL uses it as the approval concurrency contract.
export async function withApprovalProcurement(client: any, snapshot: ApprovalSummarySnapshot | null, stored?: ApprovalSummarySnapshot | null): Promise<ApprovalSummarySnapshot | null> {
  if (!snapshot) return snapshot
  const source = (snapshot.sourceData || {}) as Record<string, any[]>
  const saved = new Map((stored?.items || []).map(item => [item.key, item]))
  const candidates = new Map<string, any>()
  for (const item of snapshot.items) {
    const link = (source.cuttingItems || []).find(row => `${row.request_item_table}:${row.request_item_id}` === item.key && row.link_state === 'active')
    const version = (source.cuttingVersions || []).find(row => row.plan_id === link?.plan_id && row.status === 'approved')
    const candidate = (source.cuttingCandidates || []).find(row => row.version_id === version?.id && row.candidate_number === version?.selected_candidate_number)
    if (candidate) candidates.set(item.key, candidate)
  }
  const ids = [...new Set(snapshot.items.flatMap(item => !saved.get(item.key)?.procurement && isLayoutProcurement(item) && candidates.has(item.key) ? [candidates.get(item.key).id] : []))]
  const result = ids.length ? await client.from('long_stock_cutting_candidate_bars').select('candidate_id,stock_length_mm,length_group,source_type').in('candidate_id', ids) : { data: [], error: null }
  if (result.error) throw new Error('Не удалось прочитать заготовки согласованной раскладки')
  return { ...snapshot, items: snapshot.items.map(item => {
    const candidate = candidates.get(item.key)
    const bars = candidate ? (result.data || []).filter((bar: any) => bar.candidate_id === candidate.id) : undefined
    // A missing old candidate is unknown, whereas an existing zero-purchase candidate is zero.
    const verifiedBars = bars?.length || Number(candidate?.purchased_length_mm) === 0 ? bars : undefined
    return { ...item, procurement: saved.get(item.key)?.procurement || item.procurement || approvedProcurement(item, verifiedBars) }
  }) }
}
