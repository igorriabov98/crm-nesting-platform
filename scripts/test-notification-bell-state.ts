import assert from 'node:assert/strict'

import {
  getNotificationPreviewFilters,
  notificationBellReducer,
  type NotificationBellState,
} from '../src/components/features/notifications/notification-bell-state'
import type { NotificationItem } from '../src/components/features/notifications/notification-model'

const notification: NotificationItem = {
  id: 'notification-1',
  type: 'new_machine',
  title: 'Новая машина',
  message: 'Создана новая машина',
  created_at: '2026-07-13T12:00:00.000Z',
  is_read: false,
  related_machine_id: 'machine-1',
  consumable_request_id: null,
}

const loadedState: NotificationBellState = {
  notifications: [notification],
  isInitialLoading: false,
  isRefreshing: false,
  error: null,
}

const refreshingState = notificationBellReducer(loadedState, {
  type: 'refreshStarted',
})
assert.deepEqual(
  refreshingState.notifications,
  [notification],
  'Повторная загрузка не должна очищать уже показанные уведомления'
)
assert.equal(refreshingState.isInitialLoading, false)
assert.equal(refreshingState.isRefreshing, true)

const failedState = notificationBellReducer(refreshingState, {
  type: 'refreshFailed',
  error: 'network error',
})
assert.deepEqual(
  failedState.notifications,
  [notification],
  'Ошибка обновления не должна заменять сохранённый список пустым состоянием'
)

const readState = notificationBellReducer(loadedState, {
  type: 'markedAsRead',
  ids: [notification.id],
})
assert.equal(readState.notifications[0]?.is_read, true)

assert.deepEqual(getNotificationPreviewFilters(), { limit: 5 })
assert.equal(
  'unreadOnly' in getNotificationPreviewFilters(),
  false,
  'Preview не должен переключаться на unread-only по устаревшему счётчику'
)

console.log('notification bell state regression: ok')
