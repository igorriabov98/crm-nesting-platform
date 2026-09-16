"use server"

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/permissions/server'

type NotificationRelations = {
  machine?: { factory_id: string | null } | null
  consumable_request?: { factory_id: string | null } | null
}

type NotificationMutationResult = {
  data: Array<{ id: string }> | null
  error: { message?: string } | null
}

type NotificationMutationBuilder = PromiseLike<NotificationMutationResult> & {
  eq: (column: string, value: unknown) => NotificationMutationBuilder
  in: (column: string, values: string[]) => NotificationMutationBuilder
  select: (columns: string) => NotificationMutationBuilder
}

type NotificationTable = {
  update: (values: { is_read: boolean }) => NotificationMutationBuilder
}

export async function getNotifications(filters?: {
  unreadOnly?: boolean
  limit?: number
  factoryFilter?: string | null
}) {
  const { supabase, userId } = await requirePermission('notifications', 'view')

  let query = supabase
    .from('notifications')
    .select(`
      *,
      machine:machines(id, name, factory_id),
      consumable_request:consumable_requests(id, factory_id)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (filters?.unreadOnly) {
    query = query.eq('is_read', false)
  }

  query = query.limit(filters?.limit || 100)

  const { data, error } = await query

  if (error) throw new Error(error.message)

  const scopedData = data || []

  if (!filters?.factoryFilter || filters.factoryFilter === 'all') return scopedData

  return scopedData.filter((notification) => {
    const relations = notification as unknown as NotificationRelations
    if (relations.consumable_request) {
      if (filters.factoryFilter === 'no_factory') return false
      return relations.consumable_request.factory_id === filters.factoryFilter
    }
    if (!relations.machine) return true
    if (filters.factoryFilter === 'no_factory') return relations.machine.factory_id === null
    return relations.machine.factory_id === filters.factoryFilter
  })
}

export async function markAsRead(notificationId: string) {
  const { supabase, userId } = await requirePermission('notifications', 'manage')

  await (supabase.from('notifications') as unknown as NotificationTable)
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('user_id', userId)

  revalidatePath('/notifications')
}

export async function markNotificationsAsRead(notificationIds: string[]) {
  const uniqueIds = Array.from(new Set(notificationIds.filter(Boolean)))
  if (uniqueIds.length === 0) return { markedCount: 0 }

  const { supabase, userId } = await requirePermission('notifications', 'manage')

  const { data } = await (supabase.from('notifications') as unknown as NotificationTable)
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false)
    .in('id', uniqueIds)
    .select('id')

  revalidatePath('/notifications')

  return { markedCount: Array.isArray(data) ? data.length : 0 }
}

export async function markAllAsRead() {
  const { supabase, userId } = await requirePermission('notifications', 'manage')

  await (supabase.from('notifications') as unknown as NotificationTable)
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false)

  revalidatePath('/notifications')
}
