/* eslint-disable @typescript-eslint/no-explicit-any */
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserContext } from '@/lib/auth/current-user'
import { mailBaseUrl, requireMailSettings } from '@/lib/mail/config'
import { encryptMailSecret } from '@/lib/mail/crypto'
import { startGmailWatch, syncGmailLabels, syncGmailPage } from '@/lib/mail/sync'
import type { GmailAccountRow } from '@/lib/mail/gmail-api'

export async function GET(request: NextRequest) {
  const destination = new URL('/mail', request.url)
  try {
    const context = await getCurrentUserContext()
    if (!context) throw new Error('Сессия CRM истекла')
    const cookieStore = await cookies()
    const expectedState = cookieStore.get('gmail_oauth_state')?.value
    const state = request.nextUrl.searchParams.get('state')
    const code = request.nextUrl.searchParams.get('code')
    const oauthError = request.nextUrl.searchParams.get('error')
    cookieStore.delete('gmail_oauth_state')
    if (oauthError) throw new Error(oauthError === 'access_denied' ? 'Подключение Gmail отменено' : oauthError)
    if (!expectedState || !state || state !== expectedState) throw new Error('Проверка безопасности OAuth не пройдена')
    if (!code) throw new Error('Google не вернул код авторизации')

    const settings = await requireMailSettings()
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        redirect_uri: `${mailBaseUrl(request.url)}/api/mail/oauth/callback`,
        grant_type: 'authorization_code',
      }),
      cache: 'no-store',
    })
    const tokens = await tokenResponse.json()
    if (!tokenResponse.ok || !tokens.access_token) throw new Error(tokens.error_description || 'Google не выдал токен')

    const profileResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      cache: 'no-store',
    })
    const profile = await profileResponse.json()
    if (!profileResponse.ok || !profile.emailAddress) throw new Error('Не удалось получить адрес Gmail')

    const db = createAdminClient() as any
    const { data: previous } = await db.from('mail_accounts')
      .select('refresh_token_encrypted')
      .eq('user_id', context.user.id)
      .maybeSingle()
    const refreshTokenEncrypted = tokens.refresh_token
      ? encryptMailSecret(tokens.refresh_token)
      : previous?.refresh_token_encrypted
    if (!refreshTokenEncrypted) throw new Error('Google не выдал refresh token. Отзовите доступ приложения и подключите Gmail снова.')

    const { data: account, error } = await db.from('mail_accounts').upsert({
      user_id: context.user.id,
      email_address: profile.emailAddress,
      access_token_encrypted: encryptMailSecret(tokens.access_token),
      refresh_token_encrypted: refreshTokenEncrypted,
      token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
      gmail_history_id: profile.historyId || null,
      sync_status: 'syncing',
      sync_error: null,
      disconnected_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }).select('*').single()
    if (error) throw new Error(error.message)

    await Promise.all([
      syncGmailPage(account as GmailAccountRow, { labelId: 'INBOX', maxResults: 50 }),
      startGmailWatch(account as GmailAccountRow),
      syncGmailLabels(account as GmailAccountRow),
    ])
    destination.searchParams.set('connected', '1')
  } catch (error) {
    destination.searchParams.set('error', error instanceof Error ? error.message : 'Не удалось подключить Gmail')
  }
  return NextResponse.redirect(destination)
}
