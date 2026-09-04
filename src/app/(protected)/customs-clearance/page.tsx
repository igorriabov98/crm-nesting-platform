import { AccessDenied } from '@/components/ui/AccessDenied'
import { CustomsClearanceWorkspace } from '@/components/features/customs-clearance/CustomsClearanceWorkspace'
import { loadCustomsClearanceWorkspace } from '@/lib/actions/customs-clearance'
import { PermissionDeniedError } from '@/lib/permissions/server'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Затамаживание | CRM Завода' }

async function loadPageData() {
  try {
    return { workspace: await loadCustomsClearanceWorkspace(), denied: false as const }
  } catch (error) {
    if (error instanceof PermissionDeniedError) return { workspace: null, denied: true as const }
    throw error
  }
}

export default async function CustomsClearancePage() {
  const result = await loadPageData()
  if (result.denied) return <AccessDenied />
  return <CustomsClearanceWorkspace {...result.workspace} />
}
