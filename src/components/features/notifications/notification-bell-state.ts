import type { NotificationItem } from './notification-model'

export const NOTIFICATION_PREVIEW_LIMIT = 5

export function getNotificationPreviewFilters() {
  return { limit: NOTIFICATION_PREVIEW_LIMIT }
}

export type NotificationBellState = {
  notifications: NotificationItem[]
  isInitialLoading: boolean
  isRefreshing: boolean
  error: string | null
}

export type NotificationBellAction =
  | { type: 'refreshStarted' }
  | { type: 'refreshSucceeded'; notifications: NotificationItem[] }
  | { type: 'refreshFailed'; error: string }
  | { type: 'markedAsRead'; ids: string[] }

export const initialNotificationBellState: NotificationBellState = {
  notifications: [],
  isInitialLoading: true,
  isRefreshing: false,
  error: null,
}

export function notificationBellReducer(
  state: NotificationBellState,
  action: NotificationBellAction
): NotificationBellState {
  switch (action.type) {
    case 'refreshStarted':
      return {
        ...state,
        isInitialLoading: state.notifications.length === 0,
        isRefreshing: state.notifications.length > 0,
        error: null,
      }
    case 'refreshSucceeded':
      return {
        notifications: action.notifications,
        isInitialLoading: false,
        isRefreshing: false,
        error: null,
      }
    case 'refreshFailed':
      return {
        ...state,
        isInitialLoading: false,
        isRefreshing: false,
        error: action.error,
      }
    case 'markedAsRead': {
      const ids = new Set(action.ids)
      return {
        ...state,
        notifications: state.notifications.map((notification) =>
          ids.has(notification.id)
            ? { ...notification, is_read: true }
            : notification
        ),
      }
    }
  }
}
