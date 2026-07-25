/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { startGmailWatch } from '@/lib/mail/sync'
import type { GmailAccountRow } from '@/lib/mail/gmail-api'

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!expected || bearer !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const threshold = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  const db = createAdminClient() as any
  const { data: accounts, error } = await db.from('mail_accounts')
    .select('*')
    .is('disconnected_at', null)
    .or(`watch_expires_at.is.null,watch_expires_at.lt.${threshold}`)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const results = await Promise.allSettled((accounts || []).map((account: GmailAccountRow) => startGmailWatch(account)))
  return NextResponse.json({
    checked: accounts?.length || 0,
    renewed: results.filter((result) => result.status === 'fulfilled').length,
    failed: results.filter((result) => result.status === 'rejected').length,
  })
}
