import { AccessDenied } from '@/components/ui/AccessDenied'
import { AISettingsPage } from '@/components/features/nesting/AISettingsPage'
import { requirePermission } from '@/lib/permissions/server'
import { getAISettings, getAIUsage } from '@/lib/nesting/api'

export const metadata = {
  title: 'Настройки AI — CRM Завода',
}

export default async function NestingAISettingsRoute() {
  const allowed = await requirePermission('nesting_settings', 'view')
    .then(() => true)
    .catch(() => false)
  if (!allowed) return <AccessDenied />

  const [settings, usage] = await Promise.all([
    getAISettings(),
    getAIUsage(50),
  ])

  return <AISettingsPage initialSettings={settings} initialUsage={usage.data} />
}
