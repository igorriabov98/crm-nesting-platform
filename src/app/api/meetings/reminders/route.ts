import { NextResponse } from 'next/server'
import { dispatchMeetingAgendaReminders } from '@/lib/services/meeting-reminders'

export const dynamic = 'force-dynamic'

function isAuthorized(request: Request) {
  const secret = (process.env.MEETING_REMINDER_CRON_SECRET || process.env.CRON_SECRET || '').trim()
  if (!secret) return { ok: false as const, status: 503, error: 'Cron secret is not configured' }

  const authHeader = request.headers.get('authorization')
  const headerSecret = request.headers.get('x-cron-secret')
  const allowed = authHeader === `Bearer ${secret}` || headerSecret === secret
  return allowed
    ? { ok: true as const }
    : { ok: false as const, status: 401, error: 'Unauthorized' }
}

async function runMeetingReminderDispatch(request: Request) {
  const authorization = isAuthorized(request)
  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status })
  }

  try {
    const result = await dispatchMeetingAgendaReminders()
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Meeting reminders] Dispatch failed:', error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return runMeetingReminderDispatch(request)
}

export async function GET(request: Request) {
  return runMeetingReminderDispatch(request)
}
