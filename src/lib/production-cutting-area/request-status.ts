export function isActiveCuttingAreaRequest(status: string) {
  return status !== 'draft' && status !== 'cancelled'
}

export function getCuttingAreaOrderStatusLabel(
  status: 'waiting' | 'in_progress' | 'completed',
  startBlocker: string | null,
  canStart: boolean,
) {
  if (status === 'in_progress') return 'В работе'
  if (status === 'completed') return 'Выполнено'
  if (canStart) return 'Готов к запуску'
  if (startBlocker?.startsWith('Не завершены заявки технолога:')) {
    const requestNumbers = startBlocker.slice('Не завершены заявки технолога:'.length).trim()
    return requestNumbers.includes(',')
      ? `Ожидает завершения заявок ${requestNumbers}`
      : `Ожидает завершения заявки ${requestNumbers}`
  }
  if (startBlocker === 'Не указана дата начала Заготовки') return 'Ожидает дату начала'
  if (startBlocker === 'Нет новых заявок для цикла') return 'Ожидает новую заявку'
  return 'Ожидает запуска'
}

export function getCuttingAreaRequestStatusLabel(status: string, hasCompletion: boolean) {
  if (status === 'cancelled') return 'Отменена'
  return hasCompletion ? 'Завершена' : 'Не завершена'
}
