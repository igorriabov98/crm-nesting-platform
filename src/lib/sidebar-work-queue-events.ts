export const SIDEBAR_WORK_QUEUE_REFRESH_EVENT = 'crm:sidebar-work-queues:refresh'

export function notifySidebarWorkQueuesChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SIDEBAR_WORK_QUEUE_REFRESH_EVENT))
}
