// Корневая страница — редирект на /dashboard
// Middleware определит куда направить: /login или /dashboard
import { redirect } from 'next/navigation'
import { ROUTES } from '@/lib/constants/routes'

export default function RootPage() {
  redirect(ROUTES.DASHBOARD)
}
