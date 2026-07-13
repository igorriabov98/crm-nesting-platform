'use client'

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Loader2,
  RefreshCcw,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ru } from 'date-fns/locale'

import {
  getNotifications,
  markAsRead,
  markNotificationsAsRead,
} from '@/app/(protected)/notifications/actions'
import {
  initialNotificationBellState,
  getNotificationPreviewFilters,
  notificationBellReducer,
} from '@/components/features/notifications/notification-bell-state'
import { NotificationGlyph } from '@/components/features/notifications/NotificationGlyph'
import {
  getNotificationDestination,
  isConsumableNotification,
  type NotificationItem,
} from '@/components/features/notifications/notification-model'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/lib/constants/routes'
import { useNavigationProgress } from '@/lib/hooks/useNavigationProgress'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface NotificationBellProps {
  userId: string
}

function NotificationPreviewSkeleton() {
  return (
    <div className="space-y-2 p-3" aria-label="Загрузка уведомлений">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-3"
        >
          <Skeleton className="size-11 shrink-0 rounded-2xl" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { start } = useNavigationProgress()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [state, dispatch] = useReducer(
    notificationBellReducer,
    initialNotificationBellState
  )
  const openRef = useRef(false)
  const viewedIdsRef = useRef(new Set<string>())
  const latestRequestIdRef = useRef(0)

  const fetchCount = useCallback(async () => {
    try {
      const supabase = createClient()
      const { count: exactCount, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false)

      if (error) throw error

      const nextCount = exactCount || 0
      setCount(nextCount)
      return nextCount
    } catch (error) {
      console.error('Не удалось обновить счётчик уведомлений', error)
      return null
    }
  }, [userId])

  const refreshPreview = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current
    dispatch({ type: 'refreshStarted' })

    try {
      // Preview is always the latest history. It must not switch between
      // unread-only and all items while opening notifications marks them read.
      const latest = ((await getNotifications(getNotificationPreviewFilters())) ||
        []) as NotificationItem[]

      if (requestId === latestRequestIdRef.current) {
        dispatch({ type: 'refreshSucceeded', notifications: latest })
      }

      return latest
    } catch (error) {
      console.error('Не удалось загрузить уведомления', error)
      if (requestId === latestRequestIdRef.current) {
        dispatch({
          type: 'refreshFailed',
          error: 'Не удалось обновить уведомления',
        })
      }
      return null
    }
  }, [])

  const markVisibleAsRead = useCallback(
    async (items: NotificationItem[]) => {
      const ids = items
        .filter(
          (item) => !item.is_read && !viewedIdsRef.current.has(item.id)
        )
        .map((item) => item.id)

      if (ids.length === 0) return

      ids.forEach((id) => viewedIdsRef.current.add(id))
      dispatch({ type: 'markedAsRead', ids })
      setCount((current) => Math.max(0, current - ids.length))

      try {
        const result = await markNotificationsAsRead(ids)
        if (result.markedCount !== ids.length) {
          ids.forEach((id) => viewedIdsRef.current.delete(id))
          await Promise.all([fetchCount(), refreshPreview()])
        }
      } catch (error) {
        console.error('Не удалось отметить уведомления прочитанными', error)
        ids.forEach((id) => viewedIdsRef.current.delete(id))
        await Promise.all([fetchCount(), refreshPreview()])
      }
    },
    [fetchCount, refreshPreview]
  )

  const refreshAndMarkVisible = useCallback(async () => {
    const [, latest] = await Promise.all([fetchCount(), refreshPreview()])
    if (latest) await markVisibleAsRead(latest)
  }, [fetchCount, markVisibleAsRead, refreshPreview])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      openRef.current = nextOpen
      setOpen(nextOpen)
      if (nextOpen) void refreshAndMarkVisible()
    },
    [refreshAndMarkVisible]
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([fetchCount(), refreshPreview()])
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
          if (openRef.current) {
            void refreshPreview().then((latest) => {
              if (latest) void markVisibleAsRead(latest)
            })
          }
        }
      )
      .subscribe()

    return () => {
      window.clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [fetchCount, markVisibleAsRead, refreshPreview, userId])

  const handleNotificationClick = async (notification: NotificationItem) => {
    const destination = getNotificationDestination(notification)
    const href = destination?.href || ROUTES.NOTIFICATIONS
    if (pathname !== href) start()

    openRef.current = false
    setOpen(false)

    if (!notification.is_read && !viewedIdsRef.current.has(notification.id)) {
      viewedIdsRef.current.add(notification.id)
      dispatch({ type: 'markedAsRead', ids: [notification.id] })
      setCount((current) => Math.max(0, current - 1))
      await markAsRead(notification.id)
    }

    router.push(href)
  }

  const { notifications, isInitialLoading, isRefreshing, error } = state

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              count > 0
                ? `Уведомления, непрочитанных: ${count}`
                : 'Уведомления'
            }
            className="relative size-11 rounded-2xl text-muted-foreground hover:bg-primary/8 hover:text-primary"
          >
            <Bell className="size-5" strokeWidth={1.8} />
            {count > 0 && (
              <Badge
                variant="default"
                className="absolute -right-0.5 -top-0.5 h-[18px] min-w-[18px] border-2 border-background bg-blue-600 px-1 text-[10px] leading-none text-white shadow-sm"
              >
                {count > 99 ? '99+' : count}
              </Badge>
            )}
          </Button>
        }
      />

      <PopoverContent
        align="end"
        sideOffset={10}
        className="w-[min(420px,calc(100vw-24px))] gap-0 overflow-hidden rounded-3xl border-border/80 bg-popover p-0 shadow-2xl shadow-primary/10"
      >
        <PopoverHeader className="gap-1 border-b border-border/70 bg-gradient-to-br from-primary/8 via-popover to-popover px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <PopoverTitle className="text-base font-semibold text-foreground">
                  Уведомления
                </PopoverTitle>
                {count > 0 && (
                  <Badge className="bg-blue-600 text-white">
                    {count} новых
                  </Badge>
                )}
              </div>
              <PopoverDescription className="text-xs leading-5">
                Последние события и изменения в CRM
              </PopoverDescription>
            </div>
            {isRefreshing && (
              <Loader2
                className="mt-1 size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
                aria-label="Обновление уведомлений"
              />
            )}
          </div>
        </PopoverHeader>

        <div
          className="min-h-[260px] max-h-[min(480px,calc(100vh-190px))] overflow-y-auto bg-muted/30 p-2"
          aria-live="polite"
        >
          {isInitialLoading ? (
            <NotificationPreviewSkeleton />
          ) : error && notifications.length === 0 ? (
            <div className="flex min-h-[240px] flex-col items-center justify-center px-8 text-center">
              <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                <RefreshCcw className="size-5" aria-hidden="true" />
              </span>
              <p className="font-medium text-foreground">Не удалось обновить список</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Проверьте соединение и попробуйте ещё раз
              </p>
              <Button
                variant="outline"
                className="mt-4 min-h-11"
                onClick={() => void refreshPreview()}
              >
                Повторить
              </Button>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex min-h-[240px] flex-col items-center justify-center px-8 text-center">
              <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                <CheckCircle2 className="size-6" aria-hidden="true" />
              </span>
              <p className="font-medium text-foreground">Всё спокойно</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Новые события появятся здесь автоматически
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {notifications.map((notification) => {
                const consumable = isConsumableNotification(notification.type)

                return (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => void handleNotificationClick(notification)}
                    className={cn(
                      'group relative flex min-h-20 w-full items-start gap-3 rounded-2xl border border-transparent p-3 text-left transition-colors duration-200 hover:border-border hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                      !notification.is_read && 'bg-blue-50/70'
                    )}
                  >
                    <NotificationGlyph type={notification.type} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span
                          className={cn(
                            'line-clamp-1 text-sm font-medium text-foreground',
                            !notification.is_read && 'font-semibold'
                          )}
                        >
                          {notification.title}
                        </span>
                        <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
                          {formatDistanceToNow(new Date(notification.created_at), {
                            addSuffix: true,
                            locale: ru,
                          })}
                        </span>
                      </span>
                      <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {notification.message}
                      </span>
                      {(consumable || notification.machine?.name) && (
                        <span className="mt-2 flex flex-wrap items-center gap-1.5">
                          {consumable && (
                            <Badge variant="secondary" className="text-[10px]">
                              Расходники
                            </Badge>
                          )}
                          {notification.machine?.name && (
                            <Badge variant="outline" className="max-w-full text-[10px]">
                              <span className="truncate">
                                Машина: {notification.machine.name}
                              </span>
                            </Badge>
                          )}
                        </span>
                      )}
                    </span>
                    {!notification.is_read && (
                      <span
                        className="mt-2 size-2 shrink-0 rounded-full bg-blue-600 ring-4 ring-blue-100"
                        aria-label="Непрочитанное"
                      />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t border-border/70 bg-popover p-2.5">
          <Button
            variant="ghost"
            className="min-h-11 w-full justify-between rounded-2xl px-3 text-foreground"
            render={<Link href={ROUTES.NOTIFICATIONS} onClick={() => setOpen(false)} />}
          >
            Открыть центр уведомлений
            <ArrowRight className="size-4 transition-transform duration-200 group-hover/button:translate-x-0.5 motion-reduce:transition-none" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
