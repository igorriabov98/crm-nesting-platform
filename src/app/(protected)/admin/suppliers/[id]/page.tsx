import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/permissions/server'
import { getSupplierEditHref } from '@/lib/suppliers/directory'

export default async function EditSupplierCompatibilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requirePermission('suppliers', 'manage')
  redirect(getSupplierEditHref('all', id))
}
