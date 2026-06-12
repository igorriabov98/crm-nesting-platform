import { getAppUrl } from '@/lib/config'
import { createAdminClient } from '@/lib/supabase/admin'
import { escapeHtml, sendTelegramMessage } from '@/lib/services/telegram'

const CRM_TIME_ZONE = 'Europe/Chisinau'
const AGENDA_REMINDER_TYPE = 'agenda_30_min'
const DEFAULT_LOOK_AHEAD_MINUTES = 30
const MAX_AGENDA_ITEMS_IN_MESSAGE = 15

type DbError = { message: string; code?: string } | null
type DbResult<T = unknown> = { data: T | null; error: DbError }
type LooseQuery<T = unknown> = PromiseLike<DbResult<T>> & {
  select: (columns?: string) => LooseQuery<T>
  insert: (values: unknown) => LooseQuery<T>
  update: (values: unknown) => LooseQuery<T>
  eq: (column: string, value: unknown) => LooseQuery<T>
  gte: (column: string, value: unknown) => LooseQuery<T>
  lte: (column: string, value: unknown) => LooseQuery<T>
  not: (column: string, operator: string, value: unknown) => LooseQuery<T>
  in: (column: string, values: unknown[]) => LooseQuery<T>
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery<T>
  maybeSingle: () => Promise<DbResult<T>>
  single: () => Promise<DbResult<T>>
}
type LooseDb = {
  from: <T = unknown>(table: string) => LooseQuery<T>
}

type MeetingReminderMeeting = {
  id: string
  meeting_type: string
  title: string | null
  meeting_date: string
  meeting_time: string
}

type MeetingTypeRow = {
  key: string
  label: string
}

type AgendaRow = {
  id: string
  meeting_id: string
  title: string
  description: string | null
  sort_order: number
  created_at: string | null
}

type PlanningDirector = {
  id: string
  full_name: string
  telegram_chat_id: string | null
}

type ReminderRow = {
  id: string
  sent_at: string | null
}

export type MeetingReminderDispatchResult = {
  checkedMeetings: number
  eligibleMeetings: number
  recipients: number
  sent: number
  skipped: number
  errors: Array<{ meetingId: string; userId: string; error: string }>
}

type ZonedDateParts = {
  date: string
  hour: number
  minute: number
  second: number
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function getZonedDateParts(date: Date): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: CRM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '0'

  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    hour: Number(value('hour')),
    minute: Number(value('minute')),
    second: Number(value('second')),
  }
}

function dateOrdinal(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86_400_000)
}

function addDays(date: string, days: number) {
  const result = new Date(`${date}T00:00:00.000Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return `${result.getUTCFullYear()}-${pad2(result.getUTCMonth() + 1)}-${pad2(result.getUTCDate())}`
}

function parseMeetingTime(value: string) {
  const [hours = '0', minutes = '0'] = value.split(':')
  return {
    hour: Number(hours),
    minute: Number(minutes),
  }
}

function getMinutesUntilMeeting(meeting: MeetingReminderMeeting, nowParts: ZonedDateParts) {
  const meetingTime = parseMeetingTime(meeting.meeting_time)
  const nowAbsoluteMinutes =
    dateOrdinal(nowParts.date) * 1440 +
    nowParts.hour * 60 +
    nowParts.minute +
    nowParts.second / 60
  const meetingAbsoluteMinutes =
    dateOrdinal(meeting.meeting_date) * 1440 + meetingTime.hour * 60 + meetingTime.minute

  return meetingAbsoluteMinutes - nowAbsoluteMinutes
}

function formatMeetingDate(date: string) {
  const [year, month, day] = date.split('-')
  return `${day}.${month}.${year}`
}

function formatMeetingTime(time: string) {
  const [hours = '00', minutes = '00'] = time.split(':')
  return `${hours}:${minutes}`
}

function truncateTelegramLine(value: string, maxLength = 260) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`
}

function buildMeetingAgendaReminderMessage(input: {
  meeting: MeetingReminderMeeting
  meetingLabel: string
  agendaItems: AgendaRow[]
}) {
  const meetingName = input.meeting.title?.trim() || input.meetingLabel || input.meeting.meeting_type
  const visibleItems = input.agendaItems.slice(0, MAX_AGENDA_ITEMS_IN_MESSAGE)
  const hiddenCount = input.agendaItems.length - visibleItems.length

  const agendaLines = visibleItems.length > 0
    ? visibleItems.flatMap((item, index) => {
        const lines = [`${index + 1}. ${escapeHtml(truncateTelegramLine(item.title, 180))}`]
        if (item.description?.trim()) {
          lines.push(`   ${escapeHtml(truncateTelegramLine(item.description, 220))}`)
        }
        return lines
      })
    : ['Повестка пока пустая.']

  if (hiddenCount > 0) {
    agendaLines.push(`...и еще ${hiddenCount} пунктов`)
  }

  return [
    '<b>Собрание через 30 минут</b>',
    '',
    `<b>${escapeHtml(meetingName)}</b>`,
    `Дата: ${formatMeetingDate(input.meeting.meeting_date)}`,
    `Время: ${formatMeetingTime(input.meeting.meeting_time)}`,
    '',
    '<b>Повестка:</b>',
    ...agendaLines,
  ].join('\n')
}

async function getMeetingTypeLabels(db: LooseDb, meetings: MeetingReminderMeeting[]) {
  const keys = Array.from(new Set(meetings.map((meeting) => meeting.meeting_type)))
  if (keys.length === 0) return new Map<string, string>()

  const { data, error } = await db
    .from('meeting_types')
    .select('key,label')
    .in('key', keys)

  if (error) {
    console.warn('[Meeting reminders] Failed to load meeting type labels:', error.message)
    return new Map<string, string>()
  }

  return new Map((data as MeetingTypeRow[] | null || []).map((row) => [row.key, row.label]))
}

async function getAgendaByMeetingId(db: LooseDb, meetingIds: string[]) {
  if (meetingIds.length === 0) return new Map<string, AgendaRow[]>()

  const { data, error } = await db
    .from('meeting_agenda_items')
    .select('id,meeting_id,title,description,sort_order,created_at')
    .in('meeting_id', meetingIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    console.warn('[Meeting reminders] Failed to load agenda items:', error.message)
    return new Map<string, AgendaRow[]>()
  }

  const byMeeting = new Map<string, AgendaRow[]>()
  for (const item of (data as AgendaRow[] | null) || []) {
    const items = byMeeting.get(item.meeting_id) || []
    items.push(item)
    byMeeting.set(item.meeting_id, items)
  }
  return byMeeting
}

async function reserveReminder(db: LooseDb, meetingId: string, userId: string) {
  const { data: existing, error: existingError } = await db
    .from('meeting_telegram_reminders')
    .select('id,sent_at')
    .eq('meeting_id', meetingId)
    .eq('user_id', userId)
    .eq('reminder_type', AGENDA_REMINDER_TYPE)
    .maybeSingle()

  if (existingError) {
    return { ok: false, skipped: false, error: existingError.message as string }
  }

  if ((existing as ReminderRow | null)?.sent_at) {
    return { ok: false, skipped: true, error: null }
  }

  if ((existing as ReminderRow | null)?.id) {
    return { ok: true, skipped: false, reminderId: (existing as ReminderRow).id, error: null }
  }

  const { data: inserted, error: insertError } = await db
    .from('meeting_telegram_reminders')
    .insert({
      meeting_id: meetingId,
      user_id: userId,
      reminder_type: AGENDA_REMINDER_TYPE,
    })
    .select('id')
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      return { ok: false, skipped: true, error: null }
    }
    return { ok: false, skipped: false, error: insertError.message as string }
  }

  return { ok: true, skipped: false, reminderId: (inserted as { id: string }).id, error: null }
}

export async function dispatchMeetingAgendaReminders(options?: {
  now?: Date
  lookAheadMinutes?: number
}): Promise<MeetingReminderDispatchResult> {
  const db = createAdminClient() as unknown as LooseDb
  const nowParts = getZonedDateParts(options?.now || new Date())
  const lookAheadMinutes = options?.lookAheadMinutes ?? DEFAULT_LOOK_AHEAD_MINUTES
  const tomorrow = addDays(nowParts.date, 1)
  const result: MeetingReminderDispatchResult = {
    checkedMeetings: 0,
    eligibleMeetings: 0,
    recipients: 0,
    sent: 0,
    skipped: 0,
    errors: [],
  }

  const { data: meetingsData, error: meetingsError } = await db
    .from('meetings')
    .select('id,meeting_type,title,meeting_date,meeting_time')
    .eq('status', 'planned')
    .gte('meeting_date', nowParts.date)
    .lte('meeting_date', tomorrow)
    .order('meeting_date', { ascending: true })
    .order('meeting_time', { ascending: true })

  if (meetingsError) {
    throw new Error(`Не удалось загрузить собрания: ${meetingsError.message}`)
  }

  const meetings = ((meetingsData as MeetingReminderMeeting[] | null) || [])
    .filter((meeting) => {
      const minutesUntil = getMinutesUntilMeeting(meeting, nowParts)
      return minutesUntil >= 0 && minutesUntil <= lookAheadMinutes
    })

  result.checkedMeetings = (meetingsData as MeetingReminderMeeting[] | null)?.length || 0
  result.eligibleMeetings = meetings.length
  if (meetings.length === 0) return result

  const { data: usersData, error: usersError } = await db
    .from('users')
    .select('id,full_name,telegram_chat_id')
    .eq('role', 'planning_director')
    .eq('is_active', true)
    .not('telegram_chat_id', 'is', null)

  if (usersError) {
    throw new Error(`Не удалось загрузить директора планирования: ${usersError.message}`)
  }

  const recipients = ((usersData as PlanningDirector[] | null) || [])
    .filter((user) => !!user.telegram_chat_id?.trim())

  result.recipients = recipients.length
  if (recipients.length === 0) return result

  const meetingTypeLabels = await getMeetingTypeLabels(db, meetings)
  const agendaByMeetingId = await getAgendaByMeetingId(db, meetings.map((meeting) => meeting.id))
  const baseUrl = getAppUrl()

  for (const meeting of meetings) {
    const meetingLabel = meetingTypeLabels.get(meeting.meeting_type) || meeting.meeting_type
    const agendaItems = agendaByMeetingId.get(meeting.id) || []
    const text = buildMeetingAgendaReminderMessage({ meeting, meetingLabel, agendaItems })
    const url = `${baseUrl}/meetings/${meeting.id}`

    for (const recipient of recipients) {
      const reservation = await reserveReminder(db, meeting.id, recipient.id)
      if (reservation.skipped) {
        result.skipped += 1
        continue
      }

      if (!reservation.ok || !reservation.reminderId) {
        result.errors.push({
          meetingId: meeting.id,
          userId: recipient.id,
          error: reservation.error || 'Не удалось создать запись напоминания',
        })
        continue
      }

      const sendResult = await sendTelegramMessage(recipient.telegram_chat_id!, text, {
        parseMode: 'HTML',
        replyMarkup: {
          inline_keyboard: [[{ text: 'Открыть собрание', url }]],
        },
      })

      const updatePayload = sendResult.ok
        ? { sent_at: new Date().toISOString(), telegram_error: null, updated_at: new Date().toISOString() }
        : { telegram_error: sendResult.error || 'Telegram API вернул ошибку', updated_at: new Date().toISOString() }

      await db
        .from('meeting_telegram_reminders')
        .update(updatePayload)
        .eq('id', reservation.reminderId)

      if (sendResult.ok) {
        result.sent += 1
      } else {
        result.errors.push({
          meetingId: meeting.id,
          userId: recipient.id,
          error: sendResult.error || 'Telegram API вернул ошибку',
        })
      }
    }
  }

  return result
}
