import { redirect } from 'next/navigation'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'

export default async function SuppliersCompatibilityPage() {
  await requirePermission('suppliers', 'view')
  redirect(ROUTES.ADMIN_DATABASE)
}
