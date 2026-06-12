import { AccessDenied } from '@/components/ui/AccessDenied'
import { TelegramSettingsPage } from '@/components/features/settings/TelegramSettingsPage'
import { getTelegramStatus, getUsersWithTelegram } from '@/lib/actions/telegram-settings'
import { requirePermission } from '@/lib/permissions/server'

export const metadata = {
  title: 'Настройки Telegram - CRM Завода',
}

export default async function TelegramSettingsRoute() {
  const allowed = await requirePermission('telegram_settings', 'view')
    .then(() => true)
    .catch(() => false)
  if (!allowed) return <AccessDenied />

  const status = await getTelegramStatus()
  const usersResult = status.configured ? await getUsersWithTelegram() : { data: [], error: null }

  return (
    <TelegramSettingsPage
      status={{
        configured: status.configured,
        tokenPreview: status.tokenPreview,
        tokenSource: status.tokenSource,
        botUsername: status.botUsername,
        error: status.error || usersResult.error,
      }}
      users={usersResult.data || []}
    />
  )
}
