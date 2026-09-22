export type ApprovalState = 'pending' | 'returned' | 'superseded' | 'approved'

export type ApprovalSummaryItem = {
  key: string
  category: string
  categoryLabel: string
  name: string
  procurement?: { quantity: number | null; unit: string; components: Array<{ length_mm: number; piece_count: number; is_nonstandard: boolean }>; unavailable: boolean }
  quantity: number | null
  unit: string
  weightKg: number | null
  businessScrapReserved: number
  regularStockReserved: number
  wastePercent: number | null
  attributes?: Record<string, unknown>
}

export type ApprovalSummarySnapshot = {
  schemaVersion: 1
  sourceData?: Record<string, unknown>
  requestId: string
  machineId: string
  orderName: string
  materialType: string | null
  items: ApprovalSummaryItem[]
  futureItems: unknown[]
  enteredPlasmaMinutes: number
  archives: Array<{ objectPath: string; fileName: string; mimeType: string | null; fileSize: number }>
}

export type WasteAggregate = {
  count: number
  weightedPercent: number | null
  averagePercent: number | null
}

export function formatApprovalVersion(revisionNumber: number, requestNumber: number) {
  return revisionNumber === 0 ? String(requestNumber) : `${requestNumber}.${revisionNumber}`
}

export function calculateWasteAggregate(items: Pick<ApprovalSummaryItem, 'weightKg' | 'wastePercent'>[]): WasteAggregate {
  const eligible = items.filter((item) => item.wastePercent !== null)
  if (eligible.length === 0) return { count: 0, weightedPercent: null, averagePercent: null }
  const averagePercent = eligible.reduce((sum, item) => sum + Number(item.wastePercent), 0) / eligible.length
  const weighted = eligible.filter((item) => Number(item.weightKg) > 0)
  const totalWeight = weighted.reduce((sum, item) => sum + Number(item.weightKg), 0)
  const weightedPercent = totalWeight > 0
    ? weighted.reduce((sum, item) => sum + Number(item.weightKg) * Number(item.wastePercent), 0) / totalWeight
    : null
  return { count: eligible.length, weightedPercent, averagePercent }
}

export type ApprovalVersionDiff = {
  added: ApprovalSummaryItem[]
  removed: ApprovalSummaryItem[]
  changed: Array<{ before: ApprovalSummaryItem; after: ApprovalSummaryItem; fields: string[] }>
  completionChanged: string[]
  completionDetails: Array<{ label: string; before: string | null; after: string | null }>
}

export function compareApprovalSnapshots(before: ApprovalSummarySnapshot, after: ApprovalSummarySnapshot): ApprovalVersionDiff {
  const beforeByKey = new Map(before.items.map((item) => [item.key, item]))
  const afterByKey = new Map(after.items.map((item) => [item.key, item]))
  const added = after.items.filter((item) => !beforeByKey.has(item.key))
  const removed = before.items.filter((item) => !afterByKey.has(item.key))
  const comparable: Array<keyof ApprovalSummaryItem> = [
    'name', 'quantity', 'unit', 'weightKg', 'businessScrapReserved', 'regularStockReserved', 'wastePercent',
  ]
  const changed = after.items.flatMap((item) => {
    const previous = beforeByKey.get(item.key)
    if (!previous) return []
    const fields = comparable.filter((field) => previous[field] !== item[field]).map(String)
    if (stableValue(previous.attributes) !== stableValue(item.attributes)) fields.push('attributes')
    if (stableValue(previous.procurement) !== stableValue(item.procurement)) fields.push('procurement')
    return fields.length ? [{ before: previous, after: item, fields }] : []
  })
  const completionChanged: string[] = []
  if (before.enteredPlasmaMinutes !== after.enteredPlasmaMinutes) completionChanged.push('Время плазмы')
  if (stableValue(before.futureItems) !== stableValue(after.futureItems)) completionChanged.push('Будущая деталировка')
  if (stableValue(before.archives) !== stableValue(after.archives)) completionChanged.push('Архивы порезки')
  if (stableValue(before.sourceData?.cuttingVersions) !== stableValue(after.sourceData?.cuttingVersions)) completionChanged.push('Карты раскроя')
  const completionDetails: ApprovalVersionDiff['completionDetails'] = []
  if (before.enteredPlasmaMinutes !== after.enteredPlasmaMinutes) completionDetails.push({ label: 'Время плазмы', before: `${before.enteredPlasmaMinutes} мин.`, after: `${after.enteredPlasmaMinutes} мин.` })
  const detailDiff = (label: string, previous: unknown[], next: unknown[], key: (row: Record<string, unknown>) => string, describe: (row: Record<string, unknown>) => string) => {
    const left = new Map(previous.map((raw) => { const row = raw as Record<string, unknown>; return [key(row), row] }))
    const right = new Map(next.map((raw) => { const row = raw as Record<string, unknown>; return [key(row), row] }))
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const oldRow = left.get(id); const newRow = right.get(id)
      if (stableValue(oldRow) !== stableValue(newRow)) completionDetails.push({ label, before: oldRow ? describe(oldRow) : null, after: newRow ? describe(newRow) : null })
    }
  }
  detailDiff('Будущая деталировка', before.futureItems, after.futureItems,
    (row) => String(row.partId || row.drawingNumber || row.name),
    (row) => `${row.name || 'Деталь'} · ${row.drawingNumber || '—'} · ${row.quantity} шт. · ${row.unitWeightKg || '—'} кг/шт.`)
  detailDiff('Архив', before.archives, after.archives, (row) => String(row.objectPath), (row) => `${row.fileName} (${row.fileSize} байт)`)
  return { added, removed, changed, completionChanged, completionDetails }
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => stableValue(item)).sort())
  if (value && typeof value === 'object') return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]))
  return JSON.stringify(value) ?? ''
}
