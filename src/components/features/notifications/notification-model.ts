import { ROUTES } from '@/lib/constants/routes'

export type NotificationItem = {
  id: string
  type: string
  title: string
  message: string
  created_at: string
  is_read: boolean
  related_machine_id: string | null
  consumable_request_id: string | null
  related_mail_thread_id?: string | null
  related_department_request_id?: string | null
  machine?: {
    name?: string | null
  } | null
}

export function isConsumableNotification(type: string) {
  return type.startsWith('consumable_request_')
}

export function getNotificationDestination(notification: NotificationItem) {
  if (notification.related_department_request_id && notification.type.startsWith('department_request_')) {
    return {
      href: `${ROUTES.REQUESTS}/detail/${notification.related_department_request_id}`,
      label: 'Открыть запрос',
    }
  }

  if (notification.type === 'mail_received' && notification.related_mail_thread_id) {
    return {
      href: `${ROUTES.MAIL}?thread=${encodeURIComponent(notification.related_mail_thread_id)}`,
      label: 'Открыть письмо',
    }
  }

  if (notification.related_machine_id) {
    return {
      href: `${ROUTES.SALES_PLAN}/${notification.related_machine_id}`,
      label: 'Перейти к машине',
    }
  }

  if (notification.consumable_request_id) {
    const isSupplyNotification =
      notification.type === 'consumable_request_new' ||
      notification.type === 'consumable_request_shortage'
    const route = isSupplyNotification
      ? ROUTES.SUPPLY_CONSUMABLE_REQUESTS
      : ROUTES.PRODUCTION_CONSUMABLE_REQUESTS

    return {
      href: `${route}?request=${notification.consumable_request_id}`,
      label: 'Открыть заявку',
    }
  }

  return null
}
