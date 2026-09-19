import { OrganizationWorkspace } from '@/components/features/organization/OrganizationWorkspace'
import { AccessUnavailable } from '@/components/ui/AccessUnavailable'
import { getOrganizationData } from '@/lib/actions/organization'
import { withPagePermission } from '@/lib/permissions/page-guard'
async function OrganizationPage() {
  const {data}=await getOrganizationData()
  if(!data)return <AccessUnavailable />
  return <OrganizationWorkspace data={data}/>
}
export default withPagePermission('/admin/organization', OrganizationPage)
