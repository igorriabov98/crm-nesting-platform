import { withPagePermission } from '@/lib/permissions/page-guard'
import { AccessDenied } from '@/components/ui/AccessDenied'
import { RolePermissionsPage } from '@/components/features/settings/RolePermissionsPage'
import { getRolePermissionsPageData } from '@/lib/actions/role-permissions'

export const metadata = {
  title: 'Права доступа - CRM Завода',
}

async function AccessSettingsRoute() {
  const { data, error } = await getRolePermissionsPageData()

  if (error || !data) {
    return <AccessDenied />
  }

  return <RolePermissionsPage data={data} />
}

export default withPagePermission('/admin/settings/access', AccessSettingsRoute)
