import { AccessDenied } from '@/components/ui/AccessDenied'
import { FileArchiveSettingsPage } from '@/components/features/settings/FileArchiveSettingsPage'
import { getFileArchiveDashboard } from '@/lib/actions/file-archive'
import { requirePermission } from '@/lib/permissions/server'
import { hasPermission } from '@/lib/permissions/resources'

export const metadata = { title: 'Архив файлов — CRM Завода' }
export const dynamic = 'force-dynamic'

export default async function FileArchiveSettingsRoute() {
  const context = await requirePermission('file_archive_settings', 'view').catch(() => null)
  if (!context) return <AccessDenied />
  return (
    <FileArchiveSettingsPage
      initial={await getFileArchiveDashboard()}
      canManage={hasPermission(context.permissions, 'file_archive_settings', 'manage')}
    />
  )
}
