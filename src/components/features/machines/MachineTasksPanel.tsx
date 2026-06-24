import { TaskCards } from '@/components/features/tasks/TaskCards'
import type { TaskWithRelations } from '@/lib/actions/tasks'

interface MachineTasksPanelProps {
  tasks: TaskWithRelations[]
}

export function MachineTasksPanel({ tasks }: MachineTasksPanelProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-950">Задачи</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          Автоматические задачи по снабжению, заявке технолога и подтверждению чертежей.
        </p>
      </div>
      <TaskCards tasks={tasks} compact />
    </section>
  )
}
