// Follow this setup guide to deploy your Supabase Edge Function:
// 1. Install Supabase CLI: npm install -g supabase
// 2. Login: supabase login
// 3. Link project: supabase link --project-ref <your-project-id>
// 4. Deploy function: supabase functions deploy daily-check
// 5. Go to your Supabase Dashboard -> Edge Functions -> daily-check
// 6. Setup Schedule / Cron Job: Run everyday at 17:00 for finance reminders

// Edge Function runtime is Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TELEGRAM_API = 'https://api.telegram.org/bot'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function money(value: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' }).format(value)
}

async function getTelegramToken(supabase: any) {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'telegram_bot_token')
    .maybeSingle()

  return (data?.value || Deno.env.get('TELEGRAM_BOT_TOKEN') || '').trim()
}

async function sendTelegramMessage(token: string, chatId: string, text: string, replyMarkup?: unknown) {
  if (!token || !chatId) return false
  const response = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    }),
  })
  const result = await response.json()
  return !!result.ok
}

function financeKeyboard(eventType: 'i' | 'e', eventId: string, appUrl: string, href: string) {
  return {
    inline_keyboard: [
      [
        { text: 'Подтвердить полностью', callback_data: `fin:paid:${eventType}:${eventId}` },
        { text: 'Частичная оплата', callback_data: `fin:partial:${eventType}:${eventId}` },
      ],
      [
        { text: 'Завтра', callback_data: `fin:post1:${eventType}:${eventId}` },
        { text: 'Через 3 дня', callback_data: `fin:post3:${eventType}:${eventId}` },
        { text: 'Через неделю', callback_data: `fin:post7:${eventType}:${eventId}` },
      ],
      [
        { text: 'Выбрать дату', callback_data: `fin:postc:${eventType}:${eventId}` },
        { text: 'Не подтвердить', callback_data: `fin:reject:${eventType}:${eventId}` },
      ],
      [{ text: 'Открыть в CRM', url: `${appUrl}${href}` }],
    ],
  }
}

async function wasFinanceNotificationSent(supabase: any, eventType: 'income' | 'expense', eventId: string, userId: string, notificationDate: string) {
  const { data } = await supabase
    .from('finance_telegram_notifications')
    .select('id')
    .eq('event_type', eventType)
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .eq('notification_date', notificationDate)
    .maybeSingle()

  return !!data
}

async function markFinanceNotificationSent(supabase: any, eventType: 'income' | 'expense', eventId: string, userId: string, notificationDate: string) {
  await supabase.from('finance_telegram_notifications').upsert({
    event_type: eventType,
    event_id: eventId,
    user_id: userId,
    notification_date: notificationDate,
    sent_at: new Date().toISOString(),
  }, { onConflict: 'event_type,event_id,user_id,notification_date' })
}

async function sendFinanceDailyReminders(supabase: any) {
  const token = await getTelegramToken(supabase)
  if (!token) {
    console.log('Finance Telegram reminder skipped: token is not configured')
    return 0
  }

  const notificationDate = todayISO()
  const appUrl = Deno.env.get('NEXT_PUBLIC_APP_URL') || Deno.env.get('APP_URL') || ''
  const { data: recipientsData, error: recipientsError } = await supabase
    .from('users')
    .select('id, full_name, telegram_chat_id')
    .eq('role', 'financial_director')
    .eq('is_active', true)
    .not('telegram_chat_id', 'is', null)

  if (recipientsError) throw recipientsError
  const recipients = (recipientsData || [])
    .filter((user: any) => user?.telegram_chat_id?.trim())

  if (recipients.length === 0) return 0

  const [{ data: incomes, error: incomesError }, { data: expenses, error: expensesError }] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, machine_id, amount, paid_amount, status, payment_date, due_date, rescheduled_date, machine:machines(name)')
      .neq('status', 'paid'),
    supabase
      .from('finance_expenses')
      .select('id, title, amount, paid_amount, status, planned_date, counterparty')
      .in('status', ['planned', 'partially_paid', 'overdue']),
  ])

  if (incomesError) throw incomesError
  if (expensesError) throw expensesError

  const incomeEvents = (incomes || [])
    .map((invoice: any) => ({
      eventType: 'income' as const,
      keyboardType: 'i' as const,
      id: invoice.id,
      href: invoice.machine_id ? `/sales-plan/${invoice.machine_id}` : '/invoices',
      plannedDate: invoice.rescheduled_date || invoice.due_date || invoice.payment_date,
      title: invoice.machine?.name || 'Планируемый приход',
      amount: Number(invoice.amount || 0) - Number(invoice.paid_amount || 0),
    }))
    .filter((event: any) => event.plannedDate && event.plannedDate <= notificationDate && event.amount > 0)

  const expenseEvents = (expenses || [])
    .map((expense: any) => ({
      eventType: 'expense' as const,
      keyboardType: 'e' as const,
      id: expense.id,
      href: '/finance/calendar',
      plannedDate: expense.planned_date,
      title: `${expense.title}${expense.counterparty ? ` · ${expense.counterparty}` : ''}`,
      amount: Number(expense.amount || 0) - Number(expense.paid_amount || 0),
    }))
    .filter((event: any) => event.plannedDate && event.plannedDate <= notificationDate && event.amount > 0)

  let sent = 0
  for (const recipient of recipients) {
    for (const event of [...incomeEvents, ...expenseEvents]) {
      if (await wasFinanceNotificationSent(supabase, event.eventType, event.id, recipient.id, notificationDate)) continue

      const text =
        `${event.eventType === 'income' ? 'Планируемый приход не подтвержден' : 'Планируемый расход не подтвержден'}\n\n` +
        `Событие: <b>${escapeHtml(event.title)}</b>\n` +
        `Дата: <b>${escapeHtml(event.plannedDate)}</b>\n` +
        `Сумма: <b>${escapeHtml(money(event.amount))}</b>`

      const ok = await sendTelegramMessage(token, recipient.telegram_chat_id, text, financeKeyboard(event.keyboardType, event.id, appUrl, event.href))
      if (ok) {
        await markFinanceNotificationSent(supabase, event.eventType, event.id, recipient.id, notificationDate)
        sent++
      }
    }
  }

  return sent
}

Deno.serve(async (req) => {
  const cronSecret = (Deno.env.get('DAILY_CHECK_SECRET') || Deno.env.get('CRON_SECRET') || '').trim()
  if (!cronSecret) {
    return new Response('DAILY_CHECK_SECRET or CRON_SECRET is required', { status: 503 })
  }

  const authHeader = req.headers.get('authorization')
  const headerSecret = req.headers.get('x-cron-secret')
  if (authHeader !== `Bearer ${cronSecret}` && headerSecret !== cronSecret) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response('Environment variables SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required', { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 1. Check and generate daily notifications (e.g. deadlines, stage overdues)
    const { error: notifError } = await supabase.rpc('check_daily_notifications')
    if (notifError) {
      console.error('Error running check_daily_notifications:', notifError)
    } else {
      console.log('Daily notifications checked successfully')
    }

    // 2. Check and auto-update invoices status (pending -> overdue)
    const { error: invoiceError } = await supabase.rpc('check_daily_invoices_overdue')
    if (invoiceError) {
      console.error('Error running check_daily_invoices_overdue:', invoiceError)
    } else {
      console.log('Daily invoices checked successfully')
    }

    // 2b. Check finance calendar overdue states and send Telegram reminders for unconfirmed events.
    const { error: financeError } = await supabase.rpc('check_daily_finance_overdue')
    if (financeError) {
      console.error('Error running check_daily_finance_overdue:', financeError)
    } else {
      const sentFinanceReminders = await sendFinanceDailyReminders(supabase)
      console.log(`Finance calendar checked successfully. Telegram reminders sent: ${sentFinanceReminders}`)
    }

    // 3. Refresh agenda pool and create a planning task when there are new items.
    const { data: agendaTasksCreated, error: agendaPoolError } = await supabase.rpc('fn_create_agenda_pool_distribution_tasks')
    if (agendaPoolError) {
      console.error('Error running fn_create_agenda_pool_distribution_tasks:', agendaPoolError)
    } else {
      console.log(`Agenda pool checked successfully. Created tasks: ${agendaTasksCreated ?? 0}`)
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Daily CRON check completed.' 
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
