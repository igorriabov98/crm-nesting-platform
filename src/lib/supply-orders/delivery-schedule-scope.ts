export type SupplyOrderDeliveryScheduleScope = {
  replace_delivery_date: string | null
}

export function deliveryScheduleScopeForDateSlice(dateKey: string): SupplyOrderDeliveryScheduleScope {
  return {
    replace_delivery_date: dateKey === 'no_supply_date' ? null : dateKey,
  }
}

export function deliveryScheduleBelongsToScope(
  deliveryDate: string,
  scope: SupplyOrderDeliveryScheduleScope | undefined,
) {
  if (!scope) return true
  return scope.replace_delivery_date !== null && deliveryDate === scope.replace_delivery_date
}
