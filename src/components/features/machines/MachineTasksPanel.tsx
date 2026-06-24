"use client"

import { useId, useState } from 'react'
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
  const activeTasks = tasks.filter((task) => !['completed', 'cancelled'].includes(task.status)).length

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
                : `${activeTasks} активных из ${tasks.length}`}
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
        <TaskCards tasks={tasks} compact />
      </div>
    </section>
  )
}
