import 'server-only'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from '@/lib/supabase/admin'
import { readMailVaultSecret } from './vault'

export type MailSettingsRow = {
  google_project_id: string | null
  oauth_client_id: string | null
  oauth_client_secret_vault_id: string | null
  pubsub_topic: string | null
}

export async function getMailSettings() {
  const { data, error } = await (createAdminClient() as any)
    .from('mail_settings')
    .select('google_project_id, oauth_client_id, oauth_client_secret_vault_id, pubsub_topic')
    .eq('id', true)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data || null) as MailSettingsRow | null
}

export async function requireMailSettings() {
  const settings = await getMailSettings()
  if (!settings?.oauth_client_id || !settings.oauth_client_secret_vault_id || !settings.pubsub_topic) {
    throw new Error('Интеграция Gmail ещё не настроена администратором')
  }
  return {
    googleProjectId: settings.google_project_id,
    clientId: settings.oauth_client_id,
    clientSecret: await readMailVaultSecret(settings.oauth_client_secret_vault_id),
    pubsubTopic: settings.pubsub_topic,
  }
}

export function mailBaseUrl(requestUrl?: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (configured) return configured
  if (requestUrl) return new URL(requestUrl).origin
  return 'http://localhost:3000'
}
