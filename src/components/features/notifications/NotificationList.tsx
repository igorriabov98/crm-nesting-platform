'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  Inbox,
} from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import { ru } from 'date-fns/locale'
import { toast } from 'sonner'

import { NotificationGlyph } from './NotificationGlyph'
import {
  getNotificationDestination,
  isConsumableNotification,
  type NotificationItem,
} from './notification-model'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LoadingButton } from '@/components/ui/loading-button'
import { markAllAsRead, markAsRead } from '@/app/(protected)/notifications/actions'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/useUser'
import { cn } from '@/lib/utils'

type NotificationFilter = 'all' | 'unread'

function getGroupLabel(date: Date) {
  if (isToday(date)) return 'Сегодня'
  if (isYesterday(date)) return 'Вчера'
  return format(date, 'd MMMM yyyy', { locale: ru })
}

export function NotificationList({ initialData }: { initialData: NotificationItem[] }) {
  const router = useRouter()
  const { user } = useUser()
  const [data, setData] = useState(initialData)
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [markAllLoading, setMarkAllLoading] = useState(false)
  const [readingId, setReadingId] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.id) return
    const supabase = createClient()

    const channel = supabase
      .channel('notifications_page')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setData((current) => {
              const incoming = payload.new as NotificationItem
              if (current.some((item) => item.id === incoming.id)) return current
              return [incoming, ...current]
            })
          } else if (payload.eventType === 'UPDATE') {
            setData((current) =>
              current.map((item) =>
                item.id === payload.new.id
                  ? { ...item, ...(payload.new as NotificationItem) }
                  : item
              )
            )
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  const handleMarkAll = async () => {
    setMarkAllLoading(true)
    try {
      await markAllAsRead()
      setData((current) =>
        current.map((item) => ({ ...item, is_read: true }))
      )
      toast.success('Все уведомления отмечены прочитанными')
      router.refresh()
    } catch {
      toast.error('Не удалось отметить уведомления')
    } finally {
      setMarkAllLoading(false)
    }
  }

  const handleRead = async (notification: NotificationItem, navigate = true) => {
    const destination = getNotificationDestination(notification)
    setReadingId(notification.id)

    try {
      if (!notification.is_read) {
        await markAsRead(notification.id)
        setData((current) =>
          current.map((item) =>
            item.id === notification.id ? { ...item, is_read: true } : item
          )
        )
      }

      if (navigate && destination) router.push(destination.href)
    } catch {
      toast.error('Не удалось обновить уведомление')
    } finally {
      setReadingId(null)
    }
  }

  const unreadCount = data.filter((item) => !item.is_read).length

  const filteredData = useMemo(() => {
    if (filter === 'unread') return data.filter((item) => !item.is_read)
    return data
  }, [data, filter])

  const grouped = useMemo(() => {
    const groups: Record<string, NotificationItem[]> = {}

    filteredData.forEach((notification) => {
      const label = getGroupLabel(new Date(notification.created_at))
      if (!groups[label]) groups[label] = []
      groups[label].push(notification)
    })

    return groups
  }, [filteredData])

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-8">
      <section className="relative overflow-hidden rounded-3xl border border-border/80 bg-card shadow-sm">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-2/5 bg-gradient-to-l from-blue-50/80 to-transparent"
        />
        <div className="relative flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between lg:p-8">
          <div className="max-w-2xl">
            <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/15">
              <Bell className="size-6" strokeWidth={1.8} aria-hidden="true" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
              Центр событий
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Уведомления
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
              Изменения по машинам, срокам и заявкам собраны в одном месте.
              Новые события появляются автоматически.
            </p>
          </div>

          <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:min-w-72">
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4 backdrop-blur-sm">
              <p className="text-xs font-medium text-muted-foreground">Всего событий</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {data.length}
              </p>
            </div>
            <div className="rounded-2xl border border-blue-100 bg-blue-50/80 p-4 backdrop-blur-sm">
              <p className="text-xs font-medium text-blue-700">Непрочитано</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-blue-700">
                {unreadCount}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div
          className="grid grid-cols-2 rounded-xl bg-muted p-1"
          aria-label="Фильтр уведомлений"
        >
          <Button
            type="button"
            variant="ghost"
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
            className={cn(
              'min-h-11 rounded-lg px-4 text-muted-foreground shadow-none',
              filter === 'all' &&
                'bg-card text-foreground shadow-sm hover:bg-card hover:text-foreground'
            )}
          >
            Все события
            <Badge variant="secondary" className="ml-1 tabular-nums">
              {data.length}
            </Badge>
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-pressed={filter === 'unread'}
            onClick={() => setFilter('unread')}
            className={cn(
              'min-h-11 rounded-lg px-4 text-muted-foreground shadow-none',
              filter === 'unread' &&
                'bg-card text-foreground shadow-sm hover:bg-card hover:text-foreground'
            )}
          >
            Непрочитанные
            <Badge
              className={cn(
                'ml-1 tabular-nums',
                unreadCount > 0 ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground'
              )}
            >
              {unreadCount}
            </Badge>
          </Button>
        </div>

        {unreadCount > 0 && (
          <LoadingButton
            type="button"
            onClick={() => void handleMarkAll()}
            loading={markAllLoading}
            loadingText="Отмечаем..."
            variant="outline"
            className="min-h-11 rounded-xl px-4"
          >
            <Check className="size-4" aria-hidden="true" />
            Прочитать все
          </LoadingButton>
        )}
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-card px-6 py-16 text-center sm:py-20">
          <span className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-muted text-muted-foreground">
            {filter === 'unread' ? (
              <CheckCircle2 className="size-8" aria-hidden="true" />
            ) : (
              <Inbox className="size-8" aria-hidden="true" />
            )}
          </span>
          <h2 className="mt-5 text-lg font-semibold text-foreground">
            {filter === 'unread' ? 'Всё прочитано' : 'Событий пока нет'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {filter === 'unread'
              ? 'Новых уведомлений нет. Можно вернуться к полному списку.'
              : 'Когда в CRM произойдут важные изменения, они появятся на этой странице.'}
          </p>
          {filter === 'unread' && data.length > 0 && (
            <Button
              variant="outline"
              className="mt-5 min-h-11"
              onClick={() => setFilter('all')}
            >
              Показать все события
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([label, items]) => (
            <section key={label} aria-label={label} className="space-y-3">
              <div className="flex items-center gap-3 px-1">
                <span className="flex size-8 items-center justify-center rounded-xl bg-card text-muted-foreground ring-1 ring-border">
                  <CalendarDays className="size-4" aria-hidden="true" />
                </span>
                <h2 className="text-sm font-semibold text-foreground">{label}</h2>
                <span className="h-px flex-1 bg-border/80" aria-hidden="true" />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {items.length}
                </span>
              </div>

              <div className="space-y-3">
                {items.map((notification) => {
                  const destination = getNotificationDestination(notification)
                  const consumable = isConsumableNotification(notification.type)
                  const isReading = readingId === notification.id

                  return (
                    <article
                      key={notification.id}
                      className={cn(
                        'relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-primary/20 hover:shadow-md motion-reduce:transition-none',
                        notification.is_read
                          ? 'border-border/70'
                          : 'border-blue-200/80 bg-gradient-to-r from-blue-50/80 via-card to-card'
                      )}
                    >
                      {!notification.is_read && (
                        <span
                          className="absolute inset-y-0 left-0 w-1 bg-blue-600"
                          aria-hidden="true"
                        />
                      )}

                      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:p-5">
                        <NotificationGlyph type={notification.type} />

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-base font-semibold leading-6 text-foreground">
                                  {notification.title}
                                </h3>
                                {!notification.is_read && (
                                  <Badge className="bg-blue-600 text-white">Новое</Badge>
                                )}
                                {consumable && (
                                  <Badge variant="secondary">Расходники</Badge>
                                )}
                              </div>
                            </div>
                            <time
                              dateTime={notification.created_at}
                              className="shrink-0 text-xs tabular-nums text-muted-foreground"
                            >
                              {format(new Date(notification.created_at), 'HH:mm')}
                            </time>
                          </div>

                          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                            {notification.message}
                          </p>

                          {(destination || !notification.is_read) && (
                            <div className="mt-4 flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row sm:items-center">
                              {destination && (
                                <LoadingButton
                                  type="button"
                                  variant="secondary"
                                  loading={isReading}
                                  loadingText="Открываем..."
                                  className="min-h-11 justify-center rounded-xl px-4 sm:w-auto"
                                  onClick={() => void handleRead(notification)}
                                >
                                  {destination.label}
                                  <ArrowUpRight className="size-4" aria-hidden="true" />
                                </LoadingButton>
                              )}
                              {!notification.is_read && (
                                <LoadingButton
                                  type="button"
                                  variant="ghost"
                                  loading={isReading}
                                  loadingText="Сохраняем..."
                                  className="min-h-11 justify-center rounded-xl px-4 text-muted-foreground sm:w-auto"
                                  onClick={() => void handleRead(notification, false)}
                                >
                                  <Check className="size-4" aria-hidden="true" />
                                  Отметить прочитанным
                                </LoadingButton>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
