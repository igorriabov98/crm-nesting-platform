import { redirect } from 'next/navigation'
import { MyTasksView } from '@/components/features/tasks/MyTasksView'
import { getTasks } from '@/lib/actions/tasks'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { TASKS_LIST_LIMIT } from '@/lib/constants/performance-limits'

export const metadata = {
  title: 'Мои задачи | CRM Завода',
}

export default async function TasksPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [activeTasksResult, completedTasksResult] = await Promise.all([
    getTasks({
      assigned_to: user.id,
      statuses: ['pending', 'in_progress'],
      limit: TASKS_LIST_LIMIT,
    }),
    getTasks({
      assigned_to: user.id,
      status: 'completed',
      limit: TASKS_LIST_LIMIT,
    }),
  ])

  const error = activeTasksResult.error || completedTasksResult.error
  const tasks = [
    ...(activeTasksResult.data || []),
    ...(completedTasksResult.data || []),
  ]

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[#1B3A6B]">Мои задачи</h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Задачи по машинам, отсортированные по ближайшему дедлайну.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Ошибка загрузки задач: {error}
        </div>
      ) : (
        <MyTasksView tasks={tasks} resultLimit={TASKS_LIST_LIMIT} />
      )}
    </div>
  )
}
