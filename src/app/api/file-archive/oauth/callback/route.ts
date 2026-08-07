/* eslint-disable @typescript-eslint/no-explicit-any */
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fileArchiveBaseUrl, requireDriveOAuthSettings } from '@/lib/file-archive/config'
import { deleteMailVaultSecret, storeMailVaultSecret } from '@/lib/mail/vault'

export async function GET(request: NextRequest) {
  const destination = new URL('/admin/settings/file-archive', request.url)
  try {
    const { userId } = await requirePermission('file_archive_settings', 'manage')
    const cookieStore = await cookies()
    const expectedState = cookieStore.get('file_archive_oauth_state')?.value
    const state = request.nextUrl.searchParams.get('state')
    const code = request.nextUrl.searchParams.get('code')
    const oauthError = request.nextUrl.searchParams.get('error')
    cookieStore.delete('file_archive_oauth_state')
    if (oauthError) throw new Error(oauthError === 'access_denied' ? 'Подключение Google Drive отменено' : oauthError)
    if (!expectedState || !state || expectedState !== state) throw new Error('Проверка безопасности OAuth не пройдена')
    if (!code) throw new Error('Google не вернул код авторизации')

    const settings = await requireDriveOAuthSettings()
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        redirect_uri: `${fileArchiveBaseUrl(request.url)}/api/file-archive/oauth/callback`,
        grant_type: 'authorization_code',
      }),
      cache: 'no-store',
    })
    const tokens = await response.json()
    if (!response.ok || !tokens.access_token || !tokens.refresh_token) {
      throw new Error(tokens.error_description || 'Google не выдал offline-доступ')
    }
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      cache: 'no-store',
    })
    const profile = await profileResponse.json()
    if (!profileResponse.ok || !profile.email) throw new Error('Не удалось определить Google-аккаунт')

    const db = createAdminClient() as any
    const connectionId = crypto.randomUUID()
    const refreshTokenVaultId = await storeMailVaultSecret({
      secret: tokens.refresh_token,
      name: `drive-refresh-${connectionId}`,
      description: `Google Drive refresh token for archive connection ${connectionId}`,
    })
    const accessTokenVaultId = await storeMailVaultSecret({
      secret: tokens.access_token,
      name: `drive-access-${connectionId}`,
      description: `Google Drive access token for archive connection ${connectionId}`,
    })

    const { error: insertError } = await db.rpc('file_archive_activate_connection', {
      p_id: connectionId,
      p_email: profile.email,
      p_display_name: profile.name || null,
      p_access_token_vault_id: accessTokenVaultId,
      p_refresh_token_vault_id: refreshTokenVaultId,
      p_token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
      p_connected_by: userId,
    })
    if (insertError) {
      await Promise.allSettled([
        deleteMailVaultSecret(accessTokenVaultId),
        deleteMailVaultSecret(refreshTokenVaultId),
      ])
      throw new Error(insertError.message)
    }
    destination.searchParams.set('connected', '1')
  } catch (error) {
    destination.searchParams.set('error', error instanceof Error ? error.message : 'Не удалось подключить Google Drive')
  }
  return NextResponse.redirect(destination)
}
