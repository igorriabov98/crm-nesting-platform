import { withPagePermission } from '@/lib/permissions/page-guard'
import { NestingUploadForm } from '@/components/features/nesting/NestingUploadForm'
import { requirePermission } from '@/lib/permissions/server'

export const metadata = { title: 'Новая раскладка — CRM Завода' }

async function NewNestingProjectPage() {
  await requirePermission('nesting', 'manage')
  return <NestingUploadForm />
}

export default withPagePermission('/nesting/new', NewNestingProjectPage)
