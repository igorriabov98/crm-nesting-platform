import { AccessDenied } from '@/components/ui/AccessDenied'
import { FeatureFlagsSettingsPage } from '@/components/features/settings/FeatureFlagsSettingsPage'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { getFeatureFlagAdminDashboard } from '@/lib/feature-flags/admin'
import { getCurrentUserPermissions } from '@/lib/permissions/server'

export const metadata = {
  title: 'Фичефлаги - CRM Завода',
}

export default async function FeatureFlagsSettingsRoute() {
  const { user } = await getCurrentUserContextOrRedirect()
  const permissionDetails = await getCurrentUserPermissions(user.id)
  if (!permissionDetails.isAdminPosition) return <AccessDenied />

  const initial = await getFeatureFlagAdminDashboard()
  return <FeatureFlagsSettingsPage initial={initial} />
}
