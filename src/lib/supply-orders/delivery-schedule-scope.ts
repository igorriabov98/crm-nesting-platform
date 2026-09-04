export type SupplyOrderDeliveryScheduleScope = {
  mode: 'date'
  replace_delivery_date: string
} | {
  mode: 'unscheduled'
  replace_delivery_date: null
} | {
  mode: 'item'
  replace_delivery_date: string | null
  target_item: { table: string; id: string }
}

export function deliveryScheduleScopeForDateSlice(dateKey: string): SupplyOrderDeliveryScheduleScope {
  const replaceDeliveryDate = dateKey === 'no_supply_date' ? null : dateKey
  return replaceDeliveryDate === null
    ? { mode: 'unscheduled', replace_delivery_date: null }
    : { mode: 'date', replace_delivery_date: replaceDeliveryDate }
}

export function deliveryScheduleBelongsToScope(
  deliveryDate: string,
  scope: SupplyOrderDeliveryScheduleScope | undefined,
) {
  if (!scope) return true
  if (scope.mode === 'unscheduled') return false
  return scope.replace_delivery_date !== null && deliveryDate === scope.replace_delivery_date
}
