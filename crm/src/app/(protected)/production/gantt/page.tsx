import { redirect } from 'next/navigation'

import { ROUTES } from '@/lib/constants/routes'

export const metadata = { title: 'Производство — CRM Завода' }

export default function GanttPage() {
  redirect(ROUTES.PRODUCTION)
}
