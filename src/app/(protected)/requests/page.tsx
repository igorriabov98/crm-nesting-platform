import { DepartmentRequestsPage } from '@/components/features/department-requests/DepartmentRequestsPage'
import {
  getMyDepartmentRequestWorkspace,
} from '@/lib/actions/department-requests'
import { normalizeDepartmentRequestFilters } from '@/lib/department-requests'

export const metadata = {
  title: 'Запросы | CRM Завода',
}

export default async function MyDepartmentRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    status?: string
    target?: string
    deadline?: string
    order?: string
    tab?: string
    page?: string
    factory?: string
  }>
}) {
  const query = await searchParams
  const workspace = await getMyDepartmentRequestWorkspace(
    normalizeDepartmentRequestFilters(query),
  )

  return <DepartmentRequestsPage workspace={workspace} factoryId={query.factory} />
}
