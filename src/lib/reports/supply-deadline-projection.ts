import { deliveredSupplyQuantity, reservedSupplyQuantity } from '@/lib/supply-orders/receiving-supply-progress'

export type DeadlineSchedule = {
  id: string
  request_item_table: string
  request_item_id: string
  receipt_parent_schedule_id: string | null
  redelivery_of_schedule_id: string | null
  status: string
  delivery_date: string
  delivered_at: string | null
  quantity: number
  received_quantity: number | null
  allocated_quantity: number | null
  allocated_physical_quantity: number | null
  received_piece_length_mm: number | null
  received_piece_count: number | null
  planned_piece_length_mm: number | null
  allocated_piece_count: number | null
  supplier_id: string | null
  supplier_name: string | null
  unit: string
}

export type DeadlineSnapshot = {
  schedule_id: string
  material_deadline: string | null
  cutting_start: string | null
}

export type DeadlineExclusion = {
  id: string
  target_kind: 'item' | 'schedule'
  request_item_table: string
  request_item_id: string
  schedule_id: string | null
  reason: string
  changed_at: string
  changed_by_name: string | null
  active: boolean
}

export type DeadlineSource = {
  table: string
  itemId: string
  requestId: string
  requestKind: 'machine' | 'stock'
  sourceName: string
  factoryId: string
  factoryName: string
  materialName: string
  characteristics: string
  supplierName: string | null
  supplierId: string | null
  materialDeadline: string | null
  cuttingStart: string | null
  procurementQuantity: number
  unit: string
  legacyDelivered?: boolean
  legacyAcceptedAt?: string | null
  schedules: DeadlineSchedule[]
}

export type SupplyDeadlineRow = {
  id: string
  status: 'late_accepted' | 'not_received' | 'partial_receipt' | 'awaiting_plan' | 'without_schedule'
  source: DeadlineSource
  supplierName: string | null
  supplierId: string | null
  scheduleId: string | null
  receiptId: string | null
  deadline: string | null
  cuttingStart: string | null
  approximateDeadline: boolean
  acceptedAt: string | null
  acceptedQuantity: number
  plannedQuantity: number
  outstandingQuantity: number
  futurePlannedQuantity: number
  originDescription: string | null
  exclusion: DeadlineExclusion | null
}

export type SupplyDeadlineProjection = {
  overdue: SupplyDeadlineRow[]
  shortages: SupplyDeadlineRow[]
  excluded: SupplyDeadlineRow[]
}

const EPSILON = 0.000001

export function localReceiptDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const part = (name: string) => parts.find((item) => item.type === name)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function acceptedForDemand(schedule: DeadlineSchedule, requestKind: 'machine' | 'stock') {
  if (requestKind === 'stock') return deliveredSupplyQuantity(schedule)
  return reservedSupplyQuantity(schedule)
}

export function projectSupplyDeadlineRows(
  sources: DeadlineSource[],
  snapshots: DeadlineSnapshot[],
  exclusions: DeadlineExclusion[],
  today: string,
): SupplyDeadlineProjection {
  const snapshotBySchedule = new Map(snapshots.map((row) => [row.schedule_id, row]))
  // Allocation children belong to other request items. Resolve their physical
  // receipt from all sources without crediting the parent quantity twice.
  const schedulesById = new Map(sources.flatMap((source) => source.schedules)
    .map((row) => [row.id, row]))
  const activeExclusions = exclusions.filter((row) => row.active)
  const itemExclusions = new Map(activeExclusions.filter((row) => row.target_kind === 'item')
    .map((row) => [`${row.request_item_table}:${row.request_item_id}`, row]))
  const scheduleExclusions = new Map(activeExclusions.filter((row) => row.target_kind === 'schedule')
    .map((row) => [row.schedule_id, row]))
  const overdue: SupplyDeadlineRow[] = []
  const shortages: SupplyDeadlineRow[] = []
  const excluded: SupplyDeadlineRow[] = []

  for (const source of sources) {
    const itemKey = `${source.table}:${source.itemId}`
    const itemExclusion = itemExclusions.get(itemKey) || null
    const delivered = source.schedules.filter((row) => row.status === 'delivered'
      || (row.status === 'cancelled' && Boolean(row.delivered_at) && Number(row.received_quantity || 0) > EPSILON))
    const legacyDelivered = source.schedules.length === 0 && source.legacyDelivered === true
    const receivedForDemand = legacyDelivered ? source.procurementQuantity
      : delivered.reduce((sum, row) => sum + acceptedForDemand(row, source.requestKind), 0)
    const outstanding = Math.max(source.procurementQuantity - receivedForDemand, 0)
    const futurePlanned = source.schedules.filter((row) => row.status === 'planned' && !row.receipt_parent_schedule_id)
      .reduce((sum, row) => sum + Math.max(Number(row.quantity || 0), 0), 0)

    for (const schedule of delivered) {
      const root = schedule.receipt_parent_schedule_id ? schedulesById.get(schedule.receipt_parent_schedule_id) : schedule
      const acceptedAt = schedule.delivered_at || root?.delivered_at || null
      const snapshot = snapshotBySchedule.get(schedule.id)
      const deadline = snapshot ? snapshot.material_deadline : source.materialDeadline
      const acceptedQuantity = acceptedForDemand(schedule, source.requestKind)
      if (!acceptedAt || !deadline || acceptedQuantity <= EPSILON || !(localReceiptDate(acceptedAt)! > deadline)) continue
      const row: SupplyDeadlineRow = {
        id: `accepted:${schedule.id}`, status: 'late_accepted', source,
        supplierName: schedule.supplier_name || source.supplierName,
        supplierId: schedule.supplier_id || source.supplierId,
        scheduleId: schedule.id, receiptId: root?.id || schedule.id,
        deadline, cuttingStart: snapshot ? snapshot.cutting_start : source.cuttingStart,
        approximateDeadline: !snapshot, acceptedAt, acceptedQuantity,
        plannedQuantity: Math.max(Number(schedule.quantity || 0), 0), outstandingQuantity: outstanding,
        futurePlannedQuantity: futurePlanned, originDescription: null,
        exclusion: itemExclusion || scheduleExclusions.get(schedule.id) || scheduleExclusions.get(root?.id || '') || null,
      }
      if (row.exclusion) excluded.push(row)
      else overdue.push(row)
    }

    if (legacyDelivered && source.materialDeadline
      && localReceiptDate(source.legacyAcceptedAt || null)! > source.materialDeadline) {
      const legacyRow: SupplyDeadlineRow = {
        id: `accepted:legacy:${itemKey}`, status: 'late_accepted', source,
        supplierName: source.supplierName, supplierId: source.supplierId,
        scheduleId: null, receiptId: null, deadline: source.materialDeadline,
        cuttingStart: source.cuttingStart, approximateDeadline: true,
        acceptedAt: source.legacyAcceptedAt || null, acceptedQuantity: source.procurementQuantity,
        plannedQuantity: source.procurementQuantity, outstandingQuantity: 0,
        futurePlannedQuantity: 0, originDescription: null, exclusion: itemExclusion,
      }
      if (itemExclusion) excluded.push(legacyRow)
      else overdue.push(legacyRow)
    }

    if (outstanding <= EPSILON) continue
    const shortRoots = delivered.filter((row) => !row.receipt_parent_schedule_id
      && Number(row.quantity || 0) > deliveredSupplyQuantity(row) + EPSILON)
    const status: SupplyDeadlineRow['status'] = shortRoots.length > 0
      ? 'partial_receipt' : futurePlanned > EPSILON ? 'awaiting_plan' : 'without_schedule'
    const originDescription = shortRoots.length > 0
      ? shortRoots.map((row) => {
        const deliveredPhysical = deliveredSupplyQuantity(row)
        const redelivery = source.schedules.filter((child) => child.redelivery_of_schedule_id === row.id && child.status !== 'cancelled')
        const suffix = redelivery.length > 0
          ? `; довоз: ${redelivery.map((child) => `${Number(child.quantity || 0)} ${child.unit} на ${child.delivery_date}`).join(', ')}`
          : ''
        return `Поставка ${row.delivery_date}: план ${Number(row.quantity || 0)} ${row.unit}, склад принял ${deliveredPhysical} ${row.unit}, не привезено ${Math.max(Number(row.quantity || 0) - deliveredPhysical, 0)} ${row.unit}${suffix}`
      }).join(' · ')
      : null
    const shortage: SupplyDeadlineRow = {
      id: `open:${itemKey}`, status, source, scheduleId: null, receiptId: null,
      supplierName: source.supplierName, supplierId: source.supplierId,
      deadline: source.materialDeadline, cuttingStart: source.cuttingStart,
      approximateDeadline: false, acceptedAt: null, acceptedQuantity: receivedForDemand,
      plannedQuantity: source.procurementQuantity, outstandingQuantity: outstanding,
      futurePlannedQuantity: futurePlanned, originDescription, exclusion: itemExclusion,
    }
    shortages.push(shortage)
    if (itemExclusion && (!source.materialDeadline || source.materialDeadline >= today)) excluded.push(shortage)
    if (source.materialDeadline && source.materialDeadline < today) {
      const openOverdue = { ...shortage, id: `overdue:${itemKey}`, status: 'not_received' as const }
      if (itemExclusion) excluded.push(openOverdue)
      else overdue.push(openOverdue)
    }
  }

  return { overdue, shortages, excluded }
}
