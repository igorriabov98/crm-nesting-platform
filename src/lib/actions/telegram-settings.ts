'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/permissions/server'
import type { PermissionOperation } from '@/lib/permissions/resources'
import {
  TELEGRAM_TOKEN_SETTING_KEY,
  getBotInfo,
  getTelegramTokenPreview,
  getTelegramTokenSource,
  isTelegramConfigured,
  sendTelegramMessage,
  verifyTelegramToken,
} from '@/lib/services/telegram'
import type { UserRole } from '@/lib/types'

type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  single: () => Promise<DbResult>
  upsert: (values: unknown, options?: { onConflict?: string }) => LooseQuery
  delete: () => LooseQuery
}
type LooseDb = { from: (table: string) => LooseQuery }

export type TelegramUserRow = {
  id: string
  full_name: string
  role: UserRole
  telegram_chat_id: string | null
}

async function requireDirector(operation: PermissionOperation = 'view') {
  const context = await requirePermission('telegram_settings', operation)
  return { db: context.supabase as unknown as LooseDb }
}

export async function getTelegramStatus() {
  try {
    await requireDirector()
    const configured = await isTelegramConfigured()
    if (!configured) {
      return {
        configured: false,
        tokenPreview: null,
        tokenSource: null,
        botUsername: null,
        error: null,
      }
    }

    const bot = await getBotInfo()
    return {
      configured: true,
      tokenPreview: await getTelegramTokenPreview(),
      tokenSource: await getTelegramTokenSource(),
      botUsername: bot.ok ? bot.username || null : null,
      error: bot.ok ? null : bot.error || 'Не удалось проверить токен',
    }
  } catch (error) {
    return {
      configured: false,
      tokenPreview: null,
      tokenSource: null,
      botUsername: null,
      error: error instanceof Error ? error.message : 'Не удалось проверить Telegram',
    }
  }
}

export async function saveTelegramToken(token: string) {
  try {
    const trimmedToken = token.trim()
    if (!trimmedToken) throw new Error('Введите токен Telegram-бота')
    if (!trimmedToken.includes(':')) throw new Error('Токен выглядит некорректно')

    const verification = await verifyTelegramToken(trimmedToken)
    if (!verification.ok) throw new Error(verification.error || 'Telegram не принял токен')

    const { db } = await requireDirector('manage')
    const { error } = await db
      .from('app_settings')
      .upsert({
        key: TELEGRAM_TOKEN_SETTING_KEY,
        value: trimmedToken,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })

    if (error) throw new Error(error.message || 'Не удалось сохранить токен')

    revalidatePath('/admin/settings/telegram')
    return { success: true, botUsername: verification.username || null }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось сохранить токен' }
  }
}

export async function deleteTelegramToken() {
  try {
    const { db } = await requireDirector('manage')
    const { error } = await db
      .from('app_settings')
      .delete()
      .eq('key', TELEGRAM_TOKEN_SETTING_KEY)

    if (error) throw new Error(error.message || 'Не удалось удалить токен')

    revalidatePath('/admin/settings/telegram')
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось удалить токен' }
  }
}

export async function getUsersWithTelegram() {
  try {
    const { db } = await requireDirector()
    const { data, error } = await db
      .from('users')
      .select('id, full_name, role, telegram_chat_id')
      .eq('is_active', true)
      .order('full_name')

    if (error) throw new Error(error.message || 'Не удалось загрузить пользователей')

    const users = ((data || []) as TelegramUserRow[]).sort((a, b) => {
      if (!!a.telegram_chat_id === !!b.telegram_chat_id) return a.full_name.localeCompare(b.full_name)
      return a.telegram_chat_id ? -1 : 1
    })

    return { data: users, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить пользователей' }
  }
}

export async function sendTestMessage(userId: string) {
  try {
    const { db } = await requireDirector('manage')
    const { data, error } = await db
      .from('users')
      .select('id, full_name, telegram_chat_id')
      .eq('id', userId)
      .single()

    if (error || !data) throw new Error('Пользователь не найден')
    const user = data as { id: string; full_name: string; telegram_chat_id: string | null }
    if (!user.telegram_chat_id) throw new Error('У пользователя не заполнен Telegram Chat ID')

    const result = await sendTelegramMessage(
      user.telegram_chat_id,
      '🧪 Тестовое сообщение из CRM. Если вы видите это, Telegram-уведомления работают.'
    )

    if (!result.ok) throw new Error(result.error || 'Telegram не доставил сообщение')
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось отправить тестовое сообщение' }
  }
}
