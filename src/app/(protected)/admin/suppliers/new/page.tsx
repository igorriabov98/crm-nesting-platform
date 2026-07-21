import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/permissions/server'
import { getSupplierCreateHref } from '@/lib/suppliers/directory'

export default async function NewSupplierCompatibilityPage() {
  await requirePermission('suppliers', 'manage')
  redirect(getSupplierCreateHref('all'))
}
