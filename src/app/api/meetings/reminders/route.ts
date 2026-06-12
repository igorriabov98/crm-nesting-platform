import { NextResponse } from 'next/server'
import { dispatchMeetingAgendaReminders } from '@/lib/services/meeting-reminders'

export const dynamic = 'force-dynamic'

function isAuthorized(request: Request) {
  const secret = process.env.MEETING_REMINDER_CRON_SECRET || process.env.CRON_SECRET
  if (!secret) return true

  const authHeader = request.headers.get('authorization')
  const headerSecret = request.headers.get('x-cron-secret')
  return authHeader === `Bearer ${secret}` || headerSecret === secret
}

async function runMeetingReminderDispatch(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
