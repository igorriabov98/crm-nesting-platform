'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bell, Maximize2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ROUTES } from '@/lib/constants/routes'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getNotifications, markAsRead, markNotificationsAsRead } from '@/app/(protected)/notifications/actions'
import { NOTIFICATION_TYPES, DEFAULT_NOTIFICATION_ICON, NotificationType } from '@/lib/constants/notifications'
import { useNavigationProgress } from '@/lib/hooks/useNavigationProgress'
import { formatDistanceToNow } from 'date-fns'
import { ru } from 'date-fns/locale'

interface NotificationBellProps {
  userId: string
}

interface HeaderNotification {
  id: string
  type: string
  title: string
  message: string
  created_at: string
  is_read: boolean
  related_machine_id: string | null
  consumable_request_id: string | null
  machine?: {
    name?: string | null
  } | null
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { start } = useNavigationProgress()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [notifications, setNotifications] = useState<HeaderNotification[]>([])
  const [viewedIds, setViewedIds] = useState<Set<string>>(() => new Set())

  const fetchCount = useCallback(async () => {
    const supabase = createClient()
    const { count: exactCount } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)

    const nextCount = exactCount || 0
    setCount(nextCount)
    return nextCount
  }, [userId])

  const fetchLatest = useCallback(async (unreadCount?: number) => {
    try {
      const limit = Math.min(Math.max(unreadCount || 5, 5), 100)
      const latest = ((await getNotifications({
        limit,
        unreadOnly: typeof unreadCount === 'number' && unreadCount > 0,
      })) || []) as HeaderNotification[]
      setNotifications(latest)
      return latest
    } catch (err) {
      console.error(err)
      return []
    }
  }, [])

  const markVisibleAsRead = useCallback(async (items: HeaderNotification[]) => {
    const ids = items
      .filter((item) => !item.is_read && !viewedIds.has(item.id))
      .map((item) => item.id)

    if (ids.length === 0) return

    setViewedIds((current) => {
      const next = new Set(current)
      ids.forEach((id) => next.add(id))
      return next
    })
    setNotifications((current) => current.map((item) => ids.includes(item.id) ? { ...item, is_read: true } : item))
    setCount((current) => Math.max(0, current - ids.length))

    try {
      const result = await markNotificationsAsRead(ids)
      if (result.markedCount !== ids.length) {
        await fetchCount()
        void fetchLatest()
      }
    } catch (err) {
      console.error(err)
      setViewedIds((current) => {
        const next = new Set(current)
        ids.forEach((id) => next.delete(id))
        return next
      })
      await fetchCount()
      void fetchLatest()
    }
  }, [fetchCount, fetchLatest, viewedIds])

  const openAndMarkVisible = useCallback(async () => {
    const unreadCount = await fetchCount()
    const latest = await fetchLatest(unreadCount)
    await markVisibleAsRead(latest)
  }, [fetchCount, fetchLatest, markVisibleAsRead])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) void openAndMarkVisible()
  }, [openAndMarkVisible])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchCount()
      if (open) void openAndMarkVisible()
    }, 0)

    const supabase = createClient()
    const channel = supabase
      .channel('notifications_header')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void fetchCount()
          if (open) void openAndMarkVisible()
        }
      )
      .subscribe()

    return () => {
      window.clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [fetchCount, openAndMarkVisible, userId, open])

  const handleNotificationClick = async (notification: HeaderNotification) => {
    const isSupplyConsumableNotification = notification.type === 'consumable_request_new' || notification.type === 'consumable_request_shortage'
    const href = notification.related_machine_id
      ? `${ROUTES.SALES_PLAN}/${notification.related_machine_id}`
      : notification.consumable_request_id
        ? `${isSupplyConsumableNotification ? ROUTES.SUPPLY_CONSUMABLE_REQUESTS : ROUTES.PRODUCTION_CONSUMABLE_REQUESTS}?request=${notification.consumable_request_id}`
        : ROUTES.NOTIFICATIONS
    if (pathname !== href) start()

    setOpen(false)

    if (!viewedIds.has(notification.id)) {
      setViewedIds((current) => {
        const next = new Set(current)
        next.add(notification.id)
        return next
      })
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, is_read: true } : item))
      setCount((current) => Math.max(0, current - 1))
      await markAsRead(notification.id)
    }

    router.push(href)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open notifications"
          className="relative text-[#6B7280] hover:bg-[#F8F9FA] hover:text-[#1B3A6B]"
        >
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]"
            >
              {count > 99 ? '99+' : count}
            </Badge>
          )}
        </Button>
      } />

      <PopoverContent align="end" className="w-[380px] p-0 bg-white border-[#E8ECF0] shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#E8ECF0]">
          <p className="text-sm font-medium text-[#1B3A6B]">Уведомления</p>
          <Link
            href={ROUTES.NOTIFICATIONS}
            className="text-xs text-[#2563EB] hover:text-blue-300 flex items-center"
            onClick={() => setOpen(false)}
          >
            Все
            <Maximize2 className="ml-1 w-3 h-3" />
          </Link>
        </div>

        <div className="max-h-[300px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="text-center py-6 text-[#9CA3AF] text-sm">
              Нет новых уведомлений
            </div>
          ) : (
            <div className="divide-y divide-slate-800/50">
              {notifications.map((notif) => {
                const config = NOTIFICATION_TYPES[notif.type as NotificationType] || DEFAULT_NOTIFICATION_ICON
                const Icon = config.icon

                return (
                  <button
                    key={notif.id}
                    onClick={() => handleNotificationClick(notif)}
                    className={`w-full text-left p-4 hover:bg-[#F8F9FA]/50 transition-colors flex items-start gap-4 ${!notif.is_read ? 'bg-[#2563EB]/5' : ''}`}
                  >
                    <div className={`mt-0.5 p-2 rounded-full flex-shrink-0 ${config.bg} ${config.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 space-y-1 overflow-hidden">
                      <div className="flex justify-between items-start gap-2">
                        <p className={`text-sm font-medium truncate ${notif.is_read ? 'text-[#6B7280]' : 'text-[#374151]'}`}>
                          {notif.title}
                        </p>
                        <span className="text-[10px] text-[#9CA3AF] flex-shrink-0">
                          {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: ru })}
                        </span>
                      </div>
                      <p className={`text-xs line-clamp-2 ${notif.is_read ? 'text-[#9CA3AF]' : 'text-[#6B7280]'}`}>
                        {notif.message}
                      </p>
                      {notif.machine?.name && (
                        <p className="text-[10px] text-[#2563EB]/80 font-medium pt-1">
                          Машина: {notif.machine.name}
                        </p>
                      )}
                    </div>
                    {!notif.is_read && (
                      <div className="w-2 h-2 mt-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t border-[#E8ECF0] p-2">
          <Button
            variant="ghost"
            className="w-full text-xs text-[#6B7280] hover:text-[#1B3A6B]"
            onClick={() => {
              setOpen(false)
              router.push(ROUTES.NOTIFICATIONS)
            }}
          >
            Показать все уведомления →
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
