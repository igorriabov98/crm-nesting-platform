import 'server-only'

import {
  buildCuttingAreaMaterialSummaries,
  type CuttingAreaMaterialItem,
  type CuttingAreaMaterialRequest,
  type CuttingAreaMaterialSchedule,
  type CuttingAreaMaterialSummary,
  type CuttingAreaMaterialTable,
} from './materials'

type DbResult = { data: unknown; error: { message?: string } | null }
type Query = PromiseLike<DbResult> & {
  select: (columns: string) => Query
  in: (column: string, values: string[]) => Query
  eq: (column: string, value: unknown) => Query
  order: (column: string) => Query
  range: (from: number, to: number) => Query
}
type Db = { from: (table: string) => Query }

const QUANTITY_COLUMNS: Record<CuttingAreaMaterialTable, string> = {
  request_sheet_metal: 'remainder_qty,to_order_kg,reserved_from_stock_kg',
  request_round_tube: 'order_kg,reserved_from_stock_kg',
  request_circle: 'remainder_mm,reserved_from_stock_mm',
  request_pipe: 'pipe_type,remainder_kg,remainder_length_mm,reserved_from_stock_kg,reserved_from_stock_length_mm',
  request_knives: 'remainder_meters,to_order_mm,reserved_from_stock_mm',
  request_components: 'quantity_needed,stock_remainder,reserved_from_stock',
  request_paint: 'remainder_kg,to_order_kg,reserved_from_stock_kg',
  request_mesh: 'remainder_qty,reserved_from_stock_qty',
  request_chain_cord: 'remainder_meters,reserved_from_stock_meters',
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
  const rowsByTable = await Promise.all(Object.entries(QUANTITY_COLUMNS).map(async ([table, columns]) => {
    const rows = await readBatches<Omit<CuttingAreaMaterialItem, 'table'>>(requestIds, (ids) => db.from(table)
      .select(`id,request_id,order_status,ordered_at,material_id,material_variant_id,custom_delivery_date,${columns}`)
      .in('request_id', ids))
    const items = rows.map((row) => ({ ...row, table })) as CuttingAreaMaterialItem[]
    const schedules = await readBatches<CuttingAreaMaterialSchedule>(items.map((item) => item.id), (ids) => db
      .from('supply_order_delivery_schedules')
      .select('id,request_item_table,request_item_id,delivery_date,status,quantity,received_quantity,allocated_quantity')
      .eq('request_item_table', table)
      .in('request_item_id', ids))
    return { items, schedules }
  }))
  const summaries = buildCuttingAreaMaterialSummaries(requests, rowsByTable.flatMap((rows) => rows.items), rowsByTable.flatMap((rows) => rows.schedules))
  const targets = new Set(targetRequestIds)
  return new Map([...summaries].filter(([id]) => targets.has(id)))
}
