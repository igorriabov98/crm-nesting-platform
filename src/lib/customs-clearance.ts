export type CustomsDocumentKind = 'invoice' | 'specification' | 'packing_list' | 'other'

export type CustomsDocument = {
  id: string
  documentKind: CustomsDocumentKind
  fileName: string
  mimeType: string
  fileSize: number
  uploadedBy: string
  uploadedByName: string
  createdAt: string
}

export type CustomsClearanceMachine = {
  id: string
  name: string
  factoryId: string
  factoryName: string
  shippingReadinessDate: string
  customsClearanceDate: string | null
  deliveryToClientDate: string | null
  documents: CustomsDocument[]
}

export type CustomsClearanceSort = 'default' | 'readiness' | 'customs' | 'delivery'

export const CUSTOMS_DOCUMENT_KIND_LABELS: Record<CustomsDocumentKind, string> = {
  invoice: 'Инвойс',
  specification: 'Спецификация',
  packing_list: 'Упаковочный лист',
  other: 'Другой документ',
}

export function getCustomsClearanceState(machine: Pick<
  CustomsClearanceMachine,
  'customsClearanceDate' | 'deliveryToClientDate' | 'documents'
>) {
  const missing: string[] = []
  if (!machine.customsClearanceDate) missing.push('дата затаможивания')
  if (machine.documents.length === 0) missing.push('прикреплённый документ')
  const cleared = Boolean(
    machine.deliveryToClientDate
    && machine.customsClearanceDate
    && machine.documents.length > 0,
  )
  return {
    cleared,
    incompleteAfterDelivery: Boolean(machine.deliveryToClientDate && missing.length > 0),
    missing,
  }
}

function dateRank(value: string | null) {
  return value || '9999-12-31'
}

export function localDateKey(value = new Date()) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function compareCustomsClearanceMachines(
  left: CustomsClearanceMachine,
  right: CustomsClearanceMachine,
  sort: CustomsClearanceSort,
  today = localDateKey(),
) {
  if (sort === 'customs') {
    return dateRank(left.customsClearanceDate).localeCompare(dateRank(right.customsClearanceDate))
      || left.shippingReadinessDate.localeCompare(right.shippingReadinessDate)
  }
  if (sort === 'delivery') {
    return dateRank(left.deliveryToClientDate).localeCompare(dateRank(right.deliveryToClientDate))
      || left.shippingReadinessDate.localeCompare(right.shippingReadinessDate)
  }
  if (sort === 'readiness') {
    return left.shippingReadinessDate.localeCompare(right.shippingReadinessDate)
  }

  const leftOverdue = left.shippingReadinessDate < today ? 0 : 1
  const rightOverdue = right.shippingReadinessDate < today ? 0 : 1
  return leftOverdue - rightOverdue
    || left.shippingReadinessDate.localeCompare(right.shippingReadinessDate)
    || left.name.localeCompare(right.name, 'ru')
}

export function filterCustomsClearanceMachines(
  machines: CustomsClearanceMachine[],
  input: { tab: 'active' | 'cleared'; factoryId: string; search: string; sort: CustomsClearanceSort },
) {
  const search = input.search.trim().toLocaleLowerCase('ru-RU')
  return machines
    .filter((machine) => getCustomsClearanceState(machine).cleared === (input.tab === 'cleared'))
    .filter((machine) => input.factoryId === 'all' || machine.factoryId === input.factoryId)
    .filter((machine) => !search || machine.name.toLocaleLowerCase('ru-RU').includes(search))
    .sort((left, right) => compareCustomsClearanceMachines(left, right, input.sort))
}
