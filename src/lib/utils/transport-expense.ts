export const TRANSPORT_EXPENSE_CATEGORY = 'Транспорт'

export function isTransportExpenseCategory(category: string | null | undefined) {
  const normalized = (category || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return normalized === 'транспорт' || normalized === 'transport' || normalized === 'transport_cost'
}
