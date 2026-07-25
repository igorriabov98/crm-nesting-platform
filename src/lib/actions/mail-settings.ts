'use server'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import { encryptMailSecret, maskSecret } from '@/lib/mail/crypto'
import { getMailSettings } from '@/lib/mail/config'
import { ROUTES } from '@/lib/constants/routes'

export async function getMailSettingsView() {
  await requirePermission('mail_settings', 'view')
  const settings = await getMailSettings()
  return {
    googleProjectId: settings?.google_project_id || '',
    clientId: settings?.oauth_client_id || '',
    clientSecretPreview: settings?.oauth_client_secret_encrypted ? '••••••••сохранён' : null,
    pubsubTopic: settings?.pubsub_topic || '',
    configured: Boolean(settings?.oauth_client_id && settings.oauth_client_secret_encrypted && settings.pubsub_topic),
  }
}

export async function saveMailSettings(input: {
  googleProjectId: string
  clientId: string
  clientSecret?: string
  pubsubTopic: string
}) {
  try {
    const { userId } = await requirePermission('mail_settings', 'manage')
    const googleProjectId = input.googleProjectId.trim()
    const clientId = input.clientId.trim()
    const pubsubTopic = input.pubsubTopic.trim()
    if (!googleProjectId || !clientId || !pubsubTopic) throw new Error('Заполните обязательные поля')
    if (!clientId.endsWith('.apps.googleusercontent.com')) throw new Error('OAuth Client ID выглядит некорректно')
    if (!pubsubTopic.startsWith('projects/') || !pubsubTopic.includes('/topics/')) {
      throw new Error('Pub/Sub topic должен иметь формат projects/PROJECT/topics/TOPIC')
    }

    const existing = await getMailSettings()
    const clientSecret = input.clientSecret?.trim()
    if (!existing?.oauth_client_secret_encrypted && !clientSecret) throw new Error('Введите OAuth Client Secret')
    const payload: Record<string, unknown> = {
      id: true,
      google_project_id: googleProjectId,
      oauth_client_id: clientId,
      pubsub_topic: pubsubTopic,
      configured_by: userId,
      updated_at: new Date().toISOString(),
    }
    if (clientSecret) payload.oauth_client_secret_encrypted = encryptMailSecret(clientSecret)
    const { error } = await (createAdminClient() as any)
      .from('mail_settings')
      .upsert(payload, { onConflict: 'id' })
    if (error) throw new Error(error.message)
    revalidatePath(ROUTES.ADMIN_MAIL_SETTINGS)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось сохранить настройки' }
  }
}

export async function testMailSettings(input: {
  clientId: string
  clientSecret?: string
  pubsubTopic: string
}) {
  try {
    await requirePermission('mail_settings', 'manage')
    const existing = await getMailSettings()
    const secretAvailable = Boolean(input.clientSecret?.trim() || existing?.oauth_client_secret_encrypted)
    if (!input.clientId.endsWith('.apps.googleusercontent.com')) throw new Error('Проверьте OAuth Client ID')
    if (!secretAvailable) throw new Error('OAuth Client Secret отсутствует')
    if (!/^projects\/[^/]+\/topics\/[^/]+$/.test(input.pubsubTopic.trim())) throw new Error('Проверьте имя Pub/Sub topic')
    return { success: true, message: `Конфигурация корректна. Secret: ${maskSecret(input.clientSecret) || 'сохранён'}` }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Проверка не выполнена' }
  }
}
