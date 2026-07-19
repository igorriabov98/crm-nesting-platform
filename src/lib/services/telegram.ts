import { getAppUrl, getTelegramBotToken } from '@/lib/config'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const TELEGRAM_API = 'https://api.telegram.org/bot'
export const TELEGRAM_TOKEN_SETTING_KEY = 'telegram_bot_token'

type TelegramButton = { text: string; url?: string; callback_data?: string }
export type TelegramInlineKeyboard = {
  inline_keyboard: Array<Array<TelegramButton>>
}

type TelegramSendOptions = {
  parseMode?: 'HTML' | 'MarkdownV2'
  replyMarkup?: TelegramInlineKeyboard
}

export interface TelegramSendResult {
  ok: boolean
  error?: string
}

type TelegramApiResponse = {
  ok: boolean
  description?: string
  result?: { username?: string }
}

export type TelegramTokenSource = 'database' | 'env' | null

type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  maybeSingle: () => Promise<DbResult>
}
type LooseDb = { from: (table: string) => LooseQuery }

function isTelegramSafeUrl(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  } catch {
    return false
  }
}

function sanitizeTelegramReplyMarkup(replyMarkup?: TelegramInlineKeyboard) {
  if (!replyMarkup) return undefined

  const inline_keyboard = replyMarkup.inline_keyboard
    .map((row) => row.filter((button) => !button.url || isTelegramSafeUrl(button.url)))
    .filter((row) => row.length > 0)

  return inline_keyboard.length > 0 ? { inline_keyboard } : undefined
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function maskToken(token: string) {
  if (!token) return null
  return `${token.slice(0, 5)}••••••••••••••••`
}

async function getStoredTelegramBotToken() {
  try {
    const supabase = await createServerSupabaseClient()
    const db = supabase as unknown as LooseDb
    const { data, error } = await db
      .from('app_settings')
      .select('value')
      .eq('key', TELEGRAM_TOKEN_SETTING_KEY)
      .maybeSingle()

    if (error) {
      console.warn('[Telegram] Не удалось загрузить токен из настроек CRM:', error.message)
      return ''
    }

    return ((data as { value?: string | null } | null)?.value || '').trim()
  } catch (error) {
    console.warn('[Telegram] Не удалось загрузить токен из настроек CRM:', error)
    return ''
  }
}

export async function getResolvedTelegramBotToken(): Promise<{
  token: string
  source: TelegramTokenSource
}> {
  const storedToken = await getStoredTelegramBotToken()
  if (storedToken) return { token: storedToken, source: 'database' }

  const envToken = getTelegramBotToken().trim()
  if (envToken) return { token: envToken, source: 'env' }

  return { token: '', source: null }
}

export async function verifyTelegramToken(token: string): Promise<{
  ok: boolean
  username?: string
  error?: string
}> {
  if (!token.trim()) return { ok: false, error: 'Токен не задан' }

  try {
    const response = await fetch(`${TELEGRAM_API}${token.trim()}/getMe`, { cache: 'no-store' })
    const data = (await response.json()) as TelegramApiResponse
    if (data.ok) return { ok: true, username: data.result?.username }
    return { ok: false, error: data.description || 'Telegram API вернул ошибку' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options?: TelegramSendOptions
): Promise<TelegramSendResult> {
  const { token } = await getResolvedTelegramBotToken()
  if (!token) {
    console.warn('[Telegram] Токен бота не настроен, уведомление пропущено')
    return { ok: false, error: 'Токен бота не настроен' }
  }

  try {
    const replyMarkup = sanitizeTelegramReplyMarkup(options?.replyMarkup)
    const response = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options?.parseMode || 'HTML',
        reply_markup: replyMarkup,
      }),
    })

    const data = (await response.json()) as TelegramApiResponse
    if (!data.ok) {
      console.error('[Telegram] API error:', data.description)
      return { ok: false, error: data.description || 'Telegram API вернул ошибку' }
    }

    return { ok: true }
  } catch (error) {
    console.error('[Telegram] Network error:', error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function sendTelegramNotification(
  chatId: string,
  message: string,
  replyMarkup?: TelegramInlineKeyboard
): Promise<boolean> {
  const result = await sendTelegramMessage(chatId, message, { replyMarkup })
  return result.ok
}

export async function isTelegramConfigured(): Promise<boolean> {
  const { token } = await getResolvedTelegramBotToken()
  return !!token
}

export async function getBotInfo(): Promise<{
  ok: boolean
  username?: string
  error?: string
}> {
  const { token } = await getResolvedTelegramBotToken()
  return verifyTelegramToken(token)
}

export async function getTelegramTokenPreview() {
  const { token } = await getResolvedTelegramBotToken()
  return maskToken(token)
}

export async function getTelegramTokenSource() {
  const { source } = await getResolvedTelegramBotToken()
  return source
}

export function buildStockCheckNotification(
  machineName: string,
  requestId: string,
  type: 'procurement' | 'painting'
): { text: string; replyMarkup: TelegramInlineKeyboard } {
  const baseUrl = getAppUrl()
  const path = type === 'procurement'
    ? `/stock-check/procurement/${requestId}`
    : `/stock-check/painting/${requestId}`
  const roleName = type === 'procurement' ? 'заготовки' : 'малярки'

  return {
    text:
      `<b>Новая заявка на проверку остатков</b>\n\n` +
      `Машина: <b>${escapeHtml(machineName)}</b>\n` +
      `Раздел: ${roleName}\n\n` +
      'Откройте ссылку для заполнения остатков:',
    replyMarkup: {
      inline_keyboard: [[{ text: 'Заполнить остатки', url: `${baseUrl}${path}` }]],
    },
  }
}

export function buildStockCheckMessage(
  machineName: string,
  requestId: string,
  type: 'procurement' | 'painting'
): { text: string; url: string } {
  const baseUrl = getAppUrl()
  const path = type === 'procurement'
    ? `/stock-check/procurement/${requestId}`
    : `/stock-check/painting/${requestId}`
  const notification = buildStockCheckNotification(machineName, requestId, type)
  return { text: notification.text, url: `${baseUrl}${path}` }
}

export function buildTaskNotification(
  machineName: string,
  taskTitle: string,
  deadline: string,
  machineId: string
): { text: string; replyMarkup: TelegramInlineKeyboard } {
  const baseUrl = getAppUrl()

  return {
    text:
      `<b>Новая задача</b>\n\n` +
      `Машина: <b>${escapeHtml(machineName)}</b>\n` +
      `Задача: ${escapeHtml(taskTitle)}\n` +
      `Дедлайн: <b>${escapeHtml(deadline)}</b>`,
    replyMarkup: {
      inline_keyboard: [[{ text: 'Открыть машину', url: `${baseUrl}/sales-plan/${machineId}` }]],
    },
  }
}

export function buildTaskTelegramNotification(input: {
  title: string
  description?: string | null
  deadline: string | null
  startDate?: string | null
  machineId?: string | null
  machineName?: string | null
}): { text: string; replyMarkup: TelegramInlineKeyboard } {
  const baseUrl = getAppUrl()
  const url = input.machineId ? `${baseUrl}/sales-plan/${input.machineId}` : `${baseUrl}/tasks`
  const details = [
    input.machineName ? `Машина: <b>${escapeHtml(input.machineName)}</b>` : null,
    `Задача: ${escapeHtml(input.title)}`,
    input.startDate ? `Начать: <b>${escapeHtml(input.startDate)}</b>` : null,
    `Дедлайн: <b>${escapeHtml(input.deadline || 'В ближайшее время')}</b>`,
    input.description ? `\n${escapeHtml(input.description)}` : null,
  ].filter(Boolean).join('\n')

  return {
    text: `<b>Новая задача</b>\n\n${details}`,
    replyMarkup: {
      inline_keyboard: [[{ text: input.machineId ? 'Открыть машину' : 'Открыть задачи', url }]],
    },
  }
}

export function buildCrmNotificationTelegramMessage(input: {
  title: string
  message: string
  machineId?: string | null
  machineName?: string | null
}): { text: string; replyMarkup?: TelegramInlineKeyboard } {
  const baseUrl = getAppUrl()
  const machineLine = input.machineName ? `\n\nМашина: <b>${escapeHtml(input.machineName)}</b>` : ''

  return {
    text:
      `<b>${escapeHtml(input.title)}</b>\n\n` +
      `${escapeHtml(input.message)}` +
      machineLine,
    replyMarkup: input.machineId
      ? { inline_keyboard: [[{ text: 'Открыть машину', url: `${baseUrl}/sales-plan/${input.machineId}` }]] }
      : { inline_keyboard: [[{ text: 'Открыть уведомления', url: `${baseUrl}/notifications` }]] },
  }
}

export function buildOrderReminderNotification(
  supplierName: string,
  itemCount: number,
  deliveryDate: string
): { text: string; replyMarkup: TelegramInlineKeyboard } {
  const baseUrl = getAppUrl()

  return {
    text:
      `<b>Напоминание о заказе</b>\n\n` +
      `Поставщик: <b>${escapeHtml(supplierName)}</b>\n` +
      `Позиций к заказу: <b>${itemCount}</b>\n` +
      `Дата поставки: <b>${escapeHtml(deliveryDate)}</b>`,
    replyMarkup: {
      inline_keyboard: [[{ text: 'Открыть заказы', url: `${baseUrl}/supply/orders` }]],
    },
  }
}
