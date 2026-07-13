import { getNotifications } from './actions'
import { NotificationList } from '@/components/features/notifications/NotificationList'

export const metadata = { title: 'Уведомления — CRM Завода' }

export default async function NotificationsPage({
  searchParams
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const factoryFilter = resolvedSearchParams?.factory || 'all'
  const data = await getNotifications({ factoryFilter })

  return (
    <div className="w-full">
      <NotificationList initialData={data} />
    </div>
  )
}
