import { getNotifications } from './actions'
import { NotificationList } from '@/components/features/notifications/NotificationList'

export const metadata = { title: 'Уведомления — CRM Завода' }

export default async function NotificationsPage({
  searchParams
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  let data = []
  const resolvedSearchParams = await searchParams
  const factoryFilter = resolvedSearchParams?.factory || 'all'
  try {
    data = await getNotifications({ factoryFilter })
  } catch (e: any) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Уведомления</h1>
        <p className="text-[#DC2626]">Ошибка загрузки данных: {e.message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="max-w-4xl mx-auto w-full">
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Центр уведомлений</h1>
        <p className="text-[#6B7280] text-sm mt-1">
          Все предупреждения о сроках и изменения в статусах
        </p>
      </div>
      
      <NotificationList initialData={data} />
    </div>
  )
}
