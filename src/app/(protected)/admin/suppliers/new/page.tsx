import { withPagePermission } from '@/lib/permissions/page-guard'
import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/permissions/server'
import { getSupplierCreateHref } from '@/lib/suppliers/directory'

async function NewSupplierCompatibilityPage() {
  await requirePermission('suppliers', 'manage')
  redirect(getSupplierCreateHref('all'))
}

export default withPagePermission('/admin/suppliers/new', NewSupplierCompatibilityPage)
