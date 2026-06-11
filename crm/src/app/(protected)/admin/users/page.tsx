import { getUsersPageData } from './actions'
import { UserTable } from '@/components/features/users/UserTable'

export const metadata = {
  title: 'Управление пользователями — CRM Завода',
}

export default async function AdminUsersPage() {
  const { data, error } = await getUsersPageData()

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-red-500/10 p-4 text-[#DC2626]">
          Ошибка загрузки пользователей: {error}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1B3A6B]">Пользователи</h1>
          <p className="text-sm text-[#6B7280]">
            Управление доступом сотрудников к CRM системе завода.
          </p>
        </div>
      </div>

      <UserTable users={data.users} factories={data.factories} currentUser={data.currentUser} />
    </div>
  )
}
