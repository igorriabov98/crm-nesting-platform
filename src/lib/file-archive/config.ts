import 'server-only'

import { getMailSettings } from '@/lib/mail/config'
import { readMailVaultSecret } from '@/lib/mail/vault'

export async function requireDriveOAuthSettings() {
  const settings = await getMailSettings()
  if (!settings?.oauth_client_id || !settings.oauth_client_secret_vault_id) {
    throw new Error('Сначала настройте Google OAuth в разделе «Почта»')
  }
  return {
    clientId: settings.oauth_client_id,
    clientSecret: await readMailVaultSecret(settings.oauth_client_secret_vault_id),
  }
}
export function fileArchiveBaseUrl(requestUrl?: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (configured) return configured
  if (requestUrl) return new URL(requestUrl).origin
  return 'http://localhost:3000'
}
