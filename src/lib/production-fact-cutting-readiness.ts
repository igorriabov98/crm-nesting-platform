export type ProductionFactCuttingReadiness = {
  machineId: string
  machineName: string
  ready: boolean
  reason: string | null
}

export function productionFactCuttingReadinessReason(message: string) {
  const normalized = message.toLocaleLowerCase('ru-RU')
  if (normalized.includes('требует пересч')) return 'Карта раскроя требует пересчёта'
  if (normalized.includes('нет утверждённой версии')) return 'Нет утверждённой версии карты раскроя'
  return 'Не удалось проверить утверждённую карту раскроя'
}

export function productionFactCuttingReadinessError(
  readiness: readonly ProductionFactCuttingReadiness[],
) {
  const blocked = readiness.filter((machine) => !machine.ready)
  if (blocked.length === 0) return null
  return `Нельзя зафиксировать факт заготовки: ${blocked
    .map((machine) => `${machine.machineName} — ${(machine.reason || 'карта раскроя не готова').toLocaleLowerCase('ru-RU')}`)
    .join('; ')}`
}
