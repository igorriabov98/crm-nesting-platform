"use server"

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getNotifications(filters?: {
  unreadOnly?: boolean
  limit?: number
  factoryFilter?: string | null
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Не авторизован')

  const { data: profile } = await supabase
    .from('users')
    .select('role, factory_id')
    .eq('id', user.id)
    .single()
  const currentUser = profile as { role?: string; factory_id?: string | null } | null

  let query = supabase
    .from('notifications')
    .select(`
      *,
      machine:machines(id, name, factory_id),
      consumable_request:consumable_requests(id, factory_id)
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (filters?.unreadOnly) {
    query = query.eq('is_read', false)
  }

  query = query.limit(filters?.limit || 100)

  const { data, error } = await query

  if (error) throw new Error(error.message)

  const scopedData = (data || []).filter((notification: any) => {
    if (currentUser?.role !== 'production_manager') return true
    if (notification.consumable_request) {
      return notification.consumable_request.factory_id === currentUser.factory_id
    }
    if (!notification.machine) return true
    return notification.machine.factory_id === null || notification.machine.factory_id === currentUser.factory_id
  })

  if (!filters?.factoryFilter || filters.factoryFilter === 'all') return scopedData

  return scopedData.filter((notification: any) => {
    if (notification.consumable_request) {
      if (filters.factoryFilter === 'no_factory') return false
      return notification.consumable_request.factory_id === filters.factoryFilter
    }
    if (!notification.machine) return true
    if (filters.factoryFilter === 'no_factory') return notification.machine.factory_id === null
    return notification.machine.factory_id === filters.factoryFilter
  })
}

export async function markAsRead(notificationId: string) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await (supabase.from('notifications') as any)
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('user_id', user.id)

  revalidatePath('/notifications')
}

export async function markNotificationsAsRead(notificationIds: string[]) {
  const uniqueIds = Array.from(new Set(notificationIds.filter(Boolean)))
  if (uniqueIds.length === 0) return { markedCount: 0 }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { markedCount: 0 }

  const { data } = await (supabase.from('notifications') as any)
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('is_read', false)
    .in('id', uniqueIds)
    .select('id')

  revalidatePath('/notifications')

  return { markedCount: Array.isArray(data) ? data.length : 0 }
}

export async function markAllAsRead() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await (supabase.from('notifications') as any)
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('is_read', false)

  revalidatePath('/notifications')
}
