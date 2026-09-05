import { NextResponse } from 'next/server'
import { dispatchMeetingAgendaReminders } from '@/lib/services/meeting-reminders'
import { authorizeMeetingCron } from '@/lib/meetings-v2/cron-auth'

export const dynamic = 'force-dynamic'

async function runMeetingReminderDispatch(request: Request) {
  if (!(await authorizeMeetingCron(request))) {
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
