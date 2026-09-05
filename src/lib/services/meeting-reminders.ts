import { getAppUrl } from '@/lib/config'
import { createAdminClient } from '@/lib/supabase/admin'
import { escapeHtml, sendTelegramMessage } from '@/lib/services/telegram'

const DEFAULT_LOOK_AHEAD_MINUTES = 6
const MAX_AGENDA_ITEMS_IN_MESSAGE = 15
const MAX_REMINDER_OFFSET_MINUTES = 10_080

type DbError = { message?: string; code?: string } | null
type DbResult = { data: unknown; error: DbError }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  gte: (column: string, value: unknown) => LooseQuery
  lte: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: Record<string, unknown>) => LooseQuery
  maybeSingle: () => Promise<DbResult>
  single: () => Promise<DbResult>
}
type LooseDb = { from: (table: string) => LooseQuery }
type ReminderDb = LooseDb & {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<DbResult>
}

type MeetingReminderMeeting = {
  id: string
  title: string | null
  starts_at: string
  meeting_date: string
  meeting_time: string
  template: Record<string, unknown> | Record<string, unknown>[] | null
  attendees: Array<{ user_id: string }>
  facilitator_user_id: string | null
}

type AgendaRow = {
  id: string
  assigned_meeting_id: string
  title: string
  description: string | null
  priority: string
}

type Recipient = {
  id: string
  full_name: string | null
  telegram_chat_id: string | null
}

export type MeetingReminderDispatchResult = {
  checkedMeetings: number
  eligibleMeetings: number
  recipients: number
  crmSent: number
  telegramSent: number
  skipped: number
  errors: Array<{
    meetingId: string
    userId: string
    channel: 'crm' | 'telegram'
    error: string
  }>
}

function relation(value: MeetingReminderMeeting['template']) {
  return (Array.isArray(value) ? value[0] : value) || {}
}

function rows(result: DbResult, label: string) {
  if (result.error) throw new Error(`${label}: ${result.error.message || 'ошибка базы данных'}`)
  return Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : []
}

function formatOffset(minutes: number) {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return days === 1 ? 'через 24 часа' : `через ${days} дн.`
  }
  if (minutes % 60 === 0) return `через ${minutes / 60} ч.`
  return `через ${minutes} мин.`
}

function formatMeetingDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Uzhgorod',
  }).format(new Date(value))
}

function truncateLine(value: string, maxLength = 220) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

export function buildMeetingAgendaReminderMessage(input: {
  meeting: MeetingReminderMeeting
  agendaItems: AgendaRow[]
  offsetMinutes: number
}) {
  const template = relation(input.meeting.template)
  const meetingName = input.meeting.title?.trim() || String(template.name || 'Совещание')
  const visible = input.agendaItems.slice(0, MAX_AGENDA_ITEMS_IN_MESSAGE)
  const agendaLines = visible.length
    ? visible.flatMap((item, index) => {
        const priority = item.priority === 'critical' ? '⚠️ ' : ''
        const result = [`${index + 1}. ${priority}${escapeHtml(truncateLine(item.title, 180))}`]
        if (item.description?.trim()) result.push(`   ${escapeHtml(truncateLine(item.description))}`)
        return result
      })
    : ['Повестка пока пустая.']
  const hidden = input.agendaItems.length - visible.length
  if (hidden > 0) agendaLines.push(`…и ещё ${hidden} вопросов`)
  return [
    `<b>Совещание ${formatOffset(input.offsetMinutes)}</b>`,
    '',
    `<b>${escapeHtml(meetingName)}</b>`,
    formatMeetingDate(input.meeting.starts_at),
    '',
    '<b>Повестка:</b>',
    ...agendaLines,
  ].join('\n')
}

async function claimReminderChannel(
  db: ReminderDb,
  meetingId: string,
  userId: string,
  offsetMinutes: number,
  channel: 'crm' | 'telegram',
) {
  const result = await db.rpc('claim_meeting_reminder_delivery_v2', {
    p_meeting_id: meetingId,
    p_user_id: userId,
    p_reminder_type: `agenda_${offsetMinutes}_min`,
    p_channel: channel,
  })
  if (result.error) return { id: null, error: result.error.message || 'Ошибка резерва' }
  return {
    id: typeof result.data === 'string' ? result.data : null,
    error: null,
  }
}

async function getAgendaByMeetingId(db: LooseDb, meetingIds: string[]) {
  const result = await db
    .from('meeting_questions')
    .select('id,assigned_meeting_id,title,description,priority')
    .in('assigned_meeting_id', meetingIds)
    .order('is_pinned', { ascending: false })
    .order('priority_rank', { ascending: false })
    .order('deadline', { ascending: true, nullsFirst: false })
    .order('opened_at', { ascending: true })
  const byMeeting = new Map<string, AgendaRow[]>()
  for (const row of rows(result, 'Не удалось загрузить повестки')) {
    const item = row as unknown as AgendaRow
    byMeeting.set(item.assigned_meeting_id, [...(byMeeting.get(item.assigned_meeting_id) || []), item])
  }
  return byMeeting
}

export async function dispatchMeetingAgendaReminders(options?: {
  now?: Date
  lookAheadMinutes?: number
}): Promise<MeetingReminderDispatchResult> {
  const db = createAdminClient() as unknown as ReminderDb
  const now = options?.now || new Date()
  const lookAheadMinutes = options?.lookAheadMinutes ?? DEFAULT_LOOK_AHEAD_MINUTES
  const result: MeetingReminderDispatchResult = {
    checkedMeetings: 0,
    eligibleMeetings: 0,
    recipients: 0,
    crmSent: 0,
    telegramSent: 0,
    skipped: 0,
    errors: [],
  }
  const meetingsResult = await db
    .from('meetings')
    .select(
      'id,title,starts_at,meeting_date,meeting_time,facilitator_user_id,template:meeting_templates(name,reminder_offsets_minutes,notification_channels),attendees:meeting_attendees(user_id)',
    )
    .eq('status', 'planned')
    .gte('starts_at', now.toISOString())
    .lte('starts_at', new Date(now.getTime() + MAX_REMINDER_OFFSET_MINUTES * 60_000).toISOString())
    .order('starts_at', { ascending: true })
  const meetings = rows(meetingsResult, 'Не удалось загрузить совещания') as unknown as MeetingReminderMeeting[]
  result.checkedMeetings = meetings.length
  const deliveries = meetings.flatMap((meeting) => {
    const template = relation(meeting.template)
    const offsets = Array.isArray(template.reminder_offsets_minutes)
      ? template.reminder_offsets_minutes.map(Number)
      : [1440, 30]
    const minutesUntil = (new Date(meeting.starts_at).getTime() - now.getTime()) / 60_000
    return offsets
      .filter((offset) => Number.isFinite(offset) && minutesUntil <= offset && minutesUntil > offset - lookAheadMinutes)
      .map((offsetMinutes) => ({ meeting, offsetMinutes }))
  })
  result.eligibleMeetings = new Set(deliveries.map(({ meeting }) => meeting.id)).size
  if (!deliveries.length) return result

  const meetingIds = [...new Set(deliveries.map(({ meeting }) => meeting.id))]
  const agendaByMeeting = await getAgendaByMeetingId(db, meetingIds)
  const recipientIds = [
    ...new Set(
      deliveries.flatMap(({ meeting }) => [
        meeting.facilitator_user_id || '',
        ...(meeting.attendees || []).map((attendee) => attendee.user_id),
      ]),
    ),
  ].filter(Boolean)
  const recipientsResult = recipientIds.length
    ? await db.from('users').select('id,full_name,telegram_chat_id').in('id', recipientIds)
    : { data: [], error: null }
  const recipients = new Map(
    rows(recipientsResult, 'Не удалось загрузить участников').map((row) => [
      String(row.id),
      row as unknown as Recipient,
    ]),
  )
  result.recipients = recipients.size
  const baseUrl = getAppUrl()

  for (const { meeting, offsetMinutes } of deliveries) {
    const template = relation(meeting.template)
    const channels = Array.isArray(template.notification_channels)
      ? template.notification_channels.map(String)
      : ['crm', 'telegram']
    const userIds = [
      ...new Set([meeting.facilitator_user_id || '', ...(meeting.attendees || []).map((attendee) => attendee.user_id)]),
    ].filter(Boolean)
    const meetingName = meeting.title?.trim() || String(template.name || 'Совещание')
    const message = `${meetingName} — ${formatMeetingDate(meeting.starts_at)}. Вопросов: ${(agendaByMeeting.get(meeting.id) || []).length}.`
    const telegramText = buildMeetingAgendaReminderMessage({
      meeting,
      agendaItems: agendaByMeeting.get(meeting.id) || [],
      offsetMinutes,
    })

    for (const userId of userIds) {
      if (channels.includes('crm')) {
        const claim = await claimReminderChannel(db, meeting.id, userId, offsetMinutes, 'crm')
        if (claim.error) {
          result.errors.push({
            meetingId: meeting.id,
            userId,
            channel: 'crm',
            error: claim.error,
          })
        } else if (!claim.id) {
          result.skipped += 1
        } else {
          const crmResult = await db.from('notifications').insert({
            user_id: userId,
            type: 'meeting_reminder',
            title: `Совещание ${formatOffset(offsetMinutes)}`,
            message,
            related_meeting_id: meeting.id,
          })
          if (crmResult.error) {
            await db
              .from('meeting_telegram_reminders')
              .update({
                crm_locked_at: null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', claim.id)
            result.errors.push({
              meetingId: meeting.id,
              userId,
              channel: 'crm',
              error: crmResult.error.message || 'Не удалось создать уведомление',
            })
          } else {
            await db
              .from('meeting_telegram_reminders')
              .update({
                crm_sent_at: new Date().toISOString(),
                crm_locked_at: null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', claim.id)
            result.crmSent += 1
          }
        }
      }
      if (channels.includes('telegram')) {
        const recipient = recipients.get(userId)
        if (!recipient?.telegram_chat_id?.trim()) {
          result.skipped += 1
          continue
        }
        const claim = await claimReminderChannel(db, meeting.id, userId, offsetMinutes, 'telegram')
        if (claim.error) {
          result.errors.push({
            meetingId: meeting.id,
            userId,
            channel: 'telegram',
            error: claim.error,
          })
          continue
        }
        if (!claim.id) {
          result.skipped += 1
          continue
        }
        const sent = await sendTelegramMessage(recipient.telegram_chat_id, telegramText, {
          parseMode: 'HTML',
          replyMarkup: {
            inline_keyboard: [
              [
                {
                  text: 'Открыть совещание',
                  url: `${baseUrl}/meetings/${meeting.id}`,
                },
              ],
            ],
          },
        })
        await db
          .from('meeting_telegram_reminders')
          .update({
            sent_at: sent.ok ? new Date().toISOString() : null,
            telegram_locked_at: null,
            telegram_error: sent.ok ? null : sent.error || 'Ошибка Telegram API',
            updated_at: new Date().toISOString(),
          })
          .eq('id', claim.id)
        if (sent.ok) result.telegramSent += 1
        else
          result.errors.push({
            meetingId: meeting.id,
            userId,
            channel: 'telegram',
            error: sent.error || 'Ошибка Telegram API',
          })
      }
    }
  }
  return result
}
