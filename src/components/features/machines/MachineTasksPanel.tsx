import { TaskCards } from '@/components/features/tasks/TaskCards'
import type { TaskWithRelations } from '@/lib/actions/tasks'

interface MachineTasksPanelProps {
  tasks: TaskWithRelations[]
}

export function MachineTasksPanel({ tasks }: MachineTasksPanelProps) {
  return (
    <section className="rounded-xl border border-[#E8ECF0] bg-white p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-[#1B3A6B]">Задачи</h2>
        <p className="text-sm text-[#6B7280]">
          Автоматические задачи по снабжению, заявке технолога и подтверждению чертежей.
        </p>
      </div>
      <TaskCards tasks={tasks} compact />
    </section>
  )
}
