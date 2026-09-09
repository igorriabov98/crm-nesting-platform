export function isActiveCuttingAreaRequest(status: string) {
  return status !== 'cancelled'
}

export function getCuttingAreaRequestStatusLabel(status: string, hasCompletion: boolean) {
  if (status === 'cancelled') return 'Отменена'
  return hasCompletion ? 'Завершена' : 'Не завершена'
}
