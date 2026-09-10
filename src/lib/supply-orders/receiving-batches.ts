import type { MaterialCategory } from '@/lib/types'
import type { LongStockPurchaseComponent } from './long-stock-purchase-plan'

const EPSILON = 0.000001

export type MaterialReceivingMachine = {
  id: string
  name: string
  specification_number: string | null
}

export type MaterialReceivingSource = {
  key: string
  schedule_id: string | null
  table: string
  id: string
  request_id: string
  machine_id: string
  machine_name: string
  machine_specification_number: string | null
  supplier_id: string | null
  supplier_name: string | null
  planned_quantity: number
  weight_kg: number | null
  is_virtual_schedule: boolean
}

export type MaterialReceivingProjectionRow = MaterialReceivingSource & {
  aggregate_identity: string
  factory_id: string | null
  factory_name: string
  delivery_date: string
  unit: string
  category: MaterialCategory
  is_whole_bar: boolean
  item_name: string
  material_id: string | null
  material_variant_id: string | null
  characteristics: Array<{ label: string; value: string }>
  planned_piece_length_mm: number | null
  planned_piece_count: number | null
  purchase_components: LongStockPurchaseComponent[]
}

export type ReceivingTransportContext = {
  schedule_id: string
  trip_id: string
  delivery_stop_id: string | null
  trip_name: string
  planned_arrival_at: string | null
  arrived_at: string | null
  trip_status?: string
}

export type MaterialReceivingItem = Omit<MaterialReceivingProjectionRow, 'aggregate_identity'> & {
  schedule_ids: string[]
  sources: MaterialReceivingSource[]
  machines: MaterialReceivingMachine[]
  supplier_ids: string[]
  supplier_names: string[]
}

export type MaterialReceivingArrivalGroup = {
  key: string
  date: string
  transport_trip_id: string | null
  transport_delivery_stop_id: string | null
  transport_trip_name: string | null
  planned_arrival_at: string | null
  arrived_at: string | null
  supplier_names: string[]
  items: MaterialReceivingItem[]
}

export type MaterialReceivingDateGroup = {
  date: string
  is_initially_open: boolean
  arrivals: MaterialReceivingArrivalGroup[]
}

export type MaterialReceivingPageData = {
  factories: Array<{ id: string; name: string }>
  activeFactoryId: string | null
  groups: MaterialReceivingDateGroup[]
}

function distinct<T>(values: T[]) {
  return Array.from(new Set(values))
}

function transportSignature(context: ReceivingTransportContext) {
  return `${context.trip_id}:${context.delivery_stop_id || 'no-stop'}`
}

function rowFallbackKey(row: MaterialReceivingProjectionRow) {
  return [
    row.delivery_date,
    row.supplier_id || 'no-supplier',
    row.aggregate_identity,
    row.planned_piece_length_mm ?? 'bulk',
  ].join('|')
}

function mergePurchaseComponents(rows: MaterialReceivingProjectionRow[]) {
  const components = new Map<string, LongStockPurchaseComponent>()
  for (const row of rows) {
    for (const component of row.purchase_components) {
      const key = `${component.length_mm}:${component.is_nonstandard ? 'nonstandard' : 'standard'}`
      const current = components.get(key)
      components.set(key, current
        ? { ...current, piece_count: current.piece_count + component.piece_count }
        : { ...component })
    }
  }
  return Array.from(components.values()).sort((left, right) => (
    right.length_mm - left.length_mm
    || Number(left.is_nonstandard) - Number(right.is_nonstandard)
  ))
}

function aggregateRows(batchKey: string, rows: MaterialReceivingProjectionRow[]) {
  const first = rows[0]
  const { aggregate_identity: aggregateIdentity, ...firstWithoutIdentity } = first
  const sources = rows.map((row): MaterialReceivingSource => ({
    key: row.key,
    schedule_id: row.schedule_id,
    table: row.table,
    id: row.id,
    request_id: row.request_id,
    machine_id: row.machine_id,
    machine_name: row.machine_name,
    machine_specification_number: row.machine_specification_number,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name,
    planned_quantity: row.planned_quantity,
    weight_kg: row.weight_kg,
    is_virtual_schedule: row.is_virtual_schedule,
  }))
  const machines = new Map<string, MaterialReceivingMachine>()
  for (const source of sources) {
    if (!machines.has(source.machine_id)) {
      machines.set(source.machine_id, {
        id: source.machine_id,
        name: source.machine_name,
        specification_number: source.machine_specification_number,
      })
    }
  }
  const supplierIds = distinct(sources.map((source) => source.supplier_id).filter((value): value is string => Boolean(value)))
  const supplierNames = distinct(sources.map((source) => source.supplier_name).filter((value): value is string => Boolean(value)))
    .sort((left, right) => left.localeCompare(right, 'ru'))
  const weightValues = rows.map((row) => row.weight_kg)
  const plannedPieceCounts = rows.map((row) => row.planned_piece_count)
  const scheduleIds = distinct(rows.map((row) => row.schedule_id).filter((value): value is string => Boolean(value)))
  const machineValues = Array.from(machines.values()).sort((left, right) => left.name.localeCompare(right.name, 'ru'))
  const plannedQuantity = rows.reduce((sum, row) => sum + row.planned_quantity, 0)

  return {
    ...firstWithoutIdentity,
    key: `${batchKey}|${aggregateIdentity}|${first.planned_piece_length_mm ?? 'bulk'}`,
    schedule_id: scheduleIds[0] || null,
    schedule_ids: scheduleIds,
    sources,
    machines: machineValues,
    machine_id: machineValues[0]?.id || first.machine_id,
    machine_name: machineValues[0]?.name || first.machine_name,
    machine_specification_number: machineValues[0]?.specification_number ?? first.machine_specification_number,
    supplier_id: supplierIds.length === 1 ? supplierIds[0] : null,
    supplier_name: supplierNames.length === 1 ? supplierNames[0] : supplierNames.join(', ') || null,
    supplier_ids: supplierIds,
    supplier_names: supplierNames,
    planned_quantity: plannedQuantity,
    weight_kg: weightValues.every((value) => value !== null)
      ? weightValues.reduce<number>((sum, value) => sum + Number(value || 0), 0)
      : null,
    is_virtual_schedule: rows.every((row) => row.is_virtual_schedule),
    planned_piece_count: plannedPieceCounts.every((value) => value !== null)
      ? plannedPieceCounts.reduce<number>((sum, value) => sum + Number(value || 0), 0)
      : null,
    purchase_components: mergePurchaseComponents(rows),
  } satisfies MaterialReceivingItem
}

export function projectMaterialReceivingGroups(
  rows: MaterialReceivingProjectionRow[],
  transportContexts: ReceivingTransportContext[],
): MaterialReceivingDateGroup[] {
  const directContext = new Map(transportContexts.map((context) => [context.schedule_id, context]))
  const contextsByFallback = new Map<string, Map<string, ReceivingTransportContext>>()
  for (const row of rows) {
    const context = row.schedule_id ? directContext.get(row.schedule_id) : null
    if (!context) continue
    const key = rowFallbackKey(row)
    const candidates = contextsByFallback.get(key) || new Map<string, ReceivingTransportContext>()
    candidates.set(transportSignature(context), context)
    contextsByFallback.set(key, candidates)
  }

  const rowsByDateAndBatch = new Map<string, Map<string, {
    context: ReceivingTransportContext | null
    rows: MaterialReceivingProjectionRow[]
  }>>()
  for (const row of rows) {
    const inferredCandidates = contextsByFallback.get(rowFallbackKey(row))
    const inferredContext = inferredCandidates?.size === 1
      ? Array.from(inferredCandidates.values())[0]
      : null
    const context = (row.schedule_id ? directContext.get(row.schedule_id) : null) || inferredContext || null
    const batchKey = context
      ? `trip:${transportSignature(context)}`
      : `unlinked:${row.delivery_date}:${row.supplier_id || 'no-supplier'}`
    const batches = rowsByDateAndBatch.get(row.delivery_date) || new Map()
    const batch = batches.get(batchKey) || { context, rows: [] }
    batch.rows.push(row)
    batches.set(batchKey, batch)
    rowsByDateAndBatch.set(row.delivery_date, batches)
  }

  return Array.from(rowsByDateAndBatch.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, batches], dateIndex) => ({
      date,
      is_initially_open: dateIndex === 0,
      arrivals: Array.from(batches.entries())
        .map(([batchKey, batch]) => {
          const materialGroups = new Map<string, MaterialReceivingProjectionRow[]>()
          for (const row of batch.rows) {
            const key = [
              row.aggregate_identity,
              row.planned_piece_length_mm ?? 'bulk',
              row.schedule_id ? 'scheduled' : `virtual:${row.table}:${row.id}`,
            ].join('|')
            materialGroups.set(key, [...(materialGroups.get(key) || []), row])
          }
          const items = Array.from(materialGroups.values())
            .map((materialRows) => aggregateRows(batchKey, materialRows))
            .sort((left, right) => (
              left.category.localeCompare(right.category)
              || left.item_name.localeCompare(right.item_name, 'ru')
            ))
          return {
            key: batchKey,
            date,
            transport_trip_id: batch.context?.trip_id || null,
            transport_delivery_stop_id: batch.context?.delivery_stop_id || null,
            transport_trip_name: batch.context?.trip_name || null,
            planned_arrival_at: batch.context?.planned_arrival_at || null,
            arrived_at: batch.context?.arrived_at || null,
            supplier_names: distinct(items.flatMap((item) => item.supplier_names))
              .sort((left, right) => left.localeCompare(right, 'ru')),
            items,
          }
        })
        .sort((left, right) => {
          if (left.planned_arrival_at && right.planned_arrival_at) {
            const byTime = left.planned_arrival_at.localeCompare(right.planned_arrival_at)
            if (byTime !== 0) return byTime
          } else if (left.planned_arrival_at) return -1
          else if (right.planned_arrival_at) return 1
          return left.key.localeCompare(right.key)
        }),
    }))
}

export type MaterialReceiptBatchSchedule = {
  id: string
  quantity: number
  planned_piece_count: number | null
  created_at: string
}

export type MaterialReceiptBatchAllocation = {
  table: string
  id: string
  quantity: number
  physical_quantity: number
  piece_count: number | null
}

export type MaterialReceiptBatchCall = {
  schedule_id: string
  received_quantity: number
  received_piece_length_mm: number | null
  received_piece_count: number | null
  allocations: MaterialReceiptBatchAllocation[]
}

function roundQuantity(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000
}

export function buildMaterialReceiptBatchCalls(input: {
  schedules: MaterialReceiptBatchSchedule[]
  received_quantity: number
  received_piece_length_mm: number | null
  received_piece_count: number | null
  allocations: MaterialReceiptBatchAllocation[]
}): MaterialReceiptBatchCall[] {
  const schedules = [...input.schedules].sort((left, right) => (
    left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
  ))
  if (schedules.length === 0) throw new Error('Не найдены строки графика для пакетной приёмки')
  if (!Number.isFinite(input.received_quantity) || input.received_quantity <= 0) {
    throw new Error('Фактическое количество прихода должно быть больше 0')
  }

  const isWholeBar = input.received_piece_length_mm !== null || input.received_piece_count !== null
  const calls: MaterialReceiptBatchCall[] = schedules.map((schedule) => ({
    schedule_id: schedule.id,
    received_quantity: 0,
    received_piece_length_mm: isWholeBar ? input.received_piece_length_mm : null,
    received_piece_count: isWholeBar ? 0 : null,
    allocations: [],
  }))

  if (isWholeBar) {
    const pieceLength = Number(input.received_piece_length_mm || 0)
    let remainingPieces = Number(input.received_piece_count || 0)
    if (pieceLength <= 0 || !Number.isInteger(remainingPieces) || remainingPieces <= 0) {
      throw new Error('Для длинномера укажите длину и целое количество прутков')
    }
    if (Math.abs(pieceLength * remainingPieces - input.received_quantity) > EPSILON) {
      throw new Error('Общая длина не совпадает с количеством и длиной прутков')
    }
    for (let index = 0; index < schedules.length; index += 1) {
      const plannedPieces = Math.max(Number(schedules[index].planned_piece_count || 0), 0)
      const pieces = Math.min(remainingPieces, plannedPieces)
      calls[index].received_piece_count = pieces
      calls[index].received_quantity = roundQuantity(pieces * pieceLength)
      remainingPieces -= pieces
    }
    if (remainingPieces > 0) {
      const last = calls[calls.length - 1]
      last.received_piece_count = Number(last.received_piece_count || 0) + remainingPieces
      last.received_quantity = roundQuantity(Number(last.received_piece_count) * pieceLength)
    }
  } else {
    let remaining = input.received_quantity
    for (let index = 0; index < schedules.length; index += 1) {
      const quantity = Math.min(remaining, Math.max(Number(schedules[index].quantity || 0), 0))
      calls[index].received_quantity = roundQuantity(quantity)
      remaining = roundQuantity(remaining - quantity)
    }
    if (remaining > EPSILON) {
      calls[calls.length - 1].received_quantity = roundQuantity(
        calls[calls.length - 1].received_quantity + remaining,
      )
    }
  }

  if (isWholeBar) {
    const pieceLength = Number(input.received_piece_length_mm)
    const remainingPiecesByCall = calls.map((call) => Number(call.received_piece_count || 0))
    for (const allocation of input.allocations) {
      let remainingPieces = Number(allocation.piece_count || 0)
      let remainingLogical = allocation.quantity
      if (!Number.isInteger(remainingPieces) || remainingPieces <= 0) {
        throw new Error('Некорректное распределение прутков')
      }
      for (let index = 0; index < calls.length && remainingPieces > 0; index += 1) {
        const pieces = Math.min(remainingPieces, remainingPiecesByCall[index])
        if (pieces <= 0) continue
        const physical = pieces * pieceLength
        const logical = Math.min(remainingLogical, physical)
        calls[index].allocations.push({
          ...allocation,
          quantity: roundQuantity(logical),
          physical_quantity: roundQuantity(physical),
          piece_count: pieces,
        })
        remainingPiecesByCall[index] -= pieces
        remainingPieces -= pieces
        remainingLogical = roundQuantity(remainingLogical - logical)
      }
      if (remainingPieces > 0 || remainingLogical > EPSILON) {
        throw new Error('Распределение прутков превышает фактический приход')
      }
    }
  } else {
    const remainingByCall = calls.map((call) => call.received_quantity)
    for (const allocation of input.allocations) {
      let remaining = allocation.physical_quantity
      for (let index = 0; index < calls.length && remaining > EPSILON; index += 1) {
        const quantity = Math.min(remaining, remainingByCall[index])
        if (quantity <= EPSILON) continue
        calls[index].allocations.push({
          ...allocation,
          quantity: roundQuantity(quantity),
          physical_quantity: roundQuantity(quantity),
          piece_count: null,
        })
        remainingByCall[index] = roundQuantity(remainingByCall[index] - quantity)
        remaining = roundQuantity(remaining - quantity)
      }
      if (remaining > EPSILON) throw new Error('Распределение превышает фактический приход')
    }
  }

  return calls
}
