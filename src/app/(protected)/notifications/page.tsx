import { withPagePermission } from '@/lib/permissions/page-guard'
import { getNotifications } from './actions'
import { NotificationList } from '@/components/features/notifications/NotificationList'

export const metadata = { title: 'Уведомления — CRM Завода' }

async function NotificationsPage({
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

export default withPagePermission('/notifications', NotificationsPage)
