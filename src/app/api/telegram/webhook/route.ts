import { createClient } from '@supabase/supabase-js'
import { addDays, format, parse } from 'date-fns'

export const dynamic = 'force-dynamic'

const TELEGRAM_API = 'https://api.telegram.org/bot'
const TELEGRAM_FINANCE_ROLES = new Set(['financial_director', 'planning_director', 'supply_manager'])

type TelegramUpdate = {
  callback_query?: {
    id: string
    data?: string
    message?: { message_id?: number; chat: { id: number | string } }
    from?: { id: number | string }
  }
  message?: {
    text?: string
    chat: { id: number | string }
    from?: { id: number | string }
  }
}

type EventType = 'income' | 'expense'

type TelegramFinanceUser = {
  id: string
  full_name: string | null
  role: string | null
  is_active: boolean | null
}

function authorizeTelegramWebhook(request: Request) {
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim()
  if (!secret) return { ok: false as const, status: 503, error: 'Telegram webhook secret is not configured' }

  const headerSecret = request.headers.get('x-telegram-bot-api-secret-token')
  return headerSecret === secret
    ? { ok: true as const }
    : { ok: false as const, status: 401, error: 'Unauthorized' }
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase service credentials are missing')
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

async function getTelegramToken(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'telegram_bot_token')
    .maybeSingle()

  return (data?.value || process.env.TELEGRAM_BOT_TOKEN || '').trim()
}

async function telegramCall(token: string, method: string, body: Record<string, unknown>) {
  if (!token) return
  const response = await fetch(`${TELEGRAM_API}${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => null)
  if (result && result.ok === false) {
    console.error(`[Telegram webhook] ${method} failed:`, result.description || result)
  }
  return result
}

function parseUserDate(text: string) {
  const trimmed = text.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const parsed = parse(trimmed, 'dd.MM.yyyy', new Date())
  if (!Number.isNaN(parsed.getTime())) return format(parsed, 'yyyy-MM-dd')
  return null
}

async function findTelegramUser(supabase: ReturnType<typeof getSupabaseAdmin>, chatId: string) {
  const { data } = await supabase
    .from('users')
    .select('id, full_name, role, is_active')
    .eq('telegram_chat_id', chatId)
    .maybeSingle()
  return data as TelegramFinanceUser | null
}

function isAuthorizedFinanceTelegramUser(user: TelegramFinanceUser | null): user is TelegramFinanceUser {
  return Boolean(user?.id && user.is_active !== false && user.role && TELEGRAM_FINANCE_ROLES.has(user.role))
}

async function logAction(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  eventType: EventType,
  eventId: string,
  action: string,
  performedBy: string | null,
  values: Record<string, unknown> = {}
) {
  await supabase.from('finance_event_actions').insert({
    event_type: eventType,
    event_id: eventId,
    action,
    performed_by: performedBy,
    performed_via: 'telegram',
    ...values,
  })
}

async function updateFinanceEvent(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  eventType: EventType,
  eventId: string,
  action: 'paid' | 'partial' | 'postpone' | 'reject',
  performedBy: string,
  values: { amount?: number; date?: string; comment?: string } = {}
) {
  if (eventType === 'expense') {
    const { data: current, error: currentError } = await supabase.from('finance_expenses').select('*').eq('id', eventId).single()
    if (currentError || !current) throw new Error('Расход не найден')
    const update: Record<string, unknown> = { updated_by: performedBy }

    if (action === 'paid') {
      update.status = 'paid'
      update.paid_amount = current.amount
      update.actual_paid_date = values.date || format(new Date(), 'yyyy-MM-dd')
    } else if (action === 'partial') {
      const paidAmount = Number(values.amount || 0)
      update.status = paidAmount >= Number(current.amount) ? 'paid' : 'partially_paid'
      update.paid_amount = paidAmount
      update.actual_paid_date = paidAmount >= Number(current.amount) ? (values.date || format(new Date(), 'yyyy-MM-dd')) : null
    } else if (action === 'postpone') {
      update.planned_date = values.date
      update.rescheduled_date = values.date
      update.status = 'planned'
      update.comment = values.comment || current.comment
    } else {
      update.status = 'rejected'
      update.comment = values.comment || current.comment || 'Не подтверждено через Telegram'
    }

    const { error } = await supabase.from('finance_expenses').update(update).eq('id', eventId)
    if (error) throw new Error(error.message)
    await logAction(supabase, eventType, eventId, action, performedBy, {
      previous_planned_date: current.planned_date,
      new_planned_date: action === 'postpone' ? values.date : null,
      amount: values.amount ?? null,
      comment: values.comment ?? null,
    })
    return
  }

  const { data: current, error: currentError } = await supabase.from('invoices').select('*').eq('id', eventId).single()
  if (currentError || !current) throw new Error('Приход не найден')
  const totalAmount = Number(current.amount || 0)
  const update: Record<string, unknown> = { updated_by: performedBy }

  if (action === 'paid') {
    update.status = 'paid'
    update.paid_amount = totalAmount
    update.actual_paid_date = values.date || format(new Date(), 'yyyy-MM-dd')
  } else if (action === 'partial') {
    const paidAmount = Number(values.amount || 0)
    update.status = paidAmount >= totalAmount ? 'paid' : 'not_paid'
    update.paid_amount = paidAmount
    update.actual_paid_date = paidAmount >= totalAmount ? (values.date || format(new Date(), 'yyyy-MM-dd')) : null
  } else if (action === 'postpone') {
    update.rescheduled_date = values.date
    update.due_date = values.date
    update.payment_date = values.date
    update.status = 'not_paid'
    update.finance_comment = values.comment || current.finance_comment
  } else {
    update.status = current.status === 'paid' ? 'paid' : 'not_paid'
    update.finance_comment = values.comment || current.finance_comment || 'Не подтверждено через Telegram'
  }

  const { error } = await supabase.from('invoices').update(update).eq('id', eventId)
  if (error) throw new Error(error.message)
  await logAction(supabase, eventType, eventId, action, performedBy, {
    previous_planned_date: current.rescheduled_date || current.due_date || current.payment_date,
    new_planned_date: action === 'postpone' ? values.date : null,
    amount: values.amount ?? null,
    comment: values.comment ?? null,
  })
}

async function setDialogState(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  chatId: string,
  eventType: EventType,
  eventId: string,
  action: string,
  userId: string
) {
  await supabase.from('finance_telegram_dialog_states').upsert({
    chat_id: chatId,
    event_type: eventType,
    event_id: eventId,
    action,
    user_id: userId,
    created_at: new Date().toISOString(),
  }, { onConflict: 'chat_id' })
}

async function handleCallback(update: TelegramUpdate, supabase: ReturnType<typeof getSupabaseAdmin>, token: string) {
  const callback = update.callback_query
  const data = callback?.data || ''
  const chatId = String(callback?.message?.chat.id || callback?.from?.id || '')
  const parts = data.split(':')
  if (parts[0] !== 'fin' || !chatId) return

  const action = parts[1]
  const eventType = parts[2] === 'i' ? 'income' : 'expense'
  const eventId = parts[3]
  if (!eventId) {
    if (callback?.id) await telegramCall(token, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Некорректная кнопка', show_alert: true })
    return
  }
  const user = await findTelegramUser(supabase, chatId)
  if (!isAuthorizedFinanceTelegramUser(user)) {
    const text = 'Нет доступа к финансовым действиям через Telegram'
    if (callback?.id) await telegramCall(token, 'answerCallbackQuery', { callback_query_id: callback.id, text, show_alert: true })
    await telegramCall(token, 'sendMessage', { chat_id: chatId, text })
    return
  }

  try {
    let resultText = ''
    if (action === 'paid') {
      await updateFinanceEvent(supabase, eventType, eventId, 'paid', user.id)
      resultText = 'Оплата подтверждена.'
    } else if (action === 'post1' || action === 'post3' || action === 'post7') {
      const days = action === 'post1' ? 1 : action === 'post3' ? 3 : 7
      const newDate = format(addDays(new Date(), days), 'yyyy-MM-dd')
      await updateFinanceEvent(supabase, eventType, eventId, 'postpone', user.id, { date: newDate })
      resultText = `Перенесено на ${newDate}.`
    } else if (action === 'postc') {
      await setDialogState(supabase, chatId, eventType, eventId, 'postpone', user.id)
      resultText = 'Введите новую дату в формате YYYY-MM-DD или DD.MM.YYYY.'
    } else if (action === 'partial') {
      await setDialogState(supabase, chatId, eventType, eventId, 'partial', user.id)
      resultText = 'Введите сумму частичной оплаты числом.'
    } else if (action === 'reject') {
      await setDialogState(supabase, chatId, eventType, eventId, 'reject', user.id)
      resultText = 'Напишите комментарий, почему событие не подтверждено.'
    } else {
      throw new Error('Неизвестное действие')
    }

    if (callback?.id) await telegramCall(token, 'answerCallbackQuery', { callback_query_id: callback.id, text: resultText || 'Готово' })
    if (callback?.message?.message_id) {
      await telegramCall(token, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: callback.message.message_id,
        reply_markup: { inline_keyboard: [] },
      })
    }
    await telegramCall(token, 'sendMessage', { chat_id: chatId, text: resultText || 'Готово' })
  } catch (error) {
    const text = error instanceof Error ? error.message : 'Не удалось обработать действие'
    if (callback?.id) await telegramCall(token, 'answerCallbackQuery', { callback_query_id: callback.id, text, show_alert: true })
    await telegramCall(token, 'sendMessage', { chat_id: chatId, text })
  }
}

async function handleMessage(update: TelegramUpdate, supabase: ReturnType<typeof getSupabaseAdmin>, token: string) {
  const message = update.message
  const chatId = String(message?.chat.id || message?.from?.id || '')
  const text = message?.text?.trim()
  if (!chatId || !text) return

  const { data: state } = await supabase
    .from('finance_telegram_dialog_states')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle()

  if (!state) return

  const user = await findTelegramUser(supabase, chatId)
  if (!isAuthorizedFinanceTelegramUser(user) || user.id !== state.user_id) {
    await supabase.from('finance_telegram_dialog_states').delete().eq('chat_id', chatId)
    await telegramCall(token, 'sendMessage', { chat_id: chatId, text: 'Нет доступа к финансовым действиям через Telegram' })
    return
  }

  try {
    if (state.action === 'partial') {
      const amount = Number(text.replace(',', '.'))
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Введите сумму числом больше 0.')
      await updateFinanceEvent(supabase, state.event_type, state.event_id, 'partial', user.id, { amount })
      await telegramCall(token, 'sendMessage', { chat_id: chatId, text: 'Частичная оплата сохранена.' })
    } else if (state.action === 'postpone') {
      const date = parseUserDate(text)
      if (!date) throw new Error('Не удалось распознать дату. Используйте YYYY-MM-DD или DD.MM.YYYY.')
      await updateFinanceEvent(supabase, state.event_type, state.event_id, 'postpone', user.id, { date })
      await telegramCall(token, 'sendMessage', { chat_id: chatId, text: `Перенесено на ${date}.` })
    } else if (state.action === 'reject') {
      await updateFinanceEvent(supabase, state.event_type, state.event_id, 'reject', user.id, { comment: text })
      await telegramCall(token, 'sendMessage', { chat_id: chatId, text: 'Комментарий сохранен.' })
    }

    await supabase.from('finance_telegram_dialog_states').delete().eq('chat_id', chatId)
  } catch (error) {
    const reply = error instanceof Error ? error.message : 'Не удалось сохранить ответ.'
    await telegramCall(token, 'sendMessage', { chat_id: chatId, text: reply })
  }
}

export async function POST(request: Request) {
  try {
    const authorization = authorizeTelegramWebhook(request)
    if (!authorization.ok) {
      return Response.json({ ok: false, error: authorization.error }, { status: authorization.status })
    }

    const supabase = getSupabaseAdmin()
    const token = await getTelegramToken(supabase)
    const update = (await request.json()) as TelegramUpdate

    if (update.callback_query) await handleCallback(update, supabase, token)
    if (update.message) await handleMessage(update, supabase, token)

    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Telegram webhook error' }, { status: 500 })
  }
}
