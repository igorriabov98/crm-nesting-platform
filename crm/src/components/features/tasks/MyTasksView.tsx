'use client'

import { useMemo, useState } from 'react'
import { LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TaskCards } from './TaskCards'
import type { TaskWithRelations } from '@/lib/actions/tasks'

type TaskTab = 'active' | 'completed' | 'all'
type TaskViewMode = 'cards' | 'list'

interface MyTasksViewProps {
  tasks: TaskWithRelations[]
  resultLimit?: number
}

export function MyTasksView({ tasks, resultLimit }: MyTasksViewProps) {
  const [tab, setTab] = useState<TaskTab>('active')
  const [viewMode, setViewMode] = useState<TaskViewMode>('cards')
  const activeTasksCount = useMemo(
    () => tasks.filter((task) => ['pending', 'in_progress'].includes(task.status)).length,
    [tasks]
  )

  const filteredTasks = useMemo(() => {
    if (tab === 'active') return tasks.filter((task) => ['pending', 'in_progress'].includes(task.status))
    if (tab === 'completed') return tasks.filter((task) => task.status === 'completed')
    return tasks
  }, [tab, tasks])

  const tabs: { value: TaskTab; label: string }[] = [
    { value: 'active', label: 'Активные' },
    { value: 'completed', label: 'Завершённые' },
    { value: 'all', label: 'Все' },
  ]

  const viewModes: { value: TaskViewMode; label: string; icon: typeof LayoutGrid }[] = [
    { value: 'cards', label: 'Карточки', icon: LayoutGrid },
    { value: 'list', label: 'Список', icon: List },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {tabs.map((item) => (
            <Button
              key={item.value}
              type="button"
              variant={tab === item.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTab(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <div className="flex rounded-md border border-[#E8ECF0] bg-white p-1">
          {viewModes.map((item) => {
            const Icon = item.icon
            return (
              <Button
                key={item.value}
                type="button"
                variant={viewMode === item.value ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode(item.value)}
                className="gap-1.5"
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Button>
            )
          })}
        </div>
      </div>

      {resultLimit && activeTasksCount >= resultLimit && (
        <div className="rounded-md border border-[#E8ECF0] bg-white px-3 py-2 text-sm text-[#6B7280]">
          Показаны ближайшие {resultLimit} активных задач по дедлайну.
        </div>
      )}

      <TaskCards tasks={filteredTasks} layout={viewMode} />
    </div>
  )
}
