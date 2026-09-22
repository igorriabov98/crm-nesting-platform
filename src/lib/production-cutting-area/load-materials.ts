import 'server-only'

import {
  buildCuttingAreaMaterialSummaries,
  type CuttingAreaMaterialItem,
  type CuttingAreaMaterialRequest,
  type CuttingAreaMaterialSchedule,
  type CuttingAreaMaterialSummary,
  type CuttingAreaMaterialTable,
} from './materials'
import { plannedLogicalCoverage } from './planned-logical-coverage'

type DbResult = { data: unknown; error: { message?: string } | null }
type Query = PromiseLike<DbResult> & {
  select: (columns: string) => Query
  in: (column: string, values: string[]) => Query
  eq: (column: string, value: unknown) => Query
  order: (column: string) => Query
  range: (from: number, to: number) => Query
}
type Db = { from: (table: string) => Query }

const ITEM_COLUMNS: Record<CuttingAreaMaterialTable, string> = {
  request_sheet_metal: 'material_name,material_grade,sheet_size,thickness_mm,remainder_qty,to_order_kg,reserved_from_stock_kg,steel_types(name)',
  request_round_tube: 'material_name,piece_count,order_kg,reserved_from_stock_kg',
  request_circle: 'steel_grade,diameter_mm,is_calibrated,remainder_mm,reserved_from_stock_mm,steel_types(name)',
  request_pipe: 'pipe_type,size,diameter_mm,wall_thickness_mm,remainder_kg,remainder_length_mm,reserved_from_stock_kg,reserved_from_stock_length_mm,steel_types(name)',
  request_knives: 'knife_type,steel_grade,length_mm,width_mm,height_mm,remainder_meters,to_order_mm,reserved_from_stock_mm,steel_types(name)',
  request_components: 'component_name,specification,diameter_mm,quantity_needed,stock_remainder,reserved_from_stock',
  request_paint: 'paint_type,ral_code,finish,remainder_kg,to_order_kg,reserved_from_stock_kg',
  request_mesh: 'description,length_mm,width_mm,remainder_qty,reserved_from_stock_qty',
  request_chain_cord: 'item_type,parameters,remainder_meters,reserved_from_stock_meters',
}
const PAGE_SIZE = 500
const ID_BATCH_SIZE = 100

async function readPages<T>(query: () => Query): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await query().order('id').range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(error.message || 'Не удалось загрузить снабжение материалов')
    const page = (data || []) as T[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

async function readBatches<T>(ids: string[], query: (batch: string[]) => Query) {
  const rows: T[] = []
  for (let offset = 0; offset < ids.length; offset += ID_BATCH_SIZE) {
    rows.push(...await readPages<T>(() => query(ids.slice(offset, offset + ID_BATCH_SIZE))))
  }
  return rows
}

// The caller must authorize cutting-area view and resolve factory scope first.
// Read the factory pool for shared schedule anchors, but return only target requests.
export async function loadCuttingAreaMaterialSummaries(db: Db, factoryIds: string[], targetRequestIds: string[]): Promise<Map<string, CuttingAreaMaterialSummary>> {
  if (factoryIds.length === 0 || targetRequestIds.length === 0) return new Map()
  type RequestRow = {
    id: string
    status: string
    machines: { factory_id: string; planned_material_date: string | null }
  }
  const requestRows = await readBatches<RequestRow>([...new Set(factoryIds)], (ids) => db
    .from('technologist_requests')
    .select('id,status,machines!inner(factory_id,planned_material_date,is_archived)')
    .in('machines.factory_id', ids)
    .eq('machines.is_archived', false))
  const requests: CuttingAreaMaterialRequest[] = requestRows.map((request) => ({
    id: request.id, status: request.status,
    factoryId: request.machines.factory_id,
    plannedMaterialDate: request.machines.planned_material_date,
  }))
  const requestIds = requests.map((request) => request.id)
  const rowsByTable = await Promise.all(Object.entries(ITEM_COLUMNS).map(async ([table, columns]) => {
    const rows = await readBatches<Omit<CuttingAreaMaterialItem, 'table'>>(requestIds, (ids) => db.from(table)
      .select(`id,request_id,order_status,ordered_at,material_id,material_variant_id,custom_delivery_date,${columns}`)
      .in('request_id', ids))
    const items = rows.map((row) => ({ ...row, table })) as CuttingAreaMaterialItem[]
    const schedules = await readBatches<CuttingAreaMaterialSchedule>(items.map((item) => item.id), (ids) => db
      .from('supply_order_delivery_schedules')
      .select('id,request_item_table,request_item_id,delivery_date,status,quantity,received_quantity,allocated_quantity,allocated_physical_quantity,allocated_piece_count,received_piece_length_mm,planned_piece_length_mm,planned_piece_count')
      .eq('request_item_table', table)
      .in('request_item_id', ids))
    return { items, schedules }
  }))
  const items = rowsByTable.flatMap((rows) => rows.items)
  const revisions = await readBatches<{ source_request_item_table: string; source_request_item_id: string }>(items.map((item) => item.id), (ids) => db
    .from('supply_position_revisions').select('id,source_request_item_table,source_request_item_id')
    .in('source_request_item_id', ids).in('status', ['requested', 'editing', 'stock_check', 'cancelled']))
  const planItems = await readBatches<{ id: string; plan_id: string; request_item_table: string; request_item_id: string; cutting_status: string; link_state: string }>(
    items.filter((item) => ['request_circle', 'request_pipe', 'request_knives'].includes(item.table)).map((item) => item.id),
    (ids) => db.from('long_stock_cutting_plan_items').select('id,plan_id,request_item_table,request_item_id,cutting_status,link_state')
      .in('request_item_id', ids))
  const inactive = new Set([
    ...revisions.map((row) => `${row.source_request_item_table}:${row.source_request_item_id}`),
    ...planItems.filter((row) => row.cutting_status === 'cancelled' || (row.link_state === 'active' && row.cutting_status === 'requires_recalculation'))
      .map((row) => `${row.request_item_table}:${row.request_item_id}`),
  ])
  // Match scheduled whole bars to the actual cuts in the approved candidate.
  // Physical bar length is not the logical quantity supplied to the order.
  const activePlans = planItems.filter((row) => row.link_state === 'active'
    && ['plan_approved', 'accepted'].includes(row.cutting_status))
  const versions = await readBatches<{ id: string; plan_id: string; version_number: number; selected_candidate_number: number }>(
    [...new Set(activePlans.map((row) => row.plan_id))], (ids) => db.from('long_stock_cutting_plan_versions')
      .select('id,plan_id,version_number,selected_candidate_number').in('plan_id', ids).eq('status', 'approved'))
  const selectedVersions = new Map<string, typeof versions[number]>()
  for (const version of versions.sort((a, b) => b.version_number - a.version_number)) {
    if (!selectedVersions.has(version.plan_id)) selectedVersions.set(version.plan_id, version)
  }
  const candidates = await readBatches<{ id: string; version_id: string; candidate_number: number }>(
    [...selectedVersions.values()].map((row) => row.id), (ids) => db.from('long_stock_cutting_candidates')
      .select('id,version_id,candidate_number').in('version_id', ids))
  const selectedCandidates = candidates.filter((candidate) => [...selectedVersions.values()]
    .some((version) => version.id === candidate.version_id && version.selected_candidate_number === candidate.candidate_number))
  const bars = await readBatches<{ id: string; candidate_id: string; bar_number: number; stock_length_mm: number;
    cuts: Array<{ cut_length_mm: number; segment: { plan_item_id: string } }> }>(
    selectedCandidates.map((row) => row.id), (ids) => db.from('long_stock_cutting_candidate_bars')
      .select('id,candidate_id,bar_number,stock_length_mm,cuts:long_stock_cutting_bar_cuts(cut_length_mm,segment:long_stock_cutting_segments(plan_item_id))')
      .in('candidate_id', ids).eq('source_type', 'new_stock'))
  const allSchedules = rowsByTable.flatMap((rows) => rows.schedules)
  const logicalCoverage = new Map<string, number>()
  for (const planItem of activePlans) {
    const version = selectedVersions.get(planItem.plan_id)
    const candidate = selectedCandidates.find((row) => row.version_id === version?.id)
    if (!candidate) continue
    const itemBars = bars.filter((bar) => bar.candidate_id === candidate.id)
      .sort((a, b) => a.bar_number - b.bar_number)
      .map((bar) => ({ length: Number(bar.stock_length_mm), logical: bar.cuts
        .filter((cut) => cut.segment?.plan_item_id === planItem.id)
        .reduce((sum, cut) => sum + Number(cut.cut_length_mm), 0) }))
    const schedules = allSchedules.filter((row) => row.request_item_table === planItem.request_item_table
      && row.request_item_id === planItem.request_item_id)
    logicalCoverage.set(`${planItem.request_item_table}:${planItem.request_item_id}`, plannedLogicalCoverage(itemBars, schedules))
  }
  const summaries = buildCuttingAreaMaterialSummaries(requests,
    items.map((item) => ({ ...item, inactive: inactive.has(`${item.table}:${item.id}`),
      plannedLogicalQuantity: logicalCoverage.get(`${item.table}:${item.id}`) })), allSchedules)
  const targets = new Set(targetRequestIds)
  return new Map([...summaries].filter(([id]) => targets.has(id)))
}
