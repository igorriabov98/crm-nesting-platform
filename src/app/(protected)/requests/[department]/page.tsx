import { notFound, redirect } from 'next/navigation'
import { DepartmentRequestsPage } from '@/components/features/department-requests/DepartmentRequestsPage'
import {
  getDepartmentRequestWorkspace,
} from '@/lib/actions/department-requests'
import {
  DEPARTMENT_REQUEST_TARGETS,
  isDepartmentRequestTarget,
  normalizeDepartmentRequestFilters,
} from '@/lib/department-requests'
import { ROUTES } from '@/lib/constants/routes'

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
  searchParams: Promise<{
    q?: string
    status?: string
    deadline?: string
    order?: string
    assignee?: string
    tab?: string
    page?: string
    factory?: string
  }>
}) {
  const [{ department }, query] = await Promise.all([params, searchParams])
  if (!isDepartmentRequestTarget(department)) notFound()
  if (department === 'planning') {
    const requestParams = new URLSearchParams()
    if (query.factory) requestParams.set('factory', query.factory)
    redirect(requestParams.size > 0 ? `${ROUTES.REQUESTS}?${requestParams.toString()}` : ROUTES.REQUESTS)
  }

  let workspace
  try {
    workspace = await getDepartmentRequestWorkspace({
      target: department,
      filters: normalizeDepartmentRequestFilters(query),
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('Недостаточно прав')) notFound()
    throw error
  }

  return (
    <DepartmentRequestsPage
      workspace={workspace}
      factoryId={query.factory}
    />
  )
}
