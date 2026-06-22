import { UserCreateForm } from '@/components/features/users/UserCreateForm'
import { getUserCreatePageData } from '../actions'

export const metadata = {
  title: 'Новый пользователь — CRM Завода',
}

export default async function NewUserPage() {
  const { data, error } = await getUserCreatePageData()

  if (error || !data) {
    return (
      <div className="rounded-lg bg-red-500/10 p-4 text-[#DC2626]">
        Ошибка загрузки заводов: {error}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Регистрация в CRM</h1>
        <p className="text-sm text-[#6B7280]">
          Заполните форму, чтобы создать новый административный или рабочий профиль.
        </p>
      </div>

      <div className="pt-4">
        <UserCreateForm departments={data.departments} positions={data.positions} users={data.users} />
      </div>
    </div>
  )
}
