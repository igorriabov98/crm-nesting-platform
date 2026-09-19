import { withPagePermission } from '@/lib/permissions/page-guard'
import { headers } from 'next/headers'
import { AccessDenied } from '@/components/ui/AccessDenied'
import { MailSettingsPage } from '@/components/features/settings/MailSettingsPage'
import { getMailSettingsView } from '@/lib/actions/mail-settings'
import { requirePermission } from '@/lib/permissions/server'
import { mailBaseUrl } from '@/lib/mail/config'

export const metadata = { title: 'Настройки почты — CRM Завода' }

async function MailSettingsRoute() {
  const allowed = await requirePermission('mail_settings', 'view').then(() => true).catch(() => false)
  if (!allowed) return <AccessDenied />
  const headerStore = await headers()
  const host = headerStore.get('x-forwarded-host') || headerStore.get('host') || 'localhost:3000'
  const protocol = headerStore.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  const initial = await getMailSettingsView()
  return <MailSettingsPage initial={initial} appUrl={mailBaseUrl(`${protocol}://${host}`)} />
}

export default withPagePermission('/admin/settings/mail', MailSettingsRoute)
