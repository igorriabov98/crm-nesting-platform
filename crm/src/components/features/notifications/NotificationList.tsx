"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CheckCircle2 } from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import { ru } from 'date-fns/locale'
import { toast } from 'sonner'

import { LoadingButton } from '@/components/ui/loading-button'
import { NOTIFICATION_TYPES, DEFAULT_NOTIFICATION_ICON, NotificationType } from '@/lib/constants/notifications'
import { markAsRead, markAllAsRead } from '@/app/(protected)/notifications/actions'
import { ROUTES } from '@/lib/constants/routes'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/useUser'
import { cn } from '@/lib/utils'

type NotificationItem = {
  id: string
  type: string
  title: string
  message: string
  created_at: string
  is_read: boolean
  related_machine_id: string | null
}

export function NotificationList({ initialData }: { initialData: NotificationItem[] }) {
  const router = useRouter()
  const { user } = useUser()
  const [data, setData] = useState(initialData)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
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
            setData((prev) => [payload.new as NotificationItem, ...prev])
          } else if (payload.eventType === 'UPDATE') {
            setData((prev) => prev.map((item) => item.id === payload.new.id ? { ...item, ...(payload.new as NotificationItem) } : item))
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
      setData((prev) => prev.map((item) => ({ ...item, is_read: true })))
      toast.success('Все уведомления прочитаны')
      router.refresh()
    } catch {
      toast.error('Произошла ошибка')
    } finally {
      setMarkAllLoading(false)
    }
  }

  const handleRead = async (id: string, machineId: string | null) => {
    setReadingId(id)
    try {
      await markAsRead(id)
      setData((prev) => prev.map((item) => item.id === id ? { ...item, is_read: true } : item))

      if (machineId) {
        router.push(`${ROUTES.SALES_PLAN}/${machineId}`)
      }
    } catch {
      toast.error('Произошла ошибка')
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
      const date = new Date(notification.created_at)
      let label = ''

      if (isToday(date)) {
        label = 'Сегодня'
      } else if (isYesterday(date)) {
        label = 'Вчера'
      } else {
        label = format(date, 'd MMMM yyyy', { locale: ru })
      }

      if (!groups[label]) groups[label] = []
      groups[label].push(notification)
    })

    return groups
  }, [filteredData])

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex w-fit rounded-lg border border-[#E8ECF0] bg-white p-1">
          <button
            onClick={() => setFilter('all')}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium transition-all duration-200',
              filter === 'all'
                ? 'bg-[#F8F9FA] text-[#1B3A6B] shadow'
                : 'text-[#6B7280] hover:bg-[#F8F9FA] hover:text-[#374151]'
            )}
          >
            Все
          </button>
          <button
            onClick={() => setFilter('unread')}
            className={cn(
              'flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-all duration-200',
              filter === 'unread'
                ? 'bg-[#F8F9FA] text-[#1B3A6B] shadow'
                : 'text-[#6B7280] hover:bg-[#F8F9FA] hover:text-[#374151]'
            )}
          >
            Непрочитанные
            {unreadCount > 0 && (
              <span className="rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] text-[#1B3A6B]">
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        {unreadCount > 0 && (
          <LoadingButton
            onClick={handleMarkAll}
            loading={markAllLoading}
            variant="outline"
            className="border-[#E8ECF0] bg-white text-[#374151] hover:bg-[#F8F9FA] hover:text-[#1B3A6B]"
          >
            <Check className="mr-2 h-4 w-4" />
            Прочитать все
          </LoadingButton>
        )}
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="rounded-xl border border-[#E8ECF0] bg-white py-20 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F8F9FA]">
            <CheckCircle2 className="h-8 w-8 text-[#9CA3AF]" />
          </div>
          <h3 className="text-lg font-medium text-[#374151]">Нет уведомлений</h3>
          <p className="mt-1 text-[#9CA3AF]">
            {filter === 'unread' ? 'У вас нет непрочитанных уведомлений' : 'История уведомлений пуста'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([label, items]) => (
            <div key={label} className="space-y-3">
              <h4 className="px-1 text-sm font-semibold uppercase tracking-widest text-[#6B7280]">
                {label}
              </h4>
              <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
                <div className="divide-y divide-[#E8ECF0]">
                  {items.map((notification) => {
                    const config = NOTIFICATION_TYPES[notification.type as NotificationType] || DEFAULT_NOTIFICATION_ICON
                    const Icon = config.icon

                    return (
                      <div
                        key={notification.id}
                        className={cn(
                          'flex items-start gap-4 p-4 transition-colors hover:bg-[#FAFBFC] sm:p-5',
                          !notification.is_read ? 'bg-white' : 'bg-white/40'
                        )}
                      >
                        <div className={cn('mt-1 flex-shrink-0 rounded-xl p-3', config.bg, config.color)}>
                          <Icon className="h-5 w-5" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                            <h5 className={cn('text-base font-medium', notification.is_read ? 'text-[#374151]' : 'text-[#1B3A6B]')}>
                              {notification.title}
                            </h5>
                            <span className="whitespace-nowrap text-xs text-[#9CA3AF]">
                              {format(new Date(notification.created_at), 'HH:mm')}
                            </span>
                          </div>

                          <p className={cn('text-sm', notification.is_read ? 'text-[#9CA3AF]' : 'text-[#374151]')}>
                            {notification.message}
                          </p>

                          {(notification.related_machine_id || !notification.is_read) && (
                            <div className="mt-4 flex items-center gap-3">
                              {notification.related_machine_id && (
                                <LoadingButton
                                  size="sm"
                                  variant="secondary"
                                  loading={readingId === notification.id}
                                  className="bg-[#F8F9FA] text-[#2563EB] hover:bg-[#E8ECF0]"
                                  onClick={() => handleRead(notification.id, notification.related_machine_id)}
                                >
                                  Перейти к машине
                                </LoadingButton>
                              )}
                              {!notification.is_read && (
                                <LoadingButton
                                  size="sm"
                                  variant="ghost"
                                  loading={readingId === notification.id}
                                  className="text-[#6B7280] hover:text-[#1B3A6B]"
                                  onClick={() => handleRead(notification.id, null)}
                                >
                                  Прочитано
                                </LoadingButton>
                              )}
                            </div>
                          )}
                        </div>

                        {!notification.is_read && (
                          <div className="mt-2 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
