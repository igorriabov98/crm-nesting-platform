import { NestingUploadForm } from '@/components/features/nesting/NestingUploadForm'
import { requirePermission } from '@/lib/permissions/server'

export const metadata = { title: 'Новая раскладка — CRM Завода' }

export default async function NewNestingProjectPage() {
  await requirePermission('nesting', 'manage')
  return <NestingUploadForm />
}
