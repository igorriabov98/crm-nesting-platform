import type { RedeliveryOrigin } from '@/lib/supply-orders/redelivery'

const amount = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
const date = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('ru-RU')

export function redeliveryOriginLabel(origin: RedeliveryOrigin, unit: string) {
  const shortage = Math.max(origin.planned - origin.received, 0)
  return `Поставка ${date(origin.date)} · ${origin.supplierName || 'Без поставщика'}: заказано ${amount(origin.planned)} ${unit}, склад подтвердил ${amount(origin.received)} ${unit}, недопоставка ${amount(shortage)} ${unit}`
}

export function redeliveryOriginOptionLabel(origin: RedeliveryOrigin, unit: string) {
  return `${date(origin.date)} · ${origin.supplierName || 'Без поставщика'} · заказано ${amount(origin.planned)}, принято ${amount(origin.received)}, осталось довезти ${amount(origin.available)} ${unit}`
}
