"use client"

import { useId, useState } from 'react'
import { isBefore, startOfToday } from 'date-fns'
import { ChevronDown, ClipboardList } from 'lucide-react'

import { TaskCards } from '@/components/features/tasks/TaskCards'
import type { TaskWithRelations } from '@/lib/actions/tasks'
import { cn } from '@/lib/utils'

interface MachineTasksPanelProps {
  tasks: TaskWithRelations[]
}

export function MachineTasksPanel({ tasks }: MachineTasksPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const contentId = useId()
  const today = startOfToday()
  const groupedTasks = tasks.reduce(
    (groups, task) => {
      if (task.status === 'completed') {
        groups.completed.push(task)
        return groups
      }

      if (task.status === 'cancelled') return groups

      const overdue = isBefore(new Date(task.deadline), today)
      if (overdue) {
        groups.overdue.push(task)
      } else {
        groups.active.push(task)
      }
      return groups
    },
    {
      active: [] as TaskWithRelations[],
      overdue: [] as TaskWithRelations[],
      completed: [] as TaskWithRelations[],
    }
  )
  const activeTasks = groupedTasks.active.length + groupedTasks.overdue.length
  const visibleTasks = activeTasks + groupedTasks.completed.length

  const sections = [
    {
      title: 'Активные',
      tasks: groupedTasks.active,
      empty: 'Нет активных задач без просрочки.',
    },
    {
      title: 'Просроченные',
      tasks: groupedTasks.overdue,
      empty: 'Просроченных задач нет.',
    },
    {
      title: 'Выполнены',
      tasks: groupedTasks.completed,
      empty: 'Выполненных задач пока нет.',
    },
  ]

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={contentId}
        className="flex min-h-16 w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 sm:px-5"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-800">
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold text-slate-950">Задачи</span>
            <span className="mt-0.5 block text-sm text-slate-500">
              {tasks.length === 0
                ? 'Автоматические задачи появятся здесь при необходимости.'
                : `${activeTasks} активных · ${groupedTasks.overdue.length} просроченных · ${groupedTasks.completed.length} выполненных`}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-600 shadow-sm">
          <span className="hidden sm:inline">{isOpen ? 'Свернуть' : 'Показать'}</span>
          <ChevronDown
            className={cn('h-4 w-4 transition-transform duration-200', isOpen && 'rotate-180')}
            aria-hidden="true"
          />
        </span>
      </button>

      <div id={contentId} hidden={!isOpen} className="border-t border-slate-200 p-4 sm:p-5">
        {visibleTasks === 0 ? (
          <TaskCards tasks={[]} compact />
        ) : (
          <div className="space-y-5">
            {sections.map((section) => (
              <section key={section.title} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold uppercase text-slate-500">{section.title}</h3>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium tabular-nums text-slate-600">
                    {section.tasks.length}
                  </span>
                </div>
                {section.tasks.length > 0 ? (
                  <TaskCards tasks={section.tasks} compact emptyMessage={section.empty} />
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                    {section.empty}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
