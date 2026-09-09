type MachineWeightItem = {
  weight: unknown
  quantity: unknown
}

export function machineTotalWeightTonnes(items: MachineWeightItem[]) {
  const totalWeightKg = items.reduce((sum, item) => (
    sum + (Number(item.weight) * Number(item.quantity))
  ), 0)
  return totalWeightKg / 1000
}
