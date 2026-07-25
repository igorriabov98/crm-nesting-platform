/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { processGmailHistory } from '@/lib/mail/sync'
import type { GmailAccountRow } from '@/lib/mail/gmail-api'

type PubSubEnvelope = {
  message?: {
    data?: string
    messageId?: string
    publishTime?: string
  }
}

export async function POST(request: NextRequest) {
  try {
    const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!bearer) return NextResponse.json({ ok: false }, { status: 401 })
    const tokenInfoResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(bearer)}`,
      { cache: 'no-store' },
    )
    const tokenInfo = await tokenInfoResponse.json()
    const expectedAudience = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') + '/api/mail/pubsub'
    if (
      !tokenInfoResponse.ok
      || !['accounts.google.com', 'https://accounts.google.com'].includes(tokenInfo.iss)
      || (process.env.NEXT_PUBLIC_APP_URL && tokenInfo.aud !== expectedAudience)
    ) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }
    const envelope = await request.json() as PubSubEnvelope
    if (!envelope.message?.data) return NextResponse.json({ ok: false }, { status: 400 })
    const decoded = JSON.parse(Buffer.from(envelope.message.data, 'base64').toString('utf8')) as {
      emailAddress?: string
      historyId?: string
    }
    if (!decoded.emailAddress || !decoded.historyId) return NextResponse.json({ ok: false }, { status: 400 })

    const db = createAdminClient() as any
    const { data: account } = await db.from('mail_accounts')
      .select('*')
      .eq('email_address', decoded.emailAddress)
      .is('disconnected_at', null)
      .maybeSingle()
    if (!account) return NextResponse.json({ ok: true })

    const providerEventId = envelope.message.messageId
      || createHash('sha256').update(`${decoded.emailAddress}:${decoded.historyId}`).digest('hex')
    const { data: event, error } = await db.from('mail_sync_events').upsert({
      account_id: account.id,
      provider_event_id: providerEventId,
      history_id: decoded.historyId,
      status: 'processing',
    }, { onConflict: 'account_id,provider_event_id', ignoreDuplicates: true }).select('id,status').maybeSingle()
    if (error) throw new Error(error.message)
    if (!event) return NextResponse.json({ ok: true, duplicate: true })

    try {
      await processGmailHistory(account as GmailAccountRow, decoded.historyId)
      await db.from('mail_sync_events').update({
        status: 'processed',
        processed_at: new Date().toISOString(),
        error: null,
      }).eq('id', event.id)
    } catch (error) {
      await db.from('mail_sync_events').update({
        status: 'failed',
        error: error instanceof Error ? error.message : 'Неизвестная ошибка',
      }).eq('id', event.id)
      throw error
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Ошибка синхронизации' },
      { status: 500 },
    )
  }
}
