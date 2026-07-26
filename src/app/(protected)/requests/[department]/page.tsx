import { notFound } from 'next/navigation'
import { DepartmentRequestsPage } from '@/components/features/department-requests/DepartmentRequestsPage'
import { getDepartmentRequestWorkspace } from '@/lib/actions/department-requests'
import { DEPARTMENT_REQUEST_TARGETS, isDepartmentRequestTarget } from '@/lib/department-requests'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ department: string }>
}) {
  const { department } = await params
  if (!isDepartmentRequestTarget(department)) return { title: 'Запросы | CRM Завода' }
  return { title: `Запросы · ${DEPARTMENT_REQUEST_TARGETS[department].label} | CRM Завода` }
}

export default async function DepartmentRequestsRoute({
  params,
  searchParams,
}: {
  params: Promise<{ department: string }>
  searchParams: Promise<{ view?: string; q?: string; page?: string; factory?: string }>
}) {
  const [{ department }, query] = await Promise.all([params, searchParams])
  if (!isDepartmentRequestTarget(department)) notFound()

  const workspace = await getDepartmentRequestWorkspace({
    target: department,
    view: query.view,
    query: query.q,
    page: Number(query.page || 0),
  })

  return (
    <DepartmentRequestsPage
      workspace={workspace}
      search={query.q || ''}
      factoryId={query.factory}
    />
  )
}
