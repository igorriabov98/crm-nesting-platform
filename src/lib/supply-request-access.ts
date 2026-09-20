export type ReservationCapability = {
  allowed: boolean
  reason: string | null
}

export function evaluateReservationCapability(input: {
  hasWorkflowPermission: boolean
  hasInventoryManage: boolean
  isAdmin: boolean
  inventoryFactoryScope: 'own' | 'all'
  userFactoryId: string | null
  targetFactoryId: string | null
  workflowDeniedReason: string
}): ReservationCapability {
  if (!input.hasWorkflowPermission) return { allowed: false, reason: input.workflowDeniedReason }
  if (!input.hasInventoryManage) return { allowed: false, reason: 'Нет права управлять складом' }
  if (input.isAdmin || input.inventoryFactoryScope === 'all') return { allowed: true, reason: null }
  if (!input.userFactoryId) {
    return {
      allowed: false,
      reason: 'В карточке пользователя не указан завод. Укажите завод или выберите в матрице склада «Все заводы».',
    }
  }
  if (input.userFactoryId === input.targetFactoryId) return { allowed: true, reason: null }
  return {
    allowed: false,
    reason: 'Заказ относится к другому заводу. Для работы с ним выберите в матрице склада «Все заводы».',
  }
}
