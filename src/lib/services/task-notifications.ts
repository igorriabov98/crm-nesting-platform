import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildCrmNotificationTelegramMessage,
  buildTaskTelegramNotification,
  sendTelegramMessage,
} from './telegram'
import type { TaskStatus } from '@/lib/types'

type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
}
type LooseDb = { from: (table: string) => LooseQuery }

type PendingTaskRow = {
  id: string
  title: string
  description: string | null
  deadline: string | null
  start_date: string | null
  assigned_to: string
  machine_id: string | null
  status: TaskStatus
  machine?: {
    id?: string | null
    name?: string | null
    factory_id?: string | null
  } | null
}

type PendingNotificationRow = {
  id: string
  user_id: string
  title: string
  message: string
  related_machine_id: string | null
  machine?: {
    id?: string | null
    name?: string | null
    factory_id?: string | null
  } | null
}

type UserTelegramRow = {
  id: string
  telegram_chat_id: string | null
  role: string
  factory_id: string | null
}

type DispatchOptions = {
  machineId?: string | null
  userId?: string | null
  limit?: number
}

async function loadTelegramUsers(db: LooseDb, userIds: string[]) {
  const usersById = new Map<string, UserTelegramRow>()

  for (const userId of Array.from(new Set(userIds))) {
    const { data: usersData, error: usersError } = await db
      .from('users')
      .select('id, telegram_chat_id, role, factory_id')
      .eq('id', userId)

    if (usersError) {
      console.error('[Telegram] Не удалось загрузить пользователя для уведомления:', usersError.message)
      continue
    }

    const user = ((usersData || []) as UserTelegramRow[])[0]
    if (user) usersById.set(user.id, user)
  }

  return usersById
}

export async function dispatchPendingTelegramDeliveries(options: DispatchOptions = {}) {
  const supabase = createAdminClient()
  const db = supabase as unknown as LooseDb
  const limit = Math.min(Math.max(options.limit || 100, 1), 500)

  await dispatchPendingNotificationMessages(db, options, limit)
  await dispatchPendingTaskMessages(db, options, limit)
}

async function dispatchPendingNotificationMessages(db: LooseDb, options: DispatchOptions, limit: number) {
  let query = db
    .from('notifications')
    .select(`
      id,
      user_id,
      title,
      message,
      related_machine_id,
      machine:machines(id, name, factory_id)
    `)
    .is('telegram_notified_at', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (options.machineId) query = query.eq('related_machine_id', options.machineId)
  if (options.userId) query = query.eq('user_id', options.userId)

  const { data, error } = await query
  if (error) {
    console.error('[Telegram] Не удалось загрузить CRM-уведомления:', error.message)
    return
  }

  const notifications = (data || []) as PendingNotificationRow[]
  if (notifications.length === 0) return

  const usersById = await loadTelegramUsers(db, notifications.map((item) => item.user_id))

  for (const notification of notifications) {
    const user = usersById.get(notification.user_id)
    if (!user?.telegram_chat_id) continue
    if (
      user.role === 'production_manager' &&
      notification.related_machine_id &&
      notification.machine?.factory_id !== null &&
      notification.machine?.factory_id !== user.factory_id
    ) {
      continue
    }

    const { text, replyMarkup } = buildCrmNotificationTelegramMessage({
      title: notification.title,
      message: notification.message,
      machineId: notification.related_machine_id,
      machineName: notification.machine?.name || null,
    })
    const result = await sendTelegramMessage(user.telegram_chat_id, text, { replyMarkup })

    await db
      .from('notifications')
      .update({
        telegram_notified_at: result.ok ? new Date().toISOString() : null,
        telegram_error: result.ok ? null : result.error || 'Telegram API error',
      })
      .eq('id', notification.id)
  }
}

async function dispatchPendingTaskMessages(db: LooseDb, options: DispatchOptions, limit: number) {
  let query = db
    .from('tasks')
    .select(`
      id,
      title,
      description,
      deadline,
      start_date,
      assigned_to,
      machine_id,
      status,
      machine:machines(id, name, factory_id)
    `)
    .eq('status', 'pending')
    .is('notified_at', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (options.machineId) query = query.eq('machine_id', options.machineId)
  if (options.userId) query = query.eq('assigned_to', options.userId)

  const { data, error } = await query
  if (error) {
    console.error('[Telegram] Не удалось загрузить задачи для уведомления:', error.message)
    return
  }

  const tasks = (data || []) as PendingTaskRow[]
  if (tasks.length === 0) return

  const usersById = await loadTelegramUsers(db, tasks.map((task) => task.assigned_to))

  for (const task of tasks) {
    const user = usersById.get(task.assigned_to)
    if (!user?.telegram_chat_id) continue
    if (
      user.role === 'production_manager' &&
      task.machine_id &&
      task.machine?.factory_id !== null &&
      task.machine?.factory_id !== user.factory_id
    ) {
      continue
    }

    const { text, replyMarkup } = buildTaskTelegramNotification({
      title: task.title,
      description: task.description,
      deadline: task.deadline,
      startDate: task.start_date,
      machineId: task.machine_id,
      machineName: task.machine?.name || null,
    })
    const result = await sendTelegramMessage(user.telegram_chat_id, text, { replyMarkup })

    await db
      .from('tasks')
      .update({
        notified_at: result.ok ? new Date().toISOString() : null,
        telegram_error: result.ok ? null : result.error || 'Telegram API error',
      })
      .eq('id', task.id)
  }
}

export async function notifyNewTasks(machineId: string) {
  await dispatchPendingTelegramDeliveries({ machineId })
}
