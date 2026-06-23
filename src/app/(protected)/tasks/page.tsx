import { redirect } from 'next/navigation'
import { MyTasksView } from '@/components/features/tasks/MyTasksView'
import { getTaskDelegationOverview, getTasks } from '@/lib/actions/tasks'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { TASKS_LIST_LIMIT } from '@/lib/constants/performance-limits'

export const metadata = {
  title: 'Мои задачи | CRM Завода',
}

export default async function TasksPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [activeTasksResult, completedTasksResult, delegationOverviewResult] = await Promise.all([
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
    getTaskDelegationOverview(),
  ])

  const taskError = activeTasksResult.error || completedTasksResult.error
  const delegationError = delegationOverviewResult.error
  const tasks = [
    ...(activeTasksResult.data || []),
    ...(completedTasksResult.data || []),
  ]

  return (
    <div className="w-full">
      {taskError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Ошибка загрузки задач: {taskError}
        </div>
      ) : (
        <div className="space-y-4">
          {delegationError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Делегированные задачи временно не загрузились: {delegationError}
            </div>
          )}
          <MyTasksView
            tasks={tasks}
            incomingDelegations={delegationOverviewResult.data?.incoming || []}
            outgoingDelegations={delegationOverviewResult.data?.outgoing || []}
            resultLimit={TASKS_LIST_LIMIT}
          />
        </div>
      )}
    </div>
  )
}
