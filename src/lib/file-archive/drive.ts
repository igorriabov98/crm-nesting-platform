import 'server-only'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from '@/lib/supabase/admin'
import { readMailVaultSecret, storeMailVaultSecret } from '@/lib/mail/vault'
import { requireDriveOAuthSettings } from './config'

export type DriveConnectionRow = {
  id: string
  email: string
  access_token_vault_id: string | null
  refresh_token_vault_id: string
  token_expires_at: string | null
}
export async function getDriveAccessToken(connection: DriveConnectionRow) {
  if (
    connection.access_token_vault_id
    && connection.token_expires_at
    && new Date(connection.token_expires_at).getTime() > Date.now() + 60_000
  ) {
    return readMailVaultSecret(connection.access_token_vault_id)
  }

  const settings = await requireDriveOAuthSettings()
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      refresh_token: await readMailVaultSecret(connection.refresh_token_vault_id),
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  })
  const payload = await response.json()
  if (!response.ok || !payload.access_token) {
    await (createAdminClient() as any).from('file_archive_connections').update({
      status: 'error',
      last_error: payload.error_description || 'Google отклонил обновление токена',
    }).eq('id', connection.id)
    throw new Error(payload.error_description || 'Google Drive отключён. Подключите аккаунт снова.')
  }

  const accessTokenVaultId = await storeMailVaultSecret({
    secretId: connection.access_token_vault_id,
    secret: payload.access_token,
    name: `drive-access-${connection.id}`,
    description: `Google Drive access token for archive connection ${connection.id}`,
  })
  await (createAdminClient() as any).from('file_archive_connections').update({
    access_token_vault_id: accessTokenVaultId,
    token_expires_at: new Date(Date.now() + Number(payload.expires_in || 3600) * 1000).toISOString(),
    last_verified_at: new Date().toISOString(),
    last_error: null,
  }).eq('id', connection.id)
  return payload.access_token as string
}

export async function driveFetch(connection: DriveConnectionRow, url: string, init?: RequestInit) {
  const token = await getDriveAccessToken(connection)
  return fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init?.headers },
    cache: 'no-store',
  })
}
