export type ApprovalState = 'pending' | 'returned' | 'superseded' | 'approved'

export type ApprovalSummaryItem = {
  key: string
  category: string
  categoryLabel: string
  name: string
  quantity: number | null
  unit: string
  weightKg: number | null
  businessScrapReserved: number
  regularStockReserved: number
  wastePercent: number | null
}

export type ApprovalSummarySnapshot = {
  schemaVersion: 1
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

export function formatApprovalVersion(revisionNumber: number) {
  return revisionNumber === 0 ? '1' : `1.${revisionNumber}`
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
    return fields.length ? [{ before: previous, after: item, fields }] : []
  })
  const completionChanged: string[] = []
  if (before.enteredPlasmaMinutes !== after.enteredPlasmaMinutes) completionChanged.push('Время плазмы')
  if (JSON.stringify(before.futureItems) !== JSON.stringify(after.futureItems)) completionChanged.push('Будущая деталировка')
  if (JSON.stringify(before.archives) !== JSON.stringify(after.archives)) completionChanged.push('Архивы порезки')
  return { added, removed, changed, completionChanged }
}

export function isFinancialApprovalReviewer(role: string, isAdminPosition: boolean) {
  return role === 'financial_director' || isAdminPosition
}
