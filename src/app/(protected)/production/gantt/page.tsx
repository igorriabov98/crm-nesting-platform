import { withPagePermission } from '@/lib/permissions/page-guard'
import { redirect } from 'next/navigation'

import { ROUTES } from '@/lib/constants/routes'

export const metadata = { title: 'Производство — CRM Завода' }

function GanttPage() {
  redirect(ROUTES.PRODUCTION)
}

export default withPagePermission('/production/gantt', GanttPage)
