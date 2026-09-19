import { withPagePermission } from '@/lib/permissions/page-guard'
import { redirect } from 'next/navigation'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'

async function SuppliersCompatibilityPage() {
  await requirePermission('suppliers', 'view')
  redirect(ROUTES.ADMIN_DATABASE)
}

export default withPagePermission('/admin/suppliers', SuppliersCompatibilityPage)
